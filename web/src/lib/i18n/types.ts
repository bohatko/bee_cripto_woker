export type Locale = 'en' | 'ru';

export const LOCALES: Locale[] = ['en', 'ru'];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'bee-crypto-locale';
export const LOCALE_COOKIE_NAME = 'bee-crypto-locale';
export const I18N_PENDING_CLASS = 'i18n-pending';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as string[]).includes(value);
}

export function normalizeLocale(value: string | null | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** Persist the locale in a cookie so the server can render the correct language on the next request. */
export function writeLocaleCookie(locale: Locale): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${LOCALE_COOKIE_NAME}=${locale};path=/;max-age=31536000;samesite=lax`;
}

export type TranslationVars = Record<string, string | number>;

/** Recursively map leaf string literals to string so RU/EN dictionaries share one shape. */
type DeepStringify<T> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends Record<string, unknown>
      ? DeepStringify<T[K]>
      : T[K];
};

export type Dictionary = DeepStringify<typeof import('./dictionaries/en').en>;
