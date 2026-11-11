import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import ini from 'highlight.js/lib/languages/ini';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import nginx from 'highlight.js/lib/languages/nginx';
import python from 'highlight.js/lib/languages/python';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import go from 'highlight.js/lib/languages/go';
import sql from 'highlight.js/lib/languages/sql';
import diff from 'highlight.js/lib/languages/diff';
import xml from 'highlight.js/lib/languages/xml';
import plaintext from 'highlight.js/lib/languages/plaintext';
import { BrowserOpenURL } from '../wailsjs/runtime/runtime';
import * as App from '../wailsjs/go/main/App';
import {
    state, onUI, notify, chatTargetSession, activeChat, chatSummary, upsertChatSummary,
    selectChat, settingsOrDefault, type AgentMsg, type ToolCard, type ChatView,
} from './state';
import { icon } from './icons';
import { toastError } from './toast';
import type { main } from '../wailsjs/go/models';
import { toggleSettings } from './settings';
import { contextMenuAt, showMenuAt, confirmDialog, promptDialog, uiSwitch, type MenuEntry } from './ui';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('nginx', nginx);
hljs.registerLanguage('python', python);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('go', go);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('plaintext', plaintext);

const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });

md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const lang = (token.info ?? '').trim().split(/\s+/)[0] || '';
    const code = token.content.replace(/\n$/, '');
    const highlighted = lang && hljs.getLanguage(lang)
        ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
        : md.utils.escapeHtml(code);
    const langLabel = lang || 'text';
    return '<div class="code-block" data-code="' + md.utils.escapeHtml(code) + '">' +
        '<div class="cb-head"><span class="cb-lang">' + md.utils.escapeHtml(langLabel) + '</span>' +
        '<span class="cb-actions">' +
        '<button type="button" class="cb-btn" data-act="copy">' + icon('copy', 12).outerHTML + 'Copy</button>' +
        '<button type="button" class="cb-btn" data-act="insert">' + icon('corner-down-left', 12).outerHTML + 'Insert</button>' +
        '</span></div>' +
        '<pre><code class="hljs language-' + md.utils.escapeHtml(langLabel) + '">' + highlighted + '</code></pre></div>';
};
md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
    const token = tokens[idx];
    const href = token.attrGet('href') ?? '';
    let safe = false;
    try {
        const u = new URL(href);
        safe = u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:';
    } catch { /* relative or invalid */ }
    const env = _env as { __linkUnsafe?: boolean[] };
    (env.__linkUnsafe ??= []).push(!safe);
    if (!safe) return '';
    token.attrSet('class', 'md-link');
    token.attrSet('data-href', href);
    token.attrSet('href', '#');
    return self.renderToken(tokens, idx, options);
};
md.renderer.rules.link_close = (tokens, idx, options, env, self) => {
    const stack = (env as { __linkUnsafe?: boolean[] }).__linkUnsafe;
    if (stack?.pop()) return '';
    return self.renderToken(tokens, idx, options);
};
md.renderer.rules.table_open = () => '<div class="md-table-wrap"><table>\n';
md.renderer.rules.table_close = () => '</table>\n</div>';

const root = () => document.getElementById('agent')!;
let inputEl: HTMLTextAreaElement | null = null;

const TOOL_LABELS: Record<string, string> = {
    list_hosts: 'List hosts',
    add_host: 'Add host',
    update_host: 'Update host',
    delete_host: 'Delete host',
    connect: 'Connect',
    quick_connect: 'Quick connect',
    list_sessions: 'List sessions',
    run_command: 'Run command',
    send_keys: 'Send keys',
    read_screen: 'Read screen',
    disconnect: 'Disconnect',
    focus_session: 'Focus session',
    set_theme: 'Set theme',
    update_settings: 'Update settings',
    list_keys: 'List keys',
    list_themes: 'List themes',
};

const EXAMPLES = [
    'Check disk usage on this server',
    'Show the last 50 lines of syslog',
    'List my saved hosts',
];

let built = false;
let titleEl: HTMLElement | null = null;
let chipEl: HTMLButtonElement | null = null;
let modelEl: HTMLButtonElement | null = null;
let targetVal: HTMLElement | null = null;
let msgsEl: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let pillEl: HTMLButtonElement | null = null;
let usageEl: HTMLElement | null = null;
let sendBtn: HTMLButtonElement | null = null;
let headStopBtn: HTMLButtonElement | null = null;
let emptyEl: HTMLElement | null = null;
let chatBtn: HTMLButtonElement | null = null;
const msgEls = new Map<number, { el: HTMLElement; sig: string }>();
let pinned = true;
let newCount = 0;
let renderedChatId = '';

export function renderAgent() {
    const el = root();
    if (!built) {
        built = true;
        buildChrome(el);
    }
    updateChrome();
}

