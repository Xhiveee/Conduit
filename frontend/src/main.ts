import './style.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/cyrillic-400.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import '@fontsource/jetbrains-mono/cyrillic-600.css';
import * as App from '../wailsjs/go/main/App';
import { init, onUI, settingsOrDefault } from './state';
import { renderTabs, handleTabShortcut, focusQuickConnect } from './tabs';
import { syncTerminals, fitActive, toggleSearch } from './terminal';
import { renderSidebar } from './sidebar';
import { renderAgent, focusAgentInput } from './agent-panel';
import { toggleSettings } from './settings';
import { icon } from './icons';
import { initTooltips, installContextMenuGuard, escapeTop, layerDepth } from './ui';
import { enhanceQuickConnect } from './quick-connect';
import { WindowMinimise, WindowToggleMaximise, Quit } from '../wailsjs/runtime/runtime';

function renderAll() {
    renderTabs();
    syncTerminals();
    renderSidebar();
    renderAgent();
}

function setupTitlebar() {
    const settingsBtn = document.getElementById('btn-settings')!;
    settingsBtn.appendChild(icon('settings', 16));
    settingsBtn.onclick = () => toggleSettings();

    document.getElementById('win-min')!.appendChild(icon('minus', 14));
    document.getElementById('win-max')!.appendChild(icon('square', 13));
    document.getElementById('win-close')!.appendChild(icon('x', 14));
    document.getElementById('win-min')!.onclick = () => WindowMinimise();
    document.getElementById('win-max')!.onclick = () => WindowToggleMaximise();
    document.getElementById('win-close')!.onclick = () => Quit();

    const tb = document.getElementById('titlebar')!;
    tb.addEventListener('dblclick', ev => {
        if ((ev.target as HTMLElement).closest('button,input')) return;
        WindowToggleMaximise();
    });

    const qc = document.getElementById('quick-connect') as HTMLInputElement;
    enhanceQuickConnect(qc);
}

function uiScale(): number {
    return parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1;
}

function setupSplitters() {
    const bind = (splitId: string, targetId: string, cssVar: string, min: number, max: number, kind: 'sidebar' | 'agent') => {
        const split = document.getElementById(splitId);
        const target = document.getElementById(targetId);
        if (!split || !target) return;
        let dragging = false;
        let startX = 0;
        let startW = 0;
        let currentW = 0;
        split.addEventListener('mousedown', ev => {
            dragging = true;
            document.body.classList.add('no-anim');
            startX = ev.clientX;
            startW = target.getBoundingClientRect().width / uiScale();
            split.classList.add('dragging');
            ev.preventDefault();
        });
        window.addEventListener('mousemove', ev => {
            if (!dragging) return;
            const s = settingsOrDefault();
            const growsLeft = kind === 'sidebar' || s.agentSide === 'left';
            const delta = (growsLeft ? ev.clientX - startX : startX - ev.clientX) / uiScale();
            currentW = Math.min(max, Math.max(min, startW + delta));
            document.documentElement.style.setProperty(cssVar, (currentW / 16) + 'rem');
            requestAnimationFrame(fitActive);
        });
        window.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            document.body.classList.remove('no-anim');
            split.classList.remove('dragging');
            if (currentW > 0) {
                const s = settingsOrDefault();
                if (kind === 'sidebar') s.sidebarWidth = Math.round(currentW);
                else s.agentWidth = Math.round(currentW);
                void App.SaveSettings(s);
            }
        });
    };
    bind('split-sidebar', 'sidebar', '--sidebar-w', 180, 480, 'sidebar');
    bind('split-agent', 'agent', '--agent-w', 280, 640, 'agent');
}

function togglePanel(key: 'sidebarVisible' | 'agentVisible') {
    const s = settingsOrDefault();
    s[key] = !s[key];
    void App.SaveSettings(s);
}

function setupShortcuts() {
    window.addEventListener('keydown', ev => {
        if (ev.key === 'Escape') {
            if (escapeTop()) {
                ev.preventDefault();
            }
            return;
        }
        if (layerDepth() > 0) return;
        if (handleTabShortcut(ev)) return;
        if (!ev.ctrlKey || ev.altKey) return;
        if (ev.key === ',') {
            ev.preventDefault();
            toggleSettings();
            return;
        }
        if (!ev.shiftKey) return;
        const k = ev.key.toLowerCase();
        if (!['b', 'j', 'l', 't', 'f'].includes(k)) return;
        ev.preventDefault();
        if (k === 'b') togglePanel('sidebarVisible');
        else if (k === 'j') togglePanel('agentVisible');
        else if (k === 'l') focusAgentInput();
        else if (k === 't') focusQuickConnect();
        else if (k === 'f') toggleSearch();
    });
}

async function boot() {
    initTooltips();
    installContextMenuGuard();
    setupTitlebar();
    setupSplitters();
    setupShortcuts();
    onUI(renderAll);
    await init();
    renderAll();
}

void boot();
