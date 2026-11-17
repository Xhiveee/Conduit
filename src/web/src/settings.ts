import * as App from '../wailsjs/go/main/App';
import { BrowserOpenURL } from '../wailsjs/runtime/runtime';
import { notify, applyAll, settingsOrDefault } from './state';
import { BUILTIN_THEMES } from './themes';
import { icon } from './icons';
import { toastError, toastInfo } from './toast';
import { tr, applyLanguage } from './i18n';
import { uiSelect, uiSwitch, uiSlider, uiNumber } from './ui';
import { openDialog } from './ui/dialog';
import type { main } from '../wailsjs/go/models';

let saveTimer: ReturnType<typeof setTimeout> | null = null;

type AppInfo = {
    version: string;
    dataDir: string;
    logPath: string;
    platform: string;
};

// wails regenerates the bindings at build time; the local shape keeps tsc green before that
const aboutApi = App as unknown as {
    GetAppInfo(): Promise<AppInfo>;
    OpenDataFolder(): Promise<void>;
    OpenLogsFolder(): Promise<void>;
    Diagnostics(): Promise<string>;
};

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
    { id: 'about', label: 'About', render: renderAbout },
];

let settingsClose: (() => void) | null = null;
let showSection: ((sec: SettingsSection) => void) | null = null;
let relocalizeSettings: (() => void) | null = null;

