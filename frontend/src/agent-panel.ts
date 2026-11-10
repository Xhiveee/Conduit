import * as App from '../wailsjs/go/main/App';
import { state, onUI, notify, agentTargetId, settingsOrDefault, type AgentMsg, type ToolCard } from './state';
import { icon } from './icons';
import { toastError } from './toast';

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

export function renderAgent() {
    const el = root();
    const s = settingsOrDefault();
    const wasScrolled = el.querySelector('.ag-msgs');
    const nearBottom = wasScrolled ? wasScrolled.scrollHeight - wasScrolled.scrollTop - wasScrolled.clientHeight < 60 : true;
    const hadFocus = inputEl !== null && document.activeElement === inputEl;
    const savedVal = inputEl?.value ?? '';
    const savedPos = inputEl?.selectionStart ?? 0;

    el.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'ag-head';
    const title = document.createElement('div');
    title.className = 'ag-title';
    const botIcon = icon('bot', 15);
    const nameEl = document.createElement('span');
    nameEl.textContent = 'Agent';
    const modelEl = document.createElement('span');
    modelEl.className = 'ag-model';
    modelEl.textContent = s.ai?.model || '';
    title.append(botIcon, nameEl, modelEl);

    const resetBtn = document.createElement('button');
    resetBtn.className = 'ag-btn';
    resetBtn.title = 'Reset conversation';
    resetBtn.appendChild(icon('rotate-ccw', 15));
    resetBtn.onclick = () => { void App.AgentReset(); state.agentMessages = []; state.agentTools.clear(); notify(); };
    const stopBtn = document.createElement('button');
    stopBtn.className = 'ag-btn danger';
    stopBtn.title = 'Stop agent';
    stopBtn.appendChild(icon('square', 13));
    stopBtn.onclick = () => { void App.AgentStop(); };
    head.append(title, resetBtn, stopBtn);
    el.appendChild(head);

    const target = document.createElement('div');
    target.className = 'ag-target';
    const tid = agentTargetId();
    const targetTab = state.tabs.find(t => t.sessionId === tid);
    target.innerHTML = '';
    target.append(document.createTextNode('Target session: '));
    const b = document.createElement('b');
    b.textContent = targetTab ? targetTab.title : 'none — messages still work, the agent can connect itself';
    target.appendChild(b);
    el.appendChild(target);

    const msgs = document.createElement('div');
    msgs.className = 'ag-msgs';
    if (state.agentMessages.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'msg system-note';
        hint.textContent = 'Ask the agent to inspect hosts, run commands, or manage sessions. It types into the terminal you see.';
        msgs.appendChild(hint);
    }
    for (const m of state.agentMessages) {
        msgs.appendChild(msgEl(m));
    }
    el.appendChild(msgs);

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
    const hint = document.createElement('span');
    hint.className = 'ag-hint';
    hint.textContent = state.agentBusy ? 'Agent is working…' : 'Enter to send, Shift+Enter for newline';
    const send = document.createElement('button');
    send.className = 'ag-send';
    if (state.agentBusy) {
        send.title = 'Stop agent';
        send.appendChild(icon('square', 14));
        send.onclick = () => { App.AgentStop().catch(toastError); };
    } else {
        send.title = 'Send';
        send.appendChild(icon('send', 15));
        send.onclick = () => sendAgentMessage(ta.value);
    }
    row.append(hint, send);
    inputWrap.append(ta, row);
    el.appendChild(inputWrap);

    if (hadFocus) {
        ta.value = savedVal;
        ta.setSelectionRange(savedPos, savedPos);
        ta.focus();
    }
    if (nearBottom) {
        requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });
    }
}

function sendAgentMessage(text: string) {
    const t = text.trim();
    if (!t) return;
    if (inputEl) {
        inputEl.value = '';
        inputEl.style.height = 'auto';
    }
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
    const parts = src.split(/(```[\s\S]*?```)/g);
    return parts.map(part => {
        if (part.startsWith('```')) {
            const body = part.replace(/^```\w*\n?/, '').replace(/```$/, '');
            return '<pre><code>' + esc(body) + '</code></pre>';
        }
        return esc(part).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\n/g, '<br>');
    }).join('');
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
        reject.className = 'btn danger';
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
