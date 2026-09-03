'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ShieldCheck,
  TrendingUp,
  Zap,
  Activity,
  Layers,
  ArrowRight,
  Lock,
  Server,
  DollarSign,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { LanguageSwitcher } from '@/lib/i18n/LanguageSwitcher';

export default function LandingPage() {
  const { t, dateLocale } = useLanguage();
  const [marketPairs, setMarketPairs] = useState<any[]>([]);
  const [deposit, setDeposit] = useState<number>(5000);

  useEffect(() => {
    async function fetchMarket() {
      const { data } = await supabase.from('pair_market_data').select('*');
      if (data && data.length > 0) {
        setMarketPairs(data);
      }
    }
    fetchMarket();

    // Listen to live market changes via Supabase Realtime
    const channel = supabase
      .channel('landing_market')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pair_market_data' }, (payload) => {
        fetchMarket();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Profit calculation logic based on 6-month backtest average (approx 18% monthly net alpha)
  const estimatedWeeklyProfit = Math.round(deposit * 0.045);
  const estimatedMonthlyProfit = Math.round(deposit * 0.198);
  const platformFee = Math.round(20 * 4 + estimatedMonthlyProfit * 0.10);

  return (
    <div className="min-h-screen bg-dark-950 text-slate-100 flex flex-col selection:bg-honey-500 selection:text-black">
      {/* Navigation Header */}
      <header className="sticky top-0 z-40 w-full border-b border-dark-800/80 bg-dark-950/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-honey-500/10 border border-honey-500/30 flex items-center justify-center text-honey-500 font-bold text-xl shadow-lg shadow-honey-500/20">
              🐝
            </div>
            <div>
              <span className="font-extrabold tracking-tight text-white text-lg">BEE CRYPTO</span>
              <span className="text-honey-400 font-mono text-xs ml-1.5 px-2 py-0.5 rounded bg-honey-500/10 border border-honey-500/20">
                WORKER
              </span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-sm text-slate-300 font-medium">
            <a href="#strategy" className="hover:text-honey-400 transition-colors">
              {t('landing.strategy')}
            </a>
            <a href="#calculator" className="hover:text-honey-400 transition-colors">
              {t('landing.calculator')}
            </a>
            <a href="#backtest" className="hover:text-honey-400 transition-colors">
              {t('landing.performance')}
            </a>
            <a href="#pricing" className="hover:text-honey-400 transition-colors">
              {t('landing.pricing')}
            </a>
            <a href="#security" className="hover:text-honey-400 transition-colors">
              {t('landing.security')}
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <LanguageSwitcher variant="compact" />
            <Link
              href="/login"
              className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors"
            >
              {t('landing.signIn')}
            </Link>
            <Link
              href="/register"
              className="px-4 py-2 text-sm font-semibold rounded-xl bg-honey-500 hover:bg-honey-400 text-dark-950 shadow-lg shadow-honey-500/20 transition-all flex items-center gap-1.5"
            >
              {t('landing.tryFree')}
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-16 pb-20 overflow-hidden">
        {/* Glow ambient background */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[650px] h-[350px] bg-honey-500/10 blur-[130px] rounded-full pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          {/* Live Market Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-dark-900 border border-dark-700/80 text-xs font-mono text-slate-300 mb-8 shadow-inner">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>{t('landing.liveSignal')}</span>
            <span className="text-honey-400 font-semibold">
              {t('landing.pairsInTrend', {
                count: marketPairs.filter((p) => p.is_in_trend).length,
              })}
            </span>
          </div>

          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight max-w-4xl mx-auto leading-tight sm:leading-none">
            {t('landing.heroTitle1')} <br className="hidden sm:inline" />
            <span className="bg-gradient-to-r from-honey-400 via-amber-300 to-yellow-500 bg-clip-text text-transparent">
              {t('landing.heroTitle2')}
            </span>
          </h1>

          <p className="mt-6 text-lg sm:text-xl text-slate-400 max-w-2xl mx-auto font-normal">
            {t('landing.heroSubtitle')}
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/register"
              className="w-full sm:w-auto px-8 py-3.5 text-base font-bold rounded-xl bg-honey-500 hover:bg-honey-400 text-dark-950 shadow-xl shadow-honey-500/25 transition-all flex items-center justify-center gap-2 group"
            >
              {t('landing.startTrial')}
              <ChevronRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <Link
              href="/login"
              className="w-full sm:w-auto px-8 py-3.5 text-base font-semibold rounded-xl bg-dark-900 hover:bg-dark-850 text-slate-200 border border-dark-700 transition-colors"
            >
              {t('landing.connectApi')}
            </Link>
          </div>

          {/* Supported Exchanges Badges */}
          <div className="mt-12 flex items-center justify-center gap-6 text-xs text-slate-500 font-mono">
            <span>{t('landing.compatible')}</span>
            <span className="text-slate-300 font-semibold">BINANCE FUTURES</span>
            <span>•</span>
            <span className="text-slate-300 font-semibold">OKX SWAP</span>
            <span>•</span>
            <span className="text-slate-300 font-semibold">BYBIT DERIVATIVES</span>
          </div>
        </div>
      </section>

      {/* Live Market Pairs Ribbon */}
      <section className="border-y border-dark-800 bg-dark-900/40 py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {marketPairs.length === 0 ? (
              <div className="col-span-4 text-center py-4 text-slate-500 font-mono text-sm">
                {t('landing.connectingScanner')}
              </div>
            ) : (
              marketPairs.map((pair) => (
                <div
                  key={pair.pair_symbol}
                  className="bg-dark-900/80 border border-dark-800 p-4 rounded-xl flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white text-sm tracking-wide">{pair.pair_symbol}</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-mono uppercase ${
                        pair.is_in_trend
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : 'bg-dark-800 text-slate-500 border border-dark-700'
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
                    <span>EMA10:</span>
                    <span>{Number(pair.ema_10).toFixed(4)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Profit Calculator Section */}
      <section id="calculator" className="py-20 relative">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-extrabold text-white tracking-tight">
              {t('landing.calcTitle')}
            </h2>
            <p className="mt-3 text-slate-400 text-base">
              {t('landing.calcSubtitle')}
            </p>
          </div>

          <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 sm:p-10 shadow-2xl">
            <div className="mb-8">
              <div className="flex justify-between items-center mb-3">
                <label className="text-sm font-medium text-slate-300">{t('landing.depositLabel')}</label>
                <span className="text-2xl font-extrabold text-honey-400 font-mono">
                  ${deposit.toLocaleString(dateLocale)}
                </span>
              </div>
              <input
                type="range"
                min={500}
                max={50000}
                step={500}
                value={deposit}
                onChange={(e) => setDeposit(Number(e.target.value))}
                className="w-full h-2 bg-dark-800 rounded-lg appearance-none cursor-pointer accent-honey-500"
              />
              <div className="flex justify-between text-xs text-slate-500 font-mono mt-2">
                <span>{t('landing.minDeposit')}</span>
                <span>$25,000</span>
                <span>{t('landing.maxDeposit')}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 border-t border-dark-800">
              <div className="bg-dark-950 p-5 rounded-xl border border-dark-800">
                <span className="text-xs text-slate-400 uppercase font-medium">{t('landing.estWeekly')}</span>
                <p className="text-2xl font-bold text-emerald-400 font-mono mt-1">
                  +${estimatedWeeklyProfit.toLocaleString(dateLocale)}
                </p>
                <span className="text-[11px] text-slate-500 font-mono">{t('landing.perWeek')}</span>
              </div>

              <div className="bg-dark-950 p-5 rounded-xl border border-dark-800">
                <span className="text-xs text-slate-400 uppercase font-medium">{t('landing.estMonthly')}</span>
                <p className="text-2xl font-bold text-emerald-400 font-mono mt-1">
                  +${estimatedMonthlyProfit.toLocaleString(dateLocale)}
                </p>
                <span className="text-[11px] text-slate-500 font-mono">{t('landing.perMonth')}</span>
              </div>

              <div className="bg-dark-950 p-5 rounded-xl border border-dark-800">
                <span className="text-xs text-slate-400 uppercase font-medium">{t('landing.saasCost')}</span>
                <p className="text-2xl font-bold text-honey-400 font-mono mt-1">
                  ${platformFee.toLocaleString(dateLocale)}
                </p>
                <span className="text-[11px] text-slate-500 font-mono">{t('landing.feeNote')}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Strategy Highlights & Architecture */}
      <section id="strategy" className="py-20 bg-dark-900/30 border-t border-dark-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-extrabold text-white tracking-tight">
              {t('landing.whyTitle')}
            </h2>
            <p className="mt-3 text-slate-400 text-base max-w-2xl mx-auto">
              {t('landing.whySubtitle')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-dark-900 border border-dark-800 rounded-2xl p-8 hover:border-honey-500/40 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-honey-500/10 text-honey-500 flex items-center justify-center mb-6">
                <Layers className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">{t('landing.longShortTitle')}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                {t('landing.longShortDesc')}
              </p>
            </div>

            <div className="bg-dark-900 border border-dark-800 rounded-2xl p-8 hover:border-honey-500/40 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-6">
                <TrendingUp className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">{t('landing.compoundingTitle')}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                {t('landing.compoundingDesc')}
              </p>
            </div>

            <div className="bg-dark-900 border border-dark-800 rounded-2xl p-8 hover:border-honey-500/40 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center mb-6">
                <Server className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">{t('landing.railwayTitle')}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                {t('landing.railwayDesc')}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 border-t border-dark-800">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-extrabold text-white tracking-tight">
            {t('landing.pricingTitle')}
          </h2>
          <p className="mt-3 text-slate-400 text-base">
            {t('landing.pricingSubtitle')}
          </p>

          <div className="mt-12 bg-dark-900 border-2 border-honey-500/40 rounded-3xl p-8 sm:p-12 shadow-2xl relative">
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-honey-500 text-dark-950 font-bold text-xs uppercase tracking-wider">
              {t('landing.trialIncluded')}
            </div>

            <h3 className="text-2xl font-bold text-white">{t('landing.fullAccess')}</h3>
            <div className="mt-6 flex items-baseline justify-center gap-2">
              <span className="text-5xl font-black text-honey-400 font-mono">$20</span>
              <span className="text-slate-400 font-medium">{t('landing.perWeekPrice')}</span>
            </div>
            <p className="text-sm text-slate-400 mt-2 font-mono">{t('landing.profitShare')}</p>

            <ul className="mt-8 space-y-3.5 text-left max-w-md mx-auto text-sm text-slate-300">
              <li className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>{t('landing.feature1')}</span>
              </li>
              <li className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>{t('landing.feature2')}</span>
              </li>
              <li className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>{t('landing.feature3')}</span>
              </li>
              <li className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>{t('landing.feature4')}</span>
              </li>
              <li className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>{t('landing.feature5')}</span>
              </li>
            </ul>

            <Link
              href="/register"
              className="mt-10 block w-full py-4 rounded-xl bg-honey-500 hover:bg-honey-400 text-dark-950 font-bold text-base shadow-xl shadow-honey-500/20 transition-all"
            >
              {t('landing.getStarted')}
            </Link>
          </div>
        </div>
      </section>

      {/* Security Section */}
      <section id="security" className="py-16 bg-dark-900/50 border-t border-dark-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
            <div className="p-6">
              <Lock className="w-8 h-8 text-honey-400 mx-auto mb-3" />
              <h4 className="font-bold text-white mb-1">{t('landing.noWithdrawTitle')}</h4>
              <p className="text-xs text-slate-400">
                {t('landing.noWithdrawDesc')}
              </p>
            </div>
            <div className="p-6">
              <Server className="w-8 h-8 text-honey-400 mx-auto mb-3" />
              <h4 className="font-bold text-white mb-1">{t('landing.staticIpTitle')}</h4>
              <p className="text-xs text-slate-400">
                {t('landing.staticIpDesc')}
              </p>
            </div>
            <div className="p-6">
              <ShieldCheck className="w-8 h-8 text-honey-400 mx-auto mb-3" />
              <h4 className="font-bold text-white mb-1">{t('landing.aesTitle')}</h4>
              <p className="text-xs text-slate-400">
                {t('landing.aesDesc')}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto py-8 border-t border-dark-800 text-center text-xs text-slate-500 font-mono">
        <p>{t('landing.footer')}</p>
      </footer>
    </div>
  );
}