export function openSettings(initialSection?: string) {
    const modal = document.createElement('div');
    modal.className = 'modal wide';

    const head = document.createElement('div');
    head.className = 'modal-head';
    const h2 = document.createElement('h2');
    h2.textContent = tr('Settings');
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
        onClose: () => { settingsClose = null; showSection = null; relocalizeSettings = null; },
    });
    settingsClose = () => closeDialog();
    closeBtn.onclick = () => settingsClose?.();

    let currentSection = SECTIONS[0];
    const show = (sec: SettingsSection) => {
        currentSection = sec;
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
        b.textContent = tr(sec.label);
        b.dataset.sec = sec.id;
        b.onclick = () => show(sec);
        nav.appendChild(b);
    }
    relocalizeSettings = () => {
        h2.textContent = tr('Settings');
        nav.querySelectorAll('button').forEach(b => {
            const sec = SECTIONS.find(x => x.id === b.dataset.sec);
            if (sec) b.textContent = tr(sec.label);
        });
        show(currentSection);
    };
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
        name.textContent = tr(t.name);
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

    const langSel = uiSelect({
        value: s.language || '',
        options: [
            { value: '', label: tr('Automatic') },
            { value: 'en', label: 'English' },
            { value: 'ru', label: 'Русский' },
        ],
        onChange: v => setLanguage(v),
    });
    g.appendChild(row(tr('Language'), tr('Interface language'), langSel));

    const scale = uiSlider({
        value: s.uiScale || 1,
        min: 0.8,
        max: 1.4,
        step: 0.05,
        format: v => v.toFixed(2) + '×',
        onInput: v => update({ uiScale: v }),
    });
    g.appendChild(row(tr('Interface scale'), tr('Scales the whole UI'), scale));

    const sideSeg = document.createElement('div');
    sideSeg.className = 'seg';
    for (const [v, label] of [['right', tr('Right')], ['left', tr('Left')]] as const) {
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
    g.appendChild(row(tr('Agent panel side'), '', sideSeg));

    g.appendChild(row(tr('Sidebar'), tr('Show the host list'), toggle(s.sidebarVisible, v => update({ sidebarVisible: v }))));
    g.appendChild(row(tr('Agent panel'), tr('Show the AI assistant'), toggle(s.agentVisible, v => update({ agentVisible: v }))));
    g.appendChild(row(tr('Reduce motion'), tr('Minimize animations and transitions'), toggle(!!s.reduceMotion, v => update({ reduceMotion: v }))));

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
    g.appendChild(row(tr('Font family'), '', fontI));

    const sizeI = uiNumber({
        value: s.fontSize,
        min: 8,
        max: 32,
        step: 1,
        onChange: v => update({ fontSize: v }),
    });
    g.appendChild(row(tr('Font size'), tr('Pixels'), sizeI));

    const lhI = uiNumber({
        value: s.lineHeight,
        min: 0.8,
        max: 2.5,
        step: 0.05,
        onChange: v => update({ lineHeight: v }),
    });
    g.appendChild(row(tr('Line height'), '', lhI));

    const weightSel = (val: number, set: (v: number) => void) => {
        let v = val || 400;
        return uiSelect({
            value: String(v),
            options: [300, 400, 500, 600, 700].map(w => ({ value: String(w), label: String(w) })),
            onChange: o => { v = parseInt(o, 10); set(v); },
        });
    };
    g.appendChild(row(tr('Font weight'), '', weightSel(s.fontWeight || 400, v => update({ fontWeight: v }))));
    g.appendChild(row(tr('Bold weight'), '', weightSel(s.fontWeightBold || 600, v => update({ fontWeightBold: v }))));

    const lsI = uiNumber({
        value: s.letterSpacing || 0,
        min: -2,
        max: 10,
        step: 0.5,
        onChange: v => update({ letterSpacing: v }),
    });
    g.appendChild(row(tr('Letter spacing'), tr('Pixels between characters'), lsI));

    const cursorSel = uiSelect({
        value: s.cursorStyle || 'bar',
        options: [['bar', tr('Bar')], ['block', tr('Block')], ['underline', tr('Underline')]].map(([v, l]) => ({ value: v, label: l })),
        onChange: v => update({ cursorStyle: v }),
    });
    g.appendChild(row(tr('Cursor style'), '', cursorSel));

    g.appendChild(row(tr('Cursor blink'), '', toggle(s.cursorBlink, v => update({ cursorBlink: v }))));

    const scrollI = uiNumber({
        value: s.scrollback,
        min: 0,
        max: 100000,
        step: 1000,
        onChange: v => update({ scrollback: v }),
    });
    g.appendChild(row(tr('Scrollback'), tr('Lines kept in history'), scrollI));

    g.appendChild(row(tr('Copy on select'), '', toggle(s.copyOnSelect, v => update({ copyOnSelect: v }))));
    g.appendChild(row(tr('Right-click paste'), '', toggle(s.rightClickPaste, v => update({ rightClickPaste: v }))));

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
    urlL.textContent = tr('Base URL');
    urlF.append(urlL, urlI);
    g.appendChild(urlF);

    const keyI = document.createElement('input');
    keyI.type = 'password';
    keyI.value = s.ai.apiKey;
    keyI.className = 'mono';
    keyI.style.width = '100%';
    keyI.placeholder = tr('Empty for local servers like Ollama');
    keyI.onchange = () => { ai().apiKey = keyI.value; persistAI(); };
    const keyF = document.createElement('div');
    keyF.className = 'field full';
    const keyL = document.createElement('label');
    keyL.textContent = tr('API key');
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
    modelL.textContent = tr('Model');
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
    stepsL.textContent = tr('Max steps');
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
    ctxL.textContent = tr('Context window');
    ctxF.append(ctxL, ctxI);
    g.appendChild(ctxF);

    g.appendChild(row(tr('Full access'), tr('Run commands and change hosts without asking for approval'), toggle(fullAccessEnabled(), v => { void setFullAccess(v); })));

    const instI = document.createElement('textarea');
    instI.value = s.ai.instructions;
    instI.placeholder = tr('Extra instructions for the agent');
    instI.style.width = '100%';
    instI.onchange = () => { ai().instructions = instI.value; persistAI(); };
    const instF = document.createElement('div');
    instF.className = 'field full';
    const instL = document.createElement('label');
    instL.textContent = tr('Instructions');
    instF.append(instL, instI);
    g.appendChild(instF);

    pane.appendChild(g);
}

function persistAI() {
    persist();
}

function setLanguage(value: string) {
    const s = settingsOrDefault();
    s.language = value;
    applyLanguage(value);
    persist();
    notify();
    relocalizeSettings?.();
}

