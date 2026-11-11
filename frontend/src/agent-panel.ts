import * as App from '../wailsjs/go/main/App';
import { state, onUI, notify, agentTargetId, settingsOrDefault, type AgentMsg, type ToolCard } from './state';
import { icon } from './icons';
import { toastError } from './toast';
import { toggleSettings } from './settings';

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
    'Switch to the light theme',
];

let built = false;
let modelEl: HTMLButtonElement | null = null;
let targetVal: HTMLElement | null = null;
let msgsEl: HTMLElement | null = null;
let hintEl: HTMLElement | null = null;
let sendBtn: HTMLButtonElement | null = null;
let emptyEl: HTMLElement | null = null;
const msgEls = new Map<number, { el: HTMLElement; sig: string }>();
let forceScroll = false;

export function renderAgent() {
    const el = root();
    if (!built) {
        built = true;
        buildChrome(el);
    }
    updateChrome();
}

function buildChrome(el: HTMLElement) {
    const head = document.createElement('div');
    head.className = 'ag-head';
    const title = document.createElement('div');
    title.className = 'ag-title';
    const botIcon = icon('bot', 15);
    const nameEl = document.createElement('span');
    nameEl.textContent = 'Agent';
    modelEl = document.createElement('button');
    modelEl.className = 'ag-model';
    modelEl.type = 'button';
    modelEl.dataset.tip = 'Agent settings';
    modelEl.onclick = () => toggleSettings('agent');
    title.append(botIcon, nameEl, modelEl);

    const resetBtn = document.createElement('button');
    resetBtn.className = 'ag-btn';
    resetBtn.dataset.tip = 'Reset conversation';
    resetBtn.appendChild(icon('rotate-ccw', 15));
    resetBtn.onclick = () => { void App.AgentReset(); state.agentMessages = []; state.agentTools.clear(); notify(); };
    const stopBtn = document.createElement('button');
    stopBtn.className = 'ag-btn danger';
    stopBtn.dataset.tip = 'Stop agent';
    stopBtn.dataset.tipKeys = 'Esc';
    stopBtn.appendChild(icon('square', 13));
    stopBtn.onclick = () => { void App.AgentStop(); };
    head.append(title, resetBtn, stopBtn);
    el.appendChild(head);

    const target = document.createElement('div');
    target.className = 'ag-target';
    const tlabel = document.createElement('span');
    tlabel.className = 'ag-target-label';
    tlabel.textContent = 'Target: ';
    targetVal = document.createElement('b');
    target.append(tlabel, targetVal);
    el.appendChild(target);

    msgsEl = document.createElement('div');
    msgsEl.className = 'ag-msgs';
    el.appendChild(msgsEl);

    const inputWrap = document.createElement('div');
    inputWrap.className = 'ag-input';
    const ta = document.createElement('textarea');
    ta.placeholder = 'Message the agent…';
    ta.rows = 1;
    ta.spellcheck = false;
    inputEl = ta;
    ta.addEventListener('input', () => {
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
    });
    ta.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' && !ev.shiftKey) {
            ev.preventDefault();
            if (state.agentBusy) return;
            sendAgentMessage(ta.value);
        }
    });
    const row = document.createElement('div');
    row.className = 'ag-input-row';
    hintEl = document.createElement('span');
    hintEl.className = 'ag-hint';
    sendBtn = document.createElement('button');
    sendBtn.className = 'ag-send';
    sendBtn.type = 'button';
    row.append(hintEl, sendBtn);
    inputWrap.append(ta, row);
    el.appendChild(inputWrap);
}

function updateChrome() {
    const s = settingsOrDefault();
    if (modelEl) modelEl.textContent = s.ai?.model || 'no model';
    const tid = agentTargetId();
    const targetTab = state.tabs.find(t => t.sessionId === tid);
    if (targetVal) targetVal.textContent = targetTab ? targetTab.title : 'none';

    if (sendBtn) {
        sendBtn.innerHTML = '';
        if (state.agentBusy) {
            sendBtn.dataset.tip = 'Stop agent';
            sendBtn.dataset.tipKeys = 'Esc';
            sendBtn.appendChild(icon('square', 14));
            sendBtn.onclick = () => { App.AgentStop().catch(toastError); };
        } else {
            sendBtn.dataset.tip = 'Send';
            sendBtn.dataset.tipKeys = 'Enter';
            sendBtn.appendChild(icon('send', 15));
            sendBtn.onclick = () => { if (inputEl) sendAgentMessage(inputEl.value); };
        }
    }
    if (hintEl) {
        hintEl.textContent = state.agentBusy ? 'Agent is working…' : 'Enter to send, Shift+Enter for newline';
    }
    syncMessages();
}

