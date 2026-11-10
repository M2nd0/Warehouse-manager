import en from './en.json';

export type Messages = Record<string, string>;
export type TranslationKey = keyof typeof en;

const messages: Messages = en;

const fill = (template: string, params?: Record<string, string | number>): string =>
  params
    ? template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
    : template;

/** Look up a user-facing string; `{name}` placeholders are filled from `params`. */
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  return fill(messages[key] ?? key, params);
}

/**
 * Look up a string whose key is built from data (`sku.<id>`, `client.<id>`).
 * Falls back to `fallback` when there is no such entry.
 */
export function tData(key: string, fallback: string, params?: Record<string, string | number>): string {
  return fill(messages[key] ?? fallback, params);
}