function buildChrome(el: HTMLElement) {
    el.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'ag-head';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'ag-title-wrap';
    titleEl = document.createElement('div');
    titleEl.className = 'ag-title';
    titleEl.title = 'Double-click to rename';
    titleEl.ondblclick = () => startRename();
    chipEl = document.createElement('button');
    chipEl.className = 'ag-chip';
    chipEl.type = 'button';
    titleWrap.append(titleEl);
    modelEl = document.createElement('button');
    modelEl.className = 'ag-model';
    modelEl.type = 'button';
    modelEl.dataset.tip = 'Agent settings';
    modelEl.onclick = () => toggleSettings('agent');

    chatBtn = document.createElement('button');
    chatBtn.className = 'ag-btn';
    chatBtn.dataset.tip = 'Chats';
    chatBtn.appendChild(icon('messages-square', 15));
    chatBtn.onclick = () => { state.chatListOpen = !state.chatListOpen; notify(); };
    const newBtn = document.createElement('button');
    newBtn.className = 'ag-btn';
    newBtn.dataset.tip = 'New chat';
    newBtn.appendChild(icon('plus', 15));
    newBtn.onclick = () => { void createChat(); };
    const moreBtn = document.createElement('button');
    moreBtn.className = 'ag-btn';
    moreBtn.dataset.tip = 'Chat actions';
    moreBtn.appendChild(icon('ellipsis', 15));
    moreBtn.onclick = ev => chatMenu(ev);
    const stopBtn = document.createElement('button');
    stopBtn.className = 'ag-btn danger';
    stopBtn.dataset.tip = 'Stop agent';
    stopBtn.dataset.tipKeys = 'Esc';
    stopBtn.appendChild(icon('square', 13));
    stopBtn.onclick = () => { const id = state.activeChatId; if (id) void App.AgentStop(id); };
    headStopBtn = stopBtn;
    head.append(titleWrap, modelEl, chatBtn, newBtn, moreBtn, stopBtn);
    el.appendChild(head);

    const target = document.createElement('div');
    target.className = 'ag-target';
    const tlabel = document.createElement('span');
    tlabel.className = 'ag-target-label';
    tlabel.textContent = 'Target: ';
    targetVal = document.createElement('b');
    target.append(tlabel, chipEl, targetVal);
    el.appendChild(target);

    const body = document.createElement('div');
    body.className = 'ag-body';
    msgsEl = document.createElement('div');
    msgsEl.className = 'ag-msgs';
    msgsEl.addEventListener('scroll', onMsgsScroll, { passive: true });
    msgsEl.addEventListener('click', onMsgsClick);
    body.appendChild(msgsEl);

    pillEl = document.createElement('button');
    pillEl.className = 'ag-pill';
    pillEl.type = 'button';
    pillEl.onclick = () => scrollBottom(true);
    body.appendChild(pillEl);

    listEl = document.createElement('div');
    listEl.className = 'ag-chatlist';
    body.appendChild(listEl);
    el.appendChild(body);

    const inputWrap = document.createElement('div');
    inputWrap.className = 'ag-input';
    const ta = document.createElement('textarea');
    ta.placeholder = 'Message the agent…';
    ta.rows = 1;
    ta.spellcheck = false;
    inputEl = ta;
    ta.addEventListener('input', () => {
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 168) + 'px';
    });
    ta.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' && !ev.shiftKey) {
            ev.preventDefault();
            const chat = activeChat();
            if (chat?.busy) return;
            sendAgentMessage(ta.value);
        }
    });
    const row = document.createElement('div');
    row.className = 'ag-input-row';
    sendBtn = document.createElement('button');
    sendBtn.className = 'ag-send';
    sendBtn.type = 'button';
    usageEl = document.createElement('div');
    usageEl.className = 'ag-usage';
    row.append(ta, sendBtn);
    inputWrap.append(row, usageEl);
    el.appendChild(inputWrap);
}

