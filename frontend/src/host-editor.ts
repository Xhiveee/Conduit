import * as App from '../wailsjs/go/main/App';
import type { main } from '../wailsjs/go/models';
import { state, notify, refreshHosts } from './state';
import { icon } from './icons';
import { toastError } from './toast';

const COLORS = ['', '#7fd18b', '#6ea8fe', '#c792ea', '#f0a35e', '#e06c60', '#56b6c2', '#d9a441'];

export function openHostEditor(host: main.Host | null) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';

    const head = document.createElement('div');
    head.className = 'modal-head';
    const h2 = document.createElement('h2');
    h2.textContent = host ? 'Edit host' : 'New host';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'x';
    closeBtn.appendChild(icon('x', 15));
    closeBtn.onclick = () => overlay.remove();
    head.append(h2, closeBtn);
    modal.appendChild(head);

    const body = document.createElement('div');
    body.className = 'modal-body';
    const grid = document.createElement('div');
    grid.className = 'form-grid';

    const field = (label: string, input: HTMLElement, full = false) => {
        const f = document.createElement('div');
        f.className = 'field' + (full ? ' full' : '');
        const l = document.createElement('label');
        l.textContent = label;
        f.append(l, input);
        grid.appendChild(f);
        return f;
    };

    const nameI = document.createElement('input');
    nameI.value = host?.name ?? '';
    nameI.placeholder = 'Production server';
    field('Name', nameI);

    const groupI = document.createElement('input');
    groupI.value = host?.group ?? '';
    groupI.placeholder = 'work';
    field('Group', groupI);

    const addrI = document.createElement('input');
    addrI.value = host?.address ?? '';
    addrI.placeholder = '192.168.1.10 or example.com';
    addrI.className = 'mono';
    field('Address', addrI);

    const portI = document.createElement('input');
    portI.type = 'number';
    portI.value = String(host?.port || 22);
    portI.min = '1';
    portI.max = '65535';
    field('Port', portI);

    const userI = document.createElement('input');
    userI.value = host?.user ?? '';
    userI.placeholder = 'root';
    field('User', userI);

    const authSel = document.createElement('select');
    for (const [v, l] of [['agent', 'SSH agent'], ['key', 'Private key'], ['password', 'Password']] as const) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = l;
        authSel.appendChild(o);
    }
    authSel.value = host?.authMethod || 'agent';
    field('Auth method', authSel);

    const keySel = document.createElement('select');
    const customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = 'Custom path…';
    keySel.appendChild(customOpt);
    for (const k of state.keys.filter(k => k.source === 'file')) {
        const o = document.createElement('option');
        o.value = k.path;
        o.textContent = (k.comment || k.type || k.path) + (k.encrypted ? ' (encrypted)' : '');
        keySel.appendChild(o);
    }
    if (host?.keyPath && !state.keys.some(k => k.path === host.keyPath)) {
        const o = document.createElement('option');
        o.value = host.keyPath;
        o.textContent = host.keyPath;
        keySel.appendChild(o);
    }
    keySel.value = host?.keyPath || '';
    const keyField = field('Key file', keySel);

    const keyPathI = document.createElement('input');
    keyPathI.value = host?.keyPath ?? '';
    keyPathI.className = 'mono';
    keyPathI.placeholder = 'C:\\Users\\you\\.ssh\\id_ed25519';
    const keyPathField = field('Custom key path', keyPathI);

    const passI = document.createElement('input');
    passI.type = 'password';
    passI.value = host?.keyPassphrase ?? '';
    passI.placeholder = host?.authMethod === 'key' ? 'Key passphrase (if encrypted)' : '';
    const passField = field('Key passphrase', passI);

    const pwI = document.createElement('input');
    pwI.type = 'password';
    pwI.value = host?.password ?? '';
    pwI.placeholder = 'Password';
    const pwField = field('Password', pwI);

    const colorWrap = document.createElement('div');
    colorWrap.className = 'swatches';
    let chosenColor = host?.color ?? '';
    const renderSwatches = () => {
        colorWrap.innerHTML = '';
        for (const c of COLORS) {
            const s = document.createElement('button');
            s.className = 'swatch' + (chosenColor === c ? ' on' : '') + (c === '' ? ' none' : '');
            if (c) s.style.background = c;
            s.title = c || 'Default';
            s.onclick = () => { chosenColor = c; renderSwatches(); };
            colorWrap.appendChild(s);
        }
    };
    renderSwatches();
    const colorField = document.createElement('div');
    colorField.className = 'field';
    const cl = document.createElement('label');
    cl.textContent = 'Color';
    colorField.append(cl, colorWrap);
    grid.appendChild(colorField);

    const notesI = document.createElement('textarea');
    notesI.value = host?.notes ?? '';
    notesI.placeholder = 'Notes';
    field('Notes', notesI, true);

    body.appendChild(grid);
    modal.appendChild(body);

    const foot = document.createElement('div');
    foot.className = 'modal-foot';
    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = 'Cancel';
    cancel.onclick = () => overlay.remove();
    const save = document.createElement('button');
    save.className = 'btn primary';
    save.textContent = host ? 'Save' : 'Add host';
    save.onclick = () => { void doSave(); };
    foot.append(cancel, save);
    modal.appendChild(foot);
    overlay.appendChild(modal);
    document.getElementById('modal-root')!.appendChild(overlay);
    overlay.addEventListener('mousedown', ev => { if (ev.target === overlay) overlay.remove(); });
    nameI.focus();

    const syncAuth = () => {
        const m = authSel.value;
        keyField.style.display = m === 'key' ? '' : 'none';
        keyPathField.style.display = m === 'key' && keySel.value === '__custom__' ? '' : 'none';
        passField.style.display = m === 'key' ? '' : 'none';
        pwField.style.display = m === 'password' ? '' : 'none';
    };
    authSel.onchange = syncAuth;
    keySel.onchange = syncAuth;
    syncAuth();

    async function doSave() {
        const h: main.Host = host ? { ...host } : ({ port: 22, authMethod: 'agent' } as main.Host);
        h.name = nameI.value.trim();
        h.group = groupI.value.trim();
        h.address = addrI.value.trim();
        h.port = parseInt(portI.value, 10) || 22;
        h.user = userI.value.trim();
        h.authMethod = authSel.value;
        h.color = chosenColor;
        h.notes = notesI.value;
        if (h.authMethod === 'key') {
            h.keyPath = keySel.value === '__custom__' ? keyPathI.value.trim() : keySel.value;
            h.keyPassphrase = passI.value;
        }
        if (h.authMethod === 'password') {
            h.password = pwI.value;
        }
        if (!h.address || !h.user) {
            alert('Address and user are required');
            return;
        }
        try {
            await App.SaveHost(h);
        } catch (err) {
            toastError(err);
            return;
        }
        overlay.remove();
        try {
            await refreshHosts();
        } catch (err) {
            toastError(err);
        }
        notify();
    }
}
