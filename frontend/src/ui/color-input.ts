import { pushLayer } from './layers';

interface RGBA { r: number; g: number; b: number; a: number }

const RECENTS: string[] = [];
const RECENT_MAX = 8;

export function parseCssColor(input: string): RGBA | null {
    const s = input.trim().toLowerCase();
    let m = s.match(/^#([0-9a-f]{3,8})$/);
    if (m) {
        let h = m[1];
        if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
        if (h.length === 6) h += 'ff';
        if (h.length !== 8) return null;
        return {
            r: parseInt(h.slice(0, 2), 16),
            g: parseInt(h.slice(2, 4), 16),
            b: parseInt(h.slice(4, 6), 16),
            a: parseInt(h.slice(6, 8), 16) / 255,
        };
    }
    m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
    if (m) {
        let a = m[4] === undefined ? 1 : parseFloat(m[4]);
        if (m[4]?.endsWith('%')) a /= 100;
        return { r: +m[1], g: +m[2], b: +m[3], a };
    }
    return null;
}

function toHex(v: number): string {
    return Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
}

function rgbaToHex(c: RGBA, withAlpha: boolean): string {
    const base = '#' + toHex(c.r) + toHex(c.g) + toHex(c.b);
    if (!withAlpha) return base;
    return base + toHex(c.a * 255);
}

function rgbToHsv(c: RGBA): { h: number; s: number; v: number } {
    const r = c.r / 255, g = c.g / 255, b = c.b / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
        if (max === r) h = 60 * (((g - b) / d) % 6);
        else if (max === g) h = 60 * ((b - r) / d + 2);
        else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    const s = max === 0 ? 0 : d / max;
    return { h, s, v: max };
}

function hsvToRgb(h: number, s: number, v: number, a: number): RGBA {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255, a };
}

function hueColor(h: number): string {
    const c = hsvToRgb(h, 1, 1, 1);
    return `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`;
}

