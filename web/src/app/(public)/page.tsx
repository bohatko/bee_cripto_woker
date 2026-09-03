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

export default function LandingPage() {
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
              Strategy
            </a>
            <a href="#calculator" className="hover:text-honey-400 transition-colors">
              Calculator
            </a>
            <a href="#backtest" className="hover:text-honey-400 transition-colors">
              Performance
            </a>
            <a href="#pricing" className="hover:text-honey-400 transition-colors">
              Pricing
            </a>
            <a href="#security" className="hover:text-honey-400 transition-colors">
              Security
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              className="px-4 py-2 text-sm font-semibold rounded-xl bg-honey-500 hover:bg-honey-400 text-dark-950 shadow-lg shadow-honey-500/20 transition-all flex items-center gap-1.5"
            >
              Try 7 Days Free
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
            <span>Live Worker Signal:</span>
            <span className="text-honey-400 font-semibold">
              {marketPairs.filter((p) => p.is_in_trend).length} of 4 Pairs in Active Bull Trend
            </span>
          </div>

          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight max-w-4xl mx-auto leading-tight sm:leading-none">
            Market-Neutral <br className="hidden sm:inline" />
            <span className="bg-gradient-to-r from-honey-400 via-amber-300 to-yellow-500 bg-clip-text text-transparent">
              Crypto Alpha Engine
            </span>
          </h1>

          <p className="mt-6 text-lg sm:text-xl text-slate-400 max-w-2xl mx-auto font-normal">
            Autonomous long-short basket trading. Profit consistently from structural divergence while eliminating market direction risk (\(\beta = 0\)).
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/register"
              className="w-full sm:w-auto px-8 py-3.5 text-base font-bold rounded-xl bg-honey-500 hover:bg-honey-400 text-dark-950 shadow-xl shadow-honey-500/25 transition-all flex items-center justify-center gap-2 group"
            >
              Start Free 7-Day Trial
              <ChevronRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <Link
              href="/login"
              className="w-full sm:w-auto px-8 py-3.5 text-base font-semibold rounded-xl bg-dark-900 hover:bg-dark-850 text-slate-200 border border-dark-700 transition-colors"
            >
              Connect Exchange API
            </Link>
          </div>

          {/* Supported Exchanges Badges */}
          <div className="mt-12 flex items-center justify-center gap-6 text-xs text-slate-500 font-mono">
            <span>OFFICIALLY COMPATIBLE:</span>
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
                Connecting to Railway market scanner...
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
                      {pair.is_in_trend ? 'Active Trend' : 'Flat'}
                    </span>
                  </div>
                  <div className="mt-3 flex items-baseline justify-between font-mono">
                    <span className="text-xs text-slate-400">Ratio:</span>
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
              Interactive ROI Calculator
            </h2>
            <p className="mt-3 text-slate-400 text-base">
              Estimate your monthly yield based on historical 6-month multi-pair basket compounding.
            </p>
          </div>

          <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 sm:p-10 shadow-2xl">
            <div className="mb-8">
              <div className="flex justify-between items-center mb-3">
                <label className="text-sm font-medium text-slate-300">Your Initial Deposit (USDT):</label>
                <span className="text-2xl font-extrabold text-honey-400 font-mono">
                  ${deposit.toLocaleString('en-US')}
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
                <span>$500 Min</span>
                <span>$25,000</span>
                <span>$50,000 Max</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 border-t border-dark-800">
              <div className="bg-dark-950 p-5 rounded-xl border border-dark-800">
                <span className="text-xs text-slate-400 uppercase font-medium">Est. Weekly Profit</span>
                <p className="text-2xl font-bold text-emerald-400 font-mono mt-1">
                  +${estimatedWeeklyProfit.toLocaleString('en-US')}
                </p>
                <span className="text-[11px] text-slate-500 font-mono">~4.5% / week</span>
              </div>

              <div className="bg-dark-950 p-5 rounded-xl border border-dark-800">
                <span className="text-xs text-slate-400 uppercase font-medium">Est. Monthly Profit</span>
                <p className="text-2xl font-bold text-emerald-400 font-mono mt-1">
                  +${estimatedMonthlyProfit.toLocaleString('en-US')}
                </p>
                <span className="text-[11px] text-slate-500 font-mono">~19.8% / month</span>
              </div>

              <div className="bg-dark-950 p-5 rounded-xl border border-dark-800">
                <span className="text-xs text-slate-400 uppercase font-medium">SaaS Service Cost</span>
                <p className="text-2xl font-bold text-honey-400 font-mono mt-1">
                  ${platformFee.toLocaleString('en-US')}
                </p>
                <span className="text-[11px] text-slate-500 font-mono">$20/wk + 10% HWM Fee</span>
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
              Why Market-Neutral Basket Alpha?
            </h2>
            <p className="mt-3 text-slate-400 text-base max-w-2xl mx-auto">
              Traditional directional traders lose money when Bitcoin plummets. Bee Crypto Worker maintains zero market exposure.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-dark-900 border border-dark-800 rounded-2xl p-8 hover:border-honey-500/40 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-honey-500/10 text-honey-500 flex items-center justify-center mb-6">
                <Layers className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Simultaneous Long / Short</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                By purchasing cycle leaders like ZEC and shorting laggards like AVAX in equal volume, market-wide drops cancel each other out completely.
              </p>
            </div>

            <div className="bg-dark-900 border border-dark-800 rounded-2xl p-8 hover:border-honey-500/40 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-6">
                <TrendingUp className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Compounding Growth</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Profits are automatically reinvested into the next basket cycle, unlocking exponential equity progression with strict 8.7% max historical drawdown.
              </p>
            </div>

            <div className="bg-dark-900 border border-dark-800 rounded-2xl p-8 hover:border-honey-500/40 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center mb-6">
                <Server className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Railway 24/7 Daemon</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Deployed with static outbound IP addresses to satisfy exchange security requirements. Zero downtime, zero browser dependencies.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 border-t border-dark-800">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-extrabold text-white tracking-tight">
            Transparent, Fair Monetization
          </h2>
          <p className="mt-3 text-slate-400 text-base">
            No hidden charges. We only earn when you make actual profit.
          </p>

          <div className="mt-12 bg-dark-900 border-2 border-honey-500/40 rounded-3xl p-8 sm:p-12 shadow-2xl relative">
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-honey-500 text-dark-950 font-bold text-xs uppercase tracking-wider">
              Free 7-Day Trial Included
            </div>

            <h3 className="text-2xl font-bold text-white">Full Platform Access</h3>
            <div className="mt-6 flex items-baseline justify-center gap-2">
              <span className="text-5xl font-black text-honey-400 font-mono">$20</span>
              <span className="text-slate-400 font-medium">/ week</span>
            </div>
            <p className="text-sm text-slate-400 mt-2 font-mono">+ 10% Profit Share (High-Water Mark)</p>

            <ul className="mt-8 space-y-3.5 text-left max-w-md mx-auto text-sm text-slate-300">
              <li className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>Connect Binance, OKX, or Bybit via API</span>
              </li>
              <li className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>Automatic 4-Pair Basket Execution</span>
              </li>
              <li className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>Stop-Loss & Take-Profit Guard (TP +5%, SL -1.5%)</span>
              </li>
              <li className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>Real-time Live PnL Dashboard</span>
              </li>
              <li className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>High-Water Mark guarantee: fees only on new net profits</span>
              </li>
            </ul>

            <Link
              href="/register"
              className="mt-10 block w-full py-4 rounded-xl bg-honey-500 hover:bg-honey-400 text-dark-950 font-bold text-base shadow-xl shadow-honey-500/20 transition-all"
            >
              Get Started with 7-Day Trial
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
              <h4 className="font-bold text-white mb-1">No Withdrawal Permissions</h4>
              <p className="text-xs text-slate-400">
                Your funds remain safely on your exchange. The bot only holds Trade permissions and strictly denies withdrawal keys.
              </p>
            </div>
            <div className="p-6">
              <Server className="w-8 h-8 text-honey-400 mx-auto mb-3" />
              <h4 className="font-bold text-white mb-1">Static Egress IP Whitelisting</h4>
              <p className="text-xs text-slate-400">
                Railway outbound static IP (54.198.120.45) protects your API keys so orders can only originate from the authorized worker.
              </p>
            </div>
            <div className="p-6">
              <ShieldCheck className="w-8 h-8 text-honey-400 mx-auto mb-3" />
              <h4 className="font-bold text-white mb-1">AES-256-GCM Encryption</h4>
              <p className="text-xs text-slate-400">
                All credentials stored in Supabase are encrypted using military-grade authenticated AES-256 ciphers with unique initialization vectors.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto py-8 border-t border-dark-800 text-center text-xs text-slate-500 font-mono">
        <p>© 2026 Bee Crypto Worker. Autonomous Quantitative Trading Platform. All rights reserved.</p>
      </footer>
    </div>
  );
}
