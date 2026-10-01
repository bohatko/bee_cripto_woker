'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { History, Plus, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { toast } from '@/components/ui/sonner';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { hasProModules } from '@/lib/pro-access';

type ExchangeName = 'okx' | 'bybit';

const BYBIT_ONLY_ASSETS: ReadonlySet<string> = new Set(['CL']);

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
type Slot = {
  id: string;
  template_id: string;
  exchange: ExchangeName;
  margin_usdt: number;
  is_enabled: boolean;
  last_error: string | null;
  updated_at: string | null;
};
type Bot = {
  id: string;
  template_id: string | null;
  stopped_at: string | null;
  run_status: string;
  control_status: string;
  exchange: string;
  pnl_usdt: number | null;
  last_error: string | null;
  margin_usdt: number;
  created_at: string;
};
type GridEvent = {
  id: string;
  template_id: string | null;
  exchange: string | null;
  event: string;
  message: string;
  created_at: string;
};

export default function GridPage() {
  const router = useRouter();
  const { t, formatDateTime } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [pro, setPro] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [events, setEvents] = useState<GridEvent[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [stopSlot, setStopSlot] = useState<Slot | null>(null);
  const [editSlot, setEditSlot] = useState<Slot | null>(null);
  const [historySlot, setHistorySlot] = useState<Slot | null>(null);
  const [draftCoin, setDraftCoin] = useState('');
  const [draftExchange, setDraftExchange] = useState<ExchangeName | ''>('');
  const [draftMargin, setDraftMargin] = useState('100');

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      router.replace('/login');
      return;
    }
    setUserId(auth.user.id);

    const [{ data: profile }, { data: accs }, { data: active }, { data: slotRows }, { data: botRows }, { data: eventRows }] =
      await Promise.all([
        supabase
          .from('users_profile')
          .select('subscription_plan, subscription_status, is_frozen')
          .eq('id', auth.user.id)
          .maybeSingle(),
        supabase.from('exchange_accounts').select('id, exchange, is_validated, is_active').eq('user_id', auth.user.id),
        supabase.from('grid_templates').select('*').eq('is_active', true).order('created_at', { ascending: true }),
        supabase.from('grid_user_settings').select('*').eq('user_id', auth.user.id).order('created_at', { ascending: true }),
        supabase
          .from('grid_bots')
          .select('id, template_id, stopped_at, run_status, control_status, exchange, pnl_usdt, last_error, margin_usdt, created_at')
          .eq('user_id', auth.user.id)
          .order('created_at', { ascending: false })
          .limit(40),
        supabase
          .from('grid_events')
          .select('id, template_id, exchange, event, message, created_at')
          .eq('user_id', auth.user.id)
          .order('created_at', { ascending: false })
          .limit(120),
      ]);

    setPro(hasProModules(profile));
    setAccounts((accs || []) as Account[]);
    const coins = (active || []) as Template[];
    setTemplates(coins);
    const botList = (botRows || []) as Bot[];
    const slotList = (slotRows || []) as Slot[];
    setSlots(slotList);
    setBots(botList);
    setEvents((eventRows || []) as GridEvent[]);
    setDraftCoin((current) => current || coins[0]?.id || '');
    setLoading(false);
  }, [router]);

  const [now, setNow] = useState(() => Date.now());

  const isPending = useCallback(
    (slot: Slot) => {
      if (!slot.is_enabled) return false;
      const bot = bots.find((row) => row.template_id === slot.template_id && row.exchange === slot.exchange);
      if (!bot) return true;
      if (bot.run_status !== 'stopped') return false;
      return Boolean(
        bot.stopped_at && slot.updated_at && new Date(bot.stopped_at).getTime() < new Date(slot.updated_at).getTime()
      );
    },
    [bots]
  );

  const isStopping = useCallback(
    (slot: Slot) => {
      if (slot.is_enabled) return false;
      const bot = bots.find((row) => row.template_id === slot.template_id && row.exchange === slot.exchange);
      return bot?.run_status === 'running' || bot?.run_status === 'starting'
        ? bot.control_status !== 'released'
        : false;
    },
    [bots]
  );

  const anyPending = slots.some((slot) => (!slot.last_error && isPending(slot)) || isStopping(slot));

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      void load();
    }, anyPending ? 3000 : 15000);
    return () => clearInterval(timer);
  }, [load, anyPending]);

  const connected = useMemo(() => {
    const okx = accounts.some((row) => row.exchange === 'okx' && row.is_active && row.is_validated);
    const bybit = accounts.some((row) => row.exchange === 'bybit' && row.is_active && row.is_validated);
    return { okx, bybit };
  }, [accounts]);

  const templateById = useMemo(() => new Map(templates.map((item) => [item.id, item])), [templates]);

  const draftBybitOnly = BYBIT_ONLY_ASSETS.has(templateById.get(draftCoin)?.base_asset ?? '');

  const latestBot = (slot: Slot) =>
    bots.find((bot) => bot.template_id === slot.template_id && bot.exchange === slot.exchange);

  const firstConnected = () => (['bybit', 'okx'] as ExchangeName[]).find((name) => connected[name]) || '';

  const openCreate = () => {
    setEditSlot(null);
    setDraftCoin(templates[0]?.id || '');
    setDraftExchange(firstConnected());
    setDraftMargin('100');
    setCreateOpen(true);
  };

  const closeForm = () => {
    setCreateOpen(false);
    setEditSlot(null);
  };

  const createBot = async () => {
    if (!userId || !draftCoin || !draftExchange) return;
    const running = slots.some((slot) => {
      const bot = latestBot(slot);
      return (
        slot.template_id === draftCoin &&
        slot.exchange === draftExchange &&
        slot.is_enabled &&
        (bot?.run_status === 'running' || bot?.run_status === 'starting')
      );
    });
    if (running) {
      toast.error(t('grid.alreadyRunning'));
      setConfirmCreate(false);
      return;
    }
    const sameSlot = editSlot && editSlot.template_id === draftCoin && editSlot.exchange === draftExchange;
    const { error } = sameSlot
      ? await supabase
          .from('grid_user_settings')
          .update({ margin_usdt: Number(draftMargin), is_enabled: true, last_error: null })
          .eq('id', editSlot.id)
      : await supabase.from('grid_user_settings').upsert(
          {
            user_id: userId,
            template_id: draftCoin,
            exchange: draftExchange,
            margin_usdt: Number(draftMargin),
            is_enabled: true,
            last_error: null,
          },
          { onConflict: 'user_id,template_id,exchange' }
        );
    if (error) {
      toast.error(error.message);
      return;
    }
    if (editSlot && !sameSlot) {
      await supabase.from('grid_user_settings').delete().eq('id', editSlot.id);
    }
    toast.success(t('grid.saved'));
    setConfirmCreate(false);
    closeForm();
    await load();
  };

  const stopBot = async () => {
    if (!stopSlot) return;
    const target = stopSlot;
    setStopSlot(null);
    setSlots((current) => current.map((row) => (row.id === target.id ? { ...row, is_enabled: false, updated_at: new Date().toISOString() } : row)));
    const { error } = await supabase.from('grid_user_settings').update({ is_enabled: false }).eq('id', target.id);
    if (error) {
      toast.error(error.message);
      await load();
      return;
    }
    toast.info(t('grid.stopSent'));
    await load();
  };

  const historyEvents = historySlot
    ? events.filter((row) => row.template_id === historySlot.template_id && row.exchange === historySlot.exchange)
    : [];

  const [archiveOpen, setArchiveOpen] = useState(false);

  const openDraft = (slot: Slot) => {
    setEditSlot(slot);
    setDraftCoin(templateById.has(slot.template_id) ? slot.template_id : templates[0]?.id || '');
    setDraftExchange(connected[slot.exchange] ? slot.exchange : firstConnected());
    setDraftMargin(String(Number(slot.margin_usdt)));
    setCreateOpen(true);
  };

  const slotStatus = (slot: Slot): string => {
    const bot = latestBot(slot);
    const live = bot?.run_status === 'running' || bot?.run_status === 'starting';
    if (live && isStopping(slot)) {
      const elapsed = slot.updated_at ? Math.max(0, now - new Date(slot.updated_at).getTime()) / 1000 : 0;
      return elapsed < 5 ? 'stopRequested' : 'stopping';
    }
    if (live) return bot?.control_status === 'released' ? 'released' : bot!.run_status;
    if (isPending(slot)) {
      const elapsed = slot.updated_at ? Math.max(0, now - new Date(slot.updated_at).getTime()) / 1000 : 0;
      if (elapsed < 6) return 'preparing';
      if (elapsed < 15) return 'connecting';
      if (elapsed < 45) return 'awaiting';
      return 'waiting';
    }
    if (!slot.is_enabled && slot.last_error) return 'draft';
    return 'stopped';
  };

  const activeSlots = slots.filter((slot) => slotStatus(slot) !== 'stopped');
  const archivedSlots = slots.filter((slot) => slotStatus(slot) === 'stopped');

  const renderSlot = (slot: Slot) => {
    const coin = templateById.get(slot.template_id);
    const bot = latestBot(slot);
    const pnl = bot?.pnl_usdt == null ? null : Number(bot.pnl_usdt);
    const status = slotStatus(slot);
    const live = status === 'running' || status === 'starting' || status === 'released';
    const pending = ['preparing', 'connecting', 'awaiting', 'waiting'].includes(status);
    return (
              <article key={slot.id} className="rounded-2xl border border-dark-800 bg-dark-900 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-mono text-base font-bold text-white">{coin ? `${coin.base_asset}/USDT` : '—'}</h2>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-md border border-dark-700 bg-dark-950 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-honey-300">
                        {slot.exchange}
                      </span>
                      <StatusPill status={status} label={statusText(status, t)} />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`font-mono text-lg font-bold leading-none ${pnl != null && pnl < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {pnl == null ? '—' : `${pnl > 0 ? '+' : ''}${pnl.toFixed(2)}`}
                      <span className="ml-1 text-[10px] font-medium text-slate-500">USDT</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => setHistorySlot(slot)}
                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-honey-300"
                    >
                      <History className="h-3 w-3" />
                      {t('grid.history')}
                    </button>
                  </div>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 font-mono text-xs">
                  <Stat label={t('grid.margin')} value={`${Number(slot.margin_usdt)} USDT`} />
                  <Stat label={t('grid.range')} value={coin ? `${px(coin.lower_price)} – ${px(coin.upper_price)}` : '—'} />
                  <Stat label={t('grid.grids')} value={coin ? String(coin.grid_count) : '—'} />
                  <Stat label={t('grid.leverage')} value={coin ? `${Number(coin.leverage)}x` : '—'} />
                  <Stat label={t('grid.stopPrice')} value={coin ? px(coin.stop_price) : '—'} />
                  <Stat label={t('grid.takeProfit')} value={coin ? px(coin.take_profit_price) : '—'} />
                  <Stat label={t('grid.direction')} value={t('grid.neutral')} />
                </dl>

                {(slot.last_error || bot?.last_error) && (
                  <p className="mt-3 text-xs text-rose-300">
                    {t('grid.error')}: {slot.last_error || bot?.last_error}
                  </p>
                )}

                <div className="mt-3">
                  {status === 'stopRequested' || status === 'stopping' ? (
                    <p className="text-xs text-slate-400">{t('grid.stopWait')}</p>
                  ) : live || pending ? (
                    <button
                      type="button"
                      disabled={!pro}
                      onClick={() => setStopSlot(slot)}
                      className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-bold text-rose-300 disabled:opacity-40"
                    >
                      {t('grid.stop')}
                    </button>
                  ) : status === 'draft' ? (
                    <button
                      type="button"
                      disabled={!pro}
                      onClick={() => openDraft(slot)}
                      className="rounded-lg bg-honey-500 px-3 py-1.5 text-xs font-bold text-dark-950 disabled:opacity-40"
                    >
                      {t('grid.launchDraft')}
                    </button>
                  ) : (
                    <p className="text-xs text-slate-500">{t('grid.stoppedHint')}</p>
                  )}
                </div>
              </article>
    );
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white">{t('grid.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">{t('grid.subtitle')}</p>
        </div>
        <button
          type="button"
          disabled={!pro || templates.length === 0}
          onClick={openCreate}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-honey-500 px-4 py-2 text-sm font-bold text-dark-950 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
          {t('grid.create')}
        </button>
      </div>

      {!pro && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <p>{t('grid.proOnly')}</p>
          <Link
            href="/billing"
            className="inline-flex shrink-0 rounded-xl bg-honey-500 px-3 py-1.5 text-xs font-bold text-dark-950"
          >
            {t('nav.billing')}
          </Link>
        </div>
      )}
      {bots.some((row) => row.control_status === 'released' && row.run_status === 'running') && (
        <div className="rounded-2xl border border-honey-500/30 bg-honey-500/10 px-4 py-3 text-sm text-honey-100">
          {t('grid.released')}
        </div>
      )}
      {!connected.okx && !connected.bybit && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dark-700 bg-dark-900 px-4 py-3 text-sm text-slate-300">
          <p>{t('grid.unavailable')}</p>
          <Link
            href="/settings/exchange"
            className="inline-flex shrink-0 rounded-xl border border-honey-500/40 px-3 py-1.5 text-xs font-bold text-honey-300"
          >
            {t('nav.exchangeKeys')}
          </Link>
        </div>
      )}

      {activeSlots.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-dark-700 bg-dark-900/60 px-5 py-10 text-sm text-slate-400">
          {templates.length === 0 ? t('grid.noCoin') : t('grid.noCards')}
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{activeSlots.map(renderSlot)}</div>
      )}

      {archivedSlots.length > 0 && (
        <section className="space-y-3">
          <button
            type="button"
            onClick={() => setArchiveOpen((value) => !value)}
            className="text-sm font-bold text-slate-300"
          >
            {t('grid.archive')} ({archivedSlots.length}) {archiveOpen ? '▲' : '▼'}
          </button>
          {archiveOpen && <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{archivedSlots.map(renderSlot)}</div>}
        </section>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/70" aria-label={t('common.cancel')} onClick={closeForm} />
          <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-dark-800 bg-dark-900 p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold text-white">{editSlot ? t('grid.launchDraft') : t('grid.create')}</h2>
              <button type="button" onClick={closeForm} className="rounded-lg p-1 text-slate-400">
                <X className="h-4 w-4" />
              </button>
            </div>
            {editSlot?.last_error && <p className="mt-3 text-xs text-rose-300">{editSlot.last_error}</p>}
            <div className="mt-4">
              <p className="text-sm text-slate-300">{t('grid.coin')}</p>
              {templates.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">{t('grid.noCoin')}</p>
              ) : (
                <div className="mt-2 grid max-h-56 grid-cols-2 gap-2 overflow-y-auto">
                  {templates.map((item) => {
                    const selected = draftCoin === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          setDraftCoin(item.id);
                          if (BYBIT_ONLY_ASSETS.has(item.base_asset)) {
                            setDraftExchange(connected.bybit ? 'bybit' : '');
                          }
                        }}
                        className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                          selected
                            ? 'border-honey-500 bg-honey-500/10'
                            : 'border-dark-700 bg-dark-950 hover:border-dark-600'
                        }`}
                      >
                        <span className="block font-mono text-sm font-bold text-white">{item.base_asset}/USDT</span>
                        <span className="mt-0.5 block font-mono text-[11px] text-slate-400">
                          {px(item.lower_price)}–{px(item.upper_price)} · {Number(item.leverage)}x
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="mt-4 text-sm text-slate-300">
              {t('grid.exchange')}
              <div className="mt-2 flex gap-2">
                {(['okx', 'bybit'] as ExchangeName[]).map((name) => (
                  <button
                    key={name}
                    type="button"
                    disabled={!connected[name] || (name === 'okx' && draftBybitOnly)}
                    onClick={() => setDraftExchange(name)}
                    className={`rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-40 ${
                      draftExchange === name ? 'bg-honey-500 text-dark-950' : 'border border-dark-700 text-slate-300'
                    }`}
                  >
                    {connected[name] ? name.toUpperCase() : `${name.toUpperCase()} · ${t('grid.notConnected')}`}
                  </button>
                ))}
              </div>
            </div>
            <label className="mt-4 block text-sm text-slate-300">
              {t('grid.margin')}
              <input
                type="number"
                min={10}
                step="1"
                value={draftMargin}
                onChange={(event) => setDraftMargin(event.target.value)}
                className="mt-2 w-full rounded-xl border border-dark-700 bg-dark-950 px-3 py-2 font-mono text-white outline-none focus:border-honey-500"
              />
            </label>
            <button
              type="button"
              disabled={!draftCoin || !draftExchange || Number(draftMargin) < 10}
              onClick={() => setConfirmCreate(true)}
              className="mt-5 w-full rounded-xl bg-honey-500 px-4 py-2 text-sm font-bold text-dark-950 disabled:opacity-40"
            >
              {editSlot ? t('grid.launchDraft') : t('grid.create')}
            </button>
          </div>
        </div>
      )}

      {historySlot && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button type="button" className="absolute inset-0 bg-black/70" aria-label={t('common.cancel')} onClick={() => setHistorySlot(null)} />
          <aside className="relative flex h-full w-full max-w-md flex-col border-l border-dark-800 bg-dark-950 shadow-2xl">
            <header className="flex items-start justify-between gap-3 border-b border-dark-800 px-5 py-4">
              <div>
                <h2 className="text-base font-bold text-white">{t('grid.historyTitle')}</h2>
                <p className="mt-1 font-mono text-xs text-slate-500">
                  {templateById.get(historySlot.template_id)?.base_asset || '—'}/USDT · {historySlot.exchange.toUpperCase()}
                </p>
              </div>
              <button type="button" onClick={() => setHistorySlot(null)} className="rounded-lg p-1 text-slate-400">
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {historyEvents.length === 0 ? (
                <p className="text-sm text-slate-400">{t('grid.historyEmpty')}</p>
              ) : (
                historyEvents.map((row) => (
                  <div key={row.id} className="rounded-xl border border-dark-800 bg-dark-900 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-honey-300">{row.event}</span>
                      <span className="font-mono text-[10px] text-slate-500">{formatDateTime(row.created_at)}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-200">{row.message}</p>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      )}

      <ConfirmModal
        isOpen={confirmCreate}
        title={editSlot ? t('grid.confirmRestartTitle') : t('grid.confirmCreateTitle')}
        description={editSlot ? t('grid.confirmRestartDesc') : t('grid.confirmCreateDesc')}
        confirmText={editSlot ? t('grid.launchDraft') : t('grid.create')}
        onConfirm={() => void createBot()}
        onCancel={() => setConfirmCreate(false)}
      />
      <CloseWordModal
        isOpen={Boolean(stopSlot)}
        title={t('grid.confirmStopTitle')}
        description={t('grid.confirmStopDesc')}
        confirmText={t('grid.stop')}
        typeLabel={`${t('panic.typeClose')} CLOSE ${t('panic.toConfirm')}`}
        onConfirm={() => void stopBot()}
        onCancel={() => setStopSlot(null)}
      />
    </div>
  );
}

function CloseWordModal({
  isOpen,
  title,
  description,
  confirmText,
  typeLabel,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  title: string;
  description: string;
  confirmText: string;
  typeLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [value, setValue] = useState('');
  useEffect(() => {
    if (!isOpen) setValue('');
  }, [isOpen]);
  if (!isOpen) return null;
  const ready = value.trim().toUpperCase() === 'CLOSE';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
      <div className="w-full max-w-lg rounded-2xl border-2 border-rose-600/40 bg-dark-900 p-6">
        <h3 className="text-xl font-bold text-white">{title}</h3>
        <p className="mt-3 text-sm text-slate-300">{description}</p>
        <label className="mt-5 block text-xs font-medium text-slate-300">
          {typeLabel}
          <input
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="CLOSE"
            className="mt-2 w-full rounded-xl border border-dark-700 bg-dark-950 px-4 py-2.5 text-center font-mono tracking-widest text-white outline-none focus:border-rose-500"
          />
        </label>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="rounded-xl bg-dark-800 px-4 py-2 text-sm font-medium text-slate-300">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={onConfirm}
            className="rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-dark-800 disabled:text-slate-600"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

function statusText(status: string, t: (key: string) => string): string {
  if (status === 'running' || status === 'starting') return t('grid.running');
  if (status === 'stopRequested') return t('grid.stageStopRequested');
  if (status === 'stopping') return t('grid.stageStopping');
  if (status === 'preparing') return t('grid.stagePreparing');
  if (status === 'connecting') return t('grid.stageConnecting');
  if (status === 'awaiting') return t('grid.stageAwaiting');
  if (status === 'draft') return t('grid.draft');
  if (status === 'waiting') return t('grid.waiting');
  if (status === 'stopped') return t('grid.stopped');
  if (status === 'released') return t('grid.releasedShort');
  return status;
}

function StatusPill({ status, label }: { status: string; label: string }) {
  const tone =
    status === 'running' || status === 'starting'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
      : status === 'draft'
        ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
      : status === 'waiting' || status === 'stopRequested' || status === 'stopping' || status === 'preparing' || status === 'connecting' || status === 'awaiting'
        ? 'animate-pulse border-honey-500/40 bg-honey-500/10 text-honey-200'
        : status === 'released'
          ? 'border-honey-500/40 bg-honey-500/10 text-honey-200'
          : 'border-dark-700 bg-dark-950 text-slate-400';
  return <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${tone}`}>{label}</span>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="text-slate-100">{value}</dd>
    </div>
  );
}

function px(value: number | string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}
