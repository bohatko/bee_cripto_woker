'use client';

import React, { useEffect, useState } from 'react';
import { Percent } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from '@/components/ui/sonner';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { Pulse, CardShell } from '@/components/ui/skeleton';

export function PairTradingMarginSettings() {
  const { t } = useLanguage();
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [pairsBalancePct, setPairsBalancePct] = useState(100);
  const [freeMarginUsd, setFreeMarginUsd] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data: sett } = await supabase
          .from('trading_settings')
          .select('id, pairs_balance_pct, exchange_account_id')
          .eq('user_id', user.id)
          .maybeSingle();

        if (sett) {
          setSettingsId(sett.id);
          const pct = Number(sett.pairs_balance_pct);
          setPairsBalancePct(Number.isFinite(pct) ? Math.min(100, Math.max(5, pct)) : 100);
        }

        let freeQuery = supabase
          .from('exchange_accounts')
          .select('free_balance_usd, last_balance_usd')
          .eq('user_id', user.id)
          .eq('is_active', true);

        if (sett?.exchange_account_id) {
          freeQuery = freeQuery.eq('id', sett.exchange_account_id);
        }

        const { data: accountRows } = await freeQuery.limit(1);
        const accounts = Array.isArray(accountRows) ? accountRows[0] : accountRows;
        if (accounts) {
          const free = Number(
            accounts.free_balance_usd ?? Number(accounts.last_balance_usd || 0) * 0.75
          );
          setFreeMarginUsd(Number.isFinite(free) ? free : 0);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const savePairsBalancePct = async (nextPct: number) => {
    if (!settingsId) return;
    const clamped = Math.min(100, Math.max(5, Math.round(nextPct)));
    setSaving(true);
    try {
      const { error } = await supabase
        .from('trading_settings')
        .update({ pairs_balance_pct: clamped })
        .eq('id', settingsId);
      if (error) throw error;
      setPairsBalancePct(clamped);
      toast.success(t('history.pairsBalanceSaved', { pct: clamped }));
    } catch (err: any) {
      toast.error(err.message || t('history.pairsBalanceSaveError'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <CardShell className="p-5 shadow-xl space-y-3">
        <div className="flex justify-between items-center gap-3">
          <Pulse className="h-4 w-48" />
          <Pulse className="h-4 w-12" />
        </div>
        <Pulse className="h-2 w-full rounded-lg" />
        <Pulse className="h-3 w-64 max-w-full" />
      </CardShell>
    );
  }

  if (!settingsId) return null;

  const budget = (freeMarginUsd * pairsBalancePct) / 100;
  const slot = budget / 4;

  return (
    <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-xl space-y-3">
      <div className="flex justify-between items-center gap-3">
        <span className="text-xs font-semibold text-white flex items-center gap-1.5">
          <Percent className="w-4 h-4 text-honey-400 shrink-0" />
          {t('history.pairsBalancePctLabel')}
        </span>
        <span className="text-sm font-mono font-bold text-honey-400 shrink-0">
          {pairsBalancePct}%
        </span>
      </div>

      <input
        type="range"
        min={5}
        max={100}
        step={5}
        value={pairsBalancePct}
        disabled={saving}
        onChange={(e) => setPairsBalancePct(Number(e.target.value))}
        onMouseUp={(e) => savePairsBalancePct(Number((e.target as HTMLInputElement).value))}
        onTouchEnd={(e) => savePairsBalancePct(Number((e.target as HTMLInputElement).value))}
        className="w-full accent-honey-500 h-2 bg-dark-800 rounded-lg cursor-pointer disabled:opacity-50"
      />

      <div className="flex justify-between items-center text-[11px] font-mono text-slate-400 pt-1 gap-2">
        <span>5%</span>
        <span className="text-slate-300 font-bold text-center">
          {t('history.pairsBalanceEstimate', {
            budget: budget.toFixed(2),
            slot: slot.toFixed(2),
          })}
        </span>
        <span>100%</span>
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">{t('history.pairsBalancePctHelp')}</p>
    </div>
  );
}
