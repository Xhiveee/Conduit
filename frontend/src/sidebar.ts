import * as App from '../wailsjs/go/main/App';
import { state, onUI, connectHost, activateTab, sessionOpenForHost, refreshHosts, type Tab } from './state';
import { icon } from './icons';
import { openHostEditor } from './host-editor';

const root = () => document.getElementById('sidebar')!;

export function renderSidebar() {
    const el = root();
    el.innerHTML = '';

    const searchWrap = document.createElement('div');
    searchWrap.className = 'sb-search';
    const searchIcon = icon('search', 14);
    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Search hosts';
    search.spellcheck = false;
    search.value = filterText;
    search.addEventListener('input', () => { filterText = search.value; renderList(); });
    searchWrap.append(searchIcon, search);
    el.appendChild(searchWrap);

    const actions = document.createElement('div');
    actions.className = 'sb-actions';
    const newBtn = document.createElement('button');
    newBtn.className = 'sb-btn primary';
    newBtn.append(icon('plus', 14), document.createTextNode('New host'));
    newBtn.onclick = () => openHostEditor(null);
    const importBtn = document.createElement('button');
    importBtn.className = 'sb-btn';
    importBtn.title = 'Import from ~/.ssh/config';
    importBtn.append(icon('download', 14), document.createTextNode('Import'));
    importBtn.onclick = () => { void doImport(); };
    actions.append(newBtn, importBtn);
    el.appendChild(actions);

    const list = document.createElement('div');
    list.className = 'sb-list';
    list.id = 'sb-list';
    el.appendChild(list);
    renderList();
}

let filterText = '';
let collapsed = new Set<string>();

function renderList() {
    const list = document.getElementById('sb-list');
    if (!list) return;
    list.innerHTML = '';
    const q = filterText.trim().toLowerCase();
    const hosts = state.hosts.filter(h =>
        !q || [h.name, h.address, h.user, h.group].some(v => (v || '').toLowerCase().includes(q))
    );

    if (hosts.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'sb-empty';
        empty.textContent = state.hosts.length === 0
            ? 'No hosts yet. Add one or import your ssh config.'
            : 'No hosts match your search.';
        list.appendChild(empty);
    } else {
        const groups = new Map<string, typeof hosts>();
        for (const h of hosts) {
            const g = h.group || '';
            if (!groups.has(g)) groups.set(g, []);
            groups.get(g)!.push(h);
        }
        const sorted = [...groups.entries()].sort(([a], [b]) => {
            if (a === '') return -1;
            if (b === '') return 1;
            return a.localeCompare(b);
        });
        for (const [group, items] of sorted) {
            const section = document.createElement('div');
            section.className = 'sb-section';
            const head = document.createElement('button');
            head.className = 'sb-section-head';
            const isCollapsed = collapsed.has(group);
            head.append(
                icon(isCollapsed ? 'chevron-right' : 'chevron-down', 13),
                document.createTextNode(group === '' ? 'Hosts' : group),
            );
            const count = document.createElement('span');
            count.className = 'count';
            count.textContent = String(items.length);
            head.appendChild(count);
            head.onclick = () => {
                if (collapsed.has(group)) collapsed.delete(group); else collapsed.add(group);
                renderList();
            };
            section.appendChild(head);
            if (!isCollapsed) {
                for (const h of items) section.appendChild(hostRow(h));
            }
            list.appendChild(section);
        }
    }

    const keySection = document.createElement('div');
    keySection.className = 'sb-section';
    const keyHead = document.createElement('button');
    keyHead.className = 'sb-section-head';
    const keyCollapsed = collapsed.has('__keys__');
    keyHead.append(
        icon(keyCollapsed ? 'chevron-right' : 'chevron-down', 13),
        icon('key-round', 13),
        document.createTextNode('Keys'),
    );
    const kcount = document.createElement('span');
    kcount.className = 'count';
    kcount.textContent = String(state.keys.length);
    keyHead.appendChild(kcount);
    keyHead.onclick = () => {
        if (collapsed.has('__keys__')) collapsed.delete('__keys__'); else collapsed.add('__keys__');
        renderList();
    };
    keySection.appendChild(keyHead);
    if (!keyCollapsed) {
        if (state.keys.length === 0) {
            const none = document.createElement('div');
            none.className = 'sb-empty';
            none.style.padding = '8px 16px';
            none.textContent = 'No keys found in ~/.ssh';
            keySection.appendChild(none);
        }
        for (const k of state.keys) {
            const row = document.createElement('div');
            row.className = 'key-row';
            row.title = k.path;
            const ic = icon(k.source === 'agent' ? 'server' : 'file-key', 13);
            const nameEl = document.createElement('span');
            nameEl.className = 'kname';
            nameEl.textContent = k.comment || k.type || 'key';
            const meta = document.createElement('span');
            meta.className = 'kmeta';
            meta.textContent = (k.source === 'agent' ? 'agent · ' : '') + (k.encrypted ? 'encrypted · ' : '') + (k.fingerprint || '').slice(0, 20);
            row.append(ic, nameEl, meta);
            keySection.appendChild(row);
        }
    }
    list.appendChild(keySection);
}

