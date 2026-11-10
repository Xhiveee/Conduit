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
    body.className = 'modal-body';
    modal.appendChild(body);

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

    renderAppearance(body);
    renderThemeEditor(body);
    renderTerminal(body);
    renderAI(body);
    renderCustomCSS(body);
}

function section(title: string): HTMLElement {
    const s = document.createElement('div');
    s.className = 'set-section';
    const h = document.createElement('h3');
    h.textContent = title;
    s.appendChild(h);
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
    const t = document.createElement('button');
    t.className = 'toggle' + (on ? ' on' : '');
    t.onclick = () => {
        const v = !t.classList.contains('on');
        t.classList.toggle('on', v);
        onchange(v);
    };
    return t;
}

function renderAppearance(body: HTMLElement) {
    const s = settingsOrDefault();
    const sec = section('Appearance');

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
    sec.appendChild(themes);

    const scale = document.createElement('input');
    scale.type = 'range';
    scale.min = '0.8';
    scale.max = '1.4';
    scale.step = '0.05';
    scale.value = String(s.uiScale || 1);
    scale.oninput = () => update({ uiScale: parseFloat(scale.value) });
    sec.appendChild(row('Interface scale', 'Scales the whole UI', scale));

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
    sec.appendChild(row('Agent panel side', '', sideSeg));

    sec.appendChild(row('Sidebar', 'Show the host list', toggle(s.sidebarVisible, v => update({ sidebarVisible: v }))));
    sec.appendChild(row('Agent panel', 'Show the AI assistant', toggle(s.agentVisible, v => update({ agentVisible: v }))));

    body.appendChild(sec);
}

