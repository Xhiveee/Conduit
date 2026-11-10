import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { EventsOn } from '../wailsjs/runtime/runtime';
import * as App from '../wailsjs/go/main/App';
import type { main } from '../wailsjs/go/models';
import { applyTheme, currentXtermTheme, resolveTheme, type ThemeDef } from './themes';
import { toastError } from './toast';

export interface Tab {
    key: string;
    sessionId: string;
    title: string;
    hostId: string;
    color: string;
    user: string;
    address: string;
    connected: boolean;
    agentActive: boolean;
    closedReason: string;
    error: string;
    pending: { hostId?: string; target?: string } | null;
    term: Terminal | null;
    fit: FitAddon | null;
    termEl: HTMLElement | null;
}

export interface AgentMsg {
    id: number;
    kind: 'user' | 'assistant' | 'note' | 'tool';
    role?: string;
    content?: string;
    tool?: ToolCard;
}

export interface ToolCard {
    callId: string;
    name: string;
    args: string;
    status: string;
    result: string;
    open: boolean;
}

export const state = {
    settings: null as main.Settings | null,
    hosts: [] as main.Host[],
    keys: [] as main.KeyInfo[],
    sessions: [] as main.SessionInfo[],
    tabs: [] as Tab[],
    activeKey: '',
    agentMessages: [] as AgentMsg[],
    agentTools: new Map<string, ToolCard>(),
    agentBusy: false,
    msgSeq: 0,
};

const listeners = new Set<() => void>();
const tabCleanups = new Set<(tab: Tab) => void>();

