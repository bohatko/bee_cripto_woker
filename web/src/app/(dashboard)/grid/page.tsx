'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { toast } from '@/components/ui/sonner';
import { useLanguage } from '@/lib/i18n/LanguageContext';

type ExchangeName = 'okx' | 'bybit';

type Account = { id: string; exchange: string; is_validated: boolean; is_active: boolean };
type Template = {
  id: string;
  base_asset: string;
  lower_price: number;
  upper_price: number;
  grid_count: number;
  leverage: number;
  stop_price: number;
  take_profit_price: number;
  direction: string;
  spacing: string;
};
type Bot = {
  id: string;
  run_status: string;
  control_status: string;
  exchange: string;
  pnl_usdt: number | null;
  last_error: string | null;
  margin_usdt: number;
  created_at: string;
  grid_templates: { base_asset: string } | null;
};

export default function GridPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [pro, setPro] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [primaryExchange, setPrimaryExchange] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [margin, setMargin] = useState('140');
  const [exchange, setExchange] = useState<'' | ExchangeName>('');
  const [enabled, setEnabled] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [pending, setPending] = useState<'start' | 'stop' | null>(null);

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      router.replace('/login');
      return;
    }
    setUserId(auth.user.id);

    const [{ data: profile }, { data: accs }, { data: trading }, { data: active }, { data: settings }, { data: botRows }] =
      await Promise.all([
        supabase
          .from('users_profile')
          .select('subscription_plan, subscription_status, is_frozen')
          .eq('id', auth.user.id)
          .maybeSingle(),
        supabase.from('exchange_accounts').select('id, exchange, is_validated, is_active').eq('user_id', auth.user.id),
        supabase.from('trading_settings').select('exchange_account_id').eq('user_id', auth.user.id).maybeSingle(),
        supabase.from('grid_templates').select('*').eq('is_active', true).order('created_at', { ascending: true }),
        supabase.from('grid_user_settings').select('*').eq('user_id', auth.user.id).maybeSingle(),
        supabase
          .from('grid_bots')
          .select('*, grid_templates(base_asset)')
          .eq('user_id', auth.user.id)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

    const entitled =
      profile?.subscription_plan === 'pro' &&
      !profile?.is_frozen &&
      (profile?.subscription_status === 'trial' || profile?.subscription_status === 'active');
    setPro(Boolean(entitled));
    const list = (accs || []) as Account[];
    setAccounts(list);
    const primary = list.find((row) => row.id === trading?.exchange_account_id);
    setPrimaryExchange(primary?.exchange || null);
    setTemplates((active || []) as Template[]);
    if (settings) {
      setMargin(String(settings.margin_usdt ?? 140));
      setExchange((settings.exchange || '') as '' | ExchangeName);
      setEnabled(Boolean(settings.is_enabled));
      setSettingsError(settings.last_error || null);
    }
    setBots((botRows || []) as Bot[]);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const connected = useMemo(() => {
    const okx = accounts.some((row) => row.exchange === 'okx' && row.is_active && row.is_validated);
    const bybit = accounts.some((row) => row.exchange === 'bybit' && row.is_active && row.is_validated);
    return { okx, bybit };
  }, [accounts]);

  const effectiveExchange: ExchangeName | null =
    exchange || (primaryExchange === 'okx' || primaryExchange === 'bybit' ? primaryExchange : null);
  const exchangeReady = effectiveExchange ? connected[effectiveExchange] : false;
  const canStart = pro && templates.length > 0 && exchangeReady && Number(margin) >= 10;

  const save = async (nextEnabled: boolean) => {
    if (!userId) return;
    const { error } = await supabase.from('grid_user_settings').upsert({
      user_id: userId,
      margin_usdt: Number(margin),
      exchange: exchange || null,
      is_enabled: nextEnabled,
      last_error: null,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t('grid.saved'));
    setPending(null);
    await load();
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        <p className="font-mono text-sm">{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-8 max-w-5xl space-y-6">
        <div>
          <h1 className="text-2xl font-extrabold text-white">{t('grid.title')}</h1>
          <p className="mt-1 text-sm text-slate-400">{t('grid.subtitle')}</p>
        </div>

        {!pro && (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {t('grid.proOnly')}
          </div>
        )}
        {bots.some((row) => row.control_status === 'released' && row.run_status === 'running') && (
          <div className="rounded-2xl border border-honey-500/30 bg-honey-500/10 px-4 py-3 text-sm text-honey-100">
            {t('grid.released')}
          </div>
        )}
        {!connected.okx && !connected.bybit && (
          <div className="rounded-2xl border border-dark-700 bg-dark-900 px-4 py-3 text-sm text-slate-300">
            {t('grid.unavailable')}
          </div>
        )}

        <section className="rounded-2xl border border-dark-800 bg-dark-900 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">{t('grid.activeCoin')}</h2>
          {templates.length > 0 ? (
            <div className="mt-3 space-y-4">
              {templates.map((item) => (
                <div key={item.id} className="grid grid-cols-2 gap-3 font-mono text-sm sm:grid-cols-3">
                  <Stat label={t('grid.activeCoin')} value={`${item.base_asset}/USDT`} />
                  <Stat label={t('grid.range')} value={`${item.lower_price} – ${item.upper_price}`} />
                  <Stat label={t('grid.grids')} value={String(item.grid_count)} />
                  <Stat label={t('grid.leverage')} value={`${item.leverage}x`} />
                  <Stat label={t('grid.stopPrice')} value={String(item.stop_price)} />
                  <Stat label={t('grid.takeProfit')} value={String(item.take_profit_price)} />
                  <Stat label={t('grid.direction')} value={t('grid.neutral')} />
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-400">{t('grid.noCoin')}</p>
          )}
        </section>

        <section className="rounded-2xl border border-dark-800 bg-dark-900 p-5 space-y-4">
          <label className="block text-sm text-slate-300">
            {t('grid.exchange')}
            <div className="mt-2 flex flex-wrap gap-2">
              <ExchangeButton
                active={exchange === ''}
                label={`${t('grid.tradingDefault')}${primaryExchange ? ` (${primaryExchange.toUpperCase()})` : ''}`}
                disabled={false}
                onClick={() => setExchange('')}
              />
              {(['okx', 'bybit'] as ExchangeName[]).map((name) => (
                <ExchangeButton
                  key={name}
                  active={exchange === name}
                  label={connected[name] ? name.toUpperCase() : `${name.toUpperCase()} · ${t('grid.notConnected')}`}
                  disabled={!connected[name]}
                  onClick={() => setExchange(name)}
                />
              ))}
            </div>
          </label>

          <label className="block text-sm text-slate-300">
            {t('grid.margin')}
            <input
              type="number"
              min={10}
              step="1"
              value={margin}
              onChange={(event) => setMargin(event.target.value)}
              className="mt-2 w-full rounded-xl border border-dark-700 bg-dark-950 px-3 py-2 font-mono text-white outline-none focus:border-honey-500"
            />
          </label>

          <div className="flex gap-3">
            <button
              type="button"
              disabled={!canStart || enabled}
              onClick={() => setPending('start')}
              className="rounded-xl bg-honey-500 px-4 py-2 text-sm font-bold text-dark-950 disabled:opacity-40"
            >
              {t('grid.start')}
            </button>
            <button
              type="button"
              disabled={!enabled || !pro}
              onClick={() => setPending('stop')}
              className="rounded-xl border border-rose-500/40 px-4 py-2 text-sm font-bold text-rose-300 disabled:opacity-40"
            >
              {t('grid.stop')}
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-dark-800 bg-dark-900 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">{t('grid.yourBot')}</h2>
          {bots.length === 0 && enabled && <p className="mt-3 text-sm text-slate-400">{t('grid.waiting')}</p>}
          {bots.map((row) => (
            <div key={row.id} className="mt-3 space-y-1 font-mono text-sm text-slate-200">
              <p>
                {row.grid_templates?.base_asset || '—'}/USDT · {t('common.status')}:{' '}
                {row.control_status === 'released' ? t('grid.released') : statusLabel(row.run_status, t)}
              </p>
              <p>
                {t('grid.exchange')}: {row.exchange.toUpperCase()} · {t('grid.margin')}: {row.margin_usdt}
              </p>
              <p className={Number(row.pnl_usdt) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {t('grid.pnl')}: {row.pnl_usdt ?? '—'} USDT
              </p>
              {row.last_error && (
                <p className="text-rose-300">
                  {t('grid.error')}: {row.last_error}
                </p>
              )}
            </div>
          ))}
          {settingsError && <p className="mt-3 text-sm text-rose-300">{t('grid.error')}: {settingsError}</p>}
        </section>

      <ConfirmModal
        isOpen={pending === 'start'}
        title={t('grid.confirmStartTitle')}
        description={t('grid.confirmStartDesc')}
        confirmText={t('grid.start')}
        onConfirm={() => void save(true)}
        onCancel={() => setPending(null)}
      />
      <ConfirmModal
        isOpen={pending === 'stop'}
        title={t('grid.confirmStopTitle')}
        description={t('grid.confirmStopDesc')}
        isDestructive
        confirmText={t('grid.stop')}
        onConfirm={() => void save(false)}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

function statusLabel(status: string, t: (key: string) => string): string {
  if (status === 'running' || status === 'starting') return t('grid.running');
  if (status === 'stopped') return t('grid.stopped');
  return status;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-white">{value}</p>
    </div>
  );
}

function ExchangeButton({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-xl px-3 py-2 text-xs font-bold ${
        active ? 'bg-honey-500 text-dark-950' : 'border border-dark-700 text-slate-300'
      } disabled:opacity-40`}
    >
      {label}
    </button>
  );
}
