'use client';

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { CreditCard, Info, KeyRound, UserCog, X } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export type GuideModule = 'signals' | 'grid' | 'pair';

const STEP_COUNT: Record<GuideModule, number> = {
  signals: 6,
  grid: 6,
  pair: 6,
};

export function ModuleSetupGuide({ module }: { module: GuideModule }) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const steps = Array.from({ length: STEP_COUNT[module] }, (_, index) => index + 1);

  useEffect(() => {
    setOpen(false);
  }, [pathname, module]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full border border-honey-300/50 bg-honey-500 px-4 py-3 text-sm font-bold text-dark-950 shadow-xl shadow-black/50 transition-colors hover:bg-honey-400 ${
          open ? 'pointer-events-none opacity-0' : ''
        }`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Info className="h-4 w-4" aria-hidden />
        {t('guide.open')}
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-end sm:items-stretch">
          <button
            type="button"
            className="absolute inset-0 bg-black/70"
            aria-label={t('guide.close')}
            onClick={() => setOpen(false)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="module-guide-title"
            className="relative flex max-h-[88dvh] w-full flex-col rounded-t-2xl border border-dark-700 bg-dark-950 shadow-2xl sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none sm:border-y-0 sm:border-r-0"
          >
            <header className="flex items-start justify-between gap-3 border-b border-dark-800 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-honey-400">
                  {t('guide.open')}
                </p>
                <h2 id="module-guide-title" className="mt-1 text-lg font-extrabold text-white">
                  {t(`guide.${module}.title`)}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-dark-800 hover:text-white"
                aria-label={t('guide.close')}
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <p className="text-sm leading-relaxed text-slate-300">{t(`guide.${module}.intro`)}</p>
              <ol className="space-y-4">
                {steps.map((step) => (
                  <li key={step} className="flex gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-honey-500/15 font-mono text-xs font-bold text-honey-300">
                      {step}
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-white">
                        {t(`guide.${module}.step${step}Title`)}
                      </h3>
                      <p className="mt-1 text-sm leading-relaxed text-slate-400">
                        {t(`guide.${module}.step${step}Body`)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <footer className="border-t border-dark-800 px-5 py-4">
              <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">
                {t('guide.linksTitle')}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => router.push('/settings/exchange')}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-honey-500/40 px-3 py-1.5 text-xs font-bold text-honey-300 hover:bg-honey-500/10"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  {t('nav.exchangeKeys')}
                </button>
                {(module === 'grid' || module === 'pair') && (
                  <button
                    type="button"
                    onClick={() => router.push('/billing')}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-dark-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-dark-600 hover:text-white"
                  >
                    <CreditCard className="h-3.5 w-3.5" />
                    {t('nav.billing')}
                  </button>
                )}
                {module === 'signals' && (
                  <button
                    type="button"
                    onClick={() => router.push('/settings/profile')}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-dark-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-dark-600 hover:text-white"
                  >
                    <UserCog className="h-3.5 w-3.5" />
                    {t('nav.profile')}
                  </button>
                )}
              </div>
            </footer>
          </aside>
        </div>
      )}
    </>
  );
}
