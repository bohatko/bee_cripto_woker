'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ChevronRight,
  Layers,
  Lock,
  MousePointerClick,
  Move,
  Radio,
  Server,
  ShieldCheck,
  TrendingDown,
  UsersRound,
  Zap,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { LanguageSwitcher } from '@/lib/i18n/LanguageSwitcher';
import { BeeHeroScene } from '@/components/landing/BeeHeroScene';

type PairMarketRow = {
  pair_symbol: string;
  is_in_trend: boolean | null;
  current_ratio: number | string | null;
  ema_10: number | string | null;
};

const FEATURES = [
  'landing.planFeature1',
  'landing.planFeature2',
  'landing.planFeature3',
  'landing.planFeature4',
  'landing.planFeature5',
  'landing.planFeature6',
];

const STEPS = [
  { title: 'landing.step1Title', desc: 'landing.step1Desc', icon: Boxes },
  { title: 'landing.step2Title', desc: 'landing.step2Desc', icon: Zap },
  { title: 'landing.step3Title', desc: 'landing.step3Desc', icon: Server },
  { title: 'landing.step4Title', desc: 'landing.step4Desc', icon: Radio },
];

const FAQ_ITEMS = [
  { q: 'landing.faqQ1', a: 'landing.faqA1' },
  { q: 'landing.faqQ2', a: 'landing.faqA2' },
  { q: 'landing.faqQ3', a: 'landing.faqA3' },
  { q: 'landing.faqQ4', a: 'landing.faqA4' },
  { q: 'landing.faqQ5', a: 'landing.faqA5' },
  { q: 'landing.faqQ6', a: 'landing.faqA6' },
];

function SectionHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mx-auto mb-14 max-w-2xl text-center">
      <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">{title}</h2>
      <p className="mt-3 text-base text-slate-400">{subtitle}</p>
    </div>
  );
}

