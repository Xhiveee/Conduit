import './style.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/cyrillic-400.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import '@fontsource/jetbrains-mono/cyrillic-600.css';
import * as App from '../wailsjs/go/main/App';
import { init, onUI, quickConnect, settingsOrDefault } from './state';
import { renderTabs, handleTabShortcut, focusQuickConnect } from './tabs';
import { syncTerminals, fitActive } from './terminal';
import { renderSidebar } from './sidebar';
import { renderAgent, focusAgentInput } from './agent-panel';
import { toggleSettings } from './settings';
import { icon } from './icons';
import { initTooltips, installContextMenuGuard, escapeTop } from './ui';
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
    qc.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' && qc.value.trim()) {
            void quickConnect(qc.value.trim());
            qc.value = '';
            qc.blur();
        }
        if (ev.key === 'Escape') qc.blur();
    });
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

function setupShortcuts() {
    window.addEventListener('keydown', ev => {
        const target = ev.target as HTMLElement;
        const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
        if (ev.key === 'Escape') {
            if (escapeTop()) {
                ev.preventDefault();
            }
            return;
        }
        if (handleTabShortcut(ev)) return;
        if (!ev.ctrlKey || ev.altKey) return;
        const k = ev.key.toLowerCase();
        if (k === ',') {
            ev.preventDefault();
            toggleSettings();
        } else if (k === 'b' && !typing) {
            ev.preventDefault();
            const s = settingsOrDefault();
            s.sidebarVisible = !s.sidebarVisible;
            void App.SaveSettings(s);
        } else if (k === 'j' && !typing) {
            ev.preventDefault();
            const s = settingsOrDefault();
            s.agentVisible = !s.agentVisible;
            void App.SaveSettings(s);
        } else if (k === 'l' && !typing) {
            ev.preventDefault();
            focusAgentInput();
        } else if (ev.shiftKey && k === 't') {
            ev.preventDefault();
            focusQuickConnect();
        }
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
