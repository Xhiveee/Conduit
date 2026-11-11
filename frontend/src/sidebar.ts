import * as App from '../wailsjs/go/main/App';
import { state, onUI, connectHost, activateTab, sessionOpenForHost, refreshHosts, type Tab } from './state';
import { icon } from './icons';
import { openHostEditor } from './host-editor';
import { toastError, toastInfo } from './toast';
import { confirmDialog } from './ui/dialog';
import { contextMenuAt, showMenuAt, type MenuEntry } from './ui';

const root = () => document.getElementById('sidebar')!;

let chromeBuilt = false;
let listEl: HTMLElement | null = null;
let lastSig = '';
let filterText = '';
const collapsed = new Set<string>();

export function renderSidebar() {
    const el = root();
    if (!chromeBuilt) {
        chromeBuilt = true;
        el.innerHTML = '';

        const searchWrap = document.createElement('div');
        searchWrap.className = 'sb-search';
        const searchIcon = icon('search', 14);
        const search = document.createElement('input');
        search.type = 'text';
        search.placeholder = 'Search hosts';
        search.spellcheck = false;
        search.value = filterText;
        search.addEventListener('input', () => { filterText = search.value; renderList(true); });
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
        importBtn.dataset.tip = 'Import from ~/.ssh/config';
        importBtn.append(icon('download', 14), document.createTextNode('Import'));
        importBtn.onclick = () => { void importSSHConfig(); };
        actions.append(newBtn, importBtn);
        el.appendChild(actions);

        listEl = document.createElement('div');
        listEl.className = 'sb-list';
        listEl.id = 'sb-list';
        el.appendChild(listEl);
    }
    renderList(false);
}

function sidebarSig(): string {
    return JSON.stringify([
        state.hosts.map(h => [h.id, h.name, h.address, h.user, h.port, h.group, h.color]),
        state.keys.map(k => [k.path, k.comment, k.type, k.fingerprint, k.encrypted, k.source]),
        state.tabs.map(t => [t.key, t.hostId, t.connected]),
        state.activeKey,
        filterText,
    ]);
}

function renderList(force: boolean) {
    if (!listEl) return;
    const sig = sidebarSig();
    if (!force && sig === lastSig) return;
    lastSig = sig;
    listEl.innerHTML = '';
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
        listEl.appendChild(empty);
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
                renderList(true);
            };
            section.appendChild(head);
            if (!isCollapsed) {
                for (const h of items) section.appendChild(hostRow(h));
            }
            listEl.appendChild(section);
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
        renderList(true);
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
            const isAgent = k.source === 'agent';
            const base = k.path.split(/[\\/]/).pop() || k.path;
            const label = isAgent ? 'agent: ' + (k.comment || k.type || 'key') : base;
            row.dataset.tip = [isAgent ? 'ssh-agent' : k.path, k.fingerprint, k.comment].filter(Boolean).join('\n');
            const top = document.createElement('div');
            top.className = 'kr-top';
            top.appendChild(icon(isAgent ? 'server' : 'file-key', 13));
            const nameEl = document.createElement('span');
            nameEl.className = 'kname';
            nameEl.textContent = label;
            top.appendChild(nameEl);
            const meta = document.createElement('div');
            meta.className = 'kmeta';
            meta.textContent = [k.type, k.fingerprint ? k.fingerprint.slice(0, 24) + '…' : '', k.encrypted ? 'encrypted' : ''].filter(Boolean).join(' · ');
            row.append(top, meta);
            keySection.appendChild(row);
        }
    }
    listEl.appendChild(keySection);
}

function hostAddress(h: (typeof state.hosts)[number]): string {
    return h.user + '@' + h.address + (h.port && h.port !== 22 ? ':' + h.port : '');
}

function hostMenuItems(h: (typeof state.hosts)[number]): MenuEntry[] {
    return [
        { label: 'Edit', icon: 'pencil', onSelect: () => openHostEditor(h) },
        { label: 'Duplicate', icon: 'copy', onSelect: () => { void duplicateHost(h); } },
        { label: 'Copy address', icon: 'clipboard', onSelect: () => { void navigator.clipboard.writeText(hostAddress(h)).catch(toastError); } },
        { sep: true },
        { label: 'Delete', icon: 'trash', danger: true, onSelect: () => { void deleteHost(h); } },
    ];
}

function hostRow(h: (typeof state.hosts)[number]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'host-row';
    const connected = sessionOpenForHost(h.id);
    const activeTab = state.tabs.find((t: Tab) => t.hostId === h.id && t.key === state.activeKey && t.connected);
    if (activeTab) row.classList.add('active');
    if (connected) row.classList.add('connected');

    const dot = document.createElement('span');
    dot.className = 'hr-dot';
    if (h.color) dot.style.background = h.color;
    row.appendChild(dot);

    const txt = document.createElement('div');
    txt.className = 'hr-text';
    const name = document.createElement('div');
    name.className = 'hr-name';
    name.textContent = h.name || h.user + '@' + h.address;
    const sub = document.createElement('div');
    sub.className = 'hr-sub';
    sub.textContent = hostAddress(h);
    txt.append(name, sub);
    row.appendChild(txt);

    if (connected) {
        const live = document.createElement('span');
        live.className = 'hr-live';
        live.dataset.tip = 'Connected';
        row.appendChild(live);
    }

    const actions = document.createElement('span');
    actions.className = 'row-actions';
    const connectBtn = document.createElement('button');
    connectBtn.className = 'row-act';
    connectBtn.dataset.tip = 'Connect';
    connectBtn.appendChild(icon('plug', 14));
    connectBtn.onclick = ev => { ev.stopPropagation(); void connectHost(h); };
    const moreBtn = document.createElement('button');
    moreBtn.className = 'row-act';
    moreBtn.dataset.tip = 'More';
    moreBtn.appendChild(icon('more-horizontal', 14));
    moreBtn.onclick = ev => {
        ev.stopPropagation();
        const r = moreBtn.getBoundingClientRect();
        showMenuAt(hostMenuItems(h), r.left - 9.5 * 16, r.bottom + 4);
    };
    actions.append(connectBtn, moreBtn);
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
    row.oncontextmenu = ev => {
        contextMenuAt(hostMenuItems(h), ev);
    };
    return row;
}

async function duplicateHost(h: (typeof state.hosts)[number]) {
    const copy = { ...h, id: '', name: (h.name || h.address) + ' copy' };
    try {
        await App.SaveHost(copy);
        await refreshHosts();
    } catch (err) {
        toastError(err);
    }
}

async function deleteHost(h: (typeof state.hosts)[number]) {
    const ok = await confirmDialog({
        title: 'Delete host',
        message: `Delete host "${h.name || h.address}"?`,
        confirmLabel: 'Delete',
        danger: true,
    });
    if (!ok) return;
    try {
        await App.DeleteHost(h.id);
        await refreshHosts();
    } catch (err) {
        toastError(err);
    }
}

export async function importSSHConfig() {
    try {
        const added = await App.ImportSSHConfig();
        await refreshHosts();
        if (added.length === 0) {
            toastInfo('No new hosts found in ~/.ssh/config');
        }
    } catch (err) {
        toastError(err);
    }
}

onUI(() => renderSidebar());
