import { createElement } from 'lucide';
import {
    Plus, Search, Download, Settings, Minus, Square, X, Copy, Pencil, Trash2,
    ChevronDown, ChevronRight, KeyRound, Terminal, Plug, Unplug, RotateCcw,
    SendHorizontal, Bot, SquareTerminal, Server, FolderTree, Fingerprint,
    Check, AlertTriangle, LoaderCircle, PanelLeft, PanelRight, Eye, EyeOff,
    CircleDot, ArrowRight, Info, FileKey, CopyPlus, MoreHorizontal,
} from 'lucide';

const MAP: Record<string, any> = {
    plus: Plus, search: Search, download: Download, settings: Settings,
    minus: Minus, square: Square, x: X, copy: Copy, pencil: Pencil,
    trash: Trash2, 'chevron-down': ChevronDown, 'chevron-right': ChevronRight,
    'key-round': KeyRound, terminal: Terminal, plug: Plug, unplug: Unplug,
    'rotate-ccw': RotateCcw, send: SendHorizontal, bot: Bot,
    'square-terminal': SquareTerminal, server: Server, 'folder-tree': FolderTree,
    fingerprint: Fingerprint, check: Check, 'alert-triangle': AlertTriangle,
    loader: LoaderCircle, 'panel-left': PanelLeft, 'panel-right': PanelRight,
    eye: Eye, 'eye-off': EyeOff, 'circle-dot': CircleDot, 'arrow-right': ArrowRight,
    info: Info, 'file-key': FileKey, 'copy-plus': CopyPlus, 'more-horizontal': MoreHorizontal,
};

export function icon(name: string, size = 16): SVGElement {
    const node = MAP[name];
    if (!node) {
        return document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    }
    return createElement(node, { width: size, height: size, 'stroke-width': 1.5 }) as SVGElement;
}
