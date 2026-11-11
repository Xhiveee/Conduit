import { icon } from '../icons';
import { pushLayer } from './layers';

interface DialogEntry {
    overlay: HTMLElement;
    prevFocus: Element | null;
    close: () => void;
}

const stack: DialogEntry[] = [];

export function openDialog(modal: HTMLElement, opts?: { overlayClose?: boolean }): () => void {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay no-drag';
    overlay.appendChild(modal);
    document.getElementById('modal-root')!.appendChild(overlay);

    const entry: DialogEntry = { overlay, prevFocus: document.activeElement, close: () => {} };
    stack.push(entry);

    const close = () => {
        const i = stack.indexOf(entry);
        if (i < 0) return;
        stack.splice(i, 1);
        releaseLayer();
        overlay.classList.add('closing');
        window.setTimeout(() => overlay.remove(), 140);
        const pf = entry.prevFocus as HTMLElement | null;
        window.setTimeout(() => pf?.focus?.(), 140);
    };
    entry.close = close;
    const releaseLayer = pushLayer(() => close());

    if (opts?.overlayClose !== false) {
        overlay.addEventListener('mousedown', ev => {
            if (ev.target === overlay) close();
        });
    }

    overlay.addEventListener('keydown', ev => {
        if (ev.key !== 'Tab') return;
        const focusables = Array.from(
            modal.querySelectorAll<HTMLElement>('button, input, textarea, select, [tabindex]:not([tabindex="-1"])')
        ).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (ev.shiftKey && (active === first || !modal.contains(active))) {
            ev.preventDefault();
            last.focus();
        } else if (!ev.shiftKey && (active === last || !modal.contains(active))) {
            ev.preventDefault();
            first.focus();
        }
    });

    const first = modal.querySelector<HTMLElement>('input, textarea, button:not(.x)');
    first?.focus();

    return close;
}

export function closeTopDialog(): boolean {
    const top = stack[stack.length - 1];
    if (!top) return false;
    top.close();
    return true;
}

function dialogShell(title: string): { modal: HTMLElement; body: HTMLElement; foot: HTMLElement } {
    const modal = document.createElement('div');
    modal.className = 'modal';

    const head = document.createElement('div');
    head.className = 'modal-head';
    const h2 = document.createElement('h2');
    h2.textContent = title;
    const x = document.createElement('button');
    x.className = 'x';
    x.type = 'button';
    x.appendChild(icon('x', 15));
    head.append(h2, x);

    const body = document.createElement('div');
    body.className = 'modal-body';

    const foot = document.createElement('div');
    foot.className = 'modal-foot';

    modal.append(head, body, foot);
    return { modal, body, foot };
}

export function confirmDialog(opts: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
}): Promise<boolean> {
    return new Promise(resolve => {
        const shell = dialogShell(opts.title);
        const msg = document.createElement('div');
        msg.className = 'confirm-box';
        msg.textContent = opts.message;
        shell.body.appendChild(msg);

        let done = false;
        const finish = (v: boolean) => {
            if (done) return;
            done = true;
            close();
            resolve(v);
        };
        const close = openDialog(shell.modal);
        shell.modal.querySelector('.x')!.addEventListener('click', () => finish(false));

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn';
        cancel.textContent = opts.cancelLabel ?? 'Cancel';
        cancel.onclick = () => finish(false);
        const ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'btn ' + (opts.danger ? 'danger' : 'primary');
        ok.textContent = opts.confirmLabel ?? 'Confirm';
        ok.onclick = () => finish(true);
        shell.foot.append(cancel, ok);
        ok.focus();
    });
}

export function promptDialog(opts: {
    title: string;
    label?: string;
    password?: boolean;
    checkboxLabel?: string;
    defaultValue?: string;
    confirmLabel?: string;
}): Promise<{ value: string; checked: boolean } | null> {
    return new Promise(resolve => {
        const shell = dialogShell(opts.title);

        const f = document.createElement('div');
        f.className = 'field full';
        if (opts.label) {
            const l = document.createElement('label');
            l.textContent = opts.label;
            f.appendChild(l);
        }
        const input = document.createElement('input');
        input.type = opts.password ? 'password' : 'text';
        input.value = opts.defaultValue ?? '';
        input.spellcheck = false;
        input.autocomplete = 'off';
        f.appendChild(input);
        shell.body.appendChild(f);
        let check: HTMLInputElement | null = null;
        if (opts.checkboxLabel) {
            const row = document.createElement('label');
            row.className = 'dialog-check';
            check = document.createElement('input');
            check.type = 'checkbox';
            const span = document.createElement('span');
            span.textContent = opts.checkboxLabel;
            row.append(check, span);
            shell.body.appendChild(row);
        }

        let done = false;
        const finish = (v: { value: string; checked: boolean } | null) => {
            if (done) return;
            done = true;
            close();
            resolve(v);
        };
        const close = openDialog(shell.modal);
        shell.modal.querySelector('.x')!.addEventListener('click', () => finish(null));

        input?.addEventListener('keydown', ev => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                finish({ value: input!.value, checked: !!check?.checked });
            }
        });

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn';
        cancel.textContent = 'Cancel';
        cancel.onclick = () => finish(null);
        const ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'btn primary';
        ok.textContent = opts.confirmLabel ?? 'OK';
        ok.onclick = () => finish({ value: input?.value ?? '', checked: !!check?.checked });
        shell.foot.append(cancel, ok);
        input?.focus();
        input?.select();
    });
}