export function fullAccessEnabled(): boolean {
    return !settingsOrDefault().ai.approveCommands;
}

export async function setFullAccess(enabled: boolean): Promise<void> {
    const s = settingsOrDefault();
    if (s.ai.approveCommands === !enabled) return;
    s.ai.approveCommands = !enabled;
    notify();
    try {
        await App.SaveSettings(s);
        toastInfo(enabled ? tr('Full access on — commands run without approval') : tr('Approvals on'));
    } catch (err) {
        s.ai.approveCommands = !s.ai.approveCommands;
        notify();
        toastError(err);
    }
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
    sub.textContent = tr('Shortcuts work from anywhere, including while the terminal has focus.');
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
        d.textContent = tr(desc);
        row.append(ks, d);
        list.appendChild(row);
    }
    g.appendChild(list);
    pane.appendChild(g);
}

function aboutValue(text: string): HTMLElement {
    const el = document.createElement('span');
    el.className = 'about-value';
    el.textContent = text;
    return el;
}

function aboutButton(label: string, onclick: () => void, primary = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small' + (primary ? ' primary' : '');
    b.textContent = label;
    b.onclick = onclick;
    return b;
}

function pathControl(value: HTMLElement, button: HTMLElement): HTMLElement {
    const box = document.createElement('div');
    box.className = 'about-pathbox';
    value.classList.add('about-path', 'mono');
    box.append(value, button);
    return box;
}

async function copyDiagnostics() {
    try {
        const text = await aboutApi.Diagnostics();
        await navigator.clipboard.writeText(text);
        toastInfo(tr('Diagnostics copied'));
    } catch (err) {
        toastError(err);
    }
}

function renderAbout(pane: HTMLElement) {
    const g = group();

    const head = document.createElement('div');
    head.className = 'about-head';
    const title = document.createElement('h3');
    title.className = 'about-name';
    title.textContent = 'Conduit';
    const tagline = document.createElement('p');
    tagline.className = 'about-tagline';
    tagline.textContent = tr('Portable SSH client with a built-in AI agent.');
    head.append(title, tagline);
    g.appendChild(head);

    const versionVal = aboutValue('…');
    g.appendChild(row(tr('Version'), '', versionVal));

    const platformVal = aboutValue('…');
    g.appendChild(row(tr('Platform'), '', platformVal));

    const repo = document.createElement('button');
    repo.type = 'button';
    repo.className = 'about-link';
    repo.textContent = 'github.com/xhiveee/Conduit';
    repo.onclick = () => BrowserOpenURL('https://github.com/xhiveee/Conduit');
    g.appendChild(row(tr('Repository'), '', repo));

    g.appendChild(row(tr('License'), '', aboutValue('MIT')));

    const dataVal = aboutValue('…');
    const dataBtn = aboutButton(tr('Open data folder'), () => { void aboutApi.OpenDataFolder().catch(toastError); });
    g.appendChild(row(tr('Data folder'), '', pathControl(dataVal, dataBtn)));

    const logVal = aboutValue('…');
    const logBtn = aboutButton(tr('Open logs folder'), () => { void aboutApi.OpenLogsFolder().catch(toastError); });
    g.appendChild(row(tr('Logs'), tr('Rotating log file; no terminal output, chats or API keys.'), pathControl(logVal, logBtn)));

    const actions = document.createElement('div');
    actions.className = 'about-actions';
    actions.appendChild(aboutButton(tr('Copy diagnostics'), () => { void copyDiagnostics(); }, true));
    g.appendChild(actions);

    pane.appendChild(g);

    void (async () => {
        try {
            const info = await aboutApi.GetAppInfo();
            versionVal.textContent = info.version || 'dev';
            platformVal.textContent = info.platform;
            dataVal.textContent = info.dataDir;
            dataVal.title = info.dataDir;
            logVal.textContent = info.logPath;
            logVal.title = info.logPath;
        } catch {
            versionVal.textContent = 'dev';
            platformVal.textContent = '—';
        }
    })();
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
