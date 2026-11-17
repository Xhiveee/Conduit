import { state, activateTab, activeTab, closeTab, cycleTab, reconnectTab, retryTab, duplicateTab, moveTab, isTabClosing, type Tab } from './state';
import { icon } from './icons';
import { contextMenuAt, type MenuEntry } from './ui';
import { tr, getLang } from './i18n';

const bar = () => document.getElementById('tabbar')!;
const els = new Map<string, HTMLElement>();
let builtLang = '';

export function renderTabs() {
    const el = bar();
    const lang = getLang();
    if (builtLang !== lang) {
        builtLang = lang;
        for (const node of els.values()) node.remove();
        els.clear();
        el.querySelector('.new-tab')?.remove();
    }
    const seen = new Set<string>();
    state.tabs.forEach((tab, i) => {
        seen.add(tab.key);
        let node = els.get(tab.key);
        if (!node) {
            node = tabEl(tab);
            els.set(tab.key, node);
        }
        node.classList.toggle('active', tab.key === state.activeKey);
        node.classList.toggle('closing', isTabClosing(tab.key));
        const color = tab.color || '';
        if (color) {
            node.classList.add('has-color');
            node.style.setProperty('--tab-color', color);
        } else {
            node.classList.remove('has-color');
            node.style.removeProperty('--tab-color');
        }
        const dot = node.querySelector('.t-dot') as HTMLElement;
        dot.className = 't-dot' + (tab.error ? ' err' : tab.connecting ? ' conn' : tab.agentActive ? ' agent' : tab.connected ? ' on' : '');
        const title = node.querySelector('.t-title') as HTMLElement;
        if (title.textContent !== tab.title) title.textContent = tab.title;
        node.dataset.tip = tab.closedReason || tab.error ? tab.title + ' — ' + (tab.closedReason || tab.error) : tab.title;
        const agentTag = node.querySelector('.t-agent') as HTMLElement | null;
        if (tab.agentActive && !agentTag) {
            const ag = document.createElement('span');
            ag.className = 't-agent';
            ag.textContent = tr('Agent typing');
            node.insertBefore(ag, node.querySelector('.t-close'));
        } else if (!tab.agentActive && agentTag) {
            agentTag.remove();
        }
        if (el.children[i] !== node) el.insertBefore(node, el.children[i] ?? null);
    });
    for (const [key, node] of els) {
        if (!seen.has(key)) {
            node.remove();
            els.delete(key);
        }
    }
    let add = el.querySelector('.new-tab') as HTMLElement | null;
    if (!add) {
        add = document.createElement('button');
        add.className = 'tab new-tab';
        add.dataset.tip = tr('New quick connect');
        add.dataset.tipKeys = 'Ctrl+Shift+T';
        add.appendChild(icon('plus', 15));
        add.onclick = () => focusQuickConnect();
        el.appendChild(add);
    }
}

function tabEl(tab: Tab): HTMLElement {
    const el = document.createElement('div');
    el.className = 'tab';
    el.draggable = true;
    el.dataset.key = tab.key;

    const dot = document.createElement('span');
    dot.className = 't-dot';
    el.appendChild(dot);

    const title = document.createElement('span');
    title.className = 't-title';
    title.textContent = tab.title;
    el.appendChild(title);

    const close = document.createElement('button');
    close.className = 't-close';
    close.appendChild(icon('x', 12));
    close.onclick = ev => { ev.stopPropagation(); closeTab(tab.key); };
    el.appendChild(close);

    el.onclick = () => activateTab(tab.key);
    el.tabIndex = 0;
    el.onkeydown = ev => {
        if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            activateTab(tab.key);
        }
    };
    el.onauxclick = ev => { if (ev.button === 1) closeTab(tab.key); };
    el.oncontextmenu = ev => {
        const items: MenuEntry[] = [];
        if (tab.error && tab.pending) {
            items.push({ label: tr('Retry'), icon: 'rotate-ccw', onSelect: () => { void retryTab(tab); } });
        } else if (tab.sessionId && !tab.connected) {
            items.push({ label: tr('Reconnect'), icon: 'rotate-ccw', onSelect: () => { void reconnectTab(tab); } });
        }
        items.push(
            { label: tr('Duplicate session'), icon: 'copy', onSelect: () => { void duplicateTab(tab); } },
            { sep: true },
            { label: tr('Close'), icon: 'x', shortcut: 'Ctrl+Shift+W', onSelect: () => closeTab(tab.key) },
            { label: tr('Close others'), icon: 'x', onSelect: () => closeOthers(tab.key) },
        );
        contextMenuAt(items, ev);
    };

    el.ondragstart = ev => {
        ev.dataTransfer?.setData('text/plain', tab.key);
        if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
        el.classList.add('dragging');
    };
    el.ondragend = () => el.classList.remove('dragging');
    el.ondragover = ev => {
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
        const dragging = document.querySelector('.tab.dragging');
        if (dragging && dragging !== el) {
            const rect = el.getBoundingClientRect();
            const after = ev.clientX > rect.left + rect.width / 2;
            el.classList.toggle('drop-after', after);
            el.classList.toggle('drop-before', !after);
        }
    };
    el.ondragleave = () => {
        el.classList.remove('drop-after', 'drop-before');
    };
    el.ondrop = ev => {
        ev.preventDefault();
        el.classList.remove('drop-after', 'drop-before');
        const key = ev.dataTransfer?.getData('text/plain') ?? '';
        if (!key || key === tab.key) return;
        const from = state.tabs.findIndex(t => t.key === key);
        const rect = el.getBoundingClientRect();
        let to = state.tabs.findIndex(t => t.key === tab.key);
        if (ev.clientX > rect.left + rect.width / 2) to += 1;
        if (from < 0 || to < 0) return;
        const adjusted = from < to ? to - 1 : to;
        moveTab(key, adjusted);
    };
    return el;
}

function closeOthers(keepKey: string) {
    for (const t of [...state.tabs]) {
        if (t.key !== keepKey) closeTab(t.key);
    }
}

export function focusQuickConnect() {
    const qc = document.getElementById('quick-connect') as HTMLInputElement | null;
    qc?.focus();
    qc?.select();
}

export function handleTabShortcut(e: KeyboardEvent) {
    if (!e.ctrlKey || e.altKey) return false;
    if (e.key === 'Tab') {
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
        return true;
    }
    if (e.shiftKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        const t = activeTab();
        if (t) closeTab(t.key);
        return true;
    }
    return false;
}