function updateChrome() {
    const s = settingsOrDefault();
    if (modelEl) modelEl.textContent = s.ai?.model || 'no model';
    const chat = activeChat();
    const sum = state.activeChatId ? chatSummary(state.activeChatId) : undefined;
    if (titleEl) titleEl.textContent = sum?.title || 'New chat';
    if (chipEl) {
        chipEl.innerHTML = '';
        if (sum?.hostId) {
            const h = state.hosts.find(x => x.id === sum.hostId);
            chipEl.appendChild(icon('server', 11));
            const sp = document.createElement('span');
            sp.textContent = h ? (h.name || h.user + '@' + h.address) : 'host';
            chipEl.appendChild(sp);
            chipEl.classList.add('attached');
            chipEl.onclick = ev => {
            const me = ev.currentTarget as HTMLElement;
            const r = me.getBoundingClientRect();
            attachMenu({ clientX: r.left, clientY: r.bottom + 4 }, sum.hostId);
        };
        } else {
            chipEl.appendChild(icon('plus', 11));
            const sp = document.createElement('span');
            sp.textContent = 'Attach';
            chipEl.appendChild(sp);
            chipEl.classList.remove('attached');
            chipEl.onclick = ev => {
                const me = ev.currentTarget as HTMLElement;
                const r = me.getBoundingClientRect();
                attachMenu({ clientX: r.left, clientY: r.bottom + 4 }, '');
            };
        }
    }
    const tid = state.activeChatId ? chatTargetSession(state.activeChatId) : agentTargetFallback();
    const targetTab = state.tabs.find(t => t.sessionId === tid);
    if (targetVal) targetVal.textContent = targetTab ? targetTab.title : 'none';
    if (chatBtn) chatBtn.classList.toggle('active', state.chatListOpen);
    if (headStopBtn) headStopBtn.style.display = chat?.busy ? '' : 'none';

    if (sendBtn) {
        sendBtn.innerHTML = '';
        if (chat?.busy) {
            sendBtn.dataset.tip = 'Stop agent';
            sendBtn.dataset.tipKeys = 'Esc';
            sendBtn.appendChild(icon('square', 14));
            sendBtn.onclick = () => { if (state.activeChatId) void App.AgentStop(state.activeChatId); };
        } else {
            sendBtn.dataset.tip = 'Send';
            sendBtn.dataset.tipKeys = 'Enter';
            sendBtn.appendChild(icon('send', 15));
            sendBtn.onclick = () => { if (inputEl) sendAgentMessage(inputEl.value); };
        }
    }
    syncUsage(chat);
    syncMessages();
    syncChatList();
}

function agentTargetFallback(): string {
    const t = state.tabs.find(x => x.key === state.activeKey);
    return t && t.connected ? t.sessionId : '';
}

function onMsgsScroll() {
    if (!msgsEl) return;
    const dist = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight;
    if (dist < 80) {
        pinned = true;
        newCount = 0;
        updatePill();
    } else if (!pinned) {
        updatePill();
    }
    updateFades();
}

function updatePill() {
    if (!pillEl) return;
    const show = !pinned && newCount > 0;
    pillEl.classList.toggle('show', show);
    pillEl.innerHTML = '';
    if (show) {
        pillEl.appendChild(icon('arrow-down', 12));
        const sp = document.createElement('span');
        sp.textContent = newCount + (newCount === 1 ? ' new message' : ' new messages');
        pillEl.append(sp);
    }
}

