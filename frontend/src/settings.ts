import * as App from '../wailsjs/go/main/App';
import { notify, applyAll, settingsOrDefault, customThemes, themeSettings } from './state';
import { BUILTIN_THEMES, applyTheme, resolveTheme, type ThemeDef } from './themes';
import { icon } from './icons';
import { toastError } from './toast';
import type { main } from '../wailsjs/go/models';
import type { ITheme } from '@xterm/xterm';

const TERM_COLOR_KEYS: { key: keyof ITheme; label: string }[] = [
    { key: 'foreground', label: 'Foreground' },
    { key: 'background', label: 'Background' },
    { key: 'cursor', label: 'Cursor' },
    { key: 'cursorAccent', label: 'Cursor accent' },
    { key: 'selectionBackground', label: 'Selection' },
    { key: 'black', label: 'Black' },
    { key: 'red', label: 'Red' },
    { key: 'green', label: 'Green' },
    { key: 'yellow', label: 'Yellow' },
    { key: 'blue', label: 'Blue' },
    { key: 'magenta', label: 'Magenta' },
    { key: 'cyan', label: 'Cyan' },
    { key: 'white', label: 'White' },
    { key: 'brightBlack', label: 'Bright black' },
    { key: 'brightRed', label: 'Bright red' },
    { key: 'brightGreen', label: 'Bright green' },
    { key: 'brightYellow', label: 'Bright yellow' },
    { key: 'brightBlue', label: 'Bright blue' },
    { key: 'brightMagenta', label: 'Bright magenta' },
    { key: 'brightCyan', label: 'Bright cyan' },
    { key: 'brightWhite', label: 'Bright white' },
];

const UI_VARS = [
    '--bg', '--surface-1', '--surface-2', '--surface-3',
    '--text', '--text-2', '--text-3',
    '--accent', '--accent-ink', '--agent', '--danger',
];

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
    { id: 'themes', label: 'Themes', render: renderThemes },
    { id: 'terminal', label: 'Terminal', render: renderTerminal },
    { id: 'agent', label: 'Agent', render: renderAgentSection },
    { id: 'css', label: 'Custom CSS', render: renderCustomCSS },
];

export function openSettings() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'modal wide';

    const head = document.createElement('div');
    head.className = 'modal-head';
    const h2 = document.createElement('h2');
    h2.textContent = 'Settings';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'x';
    closeBtn.appendChild(icon('x', 15));
    closeBtn.onclick = () => overlay.remove();
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

    const foot = document.createElement('div');
    foot.className = 'modal-foot';
    const close = document.createElement('button');
    close.className = 'btn';
    close.textContent = 'Close';
    close.onclick = () => overlay.remove();
    foot.appendChild(close);
    modal.appendChild(foot);
    overlay.appendChild(modal);
    document.getElementById('modal-root')!.appendChild(overlay);
    overlay.addEventListener('mousedown', ev => { if (ev.target === overlay) overlay.remove(); });

    const show = (sec: SettingsSection) => {
        nav.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.sec === sec.id));
        pane.innerHTML = '';
        sec.render(pane);
    };
    for (const sec of SECTIONS) {
        const b = document.createElement('button');
        b.textContent = sec.label;
        b.dataset.sec = sec.id;
        b.onclick = () => show(sec);
        nav.appendChild(b);
    }
    show(SECTIONS[0]);
}

function group(): HTMLElement {
    const s = document.createElement('div');
    s.className = 'set-group';
    return s;
}

function subTitle(text: string): HTMLElement {
    const h = document.createElement('div');
    h.className = 'set-sub';
    h.textContent = text;
    return h;
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
    const t = document.createElement('button');
    t.className = 'toggle' + (on ? ' on' : '');
    t.onclick = () => {
        const v = !t.classList.contains('on');
        t.classList.toggle('on', v);
        onchange(v);
    };
    return t;
}

