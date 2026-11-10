import type { ITheme } from '@xterm/xterm';

export interface ThemeDef {
    id: string;
    name: string;
    builtin: boolean;
    ui: Record<string, string>;
    terminal: ITheme;
}

const ANSI_BASE = {
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#e5e5e5',
};

function term(fg: string, bg: string, extra: Partial<ITheme> = {}): ITheme {
    return { foreground: fg, background: bg, ...ANSI_BASE, ...extra } as ITheme;
}

export const BUILTIN_THEMES: ThemeDef[] = [
    {
        id: 'black',
        name: 'Black',
        builtin: true,
        ui: {
            '--bg': '#000000',
            '--surface-1': '#0a0a0a',
            '--surface-2': '#121212',
            '--surface-3': '#1a1a1a',
            '--text': '#e8e8e8',
            '--text-2': '#a3a3a3',
            '--text-3': '#6b6b6b',
            '--accent': '#7fd18b',
            '--accent-ink': '#0c130e',
            '--agent': '#d9a441',
            '--danger': '#e06c60',
        },
        terminal: term('#d4d4d4', '#000000', {
            cursor: '#7fd18b',
            cursorAccent: '#000000',
            selectionBackground: '#7fd18b33',
            black: '#1c1c1c',
            red: '#e06c60',
            green: '#7fd18b',
            yellow: '#d9a441',
            blue: '#6ea8fe',
            magenta: '#c792ea',
            cyan: '#56b6c2',
            white: '#d4d4d4',
            brightBlack: '#666666',
            brightRed: '#f1948a',
            brightGreen: '#a9e5c0',
            brightYellow: '#eec27f',
            brightBlue: '#9ecbff',
            brightMagenta: '#e2b6f0',
            brightCyan: '#8fd3dd',
            brightWhite: '#ffffff',
        }),
    },
    {
        id: 'dark',
        name: 'Dark',
        builtin: true,
        ui: {
            '--bg': '#0d1117',
            '--surface-1': '#161b22',
            '--surface-2': '#21262d',
            '--surface-3': '#2d333b',
            '--text': '#e6edf3',
            '--text-2': '#9da7b3',
            '--text-3': '#6e7681',
            '--accent': '#7fd18b',
            '--accent-ink': '#0c130e',
            '--agent': '#d9a441',
            '--danger': '#f47067',
        },
        terminal: term('#c9d1d9', '#0d1117', {
            cursor: '#7fd18b',
            cursorAccent: '#0d1117',
            selectionBackground: '#7fd18b33',
            black: '#484f58',
            red: '#ff7b72',
            green: '#7fd18b',
            yellow: '#e3b341',
            blue: '#79c0ff',
            magenta: '#d2a8ff',
            cyan: '#56d4dd',
            white: '#b1bac4',
            brightBlack: '#6e7681',
            brightRed: '#ffa198',
            brightGreen: '#a5f3c0',
            brightYellow: '#f0c674',
            brightBlue: '#a5d6ff',
            brightMagenta: '#e2c5ff',
            brightCyan: '#8ee8f0',
            brightWhite: '#f0f6fc',
        }),
    },
    {
        id: 'graphite',
        name: 'Graphite',
        builtin: true,
        ui: {
            '--bg': '#1a1a1e',
            '--surface-1': '#222228',
            '--surface-2': '#2b2b33',
            '--surface-3': '#35353f',
            '--text': '#e4e4e7',
            '--text-2': '#a1a1aa',
            '--text-3': '#71717a',
            '--accent': '#8fd0a0',
            '--accent-ink': '#10150f',
            '--agent': '#d9a441',
            '--danger': '#e0655f',
        },
        terminal: term('#d4d4d8', '#1a1a1e', {
            cursor: '#8fd0a0',
            cursorAccent: '#1a1a1e',
            selectionBackground: '#8fd0a033',
            black: '#3f3f46',
            red: '#e0655f',
            green: '#8fd0a0',
            yellow: '#d9a441',
            blue: '#7aa2f7',
            magenta: '#bb9af7',
            cyan: '#7dcfff',
            white: '#d4d4d8',
            brightBlack: '#52525b',
            brightRed: '#f0958f',
            brightGreen: '#b5e3c2',
            brightYellow: '#eec27f',
            brightBlue: '#9db8f8',
            brightMagenta: '#d3c2f8',
            brightCyan: '#a5dcff',
            brightWhite: '#fafafa',
        }),
    },
    {
        id: 'nord',
        name: 'Nord',
        builtin: true,
        ui: {
            '--bg': '#2e3440',
            '--surface-1': '#3b4252',
            '--surface-2': '#434c5e',
            '--surface-3': '#4c566a',
            '--text': '#eceff4',
            '--text-2': '#d8dee9',
            '--text-3': '#a3b0c5',
            '--accent': '#a3be8c',
            '--accent-ink': '#1c2417',
            '--agent': '#ebcb8b',
            '--danger': '#bf616a',
        },
        terminal: term('#eceff4', '#2e3440', {
            cursor: '#a3be8c',
            cursorAccent: '#2e3440',
            selectionBackground: '#a3be8c44',
            black: '#3b4252',
            red: '#bf616a',
            green: '#a3be8c',
            yellow: '#ebcb8b',
            blue: '#81a1c1',
            magenta: '#b48ead',
            cyan: '#88c0d0',
            white: '#e5e9f0',
            brightBlack: '#4c566a',
            brightRed: '#d08770',
            brightGreen: '#a3be8c',
            brightYellow: '#ebcb8b',
            brightBlue: '#81a1c1',
            brightMagenta: '#b48ead',
            brightCyan: '#8fbcbb',
            brightWhite: '#eceff4',
        }),
    },
    {
        id: 'solarized-dark',
        name: 'Solarized Dark',
        builtin: true,
        ui: {
            '--bg': '#002b36',
            '--surface-1': '#073642',
            '--surface-2': '#0a4250',
            '--surface-3': '#10475a',
            '--text': '#fdf6e3',
            '--text-2': '#c2d5da',
            '--text-3': '#8599a3',
            '--accent': '#a7d28a',
            '--accent-ink': '#122b12',
            '--agent': '#e6c07b',
            '--danger': '#ef7f7a',
        },
        terminal: term('#fdf6e3', '#002b36', {
            cursor: '#a7d28a',
            cursorAccent: '#002b36',
            selectionBackground: '#a7d28a44',
            black: '#073642',
            red: '#dc322f',
            green: '#859900',
            yellow: '#b58900',
            blue: '#268bd2',
            magenta: '#d33682',
            cyan: '#2aa198',
            white: '#eee8d5',
            brightBlack: '#586e75',
            brightRed: '#cb4b16',
            brightGreen: '#859900',
            brightYellow: '#b58900',
            brightBlue: '#268bd2',
            brightMagenta: '#6c71c4',
            brightCyan: '#2aa198',
            brightWhite: '#fdf6e3',
        }),
    },
    {
        id: 'light',
        name: 'Light',
        builtin: true,
        ui: {
            '--bg': '#ffffff',
            '--surface-1': '#f6f6f6',
            '--surface-2': '#ececec',
            '--surface-3': '#e0e0e0',
            '--text': '#1a1a1a',
            '--text-2': '#555555',
            '--text-3': '#8a8a8a',
            '--accent': '#1a7f37',
            '--accent-ink': '#ffffff',
            '--agent': '#9a6700',
            '--danger': '#cf222e',
        },
        terminal: term('#24292f', '#ffffff', {
            cursor: '#1a7f37',
            cursorAccent: '#ffffff',
            selectionBackground: '#1a7f3733',
            black: '#24292f',
            red: '#cf222e',
            green: '#1a7f37',
            yellow: '#9a6700',
            blue: '#0969da',
            magenta: '#8250df',
            cyan: '#1b7c83',
            white: '#6e7781',
            brightBlack: '#8c959f',
            brightRed: '#a40e26',
            brightGreen: '#116329',
            brightYellow: '#7d4e00',
            brightBlue: '#0550ae',
            brightMagenta: '#6639ba',
            brightCyan: '#3192aa',
            brightWhite: '#8c959f',
        }),
    },
];

export function builtinTheme(id: string): ThemeDef | undefined {
    return BUILTIN_THEMES.find(t => t.id === id);
}

export function resolveTheme(settings: { themeId: string; customThemes?: ThemeDef[] }): ThemeDef {
    const custom = settings.customThemes?.find(t => t.id === settings.themeId);
    if (custom) return custom;
    return builtinTheme(settings.themeId) ?? BUILTIN_THEMES[0];
}

export function applyTheme(theme: ThemeDef) {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(theme.ui)) {
        root.style.setProperty(k, v);
    }
}

export function currentXtermTheme(settings: { themeId: string; customThemes?: ThemeDef[] }): ITheme {
    return resolveTheme(settings).terminal;
}
