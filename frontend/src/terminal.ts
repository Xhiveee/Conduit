import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import * as App from '../wailsjs/go/main/App';
import { state, settingsOrDefault, themeSettings, applyTermOptions, connectHost, retryTab, reconnectTab, onTabClosed, fitTab, activeTab, ensureTermFont, writeTermData, type Tab } from './state';
import { currentXtermTheme } from './themes';
import { icon } from './icons';
import { toastError } from './toast';
import { openHostEditor } from './host-editor';
import { importSSHConfig } from './sidebar';
import { enhanceQuickConnect } from './quick-connect';

onTabClosed(tab => {
    tab.term?.dispose();
    tab.term = null;
    tab.fit = null;
    tab.search = null;
});

const termsRoot = () => document.getElementById('terms')!;
const emptyRoot = () => document.getElementById('empty')!;

export function syncTerminals() {
    const root = termsRoot();
    for (const tab of state.tabs) {
        if (!tab.termEl) {
            void createTermHost(tab);
        }
        tab.termEl!.classList.toggle('active', tab.key === state.activeKey);
        tab.termEl!.querySelector('.term-frame')?.classList.toggle('agent-active', tab.agentActive);
        syncDiscBar(tab);
    }
    for (const child of Array.from(root.children)) {
        if (child.id === 'empty') continue;
        const key = (child as HTMLElement).dataset.key;
        if (key && !state.tabs.some(t => t.key === key)) {
            child.remove();
        }
    }
    emptyRoot().classList.toggle('hidden', state.tabs.length > 0);
    renderEmpty();
}

