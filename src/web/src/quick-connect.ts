import { state, connectHost, quickConnect } from './state';
import { icon } from './icons';
import type { main } from '../wailsjs/go/models';

export function enhanceQuickConnect(input: HTMLInputElement) {
    const wrap = document.createElement('div');
    wrap.className = 'qc-wrap';
    input.parentElement?.insertBefore(wrap, input);
    wrap.appendChild(input);
    input.classList.add('qc-input');
    const ic = icon('terminal', 14);
    ic.classList.add('qc-icon');
    wrap.appendChild(ic);

    const drop = document.createElement('div');
    drop.className = 'qc-drop no-drag';
    drop.style.display = 'none';
    wrap.appendChild(drop);

    let items: main.Host[] = [];
    let active = -1;

    const close = () => {
        drop.style.display = 'none';
        items = [];
        active = -1;
    };

    const renderDrop = () => {
        drop.innerHTML = '';
        items.forEach((h, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'qc-item' + (i === active ? ' active' : '');
            const dot = document.createElement('span');
            dot.className = 'qc-dot';
            if (h.color) dot.style.background = h.color;
            const txt = document.createElement('span');
            txt.className = 'qc-text';
            const name = document.createElement('span');
            name.className = 'qc-name';
            name.textContent = h.name || h.user + '@' + h.address;
            const sub = document.createElement('span');
            sub.className = 'qc-sub';
            sub.textContent = h.user + '@' + h.address + (h.port && h.port !== 22 ? ':' + h.port : '');
            txt.append(name, sub);
            b.append(dot, txt);
            b.onmousedown = ev => ev.preventDefault();
            b.onclick = () => pick(h);
            drop.appendChild(b);
        });
        drop.style.display = items.length ? '' : 'none';
    };

    const refresh = () => {
        const q = input.value.trim().toLowerCase();
        if (!q) {
            close();
            return;
        }
        items = state.hosts
            .filter(h => [h.name, h.address, h.user, h.group].some(v => (v || '').toLowerCase().includes(q)))
            .slice(0, 8);
        active = items.length ? 0 : -1;
        renderDrop();
    };

    const pick = (h: main.Host) => {
        close();
        input.value = '';
        input.blur();
        void connectHost(h);
    };

    input.addEventListener('input', refresh);
    input.addEventListener('focus', refresh);
    input.addEventListener('keydown', ev => {
        if (ev.key === 'ArrowDown' && items.length) {
            ev.preventDefault();
            active = (active + 1) % items.length;
            renderDrop();
        } else if (ev.key === 'ArrowUp' && items.length) {
            ev.preventDefault();
            active = (active - 1 + items.length) % items.length;
            renderDrop();
        } else if (ev.key === 'Enter') {
            if (items.length && active >= 0) {
                ev.preventDefault();
                pick(items[active]);
            } else if (input.value.trim()) {
                const target = input.value.trim();
                close();
                input.value = '';
                input.blur();
                void quickConnect(target);
            }
        } else if (ev.key === 'Escape') {
            if (drop.style.display !== 'none') {
                ev.preventDefault();
                ev.stopPropagation();
                close();
            } else {
                input.blur();
            }
        }
    });
    input.addEventListener('blur', () => setTimeout(close, 150));
    document.addEventListener('mousedown', ev => {
        if (!wrap.contains(ev.target as Node)) close();
    });
}
