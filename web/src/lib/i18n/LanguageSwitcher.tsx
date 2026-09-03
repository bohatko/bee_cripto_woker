'use client';

import React from 'react';
import { Languages } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { Locale } from '@/lib/i18n/types';

interface LanguageSwitcherProps {
  variant?: 'sidebar' | 'compact';
  className?: string;
}

export function LanguageSwitcher({
  variant = 'sidebar',
  className = '',
}: LanguageSwitcherProps) {
  const { locale, setLocale, t } = useLanguage();

  const options: { code: Locale; label: string }[] = [
    { code: 'en', label: 'EN' },
    { code: 'ru', label: 'RU' },
  ];

  if (variant === 'compact') {
    return (
      <div
        className={`inline-flex items-center gap-1 rounded-lg border border-dark-700 bg-dark-900 p-0.5 ${className}`}
        role="group"
        aria-label={t('common.language')}
      >
        {options.map((opt) => (
          <button
            key={opt.code}
            type="button"
            onClick={() => setLocale(opt.code)}
            className={`px-2 py-1 text-[11px] font-bold font-mono rounded-md transition-colors ${
              locale === opt.code
                ? 'bg-honey-500 text-dark-950'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={`px-3 py-2 ${className}`}>
      <div className="flex items-center gap-2 mb-2 px-1">
        <Languages className="w-3.5 h-3.5 text-slate-500" />
        <span className="text-[10px] uppercase tracking-wider font-mono text-slate-500 font-bold">
          {t('common.language')}
        </span>
      </div>
      <div
        className="grid grid-cols-2 gap-1.5 rounded-xl border border-dark-800 bg-dark-950 p-1"
        role="group"
        aria-label={t('common.language')}
      >
        {options.map((opt) => (
          <button
            key={opt.code}
            type="button"
            onClick={() => setLocale(opt.code)}
            className={`py-1.5 rounded-lg text-xs font-bold font-mono transition-all ${
              locale === opt.code
                ? 'bg-honey-500 text-dark-950 shadow-sm shadow-honey-500/20'
                : 'text-slate-400 hover:text-white hover:bg-dark-850'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
