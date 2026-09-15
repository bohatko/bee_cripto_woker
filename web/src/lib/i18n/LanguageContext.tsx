'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { en } from './dictionaries/en';
import { ru } from './dictionaries/ru';
import {
  DEFAULT_LOCALE,
  I18N_PENDING_CLASS,
  LOCALE_STORAGE_KEY,
  isLocale,
  normalizeLocale,
  writeLocaleCookie,
  type Dictionary,
  type Locale,
  type TranslationVars,
} from './types';
import { formatDate, formatDateTime, formatTime } from '@/lib/datetime';

const dictionaries: Record<Locale, Dictionary> = { en, ru };

// Apply the stored locale before the browser paints on the client, but avoid the
// "useLayoutEffect does nothing on the server" warning during SSR.
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

type LanguageContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (path: string, vars?: TranslationVars) => string;
  dateLocale: string;
  formatDate: (value: string | number | Date | null | undefined) => string;
  formatDateTime: (value: string | number | Date | null | undefined) => string;
  formatTime: (value: string | number | Date | null | undefined) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function getByPath(dict: Dictionary, path: string): string | undefined {
  const parts = path.split('.');
  let current: unknown = dict;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template;
  return Object.entries(vars).reduce(
    (result, [key, value]) =>
      result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value)),
    template
  );
}

function readStoredLocale(): Locale | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function LanguageProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(() =>
    normalizeLocale(initialLocale)
  );

  useIsomorphicLayoutEffect(() => {
    const stored = readStoredLocale();
    setLocaleState((current) =>
      stored && stored !== current ? stored : current
    );
    document.documentElement.classList.remove(I18N_PENDING_CLASS);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    writeLocaleCookie(locale);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // ignore
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    setLocaleState(next);
  }, []);

  const t = useCallback(
    (path: string, vars?: TranslationVars) => {
      const dict = dictionaries[locale];
      const fallback = dictionaries.en;
      const raw = getByPath(dict, path) ?? getByPath(fallback, path) ?? path;
      return interpolate(raw, vars);
    },
    [locale]
  );

  const value = useMemo<LanguageContextValue>(
    () => ({
      locale,
      setLocale,
      t,
      dateLocale: locale === 'ru' ? 'ru-RU' : 'en-US',
      formatDate,
      formatDateTime,
      formatTime,
    }),
    [locale, setLocale, t]
  );

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return ctx;
}

export function useT() {
  return useLanguage().t;
}
