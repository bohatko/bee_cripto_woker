'use client';

import React, { useMemo, useState } from 'react';
import { ArrowRightLeft, Search, X, AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface BasketPairRow {
  id: string;
  pair_symbol: string;
  long_coin: string;
  short_coin: string;
  score: number | null;
  metrics?: Record<string, unknown> | null;
  activated_at?: string;
}

export interface CandidateRow {
  pair_symbol: string;
  long_coin: string;
  short_coin: string;
  score: number;
  valid?: boolean;
  reject_reasons?: string[];
  metrics?: Record<string, unknown> | null;
}

interface ReplacePairModalProps {
  isOpen: boolean;
  outgoing: BasketPairRow | null;
  activePairs: BasketPairRow[];
  candidates: CandidateRow[];
  onClose: () => void;
  onSelect: (candidate: CandidateRow) => void;
}

export function ReplacePairModal({
  isOpen,
  outgoing,
  activePairs,
  candidates,
  onClose,
  onSelect,
}: ReplacePairModalProps) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CandidateRow | null>(null);

  const reservedCoins = useMemo(() => {
    const set = new Set<string>();
    for (const p of activePairs) {
      if (outgoing && p.id === outgoing.id) continue;
      set.add(p.long_coin.toUpperCase());
      set.add(p.short_coin.toUpperCase());
    }
    return set;
  }, [activePairs, outgoing]);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    return candidates
      .filter((c) => {
        if (!c?.pair_symbol || !c.long_coin || !c.short_coin) return false;
        if (outgoing && c.pair_symbol === outgoing.pair_symbol) return false;
        if (activePairs.some((p) => p.pair_symbol === c.pair_symbol && p.id !== outgoing?.id)) {
          return false;
        }
        const long = c.long_coin.toUpperCase();
        const short = c.short_coin.toUpperCase();
        if (reservedCoins.has(long) || reservedCoins.has(short)) return false;
        if (!q) return true;
        return (
          c.pair_symbol.toUpperCase().includes(q) ||
          long.includes(q) ||
          short.includes(q)
        );
      })
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .slice(0, 40);
  }, [candidates, query, reservedCoins, activePairs, outgoing]);

  if (!isOpen || !outgoing) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-2xl max-h-[85vh] bg-dark-900 border border-dark-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-dark-800 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-honey-400" />
              <h2 className="text-base font-bold text-white">{t('admin.replacePairTitle')}</h2>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
              {t('admin.replacePairHint', { pair: outgoing.pair_symbol })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setQuery('');
              onClose();
            }}
            className="p-2 rounded-xl bg-dark-800 hover:bg-dark-700 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-dark-800 bg-dark-950/50">
          <div className="flex items-center gap-3 font-mono text-xs">
            <span className="text-slate-500">{t('admin.replaceOutgoing')}</span>
            <span className="font-bold text-white">{outgoing.pair_symbol}</span>
            <span className="text-honey-400">
              score {outgoing.score === null || outgoing.score === undefined ? '—' : Number(outgoing.score).toFixed(3)}
            </span>
          </div>
          <div className="relative mt-3">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('admin.replaceSearchPlaceholder')}
              className="w-full bg-dark-900 border border-dark-700 rounded-xl pl-9 pr-3 py-2 text-xs font-mono text-white placeholder:text-slate-600 focus:outline-none focus:border-honey-500/50"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-slate-500 text-xs font-mono">
              {t('admin.replaceNoCandidates')}
            </div>
          ) : (
            <table className="w-full text-left text-xs font-mono">
              <thead className="sticky top-0 bg-dark-900 text-[10px] uppercase tracking-wider text-slate-500 border-b border-dark-800">
                <tr>
                  <th className="px-5 py-2.5">{t('admin.candColPair')}</th>
                  <th className="px-5 py-2.5 text-right">{t('admin.candColScore')}</th>
                  <th className="px-5 py-2.5">{t('admin.replaceReasons')}</th>
                  <th className="px-5 py-2.5 text-right">{t('admin.colControl')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-800">
                {filtered.map((c) => {
                  const isSelected = selected?.pair_symbol === c.pair_symbol;
                  return (
                    <tr
                      key={c.pair_symbol}
                      className={`hover:bg-dark-850/60 transition-colors ${
                        isSelected ? 'bg-honey-500/10' : ''
                      }`}
                    >
                      <td className="px-5 py-3">
                        <div className="font-bold text-white">{c.pair_symbol}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          <span className="text-emerald-400">L:{c.long_coin}</span>
                          <span className="mx-1">/</span>
                          <span className="text-rose-400">S:{c.short_coin}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right text-honey-400 font-bold">
                        {Number(c.score).toFixed(3)}
                      </td>
                      <td className="px-5 py-3 text-[10px] text-slate-500">
                        {c.valid ? (
                          <span className="text-emerald-400">{t('admin.replaceValid')}</span>
                        ) : (
                          (c.reject_reasons || []).join(', ') || '—'
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setSelected(c)}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase border transition-all ${
                            isSelected
                              ? 'bg-honey-500 text-dark-950 border-honey-400'
                              : 'bg-dark-800 text-slate-300 border-dark-700 hover:text-white'
                          }`}
                        >
                          {isSelected ? t('admin.replaceSelected') : t('admin.replaceSelect')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-4 border-t border-dark-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-dark-950/40">
          <div className="flex items-start gap-2 text-[11px] text-amber-300/90 max-w-md">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{t('admin.replaceCoinGuard')}</span>
          </div>
          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setQuery('');
                onClose();
              }}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-dark-800 hover:bg-dark-700 text-slate-300"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={!selected}
              onClick={() => {
                if (!selected) return;
                onSelect(selected);
                setSelected(null);
                setQuery('');
              }}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-honey-500 hover:bg-honey-400 text-dark-950 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-honey-500/20"
            >
              {t('admin.replaceContinue')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