function scrollBottom(smooth: boolean) {
    if (!msgsEl) return;
    msgsEl.scrollTo({ top: msgsEl.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    pinned = true;
    newCount = 0;
    updatePill();
}

function syncMessages() {
    if (!msgsEl) return;
    const chat = activeChat();
    for (const v of state.chats.values()) {
        for (const t of v.tools.values()) {
            if (t.status !== 'running') stopToolTimer(t.callId);
        }
    }
    const cid = state.activeChatId;
    if (cid !== renderedChatId) {
        renderedChatId = cid;
        msgEls.clear();
        msgsEl.innerHTML = '';
        pinned = true;
        newCount = 0;
        updatePill();
    }
    const entries = chat?.entries ?? [];
    const thinking = !!chat?.thinking;
    const busy = !!chat?.busy;
    const ids = new Set(entries.map(m => m.id));
    for (const [id, rec] of msgEls) {
        if (!ids.has(id)) {
            rec.el.remove();
            msgEls.delete(id);
        }
    }
    let added = false;
    for (const m of entries) {
        const sig = msgSig(m);
        const rec = msgEls.get(m.id);
        if (rec && rec.sig === sig) continue;
        const el = msgEl(m);
        if (rec) {
            rec.el.replaceWith(el);
            msgEls.set(m.id, { el, sig });
        } else {
            msgEls.set(m.id, { el, sig });
            msgsEl.appendChild(el);
            added = true;
        }
    }
    syncThinking(thinking);
    if (entries.length === 0 && !thinking) {
        if (!emptyEl) {
            emptyEl = buildEmpty();
            msgsEl.appendChild(emptyEl);
        }
    } else if (emptyEl) {
        emptyEl.remove();
        emptyEl = null;
    }
    if (added && !pinned) newCount += 1;
    if (pinned || added || busy) {
        requestAnimationFrame(() => { if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight; });
    }
    updateFades();
}

function updateFades() {
    if (!msgsEl) return;
    const top = msgsEl.scrollTop > 4;
    const bottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight > 4;
    msgsEl.classList.toggle('fade-top', top);
    msgsEl.classList.toggle('fade-bottom', bottom);
}

let thinkingEl: HTMLElement | null = null;
function syncThinking(on: boolean) {
    if (!msgsEl) return;
    if (on && !thinkingEl) {
        thinkingEl = document.createElement('div');
        thinkingEl.className = 'msg thinking';
        thinkingEl.innerHTML = '<span class="td"></span><span class="td"></span><span class="td"></span>';
        msgsEl.appendChild(thinkingEl);
    } else if (!on && thinkingEl) {
        thinkingEl.remove();
        thinkingEl = null;
    }
}

function msgSig(m: AgentMsg): string {
    if (m.kind === 'tool' && m.tool) {
        const t = m.tool;
        return `tool:${t.callId}:${t.status}:${t.result.length}:${t.open}:${t.args}`;
    }
    return `${m.kind}:${m.content ?? ''}`;
}

function buildEmpty(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'ag-empty';
    const hint = document.createElement('div');
    hint.className = 'msg system-note';
    hint.textContent = 'Ask the agent to inspect hosts, run commands, or manage sessions. It types into the terminal you see.';
    wrap.appendChild(hint);
    const list = document.createElement('div');
    list.className = 'ag-examples';
    for (const ex of EXAMPLES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ag-example';
        b.textContent = ex;
        b.onclick = () => sendAgentMessage(ex);
        list.appendChild(b);
    }
    wrap.appendChild(list);
    return wrap;
}

async function createChat(hostId = '') {
    try {
        const s = await App.CreateChat(hostId);
        upsertChatSummary(s);
        await selectChat(s.id);
    } catch (err) {
        toastError(err);
    }
}

function chatMenu(ev: MouseEvent) {
    const sum = state.activeChatId ? chatSummary(state.activeChatId) : undefined;
    if (!sum) return;
    const items: MenuEntry[] = [
        { label: 'Rename', icon: 'pencil', onSelect: () => startRename() },
        { label: 'Attach to server', icon: 'server', onSelect: () => attachMenuAt(sum.hostId) },
        { label: 'Move to group', icon: 'folder', onSelect: () => moveGroupMenu(sum.id) },
        { sep: true },
        sum.archived
            ? { label: 'Unarchive', icon: 'archive-restore', onSelect: () => void App.ArchiveChat(sum.id, false).catch(toastError) }
            : { label: 'Archive', icon: 'archive', onSelect: () => void App.ArchiveChat(sum.id, true).catch(toastError) },
        { sep: true },
        { label: 'Delete', icon: 'trash-2', danger: true, onSelect: () => void deleteChat(sum.id) },
    ];
    contextMenuAt(items, ev);
}

async function deleteChat(id: string) {
    const ok = await confirmDialog({
        title: 'Delete chat',
        message: 'Delete this chat and its history?',
        confirmLabel: 'Delete',
        danger: true,
    });
    if (!ok) return;
    try {
        await App.DeleteChat(id);
    } catch (err) {
        toastError(err);
    }
}

function moveGroupMenu(chatId: string) {
    const groups = [...new Set(state.chatList.map(c => c.group).filter(g => g))].sort();
    const items: MenuEntry[] = groups.map(g => ({
        label: g,
        icon: 'folder',
        onSelect: () => void App.SetChatGroup(chatId, g).catch(toastError),
    }));
    items.push(
        { sep: true },
        { label: 'New group…', icon: 'plus', onSelect: () => void newGroup(chatId) },
        { label: 'No group', icon: 'x', onSelect: () => void App.SetChatGroup(chatId, '').catch(toastError) },
    );
    const r = root().getBoundingClientRect();
    showMenuAt(items, r.right - 200, r.top + 60, '12rem');
}

async function newGroup(chatId: string) {
    const res = await promptDialog({ title: 'New group', label: 'Group name', confirmLabel: 'Create' });
    if (!res || !res.value.trim()) return;
    try {
        await App.SetChatGroup(chatId, res.value.trim());
    } catch (err) {
        toastError(err);
    }
}

function attachMenuAt(currentHostId: string) {
    const r = root().getBoundingClientRect();
    attachMenu({ clientX: r.right - 220, clientY: r.top + 70 }, currentHostId);
}

function attachMenu(ev: { clientX: number; clientY: number }, currentHostId: string) {
    const items: MenuEntry[] = state.hosts.map(h => ({
        label: h.name || h.user + '@' + h.address,
        icon: 'server',
        onSelect: () => {
            const id = state.activeChatId;
            if (id) void App.AttachChat(id, h.id).catch(toastError);
        },
    }));
    if (items.length) items.push({ sep: true });
    items.push({
        label: 'Detach',
        icon: 'unlink',
        disabled: !currentHostId,
        onSelect: () => {
            const id = state.activeChatId;
            if (id) void App.AttachChat(id, '').catch(toastError);
        },
    });
    showMenuAt(items, ev.clientX, ev.clientY);
}

function startRename() {
    const sum = state.activeChatId ? chatSummary(state.activeChatId) : undefined;
    if (!sum || !titleEl) return;
    const input = document.createElement('input');
    input.className = 'ag-rename';
    input.value = sum.title;
    input.spellcheck = false;
    titleEl.replaceWith(input);
    input.focus();
    input.select();
    const done = async (save: boolean) => {
        const v = input.value.trim();
        input.replaceWith(titleEl!);
        if (save && v && v !== sum.title) {
            try {
                await App.RenameChat(sum.id, v);
            } catch (err) {
                toastError(err);
            }
        }
        notify();
    };
    input.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); void done(true); }
        if (ev.key === 'Escape') { ev.preventDefault(); void done(false); }
        ev.stopPropagation();
    });
    input.addEventListener('blur', () => { void done(true); });
}