function renderAppearance(pane: HTMLElement) {
    const s = settingsOrDefault();
    const g = group();

    const themes = document.createElement('div');
    themes.className = 'theme-grid';
    const allThemes: ThemeDef[] = [
        ...BUILTIN_THEMES,
        ...customThemes(),
    ];
    for (const t of allThemes) {
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
        const tag = document.createElement('span');
        tag.className = 'dim';
        tag.style.fontSize = '10.5px';
        tag.textContent = t.builtin ? 'built-in' : 'custom';
        name.appendChild(tag);
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

    const scale = document.createElement('input');
    scale.type = 'range';
    scale.min = '0.8';
    scale.max = '1.4';
    scale.step = '0.05';
    scale.value = String(s.uiScale || 1);
    scale.oninput = () => update({ uiScale: parseFloat(scale.value) });
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

    pane.appendChild(g);
}

function renderThemes(pane: HTMLElement) {
    const s = settingsOrDefault();
    const g = group();

    const top = document.createElement('div');
    top.className = 'set-row';
    const topLabel = document.createElement('label');
    topLabel.textContent = 'Theme';
    const sel = document.createElement('select');
    sel.style.width = '220px';
    const allThemes: ThemeDef[] = [...BUILTIN_THEMES, ...customThemes()];
    for (const t of allThemes) {
        const o = document.createElement('option');
        o.value = t.id;
        o.textContent = t.name + (t.builtin ? ' (built-in)' : '');
        sel.appendChild(o);
    }
    sel.value = s.themeId;
    top.append(topLabel, sel);

    const dupBtn = document.createElement('button');
    dupBtn.className = 'btn';
    dupBtn.style.marginLeft = '8px';
    dupBtn.textContent = 'Duplicate as custom';
    dupBtn.onclick = () => {
        const src = allThemes.find(t => t.id === sel.value) ?? allThemes[0];
        const copy: ThemeDef = {
            id: 'custom-' + Date.now().toString(36),
            name: src.name + ' copy',
            builtin: false,
            ui: { ...src.ui },
            terminal: { ...(src.terminal as Record<string, string>) } as ITheme,
        };
        const cur2 = settingsOrDefault();
        cur2.customThemes = [...(cur2.customThemes ?? []), copy as unknown as main.Theme];
        update({ customThemes: cur2.customThemes });
        const opt = document.createElement('option');
        opt.value = copy.id;
        opt.textContent = copy.name;
        sel.appendChild(opt);
        sel.value = copy.id;
        renderThemeVars();
    };
    top.appendChild(dupBtn);
    g.appendChild(top);

    const nameRow = document.createElement('div');
    nameRow.className = 'set-row';
    nameRow.style.display = 'none';
    const nameI = document.createElement('input');
    nameI.style.width = '220px';
    const cur = () => customThemes().find(t => t.id === sel.value);
    nameI.onchange = () => {
        const t = cur();
        if (t) {
            t.name = nameI.value;
            persist();
        }
    };
    const nameL = document.createElement('label');
    nameL.textContent = 'Custom theme name';
    nameRow.append(nameL, nameI);
    g.appendChild(nameRow);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn danger';
    delBtn.style.margin = '4px 0 12px';
    delBtn.style.display = 'none';
    delBtn.textContent = 'Delete custom theme';
    delBtn.onclick = () => {
        const t = cur();
        if (!t) return;
        if (!confirm(`Delete theme "${t.name}"?`)) return;
        const wasSelected = sel.value === t.id;
        const cur2 = settingsOrDefault();
        cur2.customThemes = (cur2.customThemes ?? []).filter((x: any) => x.id !== t.id);
        sel.querySelector(`option[value="${t.id}"]`)?.remove();
        if (cur2.themeId === t.id) update({ themeId: 'black', customThemes: cur2.customThemes });
        else update({ customThemes: cur2.customThemes });
        if (wasSelected) sel.value = settingsOrDefault().themeId;
        renderThemeVars();
    };
    g.appendChild(delBtn);

    const varsBox = document.createElement('div');
    g.appendChild(varsBox);

    function colorItem(labelText: string, get: () => string, set: (v: string) => void, onLive: () => void) {
        const item = document.createElement('div');
        item.className = 'var-item';
        const l = document.createElement('label');
        l.textContent = labelText;
        const inp = document.createElement('input');
        inp.type = 'color';
        inp.value = normalizeColor(get());
        inp.oninput = () => {
            set(inp.value);
            onLive();
            persist();
        };
        const hex = document.createElement('input');
        hex.type = 'text';
        hex.value = get();
        hex.spellcheck = false;
        hex.onchange = () => {
            if (/^#[0-9a-fA-F]{6}$/.test(hex.value)) {
                set(hex.value);
                inp.value = hex.value;
                onLive();
                persist();
            }
        };
        l.append(inp);
        item.append(l, hex);
        return item;
    }

    function renderThemeVars() {
        varsBox.innerHTML = '';
        const t = cur();
        const isCustom = !!t && !t.builtin;
        nameRow.style.display = isCustom ? '' : 'none';
        delBtn.style.display = isCustom ? '' : 'none';
        if (!t || t.builtin) {
            const note = document.createElement('div');
            note.className = 'muted';
            note.style.fontSize = '12px';
            note.textContent = 'Built-in themes are read-only. Duplicate one to customize it.';
            varsBox.appendChild(note);
            return;
        }
        nameI.value = t.name;
        const themeId = t.id;
        const liveTheme = () => customThemes().find(x => x.id === themeId) as ThemeDef | undefined;

        const uiSub = group();
        uiSub.appendChild(subTitle('Interface colors'));
        const uiGrid = document.createElement('div');
        uiGrid.className = 'var-grid';
        for (const v of UI_VARS) {
            uiGrid.appendChild(colorItem(v,
                () => liveTheme()?.ui[v] || '#000000',
                nv => { const tt = liveTheme(); if (tt) tt.ui[v] = nv; },
                () => applyTheme(resolveTheme(themeSettings()))));
        }
        uiSub.appendChild(uiGrid);
        varsBox.appendChild(uiSub);

        const termSub = group();
        termSub.appendChild(subTitle('Terminal colors'));
        const tgrid = document.createElement('div');
        tgrid.className = 'var-grid';
        for (const { key, label } of TERM_COLOR_KEYS) {
            tgrid.appendChild(colorItem(label,
                () => (liveTheme()?.terminal as Record<string, string> | undefined)?.[key as string] || '#000000',
                nv => { const tt = liveTheme(); if (tt) (tt.terminal as Record<string, string>)[key as string] = nv; },
                () => applyAll()));
        }
        termSub.appendChild(tgrid);
        varsBox.appendChild(termSub);
    }

    sel.onchange = () => {
        nameI.value = cur()?.name ?? '';
        renderThemeVars();
    };
    renderThemeVars();
    pane.appendChild(g);
}

function normalizeColor(c: string): string {
    if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
    if (/^#[0-9a-fA-F]{3}$/.test(c)) {
        return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    }
    return '#000000';
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

    const sizeI = document.createElement('input');
    sizeI.type = 'number';
    sizeI.min = '8';
    sizeI.max = '32';
    sizeI.value = String(s.fontSize);
    sizeI.onchange = () => update({ fontSize: parseInt(sizeI.value, 10) || 14 });
    g.appendChild(row('Font size', 'Pixels', sizeI));

    const lhI = document.createElement('input');
    lhI.type = 'number';
    lhI.min = '0.8';
    lhI.max = '2.5';
    lhI.step = '0.05';
    lhI.value = String(s.lineHeight);
    lhI.onchange = () => update({ lineHeight: parseFloat(lhI.value) || 1.2 });
    g.appendChild(row('Line height', '', lhI));

    const cursorSel = document.createElement('select');
    cursorSel.style.width = '140px';
    for (const [v, l] of [['bar', 'Bar'], ['block', 'Block'], ['underline', 'Underline']] as const) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = l;
        cursorSel.appendChild(o);
    }
    cursorSel.value = s.cursorStyle || 'bar';
    cursorSel.onchange = () => update({ cursorStyle: cursorSel.value });
    g.appendChild(row('Cursor style', '', cursorSel));

    g.appendChild(row('Cursor blink', '', toggle(s.cursorBlink, v => update({ cursorBlink: v }))));

    const scrollI = document.createElement('input');
    scrollI.type = 'number';
    scrollI.min = '0';
    scrollI.max = '100000';
    scrollI.step = '1000';
    scrollI.value = String(s.scrollback);
    scrollI.onchange = () => update({ scrollback: parseInt(scrollI.value, 10) || 10000 });
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
    keyI.placeholder = 'sk-… (empty for local servers like Ollama)';
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

    const stepsI = document.createElement('input');
    stepsI.type = 'number';
    stepsI.min = '1';
    stepsI.max = '100';
    stepsI.value = String(s.ai.maxSteps || 30);
    stepsI.onchange = () => { ai().maxSteps = parseInt(stepsI.value, 10) || 30; persistAI(); };
    const stepsF = document.createElement('div');
    stepsF.className = 'field';
    const stepsL = document.createElement('label');
    stepsL.textContent = 'Max steps';
    stepsF.append(stepsL, stepsI);
    g.appendChild(stepsF);

    g.appendChild(row('Approve commands', 'Ask before the agent runs commands or changes hosts', toggle(s.ai.approveCommands, v => { ai().approveCommands = v; persistAI(); })));

    const instI = document.createElement('textarea');
    instI.value = s.ai.instructions;
    instI.placeholder = 'Extra instructions appended to the agent system prompt';
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

function renderCustomCSS(pane: HTMLElement) {
    const s = settingsOrDefault();
    const g = group();
    const ta = document.createElement('textarea');
    ta.value = s.customCss;
    ta.placeholder = '.term-frame { border-color: red; }';
    ta.style.width = '100%';
    ta.style.minHeight = '90px';
    ta.style.fontFamily = 'var(--font-mono)';
    ta.style.fontSize = '12px';
    ta.onchange = () => update({ customCss: ta.value });
    const f = document.createElement('div');
    f.className = 'field full';
    const l = document.createElement('label');
    l.textContent = 'Injected into the page as a <style> tag';
    f.append(l, ta);
    g.appendChild(f);
    pane.appendChild(g);
}

export function toggleSettings() {
    const existing = document.querySelector('.modal-overlay');
    if (existing) {
        existing.remove();
        return;
    }
    openSettings();
}