export function onUI(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function onTabClosed(fn: (tab: Tab) => void): void {
    tabCleanups.add(fn);
}

export function notify() {
    listeners.forEach(fn => fn());
}

export function activeTab(): Tab | null {
    return state.tabs.find(t => t.key === state.activeKey) ?? null;
}

export function tabBySession(sessionId: string): Tab | undefined {
    return state.tabs.find(t => t.sessionId === sessionId || t.key === sessionId);
}

export function agentTargetId(): string {
    const t = activeTab();
    return t && t.connected ? t.sessionId : '';
}

let msgId = 0;
export function nextMsgId(): number {
    return ++msgId;
}

export async function init() {
    const [settings, hosts, keys, sessions] = await Promise.all([
        App.GetSettings(),
        App.ListHosts(),
        App.ListKeys(),
        App.ListSessions(),
    ]);
    state.settings = settings;
    state.hosts = hosts;
    state.keys = keys;
    state.sessions = sessions;
    applyAll();
    wireEvents();
    notify();
}

export function settingsOrDefault(): main.Settings {
    return state.settings as main.Settings;
}

export function customThemes(): ThemeDef[] {
    return (state.settings?.customThemes ?? []) as unknown as ThemeDef[];
}

export function themeSettings() {
    const s = settingsOrDefault();
    return { themeId: s.themeId, customThemes: customThemes() };
}

export function applyAll() {
    const s = settingsOrDefault();
    applyTheme(resolveTheme(themeSettings()));
    document.body.classList.toggle('agent-right', s.agentSide !== 'left');
    document.body.classList.toggle('agent-left', s.agentSide === 'left');
    document.documentElement.style.setProperty('--sidebar-w', s.sidebarWidth + 'px');
    document.documentElement.style.setProperty('--agent-w', s.agentWidth + 'px');
    document.documentElement.style.zoom = String(s.uiScale || 1);
    const sidebar = document.getElementById('sidebar');
    const agent = document.getElementById('agent');
    const splitS = document.getElementById('split-sidebar');
    const splitA = document.getElementById('split-agent');
    if (sidebar) sidebar.classList.toggle('hidden-panel', !s.sidebarVisible);
    if (agent) agent.classList.toggle('hidden-panel', !s.agentVisible);
    if (splitS) splitS.classList.toggle('hidden', !s.sidebarVisible);
    if (splitA) splitA.classList.toggle('hidden', !s.agentVisible);
    if (s.customCss) {
        let el = document.getElementById('custom-css');
        if (!el) {
            el = document.createElement('style');
            el.id = 'custom-css';
            document.head.appendChild(el);
        }
        el.textContent = s.customCss;
    } else {
        document.getElementById('custom-css')?.remove();
    }
    state.tabs.forEach(t => applyTermOptions(t));
}

export function applyTermOptions(tab: Tab) {
    const s = settingsOrDefault();
    if (!tab.term) return;
    const cur = currentXtermTheme(themeSettings());
    tab.term.options.theme = cur;
    tab.term.options.fontFamily = s.fontFamily;
    tab.term.options.fontSize = s.fontSize;
    tab.term.options.lineHeight = s.lineHeight;
    tab.term.options.cursorStyle = (s.cursorStyle || 'bar') as 'block' | 'underline' | 'bar';
    tab.term.options.cursorBlink = s.cursorBlink;
    tab.term.options.scrollback = s.scrollback;
}

function wireEvents() {
    EventsOn('session:opened', (info: main.SessionInfo) => {
        upsertSessionTab(info);
        state.sessions = state.sessions.filter(s => s.id !== info.id).concat([info]);
        notify();
    });
    EventsOn('session:data', (id: string, b64: string) => {
        const tab = tabBySession(id);
        if (!tab?.term) return;
        try {
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            tab.term.write(bytes);
        } catch (err) {
            toastError(err);
        }
    });
    EventsOn('screen:request', (requestId: string, sessionId: string, lines: number) => {
        const term = tabBySession(sessionId)?.term;
        if (!term) return;
        const buf = term.buffer.active;
        const count = Math.max(1, lines || 60);
        const out: string[] = [];
        for (let y = Math.max(0, buf.length - count); y < buf.length; y++) {
            const line = buf.getLine(y);
            out.push(line ? line.translateToString(true) : '');
        }
        while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
        App.ScreenReply(requestId, out.join('\n')).catch(toastError);
    });
    EventsOn('session:closed', (id: string, reason: string) => {
        const tab = tabBySession(id);
        if (tab) {
            tab.connected = false;
            tab.closedReason = reason;
            state.sessions = state.sessions.filter(s => s.id !== id);
            notify();
        }
    });
    EventsOn('session:agent', (id: string, active: boolean) => {
        const tab = tabBySession(id);
        if (tab) {
            tab.agentActive = !!active;
            notify();
        }
    });
    EventsOn('settings:changed', (st: main.Settings) => {
        state.settings = st;
        applyAll();
        notify();
    });
    EventsOn('ui:focus', (id: string) => {
        activateTab(id);
    });
    EventsOn('agent:message', (m: { role: string; content: string }) => {
        state.agentMessages.push({ id: nextMsgId(), kind: m.role === 'user' ? 'user' : 'assistant', role: m.role, content: m.content });
        notify();
    });
    EventsOn('agent:tool', (t: ToolCard) => {
        const existing = state.agentTools.get(t.callId);
        const merged: ToolCard = { ...(existing ?? { callId: t.callId, name: t.name, args: t.args, result: '', open: false }), ...t };
        state.agentTools.set(t.callId, merged);
        if (existing) {
            const idx = state.agentMessages.findIndex(m => m.tool?.callId === t.callId);
            if (idx >= 0) state.agentMessages[idx].tool = merged;
        } else {
            state.agentMessages.push({ id: nextMsgId(), kind: 'tool', tool: merged });
        }
        notify();
    });
    EventsOn('agent:busy', (busy: boolean) => {
        state.agentBusy = !!busy;
        notify();
    });
    EventsOn('agent:error', (msg: string) => {
        state.agentMessages.push({ id: nextMsgId(), kind: 'note', content: msg });
        notify();
    });
}

export function upsertSessionTab(info: main.SessionInfo) {
    let tab = tabBySession(info.id);
    if (!tab) {
        tab = {
            key: info.id,
            sessionId: info.id,
            title: info.title || info.user + '@' + info.address,
            hostId: info.hostId || '',
            color: info.color || '',
            user: info.user || '',
            address: info.address || '',
            connected: true,
            agentActive: false,
            closedReason: '',
            error: '',
            pending: null,
            term: null,
            fit: null,
            termEl: null,
        };
        state.tabs.push(tab);
    } else {
        tab.title = info.title || tab.title;
        tab.connected = true;
        tab.closedReason = '';
        tab.error = '';
    }
    state.activeKey = tab.key;
}

export function activateTab(key: string) {
    const tab = state.tabs.find(t => t.key === key);
    if (!tab) return;
    state.activeKey = key;
    notify();
    requestAnimationFrame(() => {
        state.tabs.forEach(t => t.termEl?.classList.toggle('active', t.key === key));
        fitTab(tab);
        tab.term?.focus();
    });
}

export function fitTab(tab: Tab) {
    if (!tab.fit || !tab.termEl || !tab.termEl.classList.contains('active')) return;
    tab.fit.fit();
    if (tab.sessionId && tab.connected) {
        App.Resize(tab.sessionId, tab.term!.cols, tab.term!.rows).catch(toastError);
    }
}

export function cycleTab(dir: number) {
    if (state.tabs.length < 2) return;
    const idx = state.tabs.findIndex(t => t.key === state.activeKey);
    const next = (idx + dir + state.tabs.length) % state.tabs.length;
    activateTab(state.tabs[next].key);
}

export async function connectHost(host: main.Host) {
    const dims = currentDims();
    try {
        await App.Connect(host.id, dims.cols, dims.rows);
    } catch (err) {
        addErrorTab(host.name || host.user + '@' + host.address, String(err), { hostId: host.id });
    }
}

export async function quickConnect(target: string, password = '') {
    const dims = currentDims();
    try {
        await App.QuickConnect(target, password, dims.cols, dims.rows);
    } catch (err) {
        addErrorTab(target, String(err), { target });
    }
}

function currentDims(): { cols: number; rows: number } {
    const tab = activeTab();
    if (tab?.term) return { cols: tab.term.cols, rows: tab.term.rows };
    return { cols: 120, rows: 32 };
}

export function addErrorTab(title: string, error: string, pending: { hostId?: string; target?: string }) {
    const key = 'err-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    state.tabs.push({
        key,
        sessionId: '',
        title,
        hostId: pending.hostId ?? '',
        color: '',
        user: '',
        address: pending.target ?? '',
        connected: false,
        agentActive: false,
        closedReason: '',
        error,
        pending,
        term: null,
        fit: null,
        termEl: null,
    });
    state.activeKey = key;
    notify();
}