function syncUsage(chat: ChatView | null) {
    if (!usageEl) return;
    usageEl.innerHTML = '';
    const u = chat?.usage;
    const win = settingsOrDefault().ai?.contextWindow || 128000;
    if (!u || (u.totalTokens === 0 && u.lastPromptTokens === 0)) {
        usageEl.classList.add('empty');
        return;
    }
    usageEl.classList.remove('empty');
    const pct = win > 0 ? Math.min(100, (u.lastPromptTokens / win) * 100) : 0;
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.setAttribute('viewBox', '0 0 20 20');
    ring.setAttribute('class', 'usage-ring' + (pct > 90 ? ' crit' : pct > 75 ? ' warn' : ''));
    const circ = 2 * Math.PI * 8;
    ring.innerHTML =
        '<circle class="ur-bg" cx="10" cy="10" r="8"/>' +
        `<circle class="ur-fg" cx="10" cy="10" r="8" stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - pct / 100)}"/>`;
    const nums = document.createElement('span');
    nums.className = 'usage-nums';
    nums.textContent = fmtNum(u.lastPromptTokens) + ' / ' + fmtNum(win);
    const spent = document.createElement('span');
    spent.className = 'usage-spent';
    spent.textContent = 'Spent ' + fmtNum(u.totalTokens);
    const detail = `In ${fmtNum(u.promptTokens)} · Out ${fmtNum(u.completionTokens)} · Last request ${fmtNum(u.lastPromptTokens)}`;
    usageEl.dataset.tip = detail;
    usageEl.append(ring, nums, spent);
}

function fmtNum(n: number): string {
    if (n < 1000) return String(n);
    if (n < 1e6) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
}

function sendAgentMessage(text: string) {
    const t = text.trim();
    if (!t) return;
    let chatId = state.activeChatId;
    if (inputEl) {
        inputEl.value = '';
        inputEl.style.height = 'auto';
    }
    if (!chatId) {
        void (async () => {
            try {
                const s = await App.CreateChat('');
                upsertChatSummary(s);
                state.activeChatId = s.id;
                chatId = s.id;
                notify();
                App.AgentSend(chatId, t, chatTargetSession(chatId)).catch(err => {
                    toastError(err);
                    restoreInput(t);
                });
            } catch (err) {
                toastError(err);
                restoreInput(t);
            }
        })();
        return;
    }
    pinned = true;
    App.AgentSend(chatId, t, chatTargetSession(chatId)).catch(err => {
        toastError(err);
        restoreInput(t);
    });
}

function restoreInput(t: string) {
    if (inputEl && inputEl.value === '') {
        inputEl.value = t;
        inputEl.dispatchEvent(new Event('input'));
    }
}

export function focusAgentInput() {
    inputEl?.focus();
}

function msgEl(m: AgentMsg): HTMLElement {
    if (m.kind === 'tool' && m.tool) return toolEl(m.tool);
    const el = document.createElement('div');
    el.className = 'msg ' + (m.kind === 'user' ? 'user' : m.kind === 'note' ? 'system-note' : 'assistant');
    if (m.kind === 'note') {
        el.textContent = m.content ?? '';
        return el;
    }
    if (m.kind === 'user') {
        el.textContent = m.content ?? '';
        return el;
    }
    el.innerHTML = md.render(m.content ?? '');
    postProcessTables(el);
    return el;
}

const NUM_RE = /^[-+]?[\d.,]+\s*(%|[KMGTP]i?B?|k|M|G|ms|s)?$/i;
function postProcessTables(root: HTMLElement) {
    const wraps = Array.from(root.querySelectorAll('.md-table-wrap')) as HTMLElement[];
    for (const wrap of wraps) {
        const table = wrap.querySelector('table');
        if (!table) continue;
        const rows = Array.from(table.querySelectorAll('tr'));
        const header = rows.find(r => !!r.querySelector('th'));
        const bodyRows = rows.filter(r => !!r.querySelector('td'));
        const colCount = Math.max(0, ...bodyRows.map(r => r.querySelectorAll('td').length));
        for (let c = 0; c < colCount; c++) {
            const cells = bodyRows
                .map(r => r.querySelectorAll('td')[c] as HTMLElement | undefined)
                .filter((x): x is HTMLElement => !!x);
            if (cells.length === 0) continue;
            const numeric = cells.every(td => NUM_RE.test(td.textContent?.trim() ?? ''));
            if (!numeric) continue;
            for (const td of cells) td.classList.add('rn');
            if (header) {
                const th = header.querySelectorAll('th')[c] as HTMLElement | undefined;
                th?.classList.add('rn');
            }
        }
    }
}

