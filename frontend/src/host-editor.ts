import * as App from '../wailsjs/go/main/App';
import type { main } from '../wailsjs/go/models';
import { state, notify, refreshHosts } from './state';
import { icon } from './icons';
import { toastError } from './toast';
import { uiSelect, uiNumber } from './ui';
import { openDialog } from './ui/dialog';

const COLORS = ['', '#86c294', '#7aa6da', '#b798d8', '#d6b26a', '#e07a6e', '#6fbfbf', '#d6a656'];

export function openHostEditor(host: main.Host | null) {
    const modal = document.createElement('div');
    modal.className = 'modal';

    const head = document.createElement('div');
    head.className = 'modal-head';
    const h2 = document.createElement('h2');
    h2.textContent = host ? 'Edit host' : 'New host';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'x';
    closeBtn.type = 'button';
    closeBtn.appendChild(icon('x', 15));
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

    let portVal = host?.port || 22;
    const portI = uiNumber({
        value: portVal,
        min: 1,
        max: 65535,
        step: 1,
        onChange: v => { portVal = v; },
    });
    field('Port', portI);

    const userI = document.createElement('input');
    userI.value = host?.user ?? '';
    userI.placeholder = 'root';
    field('User', userI);

    let authVal = host?.authMethod || 'agent';
    const authSel = uiSelect({
        value: authVal,
        options: [
            { value: 'agent', label: 'SSH agent', description: 'Keys from ~/.ssh and the agent' },
            { value: 'key', label: 'Private key', description: 'A key file on this machine' },
            { value: 'password', label: 'Password', description: 'Password authentication' },
        ],
        onChange: v => {
            authVal = v;
            syncAuth();
        },
    });
    field('Auth method', authSel);

    const keyOptions: { value: string; label: string; description?: string }[] = [
        { value: '', label: 'Select a key…' },
        { value: '__custom__', label: 'Custom path…', description: 'Enter a path manually' },
    ];
    for (const k of state.keys.filter(k => k.source === 'file')) {
        keyOptions.push({
            value: k.path,
            label: k.comment || k.type || k.path.split(/[\\/]/).pop() || k.path,
            description: (k.encrypted ? 'encrypted · ' : '') + (k.fingerprint ? k.fingerprint.slice(0, 20) + '…' : ''),
        });
    }
    if (host?.keyPath && !state.keys.some(k => k.path === host.keyPath)) {
        keyOptions.push({ value: host.keyPath, label: host.keyPath });
    }
    let keyVal = host?.keyPath || '';
    const keySel = uiSelect({
        value: keyVal,
        options: keyOptions,
        onChange: v => {
            keyVal = v;
            syncAuth();
        },
    });
    const keyField = field('Key file', keySel);

    const keyPathI = document.createElement('input');
    keyPathI.value = host?.keyPath ?? '';
    keyPathI.className = 'mono';
    keyPathI.placeholder = 'C:\\Users\\you\\.ssh\\id_ed25519';
    const keyPathField = field('Custom key path', keyPathI);

    const passI = document.createElement('input');
    passI.type = 'password';
    passI.value = host?.keyPassphrase ?? '';
    passI.placeholder = 'Key passphrase (if encrypted)';
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
            s.dataset.tip = c || 'Default';
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
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const save = document.createElement('button');
    save.className = 'btn primary';
    save.type = 'button';
    save.textContent = host ? 'Save' : 'Add host';
    foot.append(cancel, save);
    modal.appendChild(foot);

    const close = openDialog(modal);
    closeBtn.onclick = close;
    cancel.onclick = close;
    nameI.focus();

    const syncAuth = () => {
        keyField.style.display = authVal === 'key' ? '' : 'none';
        keyPathField.style.display = authVal === 'key' && keyVal === '__custom__' ? '' : 'none';
        passField.style.display = authVal === 'key' ? '' : 'none';
        pwField.style.display = authVal === 'password' ? '' : 'none';
    };
    keyPathI.addEventListener('input', () => {
        keyVal = '__custom__';
        syncAuth();
    });
    syncAuth();

    async function doSave() {
        const h: main.Host = host ? { ...host } : ({ port: 22, authMethod: 'agent' } as main.Host);
        h.name = nameI.value.trim();
        h.group = groupI.value.trim();
        h.address = addrI.value.trim();
        h.port = portVal || 22;
        h.user = userI.value.trim();
        h.authMethod = authVal;
        h.color = chosenColor;
        h.notes = notesI.value;
        if (h.authMethod === 'key') {
            h.keyPath = keyVal === '__custom__' ? keyPathI.value.trim() : keyVal;
            h.keyPassphrase = passI.value;
        }
        if (h.authMethod === 'password') {
            h.password = pwI.value;
        }
        if (!h.address || !h.user) {
            toastError(new Error('Address and user are required'));
            return;
        }
        try {
            await App.SaveHost(h);
        } catch (err) {
            toastError(err);
            return;
        }
        close();
        try {
            await refreshHosts();
        } catch (err) {
            toastError(err);
        }
        notify();
    }
    save.onclick = () => { void doSave(); };
}
