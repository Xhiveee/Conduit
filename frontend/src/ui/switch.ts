export function uiSwitch(on: boolean, onChange: (value: boolean) => void): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ui-switch' + (on ? ' on' : '');
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', String(on));
    const thumb = document.createElement('span');
    thumb.className = 'ui-switch-thumb';
    b.appendChild(thumb);
    b.onclick = () => {
        const v = !b.classList.contains('on');
        b.classList.toggle('on', v);
        b.setAttribute('aria-checked', String(v));
        onChange(v);
    };
    return b;
}