function onMsgsClick(ev: MouseEvent) {
    const target = ev.target as HTMLElement;
    const link = target.closest('.md-link') as HTMLElement | null;
    if (link) {
        ev.preventDefault();
        const href = link.dataset.href ?? '';
        try {
            const u = new URL(href);
            if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') {
                BrowserOpenURL(href);
            }
        } catch { /* not a navigable URL */ }
        return;
    }
    const btn = target.closest('.cb-btn') as HTMLElement | null;
    if (!btn) return;
    const block = btn.closest('.code-block') as HTMLElement | null;
    if (!block) return;
    const code = block.dataset.code ?? '';
    if (btn.dataset.act === 'copy') {
        navigator.clipboard.writeText(code).then(() => {
            btn.classList.add('copied');
            const label = btn.querySelector('span, svg')?.parentElement;
            void label;
            setTimeout(() => btn.classList.remove('copied'), 1200);
        }).catch(toastError);
    } else if (btn.dataset.act === 'insert') {
        const sid = state.activeChatId ? chatTargetSession(state.activeChatId) : agentTargetFallback();
        if (!sid) {
            toastError(new Error('No active session to insert into'));
            return;
        }
        App.Write(sid, code).catch(toastError);
    }
}

function toolEl(t: ToolCard): HTMLElement {
    const card = document.createElement('div');
    card.className = 'tool-card status-' + (t.status || 'idle') + (t.open ? ' open' : '');
    card.dataset.callId = t.callId;

    const head = document.createElement('div');
    head.className = 'tool-head';
    const statusIcon = icon(statusIconName(t.status), 14);
    const name = document.createElement('span');
    name.className = 'tool-name';
    name.textContent = TOOL_LABELS[t.name] ?? t.name;
    const status = document.createElement('span');
    status.className = 'tool-status ' + t.status;
    status.textContent = statusLabel(t.status);
    const timer = document.createElement('span');
    timer.className = 'tool-timer';
    if (t.status === 'running') startTimer(timer, t.callId);
    const chev = icon('chevron-right', 13);
    chev.classList.add('tool-chev');
    head.append(statusIcon, name, status, timer, chev);
    head.onclick = () => {
        t.open = !t.open;
        card.classList.toggle('open', t.open);
        notify();
    };
    card.appendChild(head);

    const argsPreview = toolArgsPreview(t);
    if (argsPreview) {
        const cmd = document.createElement('div');
        cmd.className = 'tool-cmd';
        cmd.textContent = argsPreview;
        card.appendChild(cmd);
    }

    if (t.result) {
        const out = document.createElement('div');
        out.className = 'tool-out';
        out.textContent = t.result.length > 8000 ? t.result.slice(0, 8000) + '\n…' : t.result;
        card.appendChild(out);
    }

    if (t.status === 'pending_approval') {
        const actions = document.createElement('div');
        actions.className = 'tool-actions';
        const approve = document.createElement('button');
        approve.className = 'btn primary';
        approve.textContent = 'Approve';
        approve.onclick = ev => { ev.stopPropagation(); void App.AgentApprove(t.callId, true); };
        const reject = document.createElement('button');
        reject.className = 'btn';
        reject.textContent = 'Reject';
        reject.onclick = ev => { ev.stopPropagation(); void App.AgentApprove(t.callId, false); };
        actions.append(approve, reject);
        card.appendChild(actions);
    }
    return card;
}

const toolStart = new Map<string, number>();
const toolTimers = new Map<string, number>();
function startTimer(el: HTMLElement, callId: string) {
    toolStart.set(callId, Date.now());
    const tick = () => {
        const s = (Date.now() - (toolStart.get(callId) ?? Date.now())) / 1000;
        el.textContent = s < 10 ? s.toFixed(1) + 's' : Math.round(s) + 's';
        toolTimers.set(callId, window.setTimeout(tick, 100));
    };
    tick();
}
export function stopToolTimer(callId: string) {
    const t = toolTimers.get(callId);
    if (t) clearTimeout(t);
    toolTimers.delete(callId);
}

function statusIconName(status: string): string {
    switch (status) {
        case 'done': return 'check';
        case 'error': case 'rejected': return 'alert-triangle';
        case 'running': return 'loader';
        case 'pending_approval': return 'clock';
        default: return 'circle-dot';
    }
}

function statusLabel(status: string): string {
    switch (status) {
        case 'pending_approval': return 'approval needed';
        case 'running': return 'running';
        case 'done': return 'done';
        case 'error': return 'error';
        case 'rejected': return 'rejected';
        default: return status || 'pending';
    }
}

