let tipEl: HTMLElement | null = null;
let timer: number | null = null;
let current: HTMLElement | null = null;

function hide() {
    if (timer !== null) {
        clearTimeout(timer);
        timer = null;
    }
    tipEl?.remove();
    tipEl = null;
    current = null;
}

function show(target: HTMLElement) {
    const text = target.dataset.tip ?? '';
    const keys = target.dataset.tipKeys ?? '';
    if (!text && !keys) return;
    const el = document.createElement('div');
    el.className = 'ui-tooltip';
    el.setAttribute('role', 'tooltip');
    const label = document.createElement('span');
    label.textContent = text;
    el.appendChild(label);
    if (keys) {
        const ks = document.createElement('span');
        ks.className = 'tt-keys';
        for (const part of keys.split('+')) {
            const k = document.createElement('kbd');
            k.textContent = part.trim();
            ks.appendChild(k);
        }
        el.appendChild(ks);
    }
    document.body.appendChild(el);
    const r = target.getBoundingClientRect();
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(4, Math.min(left, window.innerWidth - tw - 4));
    let top = r.top - th - 6;
    if (top < 4) top = r.bottom + 6;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    tipEl = el;
}

function onOver(ev: MouseEvent) {
    const t = (ev.target as HTMLElement).closest?.('[data-tip]') as HTMLElement | null;
    if (!t || t === current) return;
    hide();
    current = t;
    timer = window.setTimeout(() => {
        timer = null;
        if (current === t && t.isConnected) show(t);
    }, 400);
}

function onOut(ev: MouseEvent) {
    const from = (ev.target as HTMLElement).closest?.('[data-tip]');
    const to = (ev.relatedTarget as HTMLElement | null)?.closest?.('[data-tip]');
    if (from === to) return;
    hide();
}

export function initTooltips() {
    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('mousedown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('keydown', ev => {
        if (ev.key === 'Escape') hide();
    });
}
