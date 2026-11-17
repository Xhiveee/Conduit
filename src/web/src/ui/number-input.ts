import { tr } from '../i18n';

export function uiNumber(opts: {
    value: number;
    min?: number;
    max?: number;
    step?: number;
    onChange: (value: number) => void;
    className?: string;
    placeholder?: string;
}): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'ui-num' + (opts.className ? ' ' + opts.className : '');

    const dec = document.createElement('button');
    dec.type = 'button';
    dec.className = 'ui-num-btn';
    dec.textContent = '−';
    dec.setAttribute('aria-label', tr('Decrease'));
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.spellcheck = false;
    input.autocomplete = 'off';
    if (opts.placeholder !== undefined) input.placeholder = opts.placeholder;
    const inc = document.createElement('button');
    inc.type = 'button';
    inc.className = 'ui-num-btn';
    inc.textContent = '+';
    inc.setAttribute('aria-label', tr('Increase'));
    wrap.append(dec, input, inc);

    const step = opts.step ?? 1;
    let value = opts.value;
    input.value = String(value);

    const clamp = (v: number) => {
        if (opts.min !== undefined) v = Math.max(opts.min, v);
        if (opts.max !== undefined) v = Math.min(opts.max, v);
        return v;
    };

    const commit = (raw?: string) => {
        const text = raw ?? input.value;
        const parsed = parseFloat(text);
        if (Number.isNaN(parsed)) {
            input.value = String(value);
            return;
        }
        const v = clamp(parsed);
        const snapped = opts.step ? Math.round(v / step) * step : v;
        const final = clamp(snapped);
        value = final;
        input.value = String(final);
        if (final !== opts.value) opts.onChange(final);
        opts.value = final;
    };

    const stepBy = (dir: 1 | -1) => {
        const base = Number.isNaN(parseFloat(input.value)) ? value : parseFloat(input.value);
        const v = clamp(base + dir * step);
        value = v;
        input.value = String(v);
        opts.value = v;
        opts.onChange(v);
    };

    dec.addEventListener('mousedown', ev => ev.preventDefault());
    inc.addEventListener('mousedown', ev => ev.preventDefault());
    dec.onclick = () => stepBy(-1);
    inc.onclick = () => stepBy(1);

    input.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            commit();
            input.blur();
        } else if (ev.key === 'Escape') {
            input.value = String(value);
            input.blur();
        } else if (ev.key === 'ArrowUp') {
            ev.preventDefault();
            stepBy(1);
        } else if (ev.key === 'ArrowDown') {
            ev.preventDefault();
            stepBy(-1);
        }
    });
    input.addEventListener('wheel', ev => ev.preventDefault(), { passive: false });
    input.addEventListener('blur', () => commit());
    input.addEventListener('focus', () => input.select());

    return wrap;
}