async function createTermHost(tab: Tab) {
    const root = termsRoot();
    const host = document.createElement('div');
    host.className = 'term-host';
    host.dataset.key = tab.key;
    const frame = document.createElement('div');
    frame.className = 'term-frame';
    const inner = document.createElement('div');
    inner.className = 'term-inner';
    frame.appendChild(inner);
    host.appendChild(frame);
    root.insertBefore(host, emptyRoot());
    tab.termEl = host;

    if (tab.error) {
        renderError(tab);
        return;
    }
    if (!tab.sessionId) return;

    await ensureTermFont().catch(toastError);
    const s = settingsOrDefault();
    const term = new Terminal({
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        cursorStyle: (s.cursorStyle || 'bar') as 'block' | 'underline' | 'bar',
        cursorBlink: s.cursorBlink,
        scrollback: s.scrollback,
        theme: currentXtermTheme(themeSettings()),
        allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(new Unicode11Addon());
    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    tab.search = searchAddon;
    term.open(inner);
    tab.term = term;
    tab.fit = fit;
    applyTermOptions(tab);
    if (tab.pendingData?.length) {
        for (const d of tab.pendingData) writeTermData(tab, d);
        tab.pendingData = [];
    }

    term.onData(data => {
        if (tab.sessionId && tab.connected) {
            App.Write(tab.sessionId, data).catch(toastError);
        }
    });
    term.attachCustomKeyEventHandler(ev => handleTermKey(ev, term, tab));
    term.onSelectionChange(() => {
        const st = settingsOrDefault();
        if (st.copyOnSelect && term.hasSelection()) {
            const sel = term.getSelection();
            if (sel) navigator.clipboard.writeText(sel).catch(toastError);
        }
    });
    inner.addEventListener('contextmenu', ev => {
        const st = settingsOrDefault();
        if (!st.rightClickPaste) return;
        ev.preventDefault();
        navigator.clipboard.readText().then(t => { if (t) term.paste(t); }).catch(toastError);
    });

    const ro = new ResizeObserver(() => {
        requestAnimationFrame(() => fitTab(tab));
    });
    ro.observe(inner);
    if (tab.key === state.activeKey) {
        requestAnimationFrame(() => fitTab(tab));
    }
}

export function fitActive() {
    const tab = activeTab();
    if (tab) fitTab(tab);
}

function syncDiscBar(tab: Tab) {
    const frame = tab.termEl?.querySelector('.term-frame');
    if (!frame) return;
    let bar = frame.querySelector('.disc-bar') as HTMLElement | null;
    const show = !!tab.sessionId && !tab.connected && !tab.error;
    frame.classList.toggle('has-disc', show);
    if (!show) {
        bar?.remove();
        return;
    }
    if (!bar) {
        bar = document.createElement('div');
        bar.className = 'disc-bar';
        const reason = document.createElement('span');
        reason.className = 'disc-reason';
        const btn = document.createElement('button');
        btn.className = 'btn small';
        btn.textContent = 'Reconnect';
        btn.onclick = () => { void reconnectTab(tab); };
        bar.append(reason, btn);
        frame.appendChild(bar);
    }
    const reason = bar.querySelector('.disc-reason')!;
    reason.textContent = 'Disconnected' + (tab.closedReason ? ' · ' + tab.closedReason : '');
}

function hexToRgb(hex: string): [number, number, number] {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function mixHex(fg: string, bg: string, t: number): string {
    const f = hexToRgb(fg);
    const b = hexToRgb(bg);
    const c = f.map((v, i) => Math.round(v * t + b[i] * (1 - t)));
    return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}

function searchDecoOptions() {
    const cs = getComputedStyle(document.documentElement);
    const rawA = cs.getPropertyValue('--accent').trim();
    const rawB = cs.getPropertyValue('--bg').trim();
    const accent = /^#[0-9a-f]{6,8}$/i.test(rawA) ? rawA : '#86c294';
    const bg = /^#[0-9a-f]{6,8}$/i.test(rawB) ? rawB : '#0f1012';
    return {
        decorations: {
            matchBackground: mixHex(accent, bg, 0.28),
            activeMatchBackground: mixHex(accent, bg, 0.5),
            matchOverviewRuler: accent,
            activeMatchColorOverviewRuler: accent,
        },
    };
}

export function toggleSearch() {
    const tab = activeTab();
    if (!tab?.term || !tab.search) return;
    const frame = tab.termEl?.querySelector('.term-frame');
    if (!frame) return;
    let box = frame.querySelector('.term-search') as HTMLElement | null;
    if (box) {
        closeSearch(tab, box);
        return;
    }
    box = document.createElement('div');
    box.className = 'term-search no-drag';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Search';
    input.spellcheck = false;
    const count = document.createElement('span');
    count.className = 'ts-count';
    const mkBtn = (ic: string, tip: string, fn: () => void) => {
        const b = document.createElement('button');
        b.className = 'ts-btn';
        b.dataset.tip = tip;
        b.appendChild(icon(ic, 13));
        b.onclick = fn;
        return b;
    };
    const doSearch = (prev: boolean) => {
        const q = input.value;
        if (!q) {
            tab.search!.clearDecorations();
            count.textContent = '';
            return;
        }
        const opts = searchDecoOptions();
        const found = prev ? tab.search!.findPrevious(q, opts) : tab.search!.findNext(q, opts);
        if (!found) count.textContent = 'no match';
    };
    tab.search.onDidChangeResults(r => {
        count.textContent = r.resultCount > 0
            ? `${r.resultIndex + 1} of ${r.resultCount}`
            : 'no match';
    });
    input.addEventListener('input', () => doSearch(false));
    input.addEventListener('keydown', ev => {
        ev.stopPropagation();
        if (ev.key === 'Enter') {
            ev.preventDefault();
            doSearch(ev.shiftKey);
        } else if (ev.key === 'Escape') {
            ev.preventDefault();
            closeSearch(tab, box!);
        }
    });
    box.append(
        input,
        count,
        mkBtn('chevron-up', 'Previous (Shift+Enter)', () => doSearch(true)),
        mkBtn('chevron-down', 'Next (Enter)', () => doSearch(false)),
        mkBtn('x', 'Close (Esc)', () => closeSearch(tab, box!)),
    );
    frame.appendChild(box);
    input.focus();
}

function closeSearch(tab: Tab, box: HTMLElement) {
    tab.search?.clearDecorations();
    box.remove();
    tab.term?.focus();
}

const APP_SHORTCUT_KEYS = new Set(['b', 'j', 'l', 't', 'f', 'w']);

function handleTermKey(ev: KeyboardEvent, term: Terminal, tab: Tab): boolean {
    if (ev.ctrlKey && ev.shiftKey && !ev.altKey) {
        const k = ev.key.toLowerCase();
        if (k === 'c') {
            if (term.hasSelection()) {
                navigator.clipboard.writeText(term.getSelection()).catch(toastError);
                return false;
            }
            return true;
        }
        if (k === 'v') {
            navigator.clipboard.readText().then(t => { if (t) term.paste(t); }).catch(toastError);
            return false;
        }
        if (APP_SHORTCUT_KEYS.has(k)) return false;
    }
    if (ev.ctrlKey && !ev.altKey && ev.key === ',') return false;
    if (ev.ctrlKey && !ev.shiftKey && !ev.altKey && ev.key === 'Tab') return false;
    if (tab.sessionId && !tab.connected && !tab.error && ev.key === 'Enter' && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        ev.preventDefault();
        void reconnectTab(tab);
        return false;
    }
    return true;
}

function renderError(tab: Tab) {
    const host = tab.termEl!;
    const frame = host.querySelector('.term-frame')!;
    frame.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'term-error';
    const iconEl = icon('alert-triangle', 28);
    iconEl.style.color = 'var(--danger)';
    const msg = document.createElement('div');
    msg.className = 'err-msg';
    msg.textContent = tab.error;
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = 'Retry';
    btn.onclick = () => { void retryTab(tab); };
    box.append(iconEl, msg, btn);
    frame.appendChild(box);
}

function renderEmpty() {
    const el = emptyRoot();
    el.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'empty-qc';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'user@host:port';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.id = 'empty-quick-connect';
    wrap.appendChild(input);
    enhanceQuickConnect(input);
    el.appendChild(wrap);

    if (state.hosts.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'empty-hint';
        hint.textContent = 'Press Enter to connect. Keys from ~/.ssh and the ssh agent are tried automatically.';
        el.appendChild(hint);
        const btns = document.createElement('div');
        btns.className = 'empty-actions';
        const newBtn = document.createElement('button');
        newBtn.className = 'btn primary';
        newBtn.textContent = 'New host';
        newBtn.onclick = () => openHostEditor(null);
        const importBtn = document.createElement('button');
        importBtn.className = 'btn';
        importBtn.textContent = 'Import ssh config';
        importBtn.onclick = () => { void importSSHConfig(); };
        btns.append(newBtn, importBtn);
        el.appendChild(btns);
        return;
    }

    const title = document.createElement('div');
    title.className = 'empty-title';
    title.textContent = 'or connect to a host';
    el.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'empty-hosts';
    for (const h of state.hosts.slice(0, 12)) {
        const card = document.createElement('button');
        card.className = 'empty-host';
        const dot = document.createElement('span');
        dot.className = 'dot';
        if (h.color) dot.style.background = h.color;
        const txt = document.createElement('span');
        txt.style.flex = '1';
        txt.style.textAlign = 'left';
        const name = document.createElement('div');
        name.className = 'eh-name';
        name.textContent = h.name || h.user + '@' + h.address;
        const sub = document.createElement('div');
        sub.className = 'eh-sub';
        sub.textContent = h.user + '@' + h.address + (h.port && h.port !== 22 ? ':' + h.port : '');
        txt.append(name, sub);
        card.append(dot, txt);
        card.onclick = () => { void connectHost(h); };
        grid.appendChild(card);
    }
    el.appendChild(grid);
}
