import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { SearchAddon } from '@xterm/addon-search';
import { applyLanguage, localizeShell, tr, translateError } from './i18n';
import { EventsOn } from '../wailsjs/runtime/runtime';
import * as App from '../wailsjs/go/main/App';
import type { main } from '../wailsjs/go/models';
import { applyTheme, currentXtermTheme, resolveTheme } from './themes';
import { toastError, toastInfo } from './toast';
import { confirmDialog, promptDialog } from './ui/dialog';

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
    connecting: boolean;
    connected: boolean;
    agentActive: boolean;
    closedReason: string;
    closedDetail: string;
    error: string;
    pending: { hostId?: string; target?: string } | null;
    term: Terminal | null;
    fit: FitAddon | null;
    search: SearchAddon | null;
    termEl: HTMLElement | null;
    termRequested?: boolean;
    pendingData?: string[];
}

export interface AgentMsg {
    id: number;
    kind: 'user' | 'assistant' | 'note' | 'tool';
    role?: string;
    content?: string;
    tool?: ToolCard;
    ts?: number;
}

export interface ToolCard {
    callId: string;
    name: string;
    args: string;
    status: string;
    result: string;
    open: boolean;
}

export interface ChatView {
    id: string;
    entries: AgentMsg[];
    tools: Map<string, ToolCard>;
    busy: boolean;
    thinking: boolean;
    usage: main.ChatUsage | null;
    loaded: boolean;
}

export const state = {
    settings: null as main.Settings | null,
    hosts: [] as main.Host[],
    keys: [] as main.KeyInfo[],
    sessions: [] as main.SessionInfo[],
    tabs: [] as Tab[],
    activeKey: '',
    chats: new Map<string, ChatView>(),
    chatList: [] as main.ChatSummary[],
    activeChatId: '',
    chatListOpen: false,
    chatListLoading: false,
    booted: false,
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
    const [settings, hosts, keys, sessions, chats, warnings] = await Promise.all([
        App.GetSettings(),
        App.ListHosts(),
        App.ListKeys(),
        App.ListSessions(),
        App.ListChats(),
        App.Warnings(),
    ]);
    state.settings = settings;
    state.hosts = hosts;
    state.keys = keys;
    state.sessions = sessions;
    state.chatList = chats;
    const first = chats.find(c => !c.archived);
    if (first) state.activeChatId = first.id;
    for (const s of sessions) upsertSessionTab(s);
    applyAll();
    wireEvents();
    state.booted = true;
    notify();
    if (warnings.length) {
        window.setTimeout(() => warnings.forEach(w => toastInfo(translateError(w))), 700);
    }
    if (state.activeChatId) void loadChat(state.activeChatId);
}

export function settingsOrDefault(): main.Settings {
    return state.settings as main.Settings;
}

export function activeChat(): ChatView | null {
    return state.chats.get(state.activeChatId) ?? null;
}

export function chatView(id: string): ChatView {
    let v = state.chats.get(id);
    if (!v) {
        v = { id, entries: [], tools: new Map(), busy: false, thinking: false, usage: null, loaded: false };
        state.chats.set(id, v);
    }
    return v;
}

export function chatSummary(id: string): main.ChatSummary | undefined {
    return state.chatList.find(c => c.id === id);
}

