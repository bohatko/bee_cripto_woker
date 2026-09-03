'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { en } from './dictionaries/en';
import { ru } from './dictionaries/ru';
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  LOCALES,
  type Dictionary,
  type Locale,
  type TranslationVars,
} from './types';
import { formatDate, formatDateTime, formatTime } from '@/lib/datetime';

const dictionaries: Record<Locale, Dictionary> = { en, ru };

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

function readStoredLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && LOCALES.includes(stored as Locale)) {
      return stored as Locale;
    }
  } catch {
    // ignore
  }
  return DEFAULT_LOCALE;
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setLocaleState(readStoredLocale());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.lang = locale;
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // ignore
    }
  }, [locale, hydrated]);

  const setLocale = useCallback((next: Locale) => {
    if (!LOCALES.includes(next)) return;
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