function ProfitPanel({
  whatIs,
  prefix,
  tone,
  note,
  caveat,
}: {
  whatIs: string;
  prefix: 'pair' | 'signal';
  tone: 'outcome' | 'payoff';
  note: string;
  caveat: string;
}) {
  const { t } = useLanguage();

  return (
    <div className="mt-7 rounded-xl border border-dark-800 bg-dark-950 p-5">
      <p className="text-sm leading-relaxed text-slate-300">{whatIs}</p>
      <div className="mt-5 grid grid-cols-1 gap-4 border-t border-dark-800 pt-4 sm:grid-cols-3">
        {[1, 2, 3].map((index) => {
          const value = t(`landing.${prefix}Stat${index}Value`);
          const label = t(`landing.${prefix}Stat${index}Label`);
          const valueClass =
            tone === 'payoff'
              ? 'text-slate-100'
              : index === 3
                ? 'text-rose-400'
                : 'text-emerald-400';
          return (
            <div key={index}>
              <span className={`block font-mono text-lg font-bold ${valueClass}`}>{value}</span>
              <span className="mt-0.5 block text-[11px] leading-tight text-slate-500">{label}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-4 border-t border-dark-800 pt-3 text-[11px] leading-relaxed text-slate-500">{note}</p>
      <p className="mt-2 text-[11px] leading-relaxed text-honey-400/70">{caveat}</p>
    </div>
  );
}

const CALC_MIN_BALANCE = 1200;
const CALC_MAX_BALANCE = 500000;
const CALC_SLIDER_STEPS = 1000;
const CALC_SIX_MONTH_RETURN = 1.1;
const CALC_WEEKLY_FEE = 20;
const CALC_WEEKS_PER_MONTH = 4.345;
const CALC_PRESETS = [1200, 5000, 20000, 100000, 500000];
const CALC_HORIZONS = [
  { months: 1, label: 'landing.calcHorizon1' },
  { months: 3, label: 'landing.calcHorizon3' },
  { months: 6, label: 'landing.calcHorizon6' },
  { months: 12, label: 'landing.calcHorizon12' },
  { months: 60, label: 'landing.calcHorizon60' },
];

function balanceToSlider(balance: number) {
  return Math.round(
    (CALC_SLIDER_STEPS * Math.log(balance / CALC_MIN_BALANCE)) /
      Math.log(CALC_MAX_BALANCE / CALC_MIN_BALANCE)
  );
}

function ProfitCalculator() {
  const { t, dateLocale } = useLanguage();
  const [sliderPosition, setSliderPosition] = useState(() => balanceToSlider(20000));
  const [months, setMonths] = useState(60);

  const rawBalance =
    CALC_MIN_BALANCE *
    Math.pow(CALC_MAX_BALANCE / CALC_MIN_BALANCE, sliderPosition / CALC_SLIDER_STEPS);
  const balanceStep = rawBalance >= 100000 ? 1000 : rawBalance >= 10000 ? 100 : 50;
  const balance = Math.round(rawBalance / balanceStep) * balanceStep;

  const grossProfit = balance * (Math.pow(1 + CALC_SIX_MONTH_RETURN, months / 6) - 1);
  const fixedFee = CALC_WEEKLY_FEE * months * CALC_WEEKS_PER_MONTH;
  const netProfit = Math.max(grossProfit - fixedFee, -balance);
  const finalBalance = balance + netProfit;
  const effectiveRate = balance > 0 ? (netProfit / balance) * 100 : 0;

  const formatUsd = (value: number) =>
    `${value < 0 ? '-' : ''}$${Math.round(Math.abs(value)).toLocaleString(dateLocale)}`;

  return (
    <div className="rounded-2xl border border-dark-800 bg-dark-900 p-6 shadow-2xl sm:p-10">
      <div className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <label htmlFor="starting-balance" className="text-sm font-medium text-slate-300">
            {t('landing.calcBalanceLabel')}
          </label>
          <span className="font-mono text-2xl font-extrabold text-honey-400">
            {formatUsd(balance)}
          </span>
        </div>
        <input
          id="starting-balance"
          type="range"
          min={0}
          max={CALC_SLIDER_STEPS}
          step={1}
          value={sliderPosition}
          onChange={(event) => setSliderPosition(Number(event.target.value))}
          className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-dark-800 accent-honey-500"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {CALC_PRESETS.map((preset) => {
            const isActive = balance === preset;
            return (
              <button
                key={preset}
                type="button"
                onClick={() => setSliderPosition(balanceToSlider(preset))}
                className={`rounded-lg border px-3 py-1 font-mono text-xs transition-colors ${
                  isActive
                    ? 'border-honey-500/50 bg-honey-500/10 text-honey-400'
                    : 'border-dark-800 bg-dark-950 text-slate-400 hover:text-slate-200'
                }`}
              >
                {`$${preset.toLocaleString(dateLocale)}`}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-slate-500">{t('landing.calcBalanceHint')}</p>
      </div>

      <div className="mb-6">
        <span className="text-xs font-medium uppercase text-slate-400">
          {t('landing.calcHorizonLabel')}
        </span>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {CALC_HORIZONS.map((horizon) => (
            <button
              key={horizon.months}
              type="button"
              onClick={() => setMonths(horizon.months)}
              className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                months === horizon.months
                  ? 'border-honey-500/50 bg-honey-500/10 text-honey-400'
                  : 'border-dark-800 bg-dark-950 text-slate-400 hover:text-slate-200'
              }`}
            >
              {t(horizon.label)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 border-t border-dark-800 pt-6 sm:grid-cols-3">
        <div className="rounded-xl border border-dark-800 bg-dark-950 p-5">
          <span className="text-xs font-medium uppercase text-slate-400">
            {t('landing.calcGross')}
          </span>
          <p
            className={`mt-1 font-mono text-xl font-bold ${
              grossProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {formatUsd(grossProfit)}
          </p>
        </div>
        <div className="rounded-xl border border-dark-800 bg-dark-950 p-5">
          <span className="text-xs font-medium uppercase text-slate-400">
            {t('landing.calcFixedFee')}
          </span>
          <p className="mt-1 font-mono text-xl font-bold text-slate-200">{formatUsd(fixedFee)}</p>
        </div>
        <div className="rounded-xl border border-dark-800 bg-dark-950 p-5">
          <span className="text-xs font-medium uppercase text-slate-400">
            {t('landing.calcEffective')}
          </span>
          <p
            className={`mt-1 font-mono text-xl font-bold ${
              effectiveRate >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {effectiveRate.toFixed(1)}%
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-4 rounded-xl border border-honey-500/30 bg-honey-500/5 p-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="text-xs font-medium uppercase text-honey-400/80">
            {t('landing.calcNet')}
          </span>
          <p
            className={`mt-1 font-mono text-3xl font-black ${
              netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {formatUsd(netProfit)}
          </p>
        </div>
        <div className="sm:text-right">
          <span className="text-[11px] uppercase text-slate-400">
            {t('landing.calcFinalBalance')}
          </span>
          <p className="font-mono text-lg font-bold text-slate-100">{formatUsd(finalBalance)}</p>
        </div>
      </div>

      <div className="mt-6 space-y-2 text-xs leading-relaxed text-slate-500">
        {netProfit < 0 && <p className="text-rose-400/80">{t('landing.calcFeeWarning')}</p>}
      </div>
    </div>
  );
}

export default function LandingPage() {
  const { t } = useLanguage();
  const [marketPairs, setMarketPairs] = useState<PairMarketRow[]>([]);
  const [hintVisible, setHintVisible] = useState(true);

  useEffect(() => {
    async function fetchMarket() {
      const { data } = await supabase.from('pair_market_data').select('*');
      if (data && data.length > 0) {
        setMarketPairs(data as PairMarketRow[]);
      }
    }
    fetchMarket();

    const channel = supabase
      .channel('landing_market')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pair_market_data' }, () => {
        fetchMarket();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const pairsInTrend = marketPairs.filter((pair) => pair.is_in_trend).length;
  const basketSize = marketPairs.length > 0 ? marketPairs.length : 4;

  return (
    <div className="flex min-h-screen flex-col bg-dark-950 text-slate-100 selection:bg-honey-500 selection:text-black">
      {/* Navigation Header */}
      <header className="sticky top-0 z-40 w-full border-b border-dark-800/80 bg-dark-950/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-honey-500/30 bg-honey-500/10 text-xl font-bold text-honey-500 shadow-lg shadow-honey-500/20">
              🐝
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-extrabold tracking-tight text-white">
                CRYPTO <span className="text-honey-400">B</span>
              </span>
            </div>
          </Link>

          <nav className="hidden items-center gap-8 text-sm font-medium text-slate-300 md:flex">
            <a href="#products" className="transition-colors hover:text-honey-400">
              {t('landing.navProducts')}
            </a>
            <a href="#how" className="transition-colors hover:text-honey-400">
              {t('landing.navHow')}
            </a>
            <a href="#calculator" className="transition-colors hover:text-honey-400">
              {t('landing.navCalculator')}
            </a>
            <a href="#pricing" className="transition-colors hover:text-honey-400">
              {t('landing.navPricing')}
            </a>
            <a href="#security" className="transition-colors hover:text-honey-400">
              {t('landing.navSecurity')}
            </a>
            <a href="#faq" className="transition-colors hover:text-honey-400">
              {t('landing.navFaq')}
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <LanguageSwitcher variant="compact" />
            <Link
              href="/login"
              className="px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white"
            >
              {t('landing.signIn')}
            </Link>
            <Link
              href="/register"
              className="flex items-center gap-1.5 rounded-xl bg-honey-500 px-4 py-2 text-sm font-semibold text-dark-950 shadow-lg shadow-honey-500/20 transition-all hover:bg-honey-400"
            >
              {t('landing.tryFree')}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero with interactive bee */}
      <section className="relative isolate overflow-hidden">
        <BeeHeroScene className="absolute inset-0" onInteract={() => setHintVisible(false)} />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-dark-950/85 via-dark-950/55 to-dark-950" />

        <div className="relative mx-auto max-w-7xl px-4 pb-24 pt-16 sm:px-6 lg:px-8 lg:pb-36 lg:pt-24">
          <div className="mx-auto max-w-xl text-center lg:mx-0 lg:text-left">
            <div className="inline-flex items-center gap-2 rounded-full border border-dark-700/80 bg-dark-900/90 px-3.5 py-1.5 font-mono text-xs text-slate-300 backdrop-blur">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              <span className="hidden sm:inline">{t('landing.heroBadge')}</span>
              <span className="font-semibold text-honey-400">
                {t('landing.pairsInTrend', { count: pairsInTrend, total: basketSize })}
              </span>
            </div>

            <h1 className="mt-8 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
              {t('landing.heroTitle1')}{' '}
              <span className="bg-gradient-to-r from-honey-400 via-amber-300 to-yellow-500 bg-clip-text text-transparent">
                {t('landing.heroTitle2')}
              </span>
            </h1>

            <p className="mt-5 font-medium text-honey-200/90">{t('landing.slogan')}</p>

            <p className="mt-4 text-base text-slate-400 sm:text-lg">{t('landing.heroSubtitle')}</p>

            <div className="mt-9 flex flex-col items-center gap-4 sm:flex-row lg:justify-start">
              <Link
                href="/register"
                className="group flex w-full items-center justify-center gap-2 rounded-xl bg-honey-500 px-8 py-3.5 text-base font-bold text-dark-950 shadow-xl shadow-honey-500/25 transition-all hover:bg-honey-400 sm:w-auto"
              >
                {t('landing.startTrial')}
                <ChevronRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/login"
                className="w-full rounded-xl border border-dark-700 bg-dark-900/80 px-8 py-3.5 text-base font-semibold text-slate-200 backdrop-blur transition-colors hover:bg-dark-850 sm:w-auto"
              >
                {t('landing.connectApi')}
              </Link>
            </div>

            <div
              className={`mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium text-slate-500 transition-opacity duration-500 lg:justify-start ${
                hintVisible ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <Move className="h-3.5 w-3.5 text-honey-500" />
                {t('landing.heroHintMove')}
              </span>
              <span className="inline-flex items-center gap-2">
                <MousePointerClick className="h-3.5 w-3.5 text-honey-500" />
                {t('landing.heroHintClick')}
              </span>
            </div>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-mono text-xs text-slate-500 lg:justify-start">
              <span>{t('landing.compatible')}</span>
              <span className="font-semibold text-slate-300">BINANCE FUTURES</span>
              <span>•</span>
              <span className="font-semibold text-slate-300">OKX SWAP</span>
              <span>•</span>
              <span className="font-semibold text-slate-300">BYBIT DERIVATIVES</span>
            </div>
          </div>
        </div>
      </section>

      {/* Live basket scanner */}
      <section className="border-y border-dark-800 bg-dark-900/40 py-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                <Activity className="h-4 w-4 text-honey-400" />
                {t('landing.ribbonTitle')}
              </h2>
              <p className="mt-1 text-xs text-slate-500">{t('landing.ribbonSubtitle')}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {marketPairs.length === 0 ? (
              <div className="col-span-full rounded-xl border border-dark-800 bg-dark-900/80 py-6 text-center font-mono text-sm text-slate-500">
                {t('landing.connectingScanner')}
              </div>
            ) : (
              marketPairs.map((pair) => (
                <div
                  key={pair.pair_symbol}
                  className="flex flex-col justify-between rounded-xl border border-dark-800 bg-dark-900/80 p-4 transition-colors hover:border-honey-500/40"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold tracking-wide text-white">{pair.pair_symbol}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase ${
                        pair.is_in_trend
                          ? 'border border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
                          : 'border border-dark-700 bg-dark-800 text-slate-500'
                      }`}
                    >
                      {pair.is_in_trend ? t('landing.activeTrend') : t('landing.flat')}
                    </span>
                  </div>
                  <div className="mt-3 flex items-baseline justify-between font-mono">
                    <span className="text-xs text-slate-400">{t('landing.ratio')}</span>
                    <span className="text-sm font-semibold text-honey-400">
                      {Number(pair.current_ratio).toFixed(4)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between font-mono text-[11px] text-slate-500">
                    <span>{t('landing.ema10')}</span>
                    <span>{Number(pair.ema_10).toFixed(4)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Products */}
      <section id="products" className="scroll-mt-20 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <SectionHeading title={t('landing.productsTitle')} subtitle={t('landing.productsSubtitle')} />

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <article className="flex flex-col rounded-2xl border border-dark-800 bg-dark-900 p-8 transition-colors hover:border-honey-500/40">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-honey-500/10 text-honey-500">
                  <Layers className="h-6 w-6" />
                </div>
                <span className="rounded-full border border-honey-500/30 bg-honey-500/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-honey-400">
                  {t('landing.pairBadge')}
                </span>
              </div>
              <h3 className="text-xl font-bold text-white">{t('landing.pairName')}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{t('landing.pairDesc')}</p>
              <ul className="mt-6 space-y-3 text-sm text-slate-300">
                {['landing.pairGeneral1', 'landing.pairGeneral2', 'landing.pairGeneral3', 'landing.pairGeneral4'].map(
                  (key) => (
                    <li key={key} className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-honey-500" />
                      <span>{t(key)}</span>
                    </li>
                  )
                )}
              </ul>

              <div className="mt-auto">
                <ProfitPanel
                  whatIs={t('landing.pairWhatIs')}
                  prefix="pair"
                  tone="outcome"
                  note={t('landing.pairProfitNote')}
                  caveat={t('landing.pairCaveat')}
                />
              </div>
            </article>

            <article className="flex flex-col rounded-2xl border border-dark-800 bg-dark-900 p-8 transition-colors hover:border-honey-500/40">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                  <TrendingDown className="h-6 w-6" />
                </div>
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-emerald-400">
                  {t('landing.signalBadge')}
                </span>
              </div>
              <h3 className="text-xl font-bold text-white">{t('landing.signalName')}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{t('landing.signalDesc')}</p>
              <ul className="mt-6 space-y-3 text-sm text-slate-300">
                {[
                  'landing.signalGeneral1',
                  'landing.signalGeneral2',
                  'landing.signalGeneral3',
                  'landing.signalGeneral4',
                ].map((key) => (
                  <li key={key} className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    <span>{t(key)}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-auto">
                <ProfitPanel
                  whatIs={t('landing.signalWhatIs')}
                  prefix="signal"
                  tone="payoff"
                  note={t('landing.signalProfitNote')}
                  caveat={t('landing.signalCaveat')}
                />
              </div>
            </article>
          </div>

          <p className="mt-8 text-center text-xs text-slate-500">{t('landing.productsFoot')}</p>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-20 border-t border-dark-800 bg-dark-900/30 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <SectionHeading title={t('landing.howTitle')} subtitle={t('landing.howSubtitle')} />

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <div key={step.title} className="rounded-2xl border border-dark-800 bg-dark-900 p-6">
                <div className="mb-5 flex items-center justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-honey-500/10 text-honey-500">
                    <step.icon className="h-5 w-5" />
                  </div>
                  <span className="font-mono text-2xl font-black text-dark-700">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                </div>
                <h3 className="text-base font-bold text-white">{t(step.title)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{t(step.desc)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Profit calculator */}
      <section id="calculator" className="scroll-mt-20 py-20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <SectionHeading title={t('landing.calcTitle')} subtitle={t('landing.calcSubtitle')} />
          <ProfitCalculator />
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-20 border-t border-dark-800 py-20">
        <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
          <SectionHeading title={t('landing.pricingTitle')} subtitle={t('landing.pricingSubtitle')} />

          <div className="relative rounded-3xl border-2 border-honey-500/40 bg-dark-900 p-8 shadow-2xl sm:p-12">
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-honey-500 px-4 py-1 text-xs font-bold uppercase tracking-wider text-dark-950">
              {t('landing.trialIncluded')}
            </div>

            <h3 className="text-2xl font-bold text-white">{t('landing.fullAccess')}</h3>
            <div className="mt-6 flex items-baseline justify-center gap-2">
              <span className="font-mono text-5xl font-black text-honey-400">$20</span>
              <span className="font-medium text-slate-400">{t('landing.perWeekPrice')}</span>
            </div>
            <p className="mt-2 font-mono text-sm text-slate-400">{t('landing.profitShare')}</p>

            <ul className="mx-auto mt-8 max-w-md space-y-3.5 text-left text-sm text-slate-300">
              {FEATURES.map((key) => (
                <li key={key} className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
                  <span>{t(key)}</span>
                </li>
              ))}
            </ul>

            <Link
              href="/register"
              className="mt-10 block w-full rounded-xl bg-honey-500 py-4 text-base font-bold text-dark-950 shadow-xl shadow-honey-500/20 transition-all hover:bg-honey-400"
            >
              {t('landing.getStarted')}
            </Link>
          </div>

          <div className="mx-auto mt-8 flex max-w-3xl flex-col items-center gap-4 rounded-2xl border border-honey-500/25 bg-honey-500/5 px-6 py-8 text-center sm:px-10">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-honey-500/10 text-honey-400">
              <UsersRound className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">{t('landing.referralTitle')}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{t('landing.referralSubtitle')}</p>
            </div>
            <Link
              href="/register"
              className="inline-flex items-center gap-2 text-sm font-semibold text-honey-400 transition-colors hover:text-honey-300"
            >
              {t('landing.referralCta')}
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Security */}
      <section id="security" className="scroll-mt-20 border-t border-dark-800 bg-dark-900/50 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <SectionHeading title={t('landing.securityTitle')} subtitle={t('landing.securitySubtitle')} />

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-dark-800 bg-dark-900 p-6 text-center">
              <Lock className="mx-auto mb-3 h-8 w-8 text-honey-400" />
              <h4 className="mb-1 font-bold text-white">{t('landing.noWithdrawTitle')}</h4>
              <p className="text-xs leading-relaxed text-slate-400">{t('landing.noWithdrawDesc')}</p>
            </div>
            <div className="rounded-2xl border border-dark-800 bg-dark-900 p-6 text-center">
              <Server className="mx-auto mb-3 h-8 w-8 text-honey-400" />
              <h4 className="mb-1 font-bold text-white">{t('landing.staticIpTitle')}</h4>
              <p className="text-xs leading-relaxed text-slate-400">{t('landing.staticIpDesc')}</p>
              <p className="mt-3 space-y-1 font-mono text-xs text-honey-400">
                <span className="block">208.77.244.240</span>
                <span className="block">152.55.185.189</span>
                <span className="block">152.55.185.190</span>
              </p>
            </div>
            <div className="rounded-2xl border border-dark-800 bg-dark-900 p-6 text-center">
              <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-honey-400" />
              <h4 className="mb-1 font-bold text-white">{t('landing.aesTitle')}</h4>
              <p className="text-xs leading-relaxed text-slate-400">{t('landing.aesDesc')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 py-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <SectionHeading title={t('landing.faqTitle')} subtitle={t('landing.faqSubtitle')} />

          <div className="space-y-3">
            {FAQ_ITEMS.map((item) => (
              <details
                key={item.q}
                className="group rounded-xl border border-dark-800 bg-dark-900 px-5 py-4 transition-colors open:border-honey-500/40"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-white">
                  {t(item.q)}
                  <ChevronRight className="h-4 w-4 shrink-0 text-honey-500 transition-transform group-open:rotate-90" />
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-slate-400">{t(item.a)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-dark-800 py-8 text-center font-mono text-xs text-slate-500">
        <p>{t('landing.footer')}</p>
      </footer>
    </div>
  );
}