export function upsertChatSummary(s: main.ChatSummary) {
    const idx = state.chatList.findIndex(c => c.id === s.id);
    if (idx >= 0) state.chatList[idx] = s;
    else state.chatList.push(s);
    state.chatList.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function chatTargetSession(chatId: string): string {
    const sum = chatSummary(chatId);
    if (sum?.hostId) {
        const matches = state.sessions.filter(s => s.hostId === sum.hostId);
        if (matches.length) return matches[matches.length - 1].id;
        const tab = [...state.tabs].reverse().find(t => t.hostId === sum.hostId && t.connected);
        if (tab) return tab.sessionId;
    }
    return agentTargetId();
}

export async function loadChat(id: string) {
    const v = chatView(id);
    const baseLen = v.entries.length;
    try {
        const d = await App.GetChat(id);
        v.loaded = true;
        const liveTail = v.entries.slice(baseLen);
        v.entries = [];
        v.tools.clear();
        const seenCalls = new Set<string>();
        const seenTs = new Set<string>();
        for (const e of d.log ?? []) {
            if (e.kind === 'tool') {
                const cid = e.callId ?? '';
                const t: ToolCard = {
                    callId: cid, name: e.name ?? '', args: e.args ?? '',
                    status: e.status || 'done', result: e.result ?? '', open: false,
                };
                v.tools.set(cid, t);
                v.entries.push({ id: nextMsgId(), kind: 'tool', tool: t, ts: e.ts });
                seenCalls.add(cid);
            } else {
                v.entries.push({
                    id: nextMsgId(),
                    kind: e.kind === 'user' ? 'user' : e.kind === 'note' ? 'note' : 'assistant',
                    content: e.content,
                    ts: e.ts,
                });
                seenTs.add(e.kind + ':' + e.ts);
            }
        }
        if (d.truncated) {
            v.entries.unshift({
                id: nextMsgId(),
                kind: 'note',
                content: tr('Earlier messages are hidden to keep the chat responsive.'),
            });
        }
        for (const m of liveTail) {
            if (m.kind === 'tool' && m.tool) {
                if (seenCalls.has(m.tool.callId)) continue;
                seenCalls.add(m.tool.callId);
                v.tools.set(m.tool.callId, m.tool);
            } else if (m.ts !== undefined && seenTs.has(m.kind + ':' + m.ts)) {
                continue;
            }
            v.entries.push(m);
        }
        const s = state.chatList.find(c => c.id === id);
        if (s) {
            v.busy = !!s.busy;
            v.usage = s.usage ?? null;
        }
        if (state.activeChatId === id) notify();
    } catch (err) {
        toastError(err);
    }
}

export async function selectChat(id: string) {
    state.activeChatId = id;
    state.chatListOpen = false;
    notify();
    const v = state.chats.get(id);
    if (!v?.loaded) await loadChat(id);
    else notify();
}

export async function refreshChatList() {
    state.chatListLoading = true;
    notify();
    try {
        state.chatList = await App.ListChats();
    } catch (err) {
        toastError(err);
    }
    state.chatListLoading = false;
    notify();
}

export async function openChatForHost(hostId: string) {
    let c = state.chatList
        .filter(x => x.hostId === hostId && !x.archived)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!c) {
        c = await App.CreateChat(hostId);
        upsertChatSummary(c);
    }
    await selectChat(c.id);
}

export function themeSettings() {
    const s = settingsOrDefault();
    return { themeId: s.themeId };
}