function renderThemeEditor(body: HTMLElement) {
    const s = settingsOrDefault();
    const sec = section('Theme editor');

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
        s.customThemes = [...(s.customThemes ?? []), copy as unknown as main.Theme];
        update({ customThemes: s.customThemes });
        sel.value = copy.id;
        renderThemeVars();
    };
    top.appendChild(dupBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn danger';
    delBtn.style.marginLeft = '8px';
    delBtn.textContent = 'Delete custom';
    delBtn.onclick = () => {
        const t = customThemes().find(t => t.id === sel.value);
        if (!t) return;
        if (!confirm(`Delete theme "${t.name}"?`)) return;
        s.customThemes = (s.customThemes ?? []).filter((x: any) => x.id !== t.id);
        if (s.themeId === t.id) update({ themeId: 'black', customThemes: s.customThemes });
        else update({ customThemes: s.customThemes });
        renderThemeVars();
    };
    top.appendChild(delBtn);
    sec.appendChild(top);

    const nameRow = document.createElement('div');
    nameRow.className = 'set-row';
    const nameI = document.createElement('input');
    nameI.style.width = '220px';
    const cur = () => customThemes().find(t => t.id === sel.value);
    nameI.value = cur()?.name ?? '';
    nameI.disabled = !cur();
    nameI.onchange = () => {
        const t = cur();
        if (t) {
            t.name = nameI.value;
            update({ customThemes: s.customThemes });
        }
    };
    const nameL = document.createElement('label');
    nameL.textContent = 'Custom theme name';
    nameRow.append(nameL, nameI);
    sec.appendChild(nameRow);

    const varsBox = document.createElement('div');
    varsBox.className = 'var-grid';
    sec.appendChild(varsBox);

    function renderThemeVars() {
        varsBox.innerHTML = '';
        const t = cur();
        if (!t) {
            const note = document.createElement('div');
            note.className = 'muted';
            note.style.fontSize = '12px';
            note.textContent = 'Built-in themes are read-only. Duplicate one to customize it.';
            varsBox.appendChild(note);
            nameI.disabled = true;
            return;
        }
        nameI.disabled = false;
        nameI.value = t.name;

        const uiSub = document.createElement('div');
        uiSub.className = 'set-section';
        const uh = document.createElement('h3');
        uh.textContent = 'Interface colors';
        uiSub.appendChild(uh);
        for (const v of UI_VARS) {
            const item = document.createElement('div');
            item.className = 'var-item';
            const l = document.createElement('label');
            const inp = document.createElement('input');
            inp.type = 'color';
            const curVal = t.ui[v] || '#000000';
            inp.value = normalizeColor(curVal);
            inp.oninput = () => {
                t.ui[v] = inp.value;
                applyTheme(resolveTheme(themeSettings()));
                persist();
            };
            const hex = document.createElement('input');
            hex.type = 'text';
            hex.value = curVal;
            hex.onchange = () => {
                if (/^#[0-9a-fA-F]{6}$/.test(hex.value)) {
                    t.ui[v] = hex.value;
                    inp.value = hex.value;
                    applyTheme(resolveTheme(themeSettings()));
                    persist();
                }
            };
            l.append(inp);
            const span = document.createElement('span');
            span.className = 'mono';
            span.textContent = v;
            l.appendChild(span);
            item.append(l, hex);
            uiSub.appendChild(item);
        }
        varsBox.appendChild(uiSub);

        const termSub = document.createElement('div');
        termSub.className = 'set-section';
        const th = document.createElement('h3');
        th.textContent = 'Terminal colors';
        termSub.appendChild(th);
        const tgrid = document.createElement('div');
        tgrid.className = 'var-grid';
        for (const { key, label } of TERM_COLOR_KEYS) {
            const item = document.createElement('div');
            item.className = 'var-item';
            const val = (t.terminal as Record<string, string>)[key as string] || '#000000';
            const l = document.createElement('label');
            const inp = document.createElement('input');
            inp.type = 'color';
            inp.value = normalizeColor(val);
            inp.oninput = () => {
                (t.terminal as Record<string, string>)[key as string] = inp.value;
                applyAll();
                persist();
            };
            l.append(inp);
            const span = document.createElement('span');
            span.textContent = label;
            l.appendChild(span);
            item.appendChild(l);
            tgrid.appendChild(item);
        }
        termSub.appendChild(tgrid);
        varsBox.appendChild(termSub);
    }

    sel.onchange = () => {
        nameI.value = cur()?.name ?? '';
        nameI.disabled = !cur();
        renderThemeVars();
    };
    renderThemeVars();
    body.appendChild(sec);
}

function normalizeColor(c: string): string {
    if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
    if (/^#[0-9a-fA-F]{3}$/.test(c)) {
        return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    }
    return '#000000';
}

function renderTerminal(body: HTMLElement) {
    const s = settingsOrDefault();
    const sec = section('Terminal');

    const fontI = document.createElement('input');
    fontI.value = s.fontFamily;
    fontI.style.width = '280px';
    fontI.className = 'mono';
    fontI.onchange = () => update({ fontFamily: fontI.value });
    sec.appendChild(row('Font family', '', fontI));

    const sizeI = document.createElement('input');
    sizeI.type = 'number';
    sizeI.min = '8';
    sizeI.max = '32';
    sizeI.value = String(s.fontSize);
    sizeI.onchange = () => update({ fontSize: parseInt(sizeI.value, 10) || 14 });
    sec.appendChild(row('Font size', 'Pixels', sizeI));

    const lhI = document.createElement('input');
    lhI.type = 'number';
    lhI.min = '0.8';
    lhI.max = '2.5';
    lhI.step = '0.05';
    lhI.value = String(s.lineHeight);
    lhI.onchange = () => update({ lineHeight: parseFloat(lhI.value) || 1.2 });
    sec.appendChild(row('Line height', '', lhI));

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
    sec.appendChild(row('Cursor style', '', cursorSel));

    sec.appendChild(row('Cursor blink', '', toggle(s.cursorBlink, v => update({ cursorBlink: v }))));

    const scrollI = document.createElement('input');
    scrollI.type = 'number';
    scrollI.min = '0';
    scrollI.max = '100000';
    scrollI.step = '1000';
    scrollI.value = String(s.scrollback);
    scrollI.onchange = () => update({ scrollback: parseInt(scrollI.value, 10) || 10000 });
    sec.appendChild(row('Scrollback', 'Lines kept in history', scrollI));

    sec.appendChild(row('Copy on select', '', toggle(s.copyOnSelect, v => update({ copyOnSelect: v }))));
    sec.appendChild(row('Right-click paste', '', toggle(s.rightClickPaste, v => update({ rightClickPaste: v }))));

    body.appendChild(sec);
}

