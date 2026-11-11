interface Layer {
    close: () => void;
}

const stack: Layer[] = [];

export function pushLayer(close: () => void): () => void {
    const layer: Layer = { close };
    stack.push(layer);
    return () => {
        const i = stack.indexOf(layer);
        if (i >= 0) stack.splice(i, 1);
    };
}

export function escapeTop(): boolean {
    const top = stack[stack.length - 1];
    if (!top) return false;
    top.close();
    return true;
}