function syncMessages() {
    if (!msgsEl) return;
    const nearBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 60;
    const msgs = state.agentMessages;
    const ids = new Set(msgs.map(m => m.id));
    for (const [id, rec] of msgEls) {
        if (!ids.has(id)) {
            rec.el.remove();
            msgEls.delete(id);
        }
    }
    let changed = false;
    for (const m of msgs) {
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
        }
        changed = true;
    }
    if (msgs.length === 0) {
        if (!emptyEl) {
            emptyEl = buildEmpty();
            msgsEl.appendChild(emptyEl);
        }
    } else if (emptyEl) {
        emptyEl.remove();
        emptyEl = null;
    }
    if (changed || forceScroll || nearBottom) {
        forceScroll = false;
        const box = msgsEl;
        requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
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

function sendAgentMessage(text: string) {
    const t = text.trim();
    if (!t) return;
    if (inputEl) {
        inputEl.value = '';
        inputEl.style.height = 'auto';
    }
    forceScroll = true;
    App.AgentSend(t, agentTargetId()).catch(err => {
        toastError(err);
        if (inputEl && inputEl.value === '') {
            inputEl.value = t;
            inputEl.dispatchEvent(new Event('input'));
        }
    });
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
    el.innerHTML = renderMarkdownLite(m.content ?? '');
    return el;
}

function renderMarkdownLite(src: string): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inline = (s: string): string => {
        const parts = esc(s).split(/(`[^`\n]+`)/g);
        return parts.map(part => {
            if (part.length > 1 && part.startsWith('`') && part.endsWith('`')) {
                return '<code>' + part.slice(1, -1) + '</code>';
            }
            return part
                .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
                .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
                .replace(/\n/g, '<br>');
        }).join('');
    };
    const lines = src.replace(/\r\n/g, '\n').split('\n');
    const out: string[] = [];
    const isFence = (l: string) => /^```/.test(l);
    const isHead = (l: string) => /^#{1,3}\s/.test(l);
    const isBullet = (l: string) => /^\s*[-*]\s+/.test(l);
    const isNum = (l: string) => /^\s*\d+\.\s+/.test(l);
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (isFence(line)) {
            const buf: string[] = [];
            i++;
            while (i < lines.length && !isFence(lines[i])) {
                buf.push(lines[i]);
                i++;
            }
            i++;
            out.push('<pre><code>' + esc(buf.join('\n').replace(/\n+$/, '')) + '</code></pre>');
            continue;
        }
        const h = line.match(/^(#{1,3})\s+(.*)/);
        if (h) {
            out.push('<div class="md-h">' + inline(h[2]) + '</div>');
            i++;
            continue;
        }
        if (isBullet(line) || isNum(line)) {
            const ordered = isNum(line);
            const tag = ordered ? 'ol' : 'ul';
            const items: string[] = [];
            while (i < lines.length && (ordered ? isNum(lines[i]) : isBullet(lines[i]))) {
                items.push('<li>' + inline(lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, '')) + '</li>');
                i++;
            }
            out.push('<' + tag + '>' + items.join('') + '</' + tag + '>');
            continue;
        }
        if (line.trim() === '') {
            i++;
            continue;
        }
        const buf: string[] = [];
        while (i < lines.length && lines[i].trim() !== '' && !isFence(lines[i]) && !isHead(lines[i]) && !isBullet(lines[i]) && !isNum(lines[i])) {
            buf.push(lines[i]);
            i++;
        }
        out.push('<div class="md-p">' + inline(buf.join('\n')) + '</div>');
    }
    return out.join('');
}

function toolEl(t: ToolCard): HTMLElement {
    const card = document.createElement('div');
    card.className = 'tool-card' + (t.open ? ' open' : '');
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
    const chev = icon('chevron-right', 13);
    chev.classList.add('tool-chev');
    head.append(statusIcon, name, status, chev);
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

function statusIconName(status: string): string {
    switch (status) {
        case 'done': return 'check';
        case 'error': case 'rejected': return 'alert-triangle';
        case 'running': case 'pending_approval': return 'loader';
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
        default: return status;
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

onUI(() => renderAgent());
