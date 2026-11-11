import { icon } from '../icons';
import { pushLayer } from './layers';

export interface SelectOption {
    value: string;
    label: string;
    description?: string;
}

export function uiSelect(opts: {
    value: string;
    options: SelectOption[];
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
}): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ui-select' + (opts.className ? ' ' + opts.className : '');
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');

    const label = document.createElement('span');
    label.className = 'sel-label';
    const chev = icon('chevron-down', 14);
    chev.classList.add('sel-chev');
    btn.append(label, chev);

    let pop: HTMLElement | null = null;
    let releaseLayer: (() => void) | null = null;
    let typeBuf = '';
    let typeTimer: number | null = null;

    const currentLabel = () => opts.options.find(o => o.value === opts.value)?.label ?? opts.placeholder ?? '';
    label.textContent = currentLabel();

    const setActive = (i: number) => {
        pop?.querySelectorAll('.ui-select-opt').forEach((el, j) => el.classList.toggle('active', j === i));
        const el = pop?.querySelectorAll('.ui-select-opt')[i] as HTMLElement | undefined;
        el?.scrollIntoView({ block: 'nearest' });
    };

    const close = () => {
        pop?.remove();
        pop = null;
        releaseLayer?.();
        releaseLayer = null;
        btn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('mousedown', onDocDown, true);
        document.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', close);
    };

    const onDocDown = (ev: MouseEvent) => {
        const t = ev.target as Node;
        if (pop?.contains(t) || btn.contains(t)) return;
        close();
    };
    const onScroll = (ev: Event) => {
        if (pop?.contains(ev.target as Node)) return;
        close();
    };

    const choose = (i: number) => {
        const o = opts.options[i];
        if (!o) return;
        opts.value = o.value;
        label.textContent = o.label;
        opts.onChange(o.value);
        close();
        btn.focus();
    };

    const open = () => {
        if (pop) return;
        pop = document.createElement('div');
        pop.className = 'ui-select-pop no-drag';
        pop.setAttribute('role', 'listbox');
        opts.options.forEach((o, i) => {
            const item = document.createElement('div');
            item.className = 'ui-select-opt' + (o.value === opts.value ? ' sel' : '');
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', String(o.value === opts.value));
            const check = document.createElement('span');
            check.className = 'opt-check';
            if (o.value === opts.value) check.appendChild(icon('check', 12));
            const main = document.createElement('span');
            main.className = 'opt-main';
            const lab = document.createElement('span');
            lab.className = 'opt-label';
            lab.textContent = o.label;
            main.appendChild(lab);
            if (o.description) {
                const d = document.createElement('span');
                d.className = 'opt-desc';
                d.textContent = o.description;
                main.appendChild(d);
            }
            item.append(check, main);
            item.onmouseenter = () => setActive(i);
            item.onmousedown = ev => ev.preventDefault();
            item.onclick = () => choose(i);
            pop!.appendChild(item);
        });
        document.body.appendChild(pop);
        const r = btn.getBoundingClientRect();
        pop.style.left = r.left + 'px';
        pop.style.minWidth = r.width + 'px';
        const ph = pop.offsetHeight;
        pop.style.top = (r.bottom + 4 + ph > window.innerHeight ? r.top - ph - 4 : r.bottom + 4) + 'px';
        const selIdx = opts.options.findIndex(o => o.value === opts.value);
        setActive(selIdx >= 0 ? selIdx : 0);
        btn.setAttribute('aria-expanded', 'true');
        releaseLayer = pushLayer(close);
        document.addEventListener('mousedown', onDocDown, true);
        document.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', close);
    };

    btn.onclick = () => (pop ? close() : open());
    btn.onkeydown = ev => {
        if (ev.key === 'ArrowDown' || ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            open();
        } else if (ev.key === 'ArrowUp') {
            ev.preventDefault();
            open();
        } else if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey) {
            typeBuf += ev.key.toLowerCase();
            if (typeTimer) clearTimeout(typeTimer);
            typeTimer = window.setTimeout(() => { typeBuf = ''; }, 600);
            const i = opts.options.findIndex(o => o.label.toLowerCase().startsWith(typeBuf));
            if (i >= 0) {
                opts.value = opts.options[i].value;
                label.textContent = opts.options[i].label;
                opts.onChange(opts.options[i].value);
            }
        }
    };

    return btn;
}
