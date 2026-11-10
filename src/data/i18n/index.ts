import en from './en.json';

export type Messages = Record<string, string>;
export type TranslationKey = keyof typeof en;

const messages: Messages = en;

/** Look up a user-facing string; `{name}` placeholders are filled from `params`. */
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const template = messages[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
