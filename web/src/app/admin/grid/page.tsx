'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { toast } from '@/components/ui/sonner';
import { useLanguage } from '@/lib/i18n/LanguageContext';

type Coin = {
  id: string;
  base_asset: string;
  direction: string;
  lower_price: number;
  upper_price: number;
  grid_count: number;
  leverage: number;
  stop_price: number;
  take_profit_price: number;
};

type BotRow = {
  id: string;
  template_id: string | null;
  exchange: string;
  margin_usdt: number;
  run_status: string;
  control_status: string;
  pnl_usdt: number | null;
  last_error: string | null;
  exchange_bot_id: string | null;
  users_profile: { email: string | null; full_name: string | null } | null;
};

function draftOf(coin: Coin) {
  return {
    lower: String(coin.lower_price),
    upper: String(coin.upper_price),
    grids: String(coin.grid_count),
    leverage: String(coin.leverage),
    stop: String(coin.stop_price),
    take: String(coin.take_profit_price),
  };
}

export default function AdminGridPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [coins, setCoins] = useState<Coin[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ lower: '', upper: '', grids: '', leverage: '', stop: '', take: '' });
  const [bots, setBots] = useState<BotRow[]>([]);
  const [pending, setPending] = useState<null | { kind: 'stop' } | { kind: 'save' }>(null);

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

    const [{ data: active }, { data: botRows }] = await Promise.all([
      supabase.from('grid_templates').select('*').eq('is_active', true).order('created_at', { ascending: true }),
      supabase
        .from('grid_bots')
        .select('id, template_id, exchange, margin_usdt, run_status, control_status, pnl_usdt, last_error, exchange_bot_id, users_profile(email, full_name)')
        .order('created_at', { ascending: false })
        .limit(80),
    ]);

    setCoins((active || []) as Coin[]);
    setBots((botRows || []) as unknown as BotRow[]);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCoin = (coin: Coin) => {
    setSelectedId(coin.id);
    setDraft(draftOf(coin));
  };

  const saveTemplate = async () => {
    if (!selectedId) return;
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
      .eq('id', selectedId);
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

  const selected = coins.find((coin) => coin.id === selectedId) ?? null;
  const coinBots = selected ? bots.filter((row) => row.template_id === selected.id) : [];

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-dark-950 text-slate-400">
        <p className="font-mono text-sm">{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="p-4 text-slate-100 sm:p-8">
      <div className="max-w-5xl space-y-6">
        <div>
          {selected ? (
            <button type="button" onClick={() => setSelectedId(null)} className="text-sm font-bold text-honey-400">
              ← {t('grid.backToCoins')}
            </button>
          ) : null}
          <h1 className="text-2xl font-extrabold text-white">
            {selected ? `${selected.base_asset}/USDT` : t('grid.adminTitle')}
          </h1>
          <p className="mt-1 max-w-2xl font-mono text-sm text-slate-400">
            {selected
              ? `${selected.lower_price}–${selected.upper_price} · ${selected.grid_count} · ${selected.leverage}x · ${t('grid.neutral')}`
              : t('grid.adminSubtitle')}
          </p>
        </div>

        {selected ? (
          <>
            <section className="rounded-2xl border border-dark-800 bg-dark-900 p-5">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">{t('grid.activeCoin')}</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
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
            </section>
            <BotTable title={t('grid.bots')} rows={coinBots} empty={t('grid.noBots')} labels={botLabels(t)} />
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => setPending({ kind: 'stop' })} className="rounded-xl border border-rose-500/40 px-4 py-2 text-sm font-bold text-rose-300">
                {t('grid.stopAll')}
              </button>
            </div>

            {coins.length === 0 ? (
              <p className="text-sm text-slate-400">{t('grid.noCoin')}</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {coins.map((coin) => {
                  const rows = bots.filter((row) => row.template_id === coin.id);
                  const running = rows.filter((row) => row.run_status === 'running' || row.run_status === 'starting').length;
                  return (
                    <button
                      key={coin.id}
                      type="button"
                      onClick={() => openCoin(coin)}
                      className="rounded-2xl border border-dark-800 bg-dark-900 p-4 text-left transition hover:border-honey-500/50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h2 className="font-mono text-base font-bold text-white">{coin.base_asset}/USDT</h2>
                        <span className="font-mono text-xs text-honey-300">{running}/{rows.length}</span>
                      </div>
                      <p className="mt-2 font-mono text-xs text-slate-400">
                        {coin.lower_price}–{coin.upper_price} · {coin.grid_count} {t('grid.grids')} · {coin.leverage}x
                      </p>
                      <p className="mt-1 font-mono text-xs text-slate-500">
                        {t('grid.stopPrice')} {coin.stop_price} · {t('grid.takeProfit')} {coin.take_profit_price}
                      </p>
                      <p className="mt-3 text-xs font-bold text-honey-300">{t('grid.bots')}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

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

function botLabels(t: (key: string) => string) {
  return {
    user: t('grid.user'),
    exchange: t('grid.exchange'),
    margin: t('grid.margin'),
    status: t('common.status'),
    control: t('grid.control'),
    pnl: t('grid.pnl'),
  };
}

function BotTable({
  title,
  rows,
  empty,
  labels,
}: {
  title: string;
  rows: BotRow[];
  empty: string;
  labels: ReturnType<typeof botLabels>;
}) {
  return (
    <section className="overflow-x-auto rounded-2xl border border-dark-800 bg-dark-900">
      <h2 className="px-4 pt-4 text-sm font-bold uppercase tracking-wider text-slate-500">{title}</h2>
      {rows.length === 0 ? (
        <p className="px-4 py-6 font-mono text-sm text-slate-500">{empty}</p>
      ) : (
        <table className="mt-2 w-full text-left text-sm">
          <thead className="border-b border-dark-800 font-mono text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">{labels.user}</th>
              <th className="px-4 py-3">{labels.exchange}</th>
              <th className="px-4 py-3">{labels.margin}</th>
              <th className="px-4 py-3">{labels.status}</th>
              <th className="px-4 py-3">{labels.control}</th>
              <th className="px-4 py-3">{labels.pnl}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
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