function toolArgsPreview(t: ToolCard): string {
    try {
        const args = JSON.parse(t.args || '{}');
        if (t.name === 'run_command' || t.name === 'send_keys') {
            return (args.command ?? args.keys ?? '').toString();
        }
        if (t.name === 'connect') return 'host: ' + (args.host_id ?? '');
        if (t.name === 'quick_connect') return args.target ?? '';
        if (t.name === 'read_screen') return 'session: ' + (args.session_id ?? '') + (args.lines ? ', lines: ' + args.lines : '');
        if (t.name === 'disconnect' || t.name === 'focus_session' || t.name === 'delete_host') return 'id: ' + (args.session_id ?? args.id ?? '');
        if (t.name === 'set_theme') return args.theme_id ?? '';
        if (t.name === 'update_settings') return JSON.stringify(args.settings ?? {});
        const s = JSON.stringify(args);
        return s.length > 140 ? s.slice(0, 140) + '…' : s;
    } catch {
        return (t.args || '').slice(0, 140);
    }
}

let clSearch = '';
let clFilter = false;
let clSearchFocused = false;
const clCollapsed = new Set<string>();

function syncChatList() {
    if (!listEl) return;
    listEl.classList.toggle('open', state.chatListOpen);
    if (!state.chatListOpen) return;
    listEl.innerHTML = '';

    const top = document.createElement('div');
    top.className = 'cl-top';
    const search = document.createElement('input');
    search.className = 'cl-search';
    search.placeholder = 'Search chats';
    search.spellcheck = false;
    search.value = clSearch;
    search.oninput = () => { clSearch = search.value; syncChatListPreserve(search); };
    search.onfocus = () => { clSearchFocused = true; };
    search.onblur = () => { clSearchFocused = false; };
    const newChatBtn = document.createElement('button');
    newChatBtn.className = 'btn primary cl-new';
    newChatBtn.type = 'button';
    if (state.chatListLoading) newChatBtn.disabled = true;
    newChatBtn.appendChild(icon('plus', 13));
    newChatBtn.appendChild(document.createTextNode(' New chat'));
    newChatBtn.onclick = () => { void createChat(); };
    if (state.chatListLoading) {
        const sp = document.createElement('span');
        sp.className = 'cl-spin';
        top.appendChild(sp);
    }
    top.append(search, newChatBtn);
    listEl.appendChild(top);

    const hostTab = [...state.tabs].reverse().find(t => t.hostId && t.connected);
    const hostId = hostTab?.hostId ?? '';
    const filtering = clFilter && !!hostId;
    const filterRow = document.createElement('div');
    filterRow.className = 'cl-filter';
    const fs = document.createElement('span');
    fs.textContent = 'This server only';
    const sw = uiSwitch(filtering, v => { clFilter = v; syncChatList(); });
    filterRow.append(fs, sw);
    listEl.appendChild(filterRow);

    const scroll = document.createElement('div');
    scroll.className = 'cl-list-scroll';
    listEl.appendChild(scroll);

    const q = clSearch.trim().toLowerCase();
    const hostName = (hid: string) => {
        const h = state.hosts.find(x => x.id === hid);
        return h ? (h.name || h.user + '@' + h.address) : '';
    };
    let chats = state.chatList.filter(c => !c.archived);
    if (filtering) chats = chats.filter(c => c.hostId === hostId);
    if (q) chats = chats.filter(c => (c.title || 'new chat').toLowerCase().includes(q) || (c.group || '').toLowerCase().includes(q));

    const groups = new Map<string, typeof chats>();
    for (const c of chats) {
        const g = c.group || '';
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g)!.push(c);
    }
    const groupNames = [...groups.keys()].filter(g => g).sort();
    const renderSection = (name: string, items: typeof chats, forceCollapsed?: boolean) => {
        if (!items.length) return;
        const key = 'g:' + name;
        const collapsed = forceCollapsed ?? clCollapsed.has(key);
        const sec = document.createElement('div');
        sec.className = 'cl-group';
        const head = document.createElement('button');
        head.className = 'cl-group-head';
        head.type = 'button';
        head.appendChild(icon(collapsed ? 'chevron-right' : 'chevron-down', 12));
        const gt = document.createElement('span');
        gt.textContent = name || 'Chats';
        head.appendChild(gt);
        const cnt = document.createElement('span');
        cnt.className = 'cl-count';
        cnt.textContent = String(items.length);
        head.appendChild(cnt);
        const body = document.createElement('div');
        body.className = 'cl-group-body' + (collapsed ? ' collapsed' : '');
        const inner = document.createElement('div');
        inner.className = 'cl-group-inner';
        for (const c of items) inner.appendChild(chatRow(c, hostName));
        body.appendChild(inner);
        head.onclick = () => {
            const nowCollapsed = body.classList.toggle('collapsed');
            if (nowCollapsed) clCollapsed.add(key); else clCollapsed.delete(key);
            head.firstElementChild?.replaceWith(icon(nowCollapsed ? 'chevron-right' : 'chevron-down', 12));
        };
        sec.append(head, body);
        scroll.appendChild(sec);
    };
    renderSection('', groups.get('') ?? [], false);
    for (const g of groupNames) renderSection(g, groups.get(g)!);

    const archived = state.chatList.filter(c => c.archived && (!filtering || c.hostId === hostId) && (!q || (c.title || '').toLowerCase().includes(q)));
    if (archived.length) {
        const sec = document.createElement('div');
        sec.className = 'cl-group';
        const head = document.createElement('button');
        head.className = 'cl-group-head';
        head.type = 'button';
        head.appendChild(icon('chevron-right', 12));
        const gt = document.createElement('span');
        gt.textContent = 'Archived';
        head.appendChild(gt);
        const cnt = document.createElement('span');
        cnt.className = 'cl-count';
        cnt.textContent = String(archived.length);
        head.appendChild(cnt);
        const body = document.createElement('div');
        body.className = 'cl-group-body collapsed';
        const ainner = document.createElement('div');
        ainner.className = 'cl-group-inner';
        for (const c of archived) ainner.appendChild(chatRow(c, hostName));
        body.appendChild(ainner);
        head.onclick = () => {
            const nowCollapsed = body.classList.toggle('collapsed');
            clCollapsed.delete('g:__arch__');
            if (!nowCollapsed) clCollapsed.add('g:__arch__');
            head.firstElementChild?.replaceWith(icon(nowCollapsed ? 'chevron-right' : 'chevron-down', 12));
        };
        sec.append(head, body);
        scroll.appendChild(sec);
    }
    if (clSearchFocused) {
        const inp = listEl.querySelector('.cl-search') as HTMLInputElement | null;
        inp?.focus();
        inp?.setSelectionRange(inp.value.length, inp.value.length);
    }
}

