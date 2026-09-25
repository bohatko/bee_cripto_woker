'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { toast } from '@/components/ui/sonner';
import { useLanguage } from '@/lib/i18n/LanguageContext';

type Candidate = {
  baseAsset: string;
  lowerPrice: number;
  upperPrice: number;
  gridCount: number;
  leverage: number;
  stopPrice: number;
  takeProfitPrice: number;
  spacing: 'geometric' | 'arithmetic';
  direction: 'neutral' | 'long' | 'short';
  score: number;
  metrics: { netReturnPct: number; efficiency: number; avgDailyRangePct: number; lastPrice: number };
};

type BotRow = {
  id: string;
  exchange: string;
  margin_usdt: number;
  run_status: string;
  control_status: string;
  pnl_usdt: number | null;
  last_error: string | null;
  exchange_bot_id: string | null;
  users_profile: { email: string | null; full_name: string | null } | null;
};

export default function AdminGridPage() {
  const router = useRouter();
  const { t, formatDateTime } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [template, setTemplate] = useState<any>(null);
  const [coins, setCoins] = useState<any[]>([]);
  const [draft, setDraft] = useState({ lower: '', upper: '', grids: '', leverage: '', stop: '', take: '' });
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [bots, setBots] = useState<BotRow[]>([]);
  const [pending, setPending] = useState<null | { kind: 'activate'; candidate: Candidate } | { kind: 'stop' } | { kind: 'save' }>(null);

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      router.replace('/login');
      return;
    }
    const { data: profile } = await supabase.from('users_profile').select('role').eq('id', auth.user.id).single();
    if (profile?.role !== 'admin') {
      router.replace('/dashboard');
      return;
    }

    const [{ data: active }, { data: engine }, { data: runs }, { data: botRows }] = await Promise.all([
      supabase.from('grid_templates').select('*').eq('is_active', true).order('created_at', { ascending: true }),
      supabase.from('grid_engine').select('*').eq('id', 1).maybeSingle(),
      supabase.from('grid_screener_runs').select('*').order('created_at', { ascending: false }).limit(1),
      supabase
        .from('grid_bots')
        .select('id, exchange, margin_usdt, run_status, control_status, pnl_usdt, last_error, exchange_bot_id, users_profile(email, full_name)')
        .order('created_at', { ascending: false })
        .limit(80),
    ]);

    const rows = (active || []) as any[];
    setCoins(rows);
    const editable = rows[0] ?? null;
    setTemplate(editable);
    if (editable) {
      setDraft({
        lower: String(editable.lower_price),
        upper: String(editable.upper_price),
        grids: String(editable.grid_count),
        leverage: String(editable.leverage),
        stop: String(editable.stop_price),
        take: String(editable.take_profit_price),
      });
    }
    setLastScan(engine?.last_scan_at || null);
    setScanError(engine?.last_scan_error || null);
    setCandidates(((runs || [])[0]?.candidates || []) as Candidate[]);
    setBots((botRows || []) as unknown as BotRow[]);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const scan = async () => {
    const { error } = await supabase.from('grid_engine').update({ scan_requested: true }).eq('id', 1);
    if (error) toast.error(error.message);
    else toast.success(t('grid.scanQueued'));
  };

  const activate = async (candidate: Candidate) => {
    const { error } = await supabase.from('grid_templates').insert({
      base_asset: candidate.baseAsset,
      is_active: true,
      lower_price: candidate.lowerPrice,
      upper_price: candidate.upperPrice,
      grid_count: candidate.gridCount,
      spacing: candidate.spacing,
      leverage: candidate.leverage,
      stop_price: candidate.stopPrice,
      take_profit_price: candidate.takeProfitPrice,
      direction: candidate.direction,
      score: candidate.score,
      metrics: candidate.metrics,
    });
    if (error) toast.error(error.message);
    else toast.success(`${candidate.baseAsset} activated`);
    setPending(null);
    await load();
  };

  const saveTemplate = async () => {
    if (!template) return;
    const { error } = await supabase
      .from('grid_templates')
      .update({
        lower_price: Number(draft.lower),
        upper_price: Number(draft.upper),
        grid_count: Number(draft.grids),
        leverage: Number(draft.leverage),
        stop_price: Number(draft.stop),
        take_profit_price: Number(draft.take),
      })
      .eq('id', template.id);
    if (error) toast.error(error.message);
    else toast.success(t('grid.saved'));
    setPending(null);
    await load();
  };

  const stopAll = async () => {
    const { error } = await supabase.from('grid_user_settings').update({ is_enabled: false }).not('user_id', 'is', null);
    if (error) toast.error(error.message);
    else toast.success(t('grid.stopAll'));
    setPending(null);
    await load();
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-dark-950 text-slate-400">
        <p className="font-mono text-sm">{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-950 p-4 text-slate-100 sm:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-white">{t('grid.adminTitle')}</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">{t('grid.adminSubtitle')}</p>
            <p className="mt-2 font-mono text-xs text-slate-500">
              {t('grid.lastScan')}: {lastScan ? formatDateTime(lastScan) : t('common.never')}
              {scanError ? ` · ${scanError}` : ''}
            </p>
          </div>
          <Link href="/admin" className="text-sm text-honey-400">
            Admin
          </Link>
        </div>

        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => void scan()} className="rounded-xl bg-honey-500 px-4 py-2 text-sm font-bold text-dark-950">
            {t('grid.scan')}
          </button>
          <button type="button" onClick={() => setPending({ kind: 'stop' })} className="rounded-xl border border-rose-500/40 px-4 py-2 text-sm font-bold text-rose-300">
            {t('grid.stopAll')}
          </button>
        </div>

        <section className="rounded-2xl border border-dark-800 bg-dark-900 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">{t('grid.activeCoin')}</h2>
          {coins.length > 0 && (
            <ul className="mt-3 space-y-1 font-mono text-sm text-slate-300">
              {coins.map((coin) => (
                <li key={coin.id}>
                  {coin.base_asset}/USDT · {coin.lower_price}–{coin.upper_price} · {coin.grid_count} · {coin.leverage}x · SL {coin.stop_price} · TP {coin.take_profit_price}
                </li>
              ))}
            </ul>
          )}
          {template ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <p className="font-mono text-lg text-white sm:col-span-3">{template.base_asset}/USDT · {template.direction}</p>
              <Field label={t('grid.range') + ' min'} value={draft.lower} onChange={(value) => setDraft({ ...draft, lower: value })} />
              <Field label={t('grid.range') + ' max'} value={draft.upper} onChange={(value) => setDraft({ ...draft, upper: value })} />
              <Field label={t('grid.grids')} value={draft.grids} onChange={(value) => setDraft({ ...draft, grids: value })} />
              <Field label={t('grid.leverage')} value={draft.leverage} onChange={(value) => setDraft({ ...draft, leverage: value })} />
              <Field label={t('grid.stopPrice')} value={draft.stop} onChange={(value) => setDraft({ ...draft, stop: value })} />
              <Field label={t('grid.takeProfit')} value={draft.take} onChange={(value) => setDraft({ ...draft, take: value })} />
              <button type="button" onClick={() => setPending({ kind: 'save' })} className="rounded-xl bg-dark-800 px-4 py-2 text-sm font-bold text-honey-300 sm:col-span-3">
                {t('grid.saveTemplate')}
              </button>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-400">{t('grid.noCoin')}</p>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-500">{t('grid.candidates')}</h2>
          {candidates.length === 0 ? (
            <p className="font-mono text-sm text-slate-500">{t('grid.noCandidates')}</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {candidates.map((candidate) => (
                <article key={candidate.baseAsset} className="rounded-2xl border border-dark-800 bg-dark-900 p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-mono text-lg text-white">{candidate.baseAsset}/USDT</h3>
                    <span className="font-mono text-honey-400">{candidate.score}</span>
                  </div>
                  <p className="mt-2 font-mono text-xs text-slate-400">
                    {candidate.lowerPrice} – {candidate.upperPrice} · {candidate.gridCount} · {candidate.leverage}x
                  </p>
                  <p className="mt-1 font-mono text-xs text-slate-500">
                    {t('grid.netReturn')} {candidate.metrics.netReturnPct}% · {t('grid.efficiency')} {candidate.metrics.efficiency} · ATR {candidate.metrics.avgDailyRangePct}%
                  </p>
                  <button
                    type="button"
                    onClick={() => setPending({ kind: 'activate', candidate })}
                    className="mt-3 rounded-lg bg-honey-500/15 px-3 py-1.5 text-xs font-bold text-honey-300"
                  >
                    {t('grid.activate')}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="overflow-x-auto rounded-2xl border border-dark-800 bg-dark-900">
          <h2 className="px-4 pt-4 text-sm font-bold uppercase tracking-wider text-slate-500">{t('grid.bots')}</h2>
          {bots.length === 0 ? (
            <p className="px-4 py-6 font-mono text-sm text-slate-500">{t('grid.noBots')}</p>
          ) : (
            <table className="mt-2 w-full text-left text-sm">
              <thead className="border-b border-dark-800 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">{t('grid.user')}</th>
                  <th className="px-4 py-3">{t('grid.exchange')}</th>
                  <th className="px-4 py-3">{t('grid.margin')}</th>
                  <th className="px-4 py-3">{t('common.status')}</th>
                  <th className="px-4 py-3">{t('grid.control')}</th>
                  <th className="px-4 py-3">{t('grid.pnl')}</th>
                </tr>
              </thead>
              <tbody>
                {bots.map((row) => (
                  <tr key={row.id} className="border-b border-dark-800/70">
                    <td className="px-4 py-3">
                      <p>{row.users_profile?.full_name || row.users_profile?.email || 'Trader'}</p>
                      <p className="font-mono text-[11px] text-slate-500">{row.exchange_bot_id || row.last_error || ''}</p>
                    </td>
                    <td className="px-4 py-3 font-mono">{row.exchange}</td>
                    <td className="px-4 py-3 font-mono">{row.margin_usdt}</td>
                    <td className="px-4 py-3 font-mono">{row.run_status}</td>
                    <td className="px-4 py-3 font-mono">{row.control_status}</td>
                    <td className={`px-4 py-3 font-mono ${Number(row.pnl_usdt) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {row.pnl_usdt ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <ConfirmModal
        isOpen={pending?.kind === 'activate'}
        title={t('grid.confirmActivateTitle')}
        description={t('grid.confirmActivateDesc')}
        confirmText={t('grid.activate')}
        onConfirm={() => pending?.kind === 'activate' && void activate(pending.candidate)}
        onCancel={() => setPending(null)}
      />
      <ConfirmModal
        isOpen={pending?.kind === 'stop'}
        title={t('grid.confirmStopAllTitle')}
        description={t('grid.confirmStopAllDesc')}
        isDestructive
        confirmText={t('grid.stopAll')}
        onConfirm={() => void stopAll()}
        onCancel={() => setPending(null)}
      />
      <ConfirmModal
        isOpen={pending?.kind === 'save'}
        title={t('grid.confirmSaveTitle')}
        description={t('grid.confirmSaveDesc')}
        confirmText={t('grid.saveTemplate')}
        onConfirm={() => void saveTemplate()}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-xs text-slate-400">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-xl border border-dark-700 bg-dark-950 px-3 py-2 font-mono text-sm text-white outline-none focus:border-honey-500"
      />
    </label>
  );
}
