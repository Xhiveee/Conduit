export function toastError(err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    show(msg.replace(/^Error:\s*/i, ''), true);
}

export function toastInfo(message: string) {
    show(message, false);
}

function show(message: string, danger: boolean) {
    const root = document.getElementById('toasts');
    if (!root) return;
    const el = document.createElement('div');
    el.className = 'toast' + (danger ? ' error' : '');
    el.textContent = message;
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => {
        el.classList.remove('in');
        setTimeout(() => el.remove(), 200);
    }, 5000);
}
