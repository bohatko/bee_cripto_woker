export type Locale = 'en' | 'ru';

export const LOCALES: Locale[] = ['en', 'ru'];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'bee-crypto-locale';

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