export function uiColor(opts: {
    value: string;
    onChange: (value: string) => void;
    allowAlpha?: boolean;
}): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'ui-color';

    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'ui-color-swatch';
    const fill = document.createElement('span');
    fill.className = 'ui-color-fill';
    swatch.appendChild(fill);
    wrap.appendChild(swatch);

    let color = parseCssColor(opts.value) ?? { r: 128, g: 128, b: 128, a: 1 };
    let hsv = rgbToHsv(color);

    const emit = () => {
        const withAlpha = !!opts.allowAlpha || color.a < 1;
        const hex = rgbaToHex(color, withAlpha);
        fill.style.background = withAlpha
            ? `rgba(${Math.round(color.r)},${Math.round(color.g)},${Math.round(color.b)},${color.a})`
            : `rgb(${Math.round(color.r)},${Math.round(color.g)},${Math.round(color.b)})`;
        opts.value = hex;
        opts.onChange(hex);
        if (pop) syncPop();
    };

    const remember = () => {
        const hex = rgbaToHex(color, opts.allowAlpha ? color.a < 1 : false);
        const i = RECENTS.indexOf(hex);
        if (i >= 0) RECENTS.splice(i, 1);
        RECENTS.unshift(hex);
        if (RECENTS.length > RECENT_MAX) RECENTS.pop();
    };

    let pop: HTMLElement | null = null;
    let releaseLayer: (() => void) | null = null;

    const syncPop = () => {
        if (!pop) return;
        svThumb.style.left = (hsv.s * 100) + '%';
        svThumb.style.top = ((1 - hsv.v) * 100) + '%';
        hueThumb.style.left = (hsv.h / 360 * 100) + '%';
        if (alphaTrack && alphaThumb && alphaFill) {
            alphaThumb.style.left = (color.a * 100) + '%';
            alphaFill.style.width = (color.a * 100) + '%';
        }
        const hex = rgbaToHex(color, !!opts.allowAlpha || color.a < 1);
        hexInput.value = hex;
        svArea.style.background =
            `linear-gradient(to top, #000, transparent),` +
            `linear-gradient(to right, #fff, transparent),` +
            hueColor(hsv.h);
    };

    const setFromSv = (clientX: number, clientY: number) => {
        const r = svArea.getBoundingClientRect();
        hsv.s = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
        hsv.v = Math.min(1, Math.max(0, 1 - (clientY - r.top) / r.height));
        color = hsvToRgb(hsv.h, hsv.s, hsv.v, color.a);
        emit();
    };

    const setFromHue = (clientX: number) => {
        const r = hueTrack.getBoundingClientRect();
        hsv.h = (((clientX - r.left) / r.width) * 360) % 360;
        color = hsvToRgb(hsv.h, hsv.s, hsv.v, color.a);
        emit();
    };

    const setFromAlpha = (clientX: number) => {
        if (!alphaTrack) return;
        const r = alphaTrack.getBoundingClientRect();
        color.a = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
        emit();
    };

    const drag = (el: HTMLElement, move: (x: number, y: number) => void) => {
        el.addEventListener('pointerdown', ev => {
            if (ev.button !== 0) return;
            el.setPointerCapture(ev.pointerId);
            move(ev.clientX, ev.clientY);
            const onMove = (e: PointerEvent) => move(e.clientX, e.clientY);
            const onUp = () => {
                el.removeEventListener('pointermove', onMove);
                el.removeEventListener('pointerup', onUp);
                el.removeEventListener('pointercancel', onUp);
                remember();
            };
            el.addEventListener('pointermove', onMove);
            el.addEventListener('pointerup', onUp);
            el.addEventListener('pointercancel', onUp);
            ev.preventDefault();
        });
    };

    const svArea = document.createElement('div');
    svArea.className = 'ui-color-sv';
    const svThumb = document.createElement('div');
    svThumb.className = 'ui-color-thumb';
    svArea.appendChild(svThumb);

    const hueTrack = document.createElement('div');
    hueTrack.className = 'ui-color-hue';
    const hueThumb = document.createElement('div');
    hueThumb.className = 'ui-color-thumb small';
    hueTrack.appendChild(hueThumb);

    let alphaTrack: HTMLElement | null = null;
    let alphaThumb: HTMLElement | null = null;
    let alphaFill: HTMLElement | null = null;
    let hexInput: HTMLInputElement;

    const close = () => {
        pop?.remove();
        pop = null;
        releaseLayer?.();
        releaseLayer = null;
        document.removeEventListener('mousedown', onDocDown, true);
    };

    const onDocDown = (ev: MouseEvent) => {
        const t = ev.target as Node;
        if (pop?.contains(t) || swatch.contains(t)) return;
        close();
    };

    const open = () => {
        if (pop) return;
        pop = document.createElement('div');
        pop.className = 'ui-color-pop no-drag';
        pop.appendChild(svArea);

        const hueRow = document.createElement('div');
        hueRow.className = 'ui-color-strip-row';
        hueRow.appendChild(hueTrack);
        pop.appendChild(hueRow);

        if (opts.allowAlpha) {
            alphaTrack = document.createElement('div');
            alphaTrack.className = 'ui-color-alpha ui-color-checker';
            alphaFill = document.createElement('div');
            alphaFill.className = 'ui-color-alpha-fill';
            alphaTrack.appendChild(alphaFill);
            alphaThumb = document.createElement('div');
            alphaThumb.className = 'ui-color-thumb small';
            alphaTrack.appendChild(alphaThumb);
            drag(alphaTrack, (x) => setFromAlpha(x));
            const aRow = document.createElement('div');
            aRow.className = 'ui-color-strip-row';
            aRow.appendChild(alphaTrack);
            pop.appendChild(aRow);
        }

        const hexRow = document.createElement('div');
        hexRow.className = 'ui-color-hexrow';
        hexInput = document.createElement('input');
        hexInput.className = 'mono';
        hexInput.spellcheck = false;
        hexInput.maxLength = opts.allowAlpha ? 9 : 7;
        hexInput.onchange = () => {
            const c = parseCssColor(hexInput.value);
            if (c) {
                color = c;
                hsv = rgbToHsv(c);
                emit();
            } else {
                hexInput.value = rgbaToHex(color, !!opts.allowAlpha || color.a < 1);
            }
        };
        hexRow.appendChild(hexInput);
        pop.appendChild(hexRow);

        if (RECENTS.length > 0) {
            const recRow = document.createElement('div');
            recRow.className = 'ui-color-recent';
            for (const rh of RECENTS.slice(0, 8)) {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'ui-color-swatch small ui-color-recent-btn';
                const bf = document.createElement('span');
                bf.className = 'ui-color-fill';
                bf.style.background = rh;
                b.appendChild(bf);
                b.onclick = () => {
                    const c = parseCssColor(rh);
                    if (c) {
                        color = c;
                        hsv = rgbToHsv(c);
                        emit();
                    }
                };
                recRow.appendChild(b);
            }
            pop.appendChild(recRow);
        }

        document.body.appendChild(pop);
        const r = swatch.getBoundingClientRect();
        const pw = pop.offsetWidth;
        const ph = pop.offsetHeight;
        let left = r.left;
        if (left + pw > window.innerWidth - 4) left = r.right - pw;
        left = Math.max(4, Math.min(left, window.innerWidth - pw - 4));
        let top = r.bottom + 4;
        if (top + ph > window.innerHeight - 4) top = Math.max(4, r.top - ph - 4);
        pop.style.left = left + 'px';
        pop.style.top = top + 'px';
        syncPop();
        releaseLayer = pushLayer(close);
        document.addEventListener('mousedown', onDocDown, true);
    };

    drag(svArea, (x, y) => setFromSv(x, y));
    drag(hueTrack, (x) => setFromHue(x));

    swatch.onclick = () => (pop ? close() : open());

    emit();
    return wrap;
}