export function applyAll() {
    const s = settingsOrDefault();
    applyLanguage(s.language);
    localizeShell();
    applyTheme(resolveTheme(themeSettings()));
    document.body.classList.toggle('agent-right', s.agentSide !== 'left');
    document.body.classList.toggle('agent-left', s.agentSide === 'left');
    document.body.classList.toggle('reduce-motion', !!s.reduceMotion);
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

interface HostKeyPrompt {
    requestId: string;
    hostname: string;
    fingerprint: string;
    oldFingerprint?: string;
    kind: string;
}

type HostKeyBindings = {
    SessionHostKeyDecision(requestID: string, trust: boolean): Promise<void>;
    SessionHostKeyUpdate(requestID: string): Promise<void>;
};

function hostKeyBindings(): HostKeyBindings {
    const app = (window as unknown as { go?: { main?: { App?: Partial<HostKeyBindings> } } }).go?.main?.App;
    if (typeof app?.SessionHostKeyDecision !== 'function' || typeof app.SessionHostKeyUpdate !== 'function') {
        throw new Error(tr('Host key confirmation is unavailable'));
    }
    return app as HostKeyBindings;
}

const hostKeyQueue: HostKeyPrompt[] = [];
const hostKeyQueued = new Set<string>();
let hostKeyPromptActive = false;

function queueHostKeyPrompt(prompt: HostKeyPrompt) {
    if (!prompt?.requestId || hostKeyQueued.has(prompt.requestId)) return;
    hostKeyQueued.add(prompt.requestId);
    hostKeyQueue.push(prompt);
    if (!hostKeyPromptActive) void drainHostKeyPrompts();
}

async function drainHostKeyPrompts() {
    hostKeyPromptActive = true;
    try {
        for (let prompt = hostKeyQueue.shift(); prompt; prompt = hostKeyQueue.shift()) {
            try {
                await resolveHostKeyPrompt(prompt);
            } catch (err) {
                toastError(err);
            } finally {
                hostKeyQueued.delete(prompt.requestId);
            }
        }
    } finally {
        hostKeyPromptActive = false;
    }
}

async function resolveHostKeyPrompt(prompt: HostKeyPrompt) {
    if (prompt.kind === 'changed') {
        const update = await confirmDialog({
            title: tr('Host key changed'),
            message: tr(
                'The host key for {host} has changed. Known: {known}. Presented: {presented}. Update the saved key only if you trust this change.',
                { host: prompt.hostname, known: prompt.oldFingerprint || '', presented: prompt.fingerprint },
            ),
            confirmLabel: tr('Update key'),
            danger: true,
        });
        if (update) {
            await hostKeyBindings().SessionHostKeyUpdate(prompt.requestId);
            toastInfo(tr('Host key updated. Reconnect to continue.'));
        }
        return;
    }
    const trust = await confirmDialog({
        title: tr('Unknown host key'),
        message: tr('The authenticity of {host} cannot be established. Fingerprint: {fingerprint}', {
            host: prompt.hostname,
            fingerprint: prompt.fingerprint,
        }),
        confirmLabel: tr('Trust'),
        danger: true,
    });
    await hostKeyBindings().SessionHostKeyDecision(prompt.requestId, trust);
}

function wireEvents() {
    EventsOn('session:opened', (info: main.SessionInfo) => {
        upsertSessionTab(info);
        state.sessions = state.sessions.filter(s => s.id !== info.id).concat([info]);
        notify();
    });
    EventsOn('session:hostkey', (prompt: HostKeyPrompt) => {
        queueHostKeyPrompt(prompt);
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
    EventsOn('session:closed', (id: string, reason: string, detail?: string) => {
        state.sessions = state.sessions.filter(s => s.id !== id);
        const tab = tabBySession(id);
        if (tab) {
            tab.connected = false;
            tab.closedReason = reason || tr('Disconnected');
            tab.closedDetail = detail || '';
        }
        notify();
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
    EventsOn('chat:updated', (s: main.ChatSummary) => {
        upsertChatSummary(s);
        const v = state.chats.get(s.id);
        if (v) {
            v.busy = !!s.busy;
            v.usage = s.usage ?? v.usage;
        }
        notify();
    });
    EventsOn('chat:deleted', (id: string) => {
        state.chatList = state.chatList.filter(c => c.id !== id);
        state.chats.delete(id);
        if (state.activeChatId === id) {
            state.activeChatId = state.chatList.find(c => !c.archived)?.id ?? '';
            if (state.activeChatId) void loadChat(state.activeChatId);
        }
        notify();
    });
    EventsOn('agent:message', (chatId: string, e: main.ChatLogEntry) => {
        const v = chatView(chatId);
        v.entries.push({
            id: nextMsgId(),
            kind: e.kind === 'user' ? 'user' : e.kind === 'note' ? 'note' : 'assistant',
            content: e.content,
            ts: e.ts,
        });
        notify();
    });
    EventsOn('agent:tool', (chatId: string, e: main.ChatLogEntry) => {
        const v = chatView(chatId);
        const cid = e.callId ?? '';
        let t = v.tools.get(cid);
        if (!t) {
            t = { callId: cid, name: e.name ?? '', args: e.args ?? '', status: '', result: '', open: false };
            v.tools.set(cid, t);
            v.entries.push({ id: nextMsgId(), kind: 'tool', tool: t, ts: e.ts });
        }
        if (e.name) t.name = e.name;
        if (e.args !== undefined) t.args = e.args;
        if (e.status) t.status = e.status;
        if (e.result !== undefined) t.result = e.result;
        if (t.status === 'pending_approval' && state.settings && !state.settings.ai.approveCommands) {
            void App.AgentApprove(cid, true);
        }
        notify();
    });
    EventsOn('agent:busy', (chatId: string, busy: boolean) => {
        chatView(chatId).busy = !!busy;
        notify();
    });
    EventsOn('agent:error', (chatId: string, msg: string) => {
        chatView(chatId).entries.push({ id: nextMsgId(), kind: 'note', content: msg });
        notify();
    });
    EventsOn('agent:usage', (chatId: string, u: main.ChatUsage) => {
        chatView(chatId).usage = u;
        notify();
    });
    EventsOn('agent:thinking', (chatId: string, on: boolean) => {
        chatView(chatId).thinking = !!on;
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
    const reuse = state.tabs.find(t => (t.reconnecting || t.connecting) &&
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
            connecting: false,
            connected: true,
            agentActive: false,
            closedReason: '',
            closedDetail: '',
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
        tab.connecting = false;
        tab.connected = true;
        tab.closedReason = '';
        tab.closedDetail = '';
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
    return kind === 'passphrase' ? tr('Key passphrase for {host}', { host: label }) : tr('Password for {host}', { host: label });
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
            title: tr('Authentication required'),
            label: authPromptLabel(kind, label),
            password: true,
            checkboxLabel: tr('Save to host'),
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
            title: tr('Authentication required'),
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

export function addPendingTab(title: string, pending: { hostId?: string; target?: string }, connecting: boolean): Tab {
    const key = 'pend-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const tab: Tab = {
        key,
        sessionId: '',
        title,
        hostId: pending.hostId ?? '',
        color: '',
        user: '',
        address: pending.target ?? '',
        qcTarget: pending.target ?? '',
        reconnecting: false,
        connecting,
        connected: false,
        agentActive: false,
        closedReason: '',
        closedDetail: '',
        error: '',
        pending,
        term: null,
        fit: null,
        search: null,
        termEl: null,
    };
    state.tabs.push(tab);
    state.activeKey = key;
    notify();
    return tab;
}

export async function connectHost(host: main.Host) {
    const dims = currentDims();
    const tab = addPendingTab(host.name || host.user + '@' + host.address, { hostId: host.id }, true);
    const res = await connectHostInner(host, dims);
    if ('error' in res) {
        tab.connecting = false;
        tab.error = res.error;
        tab.pending = { hostId: host.id };
        notify();
    }
}

export async function quickConnect(target: string, password = '') {
    const dims = currentDims();
    const tab = addPendingTab(target, { target }, true);
    const res = await quickConnectInner(target, password, dims);
    if ('id' in res) qcTargets.set(res.id, target);
    else {
        tab.connecting = false;
        tab.error = res.error;
        tab.pending = { target };
        notify();
    }
}

export async function reconnectTab(tab: Tab) {
    if (tab.reconnecting || tab.error) return;
    const dims = currentDims();
    tab.reconnecting = true;
    tab.term?.write('\x1b[2m\r\n—— ' + tr('connection lost, reconnecting') + ' ——\x1b[0m\r\n');
    notify();
    let res: ConnResult;
    if (tab.hostId) {
        const host = state.hosts.find(h => h.id === tab.hostId);
        if (!host) {
            tab.reconnecting = false;
            toastError(new Error(tr('saved host no longer exists')));
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
    addPendingTab(title, pending, false);
    const tab = state.tabs[state.tabs.length - 1];
    tab.error = error;
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

const closingTabs = new Set<string>();

export function isTabClosing(key: string) {
    return closingTabs.has(key);
}

export function closeTab(key: string) {
    if (closingTabs.has(key)) return;
    const tab = state.tabs.find(t => t.key === key);
    if (!tab) return;
    closingTabs.add(key);
    notify();
    if (tab.sessionId) {
        state.sessions = state.sessions.filter(s => s.id !== tab.sessionId);
        App.Disconnect(tab.sessionId).catch(err => toastError(err));
    }
    const delay = state.settings?.reduceMotion ? 0 : 140;
    setTimeout(() => {
        closingTabs.delete(key);
        const idx = state.tabs.findIndex(t => t.key === key);
        if (idx < 0) { notify(); return; }
        const t = state.tabs[idx];
        state.tabs.splice(idx, 1);
        tabCleanups.forEach(fn => fn(t));
        if (state.activeKey === key) {
            const next = state.tabs[Math.min(idx, state.tabs.length - 1)];
            state.activeKey = next ? next.key : '';
        }
        notify();
    }, delay);
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
