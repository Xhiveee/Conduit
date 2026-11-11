import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { SearchAddon } from '@xterm/addon-search';
import { EventsOn } from '../wailsjs/runtime/runtime';
import * as App from '../wailsjs/go/main/App';
import type { main } from '../wailsjs/go/models';
import { applyTheme, currentXtermTheme, resolveTheme, type ThemeDef } from './themes';
import { toastError } from './toast';
import { promptDialog } from './ui/dialog';

export interface Tab {
    key: string;
    sessionId: string;
    title: string;
    hostId: string;
    color: string;
    user: string;
    address: string;
    qcTarget: string;
    reconnecting: boolean;
    connected: boolean;
    agentActive: boolean;
    closedReason: string;
    error: string;
    pending: { hostId?: string; target?: string } | null;
    term: Terminal | null;
    fit: FitAddon | null;
    search: SearchAddon | null;
    termEl: HTMLElement | null;
    pendingData?: string[];
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
    for (const s of sessions) upsertSessionTab(s);
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
    document.documentElement.style.setProperty('--ui-scale', String(s.uiScale || 1));
    document.documentElement.style.setProperty('--sidebar-w', (s.sidebarWidth / 16) + 'rem');
    document.documentElement.style.setProperty('--agent-w', (s.agentWidth / 16) + 'rem');
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
    void ensureTermFont().then(() => {
        state.tabs.forEach(t => {
            if (!t.term) return;
            t.term.refresh(0, t.term.rows - 1);
            fitTab(t);
        });
    }).catch(toastError);
}

let fontKey = '';
let fontLoading: Promise<void> | null = null;

