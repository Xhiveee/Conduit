import * as App from '../wailsjs/go/main/App';
import { notify, applyAll, settingsOrDefault } from './state';
import { BUILTIN_THEMES } from './themes';
import { icon } from './icons';
import { toastError } from './toast';
import { uiSelect, uiSwitch, uiSlider, uiNumber } from './ui';
import { openDialog } from './ui/dialog';
import type { main } from '../wailsjs/go/models';

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persist() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        const s = settingsOrDefault();
        void App.SaveSettings(s).catch(toastError);
    }, 400);
}

function update(patch: Partial<main.Settings>) {
    const s = settingsOrDefault();
    Object.assign(s, patch);
    applyAll();
    notify();
    persist();
}

interface SettingsSection {
    id: string;
    label: string;
    render: (pane: HTMLElement) => void;
}

const SECTIONS: SettingsSection[] = [
    { id: 'appearance', label: 'Appearance', render: renderAppearance },
    { id: 'terminal', label: 'Terminal', render: renderTerminal },
    { id: 'agent', label: 'Agent', render: renderAgentSection },
    { id: 'keyboard', label: 'Keyboard', render: renderKeyboard },
];

let settingsClose: (() => void) | null = null;
let showSection: ((sec: SettingsSection) => void) | null = null;

export function openSettings(initialSection?: string) {
    const modal = document.createElement('div');
    modal.className = 'modal wide';

    const head = document.createElement('div');
    head.className = 'modal-head';
    const h2 = document.createElement('h2');
    h2.textContent = 'Settings';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'x';
    closeBtn.type = 'button';
    closeBtn.appendChild(icon('x', 15));
    head.append(h2, closeBtn);
    modal.appendChild(head);

    const body = document.createElement('div');
    body.className = 'modal-body set-body';
    modal.appendChild(body);

    const layout = document.createElement('div');
    layout.className = 'set-layout';
    const nav = document.createElement('div');
    nav.className = 'set-nav';
    const pane = document.createElement('div');
    pane.className = 'set-pane';
    layout.append(nav, pane);
    body.appendChild(layout);

    const closeDialog = openDialog(modal, {
        onClose: () => { settingsClose = null; showSection = null; },
    });
    settingsClose = () => closeDialog();
    closeBtn.onclick = () => settingsClose?.();

    const show = (sec: SettingsSection) => {
        nav.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.sec === sec.id));
        pane.innerHTML = '';
        pane.classList.remove('pane-in');
        void pane.offsetWidth;
        sec.render(pane);
        pane.classList.add('pane-in');
    };
    showSection = show;
    for (const sec of SECTIONS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = sec.label;
        b.dataset.sec = sec.id;
        b.onclick = () => show(sec);
        nav.appendChild(b);
    }
    show(SECTIONS.find(s => s.id === initialSection) ?? SECTIONS[0]);
}

function group(): HTMLElement {
    const s = document.createElement('div');
    s.className = 'set-group';
    return s;
}

function row(label: string, sub: string, control: HTMLElement): HTMLElement {
    const r = document.createElement('div');
    r.className = 'set-row';
    const l = document.createElement('label');
    l.textContent = label;
    if (sub) {
        const s = document.createElement('span');
        s.className = 'sub';
        s.textContent = sub;
        l.appendChild(s);
    }
    r.append(l, control);
    return r;
}

function toggle(on: boolean, onchange: (v: boolean) => void): HTMLElement {
    return uiSwitch(on, onchange);
}