function hostRow(h: (typeof state.hosts)[number]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'host-row';
    const connected = sessionOpenForHost(h.id);
    const activeTab = state.tabs.find((t: Tab) => t.hostId === h.id && t.key === state.activeKey && t.connected);
    if (activeTab) row.classList.add('active');

    const dot = document.createElement('span');
    dot.className = 'dot' + (connected ? ' on' : '');
    if (h.color) dot.style.background = h.color;
    row.appendChild(dot);

    const name = document.createElement('span');
    name.className = 'hn';
    name.textContent = h.name || h.user + '@' + h.address;
    name.style.maxWidth = '110px';
    row.appendChild(name);

    const sub = document.createElement('span');
    sub.className = 'hs';
    sub.textContent = h.user + '@' + h.address + (h.port && h.port !== 22 ? ':' + h.port : '');
    row.appendChild(sub);

    const actions = document.createElement('span');
    actions.className = 'row-actions';
    const mk = (ic: string, title: string, fn: () => void, danger = false) => {
        const b = document.createElement('button');
        b.className = 'row-act' + (danger ? ' danger' : '');
        b.title = title;
        b.appendChild(icon(ic, 14));
        b.onclick = ev => { ev.stopPropagation(); fn(); };
        return b;
    };
    actions.append(
        mk('plug', 'Connect', () => { void connectHost(h); }),
        mk('pencil', 'Edit', () => openHostEditor(h)),
        mk('copy', 'Duplicate', () => { void duplicateHost(h); }),
        mk('trash', 'Delete', () => { void deleteHost(h); }, true),
    );
    row.appendChild(actions);

    row.onclick = ev => {
        if ((ev.target as HTMLElement).closest('.row-actions')) return;
        const existing = state.tabs.find(t => t.hostId === h.id && t.connected);
        if (existing) {
            activateTab(existing.key);
        } else {
            void connectHost(h);
        }
    };
    return row;
}

async function duplicateHost(h: (typeof state.hosts)[number]) {
    const copy = { ...h, id: '', name: (h.name || h.address) + ' copy' };
    await App.SaveHost(copy);
    await refreshHosts();
}

async function deleteHost(h: (typeof state.hosts)[number]) {
    if (!confirm(`Delete host "${h.name || h.address}"?`)) return;
    await App.DeleteHost(h.id);
    await refreshHosts();
}

async function doImport() {
    try {
        const added = await App.ImportSSHConfig();
        await refreshHosts();
        if (added.length === 0) {
            alert('No new hosts found in ~/.ssh/config');
        }
    } catch (err) {
        alert('Import failed: ' + String(err));
    }
}

onUI(() => renderSidebar());