function firstFamily(stack: string): string {
    const first = (stack || '').split(',')[0].trim();
    return first.replace(/^['"]|['"]$/g, '');
}

export function ensureTermFont(): Promise<void> {
    const family = firstFamily(state.settings?.fontFamily || '');
    if (!family) return Promise.resolve();
    if (fontKey !== family) {
        fontKey = family;
        fontLoading = null;
    }
    if (!fontLoading) {
        fontLoading = Promise.all([
            document.fonts.load(`14px "${family}"`),
            document.fonts.load(`600 14px "${family}"`),
        ]).then(() => undefined);
    }
    return fontLoading;
}

export function applyTermOptions(tab: Tab) {
    const s = settingsOrDefault();
    if (!tab.term) return;
    const cur = currentXtermTheme(themeSettings());
    tab.term.options.theme = cur;
    tab.term.options.fontFamily = s.fontFamily;
    tab.term.options.fontSize = s.fontSize;
    tab.term.options.fontWeight = s.fontWeight || 400;
    tab.term.options.fontWeightBold = s.fontWeightBold || 600;
    tab.term.options.letterSpacing = s.letterSpacing || 0;
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
        if (!tab) return;
        if (!tab.term) {
            (tab.pendingData ??= []).push(b64);
            return;
        }
        writeTermData(tab, b64);
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

export function writeTermData(tab: Tab, b64: string) {
    if (!tab.term) return;
    try {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        tab.term.write(bytes);
    } catch (err) {
        toastError(err);
    }
}

const qcTargets = new Map<string, string>();

export function upsertSessionTab(info: main.SessionInfo) {
    const reuse = state.tabs.find(t => t.reconnecting &&
        ((t.hostId && t.hostId === info.hostId) ||
         (!t.hostId && t.qcTarget && t.user === info.user && t.address === info.address))) ?? tabBySession(info.id);
    let tab = reuse;
    if (!tab) {
        tab = {
            key: info.id,
            sessionId: info.id,
            title: info.title || info.user + '@' + info.address,
            hostId: info.hostId || '',
            color: info.color || '',
            user: info.user || '',
            address: info.address || '',
            qcTarget: qcTargets.get(info.id) ?? '',
            reconnecting: false,
            connected: true,
            agentActive: false,
            closedReason: '',
            error: '',
            pending: null,
            term: null,
            fit: null,
            search: null,
            termEl: null,
        };
        state.tabs.push(tab);
    } else {
        tab.title = info.title || tab.title;
        tab.sessionId = info.id;
        tab.hostId = info.hostId || tab.hostId;
        tab.color = info.color || tab.color;
        tab.user = info.user || tab.user;
        tab.address = info.address || tab.address;
        if (!tab.qcTarget) tab.qcTarget = qcTargets.get(info.id) ?? '';
        tab.reconnecting = false;
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

type ConnResult = { id: string } | { error: string };

function errText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function authPromptLabel(kind: string, label: string): string {
    return (kind === 'passphrase' ? 'Key passphrase for ' : 'Password for ') + label;
}

function authKind(err: unknown): string {
    const m = errText(err).match(/auth_required:(password|passphrase)/);
    return m ? m[1] : '';
}

async function connectHostInner(host: main.Host, dims: { cols: number; rows: number }): Promise<ConnResult> {
    try {
        return { id: await App.Connect(host.id, dims.cols, dims.rows) };
    } catch (err) {
        const kind = authKind(err);
        if (!kind) return { error: errText(err) };
        const msg = errText(err);
        const label = host.name || host.user + '@' + host.address;
        const res = await promptDialog({
            title: 'Authentication required',
            label: authPromptLabel(kind, label),
            password: true,
            checkboxLabel: 'Save to host',
        });
        if (res === null) return { error: msg };
        try {
            return { id: await App.ConnectWithSecret(host.id, res.value, res.checked, dims.cols, dims.rows) };
        } catch (err2) {
            return { error: errText(err2) };
        }
    }
}

async function quickConnectInner(target: string, password: string, dims: { cols: number; rows: number }): Promise<ConnResult> {
    try {
        const id = await App.QuickConnect(target, password, dims.cols, dims.rows);
        return { id };
    } catch (err) {
        const kind = authKind(err);
        if (!kind) return { error: errText(err) };
        const msg = errText(err);
        const res = await promptDialog({
            title: 'Authentication required',
            label: authPromptLabel(kind, target),
            password: true,
        });
        if (res === null) return { error: msg };
        try {
            return { id: await App.QuickConnect(target, res.value, dims.cols, dims.rows) };
        } catch (err2) {
            return { error: errText(err2) };
        }
    }
}

export async function connectHost(host: main.Host) {
    const dims = currentDims();
    const res = await connectHostInner(host, dims);
    if ('error' in res) {
        addErrorTab(host.name || host.user + '@' + host.address, res.error, { hostId: host.id });
    }
}

export async function quickConnect(target: string, password = '') {
    const dims = currentDims();
    const res = await quickConnectInner(target, password, dims);
    if ('id' in res) qcTargets.set(res.id, target);
    else addErrorTab(target, res.error, { target });
}

export async function reconnectTab(tab: Tab) {
    if (tab.reconnecting || tab.error) return;
    const dims = currentDims();
    tab.reconnecting = true;
    tab.term?.write('\x1b[2m\r\n—— connection lost, reconnecting ——\x1b[0m\r\n');
    notify();
    let res: ConnResult;
    if (tab.hostId) {
        const host = state.hosts.find(h => h.id === tab.hostId);
        if (!host) {
            tab.reconnecting = false;
            toastError(new Error('saved host no longer exists'));
            return;
        }
        res = await connectHostInner(host, dims);
    } else {
        const target = tab.qcTarget || ([tab.user, tab.address].filter(Boolean).join('@') || tab.title);
        res = await quickConnectInner(target, '', dims);
    }
    if ('id' in res) {
        if (tab.qcTarget && !tab.hostId) qcTargets.set(res.id, tab.qcTarget);
        notify();
    } else {
        tab.reconnecting = false;
        toastError(new Error(res.error));
        notify();
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
        qcTarget: pending.target ?? '',
        reconnecting: false,
        connected: false,
        agentActive: false,
        closedReason: '',
        error,
        pending,
        term: null,
        fit: null,
        search: null,
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

export async function duplicateTab(tab: Tab) {
    if (tab.hostId) {
        const host = state.hosts.find(h => h.id === tab.hostId);
        if (host) {
            await connectHost(host);
            return;
        }
    }
    const target = tab.qcTarget || ([tab.user, tab.address].filter(Boolean).join('@') || tab.title);
    if (target) await quickConnect(target);
}

export function moveTab(key: string, toIndex: number) {
    const idx = state.tabs.findIndex(t => t.key === key);
    if (idx < 0) return;
    const [tab] = state.tabs.splice(idx, 1);
    state.tabs.splice(Math.max(0, Math.min(toIndex, state.tabs.length)), 0, tab);
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
