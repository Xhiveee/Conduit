import { icon } from '../icons';
import { pushLayer } from './layers';
import { toastError } from '../toast';

export type MenuEntry =
    | { sep: true }
    | {
        icon?: string;
        label: string;
        shortcut?: string;
        danger?: boolean;
        disabled?: boolean;
        onSelect?: () => void;
    };

export function showMenuAt(items: MenuEntry[], x: number, y: number, minWidth = '9rem'): void {
    const pop = document.createElement('div');
    pop.className = 'ui-menu no-drag';
    pop.setAttribute('role', 'menu');

    const buttons: HTMLButtonElement[] = [];
    for (const item of items) {
        if ('sep' in item) {
            const sep = document.createElement('div');
            sep.className = 'ui-menu-sep';
            pop.appendChild(sep);
            continue;
        }
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ui-menu-item' + (item.danger ? ' danger' : '');
        b.setAttribute('role', 'menuitem');
        if (item.disabled) {
            b.classList.add('disabled');
            b.disabled = true;
        }
        if (item.icon) b.appendChild(icon(item.icon, 14));
        const lab = document.createElement('span');
        lab.className = 'mi-label';
        lab.textContent = item.label;
        b.appendChild(lab);
        if (item.shortcut) {
            const keys = document.createElement('span');
            keys.className = 'mi-keys';
            for (const part of item.shortcut.split('+')) {
                const k = document.createElement('kbd');
                k.textContent = part.trim();
                keys.appendChild(k);
            }
            b.appendChild(keys);
        }
        b.onclick = () => {
            close();
            item.onSelect?.();
        };
        buttons.push(b);
        pop.appendChild(b);
    }

    let active = -1;
    let releaseLayer: () => void = () => {};
    const setActive = (i: number) => {
        const enabled = buttons.map((b, j) => ({ b, j })).filter(x => !x.b.disabled);
        if (enabled.length === 0) return;
        const pos = enabled.findIndex(x => x.j === i);
        const next = enabled[(pos + enabled.length + 1) % enabled.length];
        active = next.j;
        buttons.forEach((b, j) => b.classList.toggle('active', j === active));
        buttons[active].scrollIntoView({ block: 'nearest' });
    };

    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        pop.classList.add('closing');
        window.setTimeout(() => {
            pop.remove();
            releaseLayer();
            document.removeEventListener('mousedown', onDocDown, true);
            document.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', close);
            window.removeEventListener('keydown', onKey, true);
        }, 110);
    };

    const onDocDown = (ev: MouseEvent) => {
        if (pop.contains(ev.target as Node)) return;
        close();
    };
    const onScroll = (ev: Event) => {
        if (pop.contains(ev.target as Node)) return;
        close();
    };

    let typeBuf = '';
    let typeTimer: number | null = null;
    const onKey = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') {
            ev.stopPropagation();
            close();
            return;
        }
        if (ev.key === 'ArrowDown') {
            ev.preventDefault();
            ev.stopPropagation();
            setActive(active + 1);
            return;
        }
        if (ev.key === 'ArrowUp') {
            ev.preventDefault();
            ev.stopPropagation();
            setActive(active <= 0 ? buttons.length - 1 : active - 1);
            return;
        }
        if (ev.key === 'Home') {
            ev.preventDefault();
            ev.stopPropagation();
            setActive(0);
            return;
        }
        if (ev.key === 'End') {
            ev.preventDefault();
            ev.stopPropagation();
            setActive(buttons.length - 1);
            return;
        }
        if (ev.key === 'Enter' || ev.key === ' ') {
            if (active >= 0 && !buttons[active].disabled) {
                ev.preventDefault();
                ev.stopPropagation();
                buttons[active].click();
            }
            return;
        }
        if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
            typeBuf += ev.key.toLowerCase();
            if (typeTimer) clearTimeout(typeTimer);
            typeTimer = window.setTimeout(() => { typeBuf = ''; }, 600);
            const i = items.findIndex(it => !('sep' in it) && it.label.toLowerCase().startsWith(typeBuf));
            if (i >= 0) setActive(i);
        }
    };

    document.body.appendChild(pop);
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    pop.style.left = Math.max(4, Math.min(x, window.innerWidth - pw - 4)) + 'px';
    pop.style.top = Math.max(4, Math.min(y, window.innerHeight - ph - 4)) + 'px';
    pop.style.minWidth = minWidth;

    releaseLayer = pushLayer(close);
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey, true);
    setActive(0);
}

export function contextMenuAt(items: MenuEntry[], ev: MouseEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    showMenuAt(items, ev.clientX, ev.clientY);
}

function editMenuFor(target: HTMLElement, x: number, y: number) {
    const el = target as HTMLInputElement | HTMLTextAreaElement;
    const isArea = el.tagName === 'TEXTAREA' || el.isContentEditable;
    const sel = isArea
        ? String(window.getSelection() ?? '')
        : (el as HTMLInputElement).value.substring((el as HTMLInputElement).selectionStart ?? 0, (el as HTMLInputElement).selectionEnd ?? 0);
    const hasSel = sel.length > 0;
    showMenuAt([
        { label: 'Cut', shortcut: 'Ctrl+X', disabled: !hasSel, onSelect: () => { document.execCommand('cut'); } },
        { label: 'Copy', shortcut: 'Ctrl+C', disabled: !hasSel, onSelect: () => { document.execCommand('copy'); } },
        {
            label: 'Paste', shortcut: 'Ctrl+V', onSelect: () => {
                navigator.clipboard.readText().then(t => {
                    if (t) document.execCommand('insertText', false, t);
                }).catch(toastError);
            },
        },
        { sep: true },
        { label: 'Select all', shortcut: 'Ctrl+A', onSelect: () => { document.execCommand('selectAll'); } },
    ], x, y, '11rem');
}

export function installContextMenuGuard(): void {
    document.addEventListener('contextmenu', ev => {
        if (ev.defaultPrevented) return;
        ev.preventDefault();
        const t = ev.target as HTMLElement;
        if (t.closest('input, textarea, [contenteditable="true"], [contenteditable=""]')) {
            editMenuFor(t, ev.clientX, ev.clientY);
        }
    });
}