function renderAppearance(pane: HTMLElement) {
    const s = settingsOrDefault();
    const g = group();

    const themes = document.createElement('div');
    themes.className = 'theme-grid';
    for (const t of BUILTIN_THEMES) {
        const card = document.createElement('button');
        card.className = 'theme-card' + (s.themeId === t.id ? ' sel' : '');
        const prev = document.createElement('div');
        prev.className = 'theme-prev';
        prev.style.background = t.ui['--bg'] ?? '#000';
        const dots = ['--accent', '--agent', '--danger', '--text-2'];
        for (const v of dots) {
            const d = document.createElement('span');
            d.className = 'tp-dot';
            d.style.background = t.ui[v] ?? '#888';
            prev.appendChild(d);
        }
        const bar1 = document.createElement('div');
        bar1.className = 'tp-bar';
        bar1.style.background = t.ui['--surface-3'] ?? '#333';
        const bar2 = document.createElement('div');
        bar2.className = 'tp-bar';
        bar2.style.background = t.ui['--accent'] ?? '#7fd18b';
        bar2.style.opacity = '0.5';
        prev.append(bar1, bar2);
        const name = document.createElement('div');
        name.className = 'theme-name';
        name.textContent = t.name;
        card.append(prev, name);
        card.onclick = () => {
            if (s.themeId === t.id) return;
            update({ themeId: t.id });
            document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('sel'));
            card.classList.add('sel');
        };
        themes.appendChild(card);
    }
    g.appendChild(themes);

    const scale = uiSlider({
        value: s.uiScale || 1,
        min: 0.8,
        max: 1.4,
        step: 0.05,
        format: v => v.toFixed(2) + '×',
        onInput: v => update({ uiScale: v }),
    });
    g.appendChild(row('Interface scale', 'Scales the whole UI', scale));

    const sideSeg = document.createElement('div');
    sideSeg.className = 'seg';
    for (const [v, label] of [['right', 'Right'], ['left', 'Left']] as const) {
        const b = document.createElement('button');
        b.textContent = label;
        b.className = s.agentSide === v ? 'on' : '';
        b.onclick = () => {
            sideSeg.querySelectorAll('button').forEach(x => x.classList.remove('on'));
            b.classList.add('on');
            update({ agentSide: v });
        };
        sideSeg.appendChild(b);
    }
    g.appendChild(row('Agent panel side', '', sideSeg));

    g.appendChild(row('Sidebar', 'Show the host list', toggle(s.sidebarVisible, v => update({ sidebarVisible: v }))));
    g.appendChild(row('Agent panel', 'Show the AI assistant', toggle(s.agentVisible, v => update({ agentVisible: v }))));
    g.appendChild(row('Reduce motion', 'Minimize animations and transitions', toggle(!!s.reduceMotion, v => update({ reduceMotion: v }))));

    pane.appendChild(g);
}

function renderTerminal(pane: HTMLElement) {
    const s = settingsOrDefault();
    const g = group();

    const fontI = document.createElement('input');
    fontI.value = s.fontFamily;
    fontI.style.width = '280px';
    fontI.className = 'mono';
    fontI.onchange = () => update({ fontFamily: fontI.value });
    g.appendChild(row('Font family', '', fontI));

    const sizeI = uiNumber({
        value: s.fontSize,
        min: 8,
        max: 32,
        step: 1,
        onChange: v => update({ fontSize: v }),
    });
    g.appendChild(row('Font size', 'Pixels', sizeI));

    const lhI = uiNumber({
        value: s.lineHeight,
        min: 0.8,
        max: 2.5,
        step: 0.05,
        onChange: v => update({ lineHeight: v }),
    });
    g.appendChild(row('Line height', '', lhI));

    const weightSel = (val: number, set: (v: number) => void) => {
        let v = val || 400;
        return uiSelect({
            value: String(v),
            options: [300, 400, 500, 600, 700].map(w => ({ value: String(w), label: String(w) })),
            onChange: o => { v = parseInt(o, 10); set(v); },
        });
    };
    g.appendChild(row('Font weight', '', weightSel(s.fontWeight || 400, v => update({ fontWeight: v }))));
    g.appendChild(row('Bold weight', '', weightSel(s.fontWeightBold || 600, v => update({ fontWeightBold: v }))));

    const lsI = uiNumber({
        value: s.letterSpacing || 0,
        min: -2,
        max: 10,
        step: 0.5,
        onChange: v => update({ letterSpacing: v }),
    });
    g.appendChild(row('Letter spacing', 'Pixels between characters', lsI));

    const cursorSel = uiSelect({
        value: s.cursorStyle || 'bar',
        options: [['bar', 'Bar'], ['block', 'Block'], ['underline', 'Underline']].map(([v, l]) => ({ value: v, label: l })),
        onChange: v => update({ cursorStyle: v }),
    });
    g.appendChild(row('Cursor style', '', cursorSel));

    g.appendChild(row('Cursor blink', '', toggle(s.cursorBlink, v => update({ cursorBlink: v }))));

    const scrollI = uiNumber({
        value: s.scrollback,
        min: 0,
        max: 100000,
        step: 1000,
        onChange: v => update({ scrollback: v }),
    });
    g.appendChild(row('Scrollback', 'Lines kept in history', scrollI));

    g.appendChild(row('Copy on select', '', toggle(s.copyOnSelect, v => update({ copyOnSelect: v }))));
    g.appendChild(row('Right-click paste', '', toggle(s.rightClickPaste, v => update({ rightClickPaste: v }))));

    pane.appendChild(g);
}

