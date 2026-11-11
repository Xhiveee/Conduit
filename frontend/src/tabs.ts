import { state, activateTab, closeTab, cycleTab, type Tab } from './state';
import { icon } from './icons';

const bar = () => document.getElementById('tabbar')!;

export function renderTabs() {
    const el = bar();
    el.innerHTML = '';
    for (const tab of state.tabs) {
        el.appendChild(tabEl(tab));
    }
    const add = document.createElement('button');
    add.className = 'tab new-tab';
    add.dataset.tip = 'New quick connect';
    add.dataset.tipKeys = 'Ctrl+Shift+T';
    add.appendChild(icon('plus', 15));
    add.onclick = () => focusQuickConnect();
    el.appendChild(add);
}

function tabEl(tab: Tab): HTMLElement {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.key === state.activeKey ? ' active' : '');
    if (tab.color) {
        el.classList.add('has-color');
        el.style.setProperty('--tab-color', tab.color);
    }
    if (tab.closedReason || tab.error) {
        el.dataset.tip = tab.title + ' — ' + (tab.closedReason || tab.error);
    } else {
        el.dataset.tip = tab.title;
    }
    el.onclick = () => activateTab(tab.key);
    el.onauxclick = ev => { if (ev.button === 1) closeTab(tab.key); };

    const dot = document.createElement('span');
    dot.className = 't-dot';
    if (tab.error) dot.classList.add('err');
    else if (tab.agentActive) dot.classList.add('agent');
    else if (tab.connected) dot.classList.add('on');
    el.appendChild(dot);

    const title = document.createElement('span');
    title.className = 't-title';
    title.textContent = tab.title;
    el.appendChild(title);

    if (tab.agentActive) {
        const ag = document.createElement('span');
        ag.className = 't-agent';
        ag.textContent = 'Agent typing';
        el.appendChild(ag);
    }

    const close = document.createElement('button');
    close.className = 't-close';
    close.appendChild(icon('x', 12));
    close.onclick = ev => { ev.stopPropagation(); closeTab(tab.key); };
    el.appendChild(close);
    return el;
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
        if (state.activeKey) closeTab(state.activeKey);
        return true;
    }
    return false;
}
