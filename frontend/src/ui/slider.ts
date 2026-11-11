export function uiSlider(opts: {
    value: number;
    min: number;
    max: number;
    step: number;
    onInput: (value: number) => void;
    format?: (value: number) => string;
    className?: string;
}): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'ui-slider' + (opts.className ? ' ' + opts.className : '');

    const track = document.createElement('div');
    track.className = 'ui-slider-track';
    const fill = document.createElement('div');
    fill.className = 'ui-slider-fill';
    const thumb = document.createElement('div');
    thumb.className = 'ui-slider-thumb';
    thumb.tabIndex = 0;
    thumb.setAttribute('role', 'slider');
    const bubble = document.createElement('div');
    bubble.className = 'ui-slider-bubble';
    track.append(fill, thumb, bubble);
    wrap.appendChild(track);

    let value = opts.value;
    const fmt = opts.format ?? (v => String(Math.round(v * 100) / 100));

    const clampStep = (v: number) => {
        const snapped = opts.min + Math.round((v - opts.min) / opts.step) * opts.step;
        return Math.min(opts.max, Math.max(opts.min, snapped));
    };

    const render = (showBubble: boolean) => {
        const pct = ((value - opts.min) / (opts.max - opts.min)) * 100;
        fill.style.width = pct + '%';
        thumb.style.left = pct + '%';
        thumb.setAttribute('aria-valuenow', String(value));
        thumb.setAttribute('aria-valuemin', String(opts.min));
        thumb.setAttribute('aria-valuemax', String(opts.max));
        bubble.textContent = fmt(value);
        bubble.style.left = pct + '%';
        bubble.style.display = showBubble ? '' : 'none';
    };

    const setFromX = (clientX: number, showBubble: boolean) => {
        const r = track.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
        const v = clampStep(opts.min + ratio * (opts.max - opts.min));
        if (v !== value) {
            value = v;
            opts.onInput(v);
        }
        render(showBubble);
    };

    let dragging = false;
    track.addEventListener('pointerdown', ev => {
        if (ev.button !== 0) return;
        dragging = true;
        track.setPointerCapture(ev.pointerId);
        thumb.focus();
        setFromX(ev.clientX, true);
        ev.preventDefault();
    });
    track.addEventListener('pointermove', ev => {
        if (dragging) setFromX(ev.clientX, true);
    });
    const endDrag = () => {
        if (!dragging) return;
        dragging = false;
        render(false);
    };
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);
    thumb.addEventListener('pointerdown', ev => {
        if (ev.button !== 0) return;
        dragging = true;
        track.setPointerCapture(ev.pointerId);
        setFromX(ev.clientX, true);
        ev.preventDefault();
        ev.stopPropagation();
    });

    thumb.addEventListener('keydown', ev => {
        const big = ev.shiftKey ? opts.step * 10 : opts.step;
        let v: number | null = null;
        if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') v = value - big;
        else if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') v = value + big;
        else if (ev.key === 'PageDown') v = value - opts.step * 10;
        else if (ev.key === 'PageUp') v = value + opts.step * 10;
        else if (ev.key === 'Home') v = opts.min;
        else if (ev.key === 'End') v = opts.max;
        if (v === null) return;
        ev.preventDefault();
        const nv = clampStep(v);
        if (nv !== value) {
            value = nv;
            opts.onInput(nv);
        }
        render(true);
    });
    thumb.addEventListener('blur', () => render(false));
    thumb.addEventListener('focus', () => render(true));

    render(false);
    return wrap;
}