export async function retryTab(tab: Tab) {
    const idx = state.tabs.indexOf(tab);
    if (idx >= 0) state.tabs.splice(idx, 1);
    if (tab.pending?.hostId) {
        const host = state.hosts.find(h => h.id === tab.pending!.hostId);
        if (host) await connectHost(host);
    } else if (tab.pending?.target) {
        await quickConnect(tab.pending.target);
    }
    notify();
}

export function closeTab(key: string) {
    const idx = state.tabs.findIndex(t => t.key === key);
    if (idx < 0) return;
    const tab = state.tabs[idx];
    state.tabs.splice(idx, 1);
    tabCleanups.forEach(fn => fn(tab));
    if (tab.sessionId) App.Disconnect(tab.sessionId).catch(toastError);
    if (state.activeKey === key) {
        const next = state.tabs[Math.min(idx, state.tabs.length - 1)];
        state.activeKey = next ? next.key : '';
    }
    notify();
}

export async function refreshHosts() {
    state.hosts = await App.ListHosts();
    notify();
}

export async function refreshKeys() {
    state.keys = await App.ListKeys();
    notify();
}

export async function refreshSessions() {
    state.sessions = await App.ListSessions();
    notify();
}

export function sessionOpenForHost(hostId: string): boolean {
    return state.sessions.some(s => s.hostId === hostId) || state.tabs.some(t => t.hostId === hostId && t.connected);
}