function renderAgentSection(pane: HTMLElement) {
    const s = settingsOrDefault();
    const ai = () => settingsOrDefault().ai;
    const g = group();

    const urlI = document.createElement('input');
    urlI.value = s.ai.baseUrl;
    urlI.className = 'mono';
    urlI.style.width = '100%';
    urlI.onchange = () => { ai().baseUrl = urlI.value; persistAI(); };
    const urlF = document.createElement('div');
    urlF.className = 'field full';
    const urlL = document.createElement('label');
    urlL.textContent = 'Base URL';
    urlF.append(urlL, urlI);
    g.appendChild(urlF);

    const keyI = document.createElement('input');
    keyI.type = 'password';
    keyI.value = s.ai.apiKey;
    keyI.className = 'mono';
    keyI.style.width = '100%';
    keyI.placeholder = 'Empty for local servers like Ollama';
    keyI.onchange = () => { ai().apiKey = keyI.value; persistAI(); };
    const keyF = document.createElement('div');
    keyF.className = 'field full';
    const keyL = document.createElement('label');
    keyL.textContent = 'API key';
    keyF.append(keyL, keyI);
    g.appendChild(keyF);

    const modelI = document.createElement('input');
    modelI.value = s.ai.model;
    modelI.className = 'mono';
    modelI.style.width = '100%';
    modelI.onchange = () => { ai().model = modelI.value; persistAI(); notify(); };
    const modelF = document.createElement('div');
    modelF.className = 'field';
    const modelL = document.createElement('label');
    modelL.textContent = 'Model';
    modelF.append(modelL, modelI);
    g.appendChild(modelF);

    const stepsI = uiNumber({
        value: s.ai.maxSteps || 30,
        min: 1,
        max: 100,
        step: 1,
        onChange: v => { ai().maxSteps = v; persistAI(); },
    });
    const stepsF = document.createElement('div');
    stepsF.className = 'field';
    const stepsL = document.createElement('label');
    stepsL.textContent = 'Max steps';
    stepsF.append(stepsL, stepsI);
    g.appendChild(stepsF);

    const ctxI = uiNumber({
        value: s.ai.contextWindow || 128000,
        min: 1024,
        max: 2000000,
        step: 1024,
        onChange: v => { ai().contextWindow = v; persistAI(); notify(); },
    });
    const ctxF = document.createElement('div');
    ctxF.className = 'field';
    const ctxL = document.createElement('label');
    ctxL.textContent = 'Context window';
    ctxF.append(ctxL, ctxI);
    g.appendChild(ctxF);

    g.appendChild(row('Approve commands', 'Ask before the agent runs commands or changes hosts', toggle(s.ai.approveCommands, v => { ai().approveCommands = v; persistAI(); })));

    const instI = document.createElement('textarea');
    instI.value = s.ai.instructions;
    instI.placeholder = 'Extra instructions for the agent';
    instI.style.width = '100%';
    instI.onchange = () => { ai().instructions = instI.value; persistAI(); };
    const instF = document.createElement('div');
    instF.className = 'field full';
    const instL = document.createElement('label');
    instL.textContent = 'Instructions';
    instF.append(instL, instI);
    g.appendChild(instF);

    pane.appendChild(g);
}

function persistAI() {
    persist();
}

const KEYBOARD_SHORTCUTS: [string, string][] = [
    ['Ctrl+Shift+B', 'Toggle sidebar'],
    ['Ctrl+Shift+J', 'Toggle agent panel'],
    ['Ctrl+Shift+L', 'Focus agent input'],
    ['Ctrl+Shift+T', 'Quick connect'],
    ['Ctrl+Shift+F', 'Search terminal'],
    ['Ctrl+,', 'Settings'],
    ['Ctrl+Tab', 'Next tab'],
    ['Ctrl+Shift+Tab', 'Previous tab'],
    ['Ctrl+Shift+W', 'Close tab'],
    ['Esc', 'Close dialog or search'],
];

function renderKeyboard(pane: HTMLElement) {
    const g = group();
    const sub = document.createElement('div');
    sub.className = 'set-desc';
    sub.textContent = 'Shortcuts work from anywhere, including while the terminal has focus.';
    g.appendChild(sub);
    const list = document.createElement('div');
    list.className = 'kbd-list';
    for (const [keys, desc] of KEYBOARD_SHORTCUTS) {
        const row = document.createElement('div');
        row.className = 'kbd-row';
        const ks = document.createElement('span');
        ks.className = 'kbd-keys';
        for (const part of keys.split('+')) {
            const k = document.createElement('kbd');
            k.textContent = part.trim();
            ks.appendChild(k);
        }
        const d = document.createElement('span');
        d.className = 'kbd-desc';
        d.textContent = desc;
        row.append(ks, d);
        list.appendChild(row);
    }
    g.appendChild(list);
    pane.appendChild(g);
}

export function toggleSettings(sectionId?: string) {
    if (settingsClose) {
        if (sectionId && showSection) {
            const sec = SECTIONS.find(s => s.id === sectionId);
            if (sec) showSection(sec);
            return;
        }
        settingsClose();
        return;
    }
    openSettings(sectionId);
}