function syncChatListPreserve(search: HTMLInputElement) {
    const pos = search.selectionStart ?? search.value.length;
    syncChatList();
    const inp = listEl?.querySelector('.cl-search') as HTMLInputElement | null;
    if (inp) {
        inp.focus();
        inp.setSelectionRange(pos, pos);
    }
}

function relTime(ts: number): string {
    const d = Date.now() - ts;
    if (d < 60_000) return 'just now';
    if (d < 3600_000) return Math.floor(d / 60_000) + ' min ago';
    if (d < 86400_000) return Math.floor(d / 3600_000) + ' h ago';
    const days = Math.floor(d / 86400_000);
    if (days === 1) return 'Yesterday';
    if (days < 7) return days + ' days ago';
    return new Date(ts).toLocaleDateString();
}

function chatRow(c: main.ChatSummary, hostName: (id: string) => string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'cl-row' + (c.id === state.activeChatId ? ' active' : '');
    const main = document.createElement('div');
    main.className = 'cl-row-main';
    const title = document.createElement('div');
    title.className = 'cl-row-title';
    title.textContent = c.title || 'New chat';
    const sub = document.createElement('div');
    sub.className = 'cl-row-sub';
    const parts: string[] = [];
    if (c.hostId) parts.push(hostName(c.hostId) || 'host');
    parts.push(relTime(c.updatedAt));
    sub.textContent = parts.join(' · ');
    main.append(title, sub);
    row.appendChild(main);
    if (c.busy) {
        const spin = document.createElement('span');
        spin.className = 'cl-spin';
        row.appendChild(spin);
    }
    row.onclick = () => { void selectChat(c.id); };
    row.oncontextmenu = ev => {
        const items: MenuEntry[] = [
            { label: 'Open', icon: 'message-square', onSelect: () => { void selectChat(c.id); } },
            { label: 'Rename', icon: 'pencil', onSelect: () => { void selectChat(c.id).then(startRename); } },
            { label: 'Move to group', icon: 'folder', onSelect: () => moveGroupMenu(c.id) },
            { label: 'Attach to server', icon: 'server', onSelect: () => attachToChatMenu(c.id, ev) },
            { sep: true },
            c.archived
                ? { label: 'Unarchive', icon: 'archive-restore', onSelect: () => void App.ArchiveChat(c.id, false).catch(toastError) }
                : { label: 'Archive', icon: 'archive', onSelect: () => void App.ArchiveChat(c.id, true).catch(toastError) },
            { label: 'Delete', icon: 'trash-2', danger: true, onSelect: () => void deleteChat(c.id) },
        ];
        contextMenuAt(items, ev);
    };
    return row;
}

function attachToChatMenu(chatId: string, ev: MouseEvent) {
    const items: MenuEntry[] = state.hosts.map(h => ({
        label: h.name || h.user + '@' + h.address,
        icon: 'server',
        onSelect: () => void App.AttachChat(chatId, h.id).catch(toastError),
    }));
    if (items.length) items.push({ sep: true });
    items.push({ label: 'Detach', icon: 'unlink', onSelect: () => void App.AttachChat(chatId, '').catch(toastError) });
    contextMenuAt(items, ev);
}

onUI(() => renderAgent());