function renderAI(body: HTMLElement) {
    const s = settingsOrDefault();
    const ai = s.ai;
    const sec = section('AI agent');

    const urlI = document.createElement('input');
    urlI.value = ai.baseUrl;
    urlI.className = 'mono';
    urlI.style.width = '100%';
    urlI.onchange = () => { ai.baseUrl = urlI.value; persistAI(); };
    const urlF = document.createElement('div');
    urlF.className = 'field full';
    const urlL = document.createElement('label');
    urlL.textContent = 'Base URL';
    urlF.append(urlL, urlI);
    sec.appendChild(urlF);

    const keyI = document.createElement('input');
    keyI.type = 'password';
    keyI.value = ai.apiKey;
    keyI.className = 'mono';
    keyI.style.width = '100%';
    keyI.placeholder = 'sk-… (empty for local servers like Ollama)';
    keyI.onchange = () => { ai.apiKey = keyI.value; persistAI(); };
    const keyF = document.createElement('div');
    keyF.className = 'field full';
    const keyL = document.createElement('label');
    keyL.textContent = 'API key';
    keyF.append(keyL, keyI);
    sec.appendChild(keyF);

    const modelI = document.createElement('input');
    modelI.value = ai.model;
    modelI.className = 'mono';
    modelI.style.width = '100%';
    modelI.onchange = () => { ai.model = modelI.value; persistAI(); notify(); };
    const modelF = document.createElement('div');
    modelF.className = 'field';
    const modelL = document.createElement('label');
    modelL.textContent = 'Model';
    modelF.append(modelL, modelI);
    sec.appendChild(modelF);

    const stepsI = document.createElement('input');
    stepsI.type = 'number';
    stepsI.min = '1';
    stepsI.max = '100';
    stepsI.value = String(ai.maxSteps || 30);
    stepsI.onchange = () => { ai.maxSteps = parseInt(stepsI.value, 10) || 30; persistAI(); };
    const stepsF = document.createElement('div');
    stepsF.className = 'field';
    const stepsL = document.createElement('label');
    stepsL.textContent = 'Max steps';
    stepsF.append(stepsL, stepsI);
    sec.appendChild(stepsF);

    sec.appendChild(row('Approve commands', 'Ask before the agent runs commands or changes hosts', toggle(ai.approveCommands, v => { ai.approveCommands = v; persistAI(); })));

    const instI = document.createElement('textarea');
    instI.value = ai.instructions;
    instI.placeholder = 'Extra instructions appended to the agent system prompt';
    instI.style.width = '100%';
    instI.onchange = () => { ai.instructions = instI.value; persistAI(); };
    const instF = document.createElement('div');
    instF.className = 'field full';
    const instL = document.createElement('label');
    instL.textContent = 'Instructions';
    instF.append(instL, instI);
    sec.appendChild(instF);

    body.appendChild(sec);
}

function persistAI() {
    persist();
}

function renderCustomCSS(body: HTMLElement) {
    const s = settingsOrDefault();
    const sec = section('Custom CSS');
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
    sec.appendChild(f);
    body.appendChild(sec);
}

export function toggleSettings() {
    const existing = document.querySelector('.modal-overlay');
    if (existing) {
        existing.remove();
        return;
    }
    openSettings();
}
