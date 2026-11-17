import { ruAgent } from './i18n/ru-agent';
import { ruErrors, ruErrorRules } from './i18n/ru-errors';
import { ruSettings } from './i18n/ru-settings';
import { ruShell } from './i18n/ru-shell';
import { ruTerminal } from './i18n/ru-terminal';

export type Lang = 'en' | 'ru';

type Vars = Record<string, string | number>;

const RU: Record<string, string> = {
    ...ruShell,
    ...ruAgent,
    ...ruTerminal,
    ...ruSettings,
    ...ruErrors,
};

let lang: Lang = 'en';

export function setLang(next: Lang): void {
    lang = next;
    document.documentElement.lang = next;
}

export function getLang(): Lang {
    return lang;
}

export function dateLocale(): string | undefined {
    return lang === 'ru' ? 'ru-RU' : undefined;
}

export function resolveLang(stored: string | undefined): Lang {
    if (stored === 'ru' || stored === 'en') return stored;
    const nav = typeof navigator === 'undefined' ? 'en' : navigator.language.toLowerCase();
    return nav.startsWith('ru') ? 'ru' : 'en';
}

export function applyLanguage(stored: string | undefined): void {
    setLang(resolveLang(stored));
}

export function localizeShell(): void {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('#titlebar [data-tip], #quick-connect'))) {
        if (el.dataset.tip) {
            if (!el.dataset.tipSrc) el.dataset.tipSrc = el.dataset.tip;
            el.dataset.tip = tr(el.dataset.tipSrc);
        }
        if (el.dataset.tipKeys) {
            if (!el.dataset.tipKeysSrc) el.dataset.tipKeysSrc = el.dataset.tipKeys;
            el.dataset.tipKeys = tr(el.dataset.tipKeysSrc);
        }
        const placeholder = el.getAttribute('placeholder');
        if (placeholder) {
            if (!el.dataset.phSrc) el.dataset.phSrc = placeholder;
            el.setAttribute('placeholder', tr(el.dataset.phSrc));
        }
    }
}

function fill(text: string, vars: Vars): string {
    return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

export function tr(source: string, vars?: Vars): string {
    const text = lang === 'ru' ? RU[source] ?? source : source;
    return vars ? fill(text, vars) : text;
}

export const t = tr;

const RU_PLURAL = new Intl.PluralRules('ru');

export function count(n: number, one: string, many: string): string {
    if (lang === 'en') return fill(n === 1 ? one : many, { n });
    const forms = (RU[many] ?? many).split('|');
    const rule = RU_PLURAL.select(n);
    const index = rule === 'one' ? 0 : rule === 'few' ? 1 : 2;
    return fill(forms[index] ?? forms[0] ?? many, { n });
}

export function translateError(message: string): string {
    const key = message.replace(/^Error:\s*/i, '').trim();
    if (lang !== 'ru') return key;
    const exact = RU['error:' + key];
    if (exact) return exact;
    for (const [pattern, replacement] of ruErrorRules) {
        if (pattern.test(key)) return key.replace(pattern, replacement);
    }
    return key;
}
