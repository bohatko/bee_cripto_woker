'use client';

import React, { useState, useEffect } from 'react';
import {
  Sliders,
  Power,
  AlertTriangle,
  Bell,
  Percent,
  Wallet,
  ShieldAlert,
  HelpCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { PanicCloseModal } from '@/components/modals/PanicCloseModal';
import { toast } from '@/components/ui/sonner';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface SignalSettingsCardProps {
  userId: string;
  strategyId?: string;
  strategySymbol?: string;
  leverage?: number;
  initialSettings: any;
  primaryAccount: any;
  freeMargin: number;
  hasOpenPosition: boolean;
  onSettingsUpdated: (newSettings: any) => void;
}

export function SignalSettingsCard({
  userId,
  strategyId = 'xrp_dip_buy_v1',
  strategySymbol = 'XRP',
  leverage = 3.0,
  initialSettings,
  primaryAccount,
  freeMargin,
  hasOpenPosition,
  onSettingsUpdated,
}: SignalSettingsCardProps) {
  const { t } = useLanguage();
  const [isEnabled, setIsEnabled] = useState(Boolean(initialSettings?.is_enabled));
  const [balancePct, setBalancePct] = useState<number>(Number(initialSettings?.balance_pct || 50));
  const [alertReadiness, setAlertReadiness] = useState(
    initialSettings?.alert_readiness_enabled !== false
  );
  const [thresholds, setThresholds] = useState<number[]>(
    Array.isArray(initialSettings?.alert_thresholds) ? initialSettings.alert_thresholds : [80, 90]
  );

  useEffect(() => {
    setIsEnabled(Boolean(initialSettings?.is_enabled));
    setBalancePct(Number(initialSettings?.balance_pct || 50));
    setAlertReadiness(initialSettings?.alert_readiness_enabled !== false);
    setThresholds(
      Array.isArray(initialSettings?.alert_thresholds) ? initialSettings.alert_thresholds : [80, 90]
    );
  }, [initialSettings, strategyId]);

  const [saving, setSaving] = useState(false);
  const [isConfirmToggleOpen, setIsConfirmToggleOpen] = useState(false);
  const [isPanicOpen, setIsPanicOpen] = useState(false);

  const estimatedMargin = ((freeMargin * balancePct) / 100).toFixed(2);
  const estimatedNotional = (Number(estimatedMargin) * leverage).toFixed(2);

  const handleToggleClick = () => {
    if (!primaryAccount || !primaryAccount.is_validated) {
      toast.error('Connect and validate an exchange API key in Exchange Keys first.');
      return;
    }
    setIsConfirmToggleOpen(true);
  };

  const handleConfirmToggle = async () => {
    const nextState = !isEnabled;
    setIsEnabled(nextState);
    setIsConfirmToggleOpen(false);
    await saveSettings({ is_enabled: nextState });
  };

  const handleThresholdToggle = async (th: number) => {
    let next: number[];
    if (thresholds.includes(th)) {
      next = thresholds.filter((x) => x !== th);
    } else {
      next = [...thresholds, th].sort((a, b) => a - b);
    }
    setThresholds(next);
    await saveSettings({ alert_thresholds: next });
  };

  const saveSettings = async (overrides: Record<string, any> = {}) => {
    setSaving(true);
    try {
      const payload = {
        user_id: userId,
        strategy_id: strategyId,
        is_enabled: isEnabled,
        balance_pct: balancePct,
        alert_readiness_enabled: alertReadiness,
        alert_thresholds: thresholds,
        ...overrides,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('user_signal_settings')
        .upsert(payload, { onConflict: 'user_id,strategy_id' })
        .select('*')
        .single();

      if (error) {
        toast.error('Failed to save settings: ' + error.message);
      } else {
        toast.success(t('signals.toastSettingsSaved'));
        onSettingsUpdated(data);
      }
    } finally {
      setSaving(false);
    }
  };

  const handlePanicClose = async () => {
    try {
      const { error } = await supabase
        .from('user_signal_settings')
        .upsert(
          {
            user_id: userId,
            strategy_id: strategyId,
            panic_close_requested_at: new Date().toISOString(),
            is_enabled: false,
          },
          { onConflict: 'user_id,strategy_id' }
        );

      if (error) {
        toast.error('Failed to trigger panic close: ' + error.message);
      } else {
        setIsEnabled(false);
        toast.warning(t('signals.toastPanicTriggered'));
        setIsPanicOpen(false);
      }
    } catch (e: any) {
      toast.error('Panic close error: ' + e.message);
    }
  };

  return (
    <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-5">
      {/* Risk Warning Header */}
      <div className="bg-rose-500/10 border border-rose-500/25 rounded-xl p-3.5 sm:p-4 flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h4 className="text-xs font-bold text-rose-300 tracking-wide uppercase">
            {t('signals.riskWarningTitle')}
          </h4>
          <p className="text-xs text-rose-200/80 leading-relaxed">
            {strategySymbol === 'ETH'
              ? `При плече ${leverage}x падение цены на -15% означает убыток около -${Math.round(15 * leverage)}% маржи. Ликвидация в isolated наступает около -${(100 / leverage).toFixed(0)}%. Управляйте объемом позиции консервативно.`
              : t('signals.riskWarningText')}
          </p>
        </div>
      </div>

      {/* Main Settings Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-5">
        {/* Left: Trading Toggle & Margin Sizing */}
        <div className="space-y-4">
          {/* Toggle Block */}
          <div className="bg-dark-950 border border-dark-800 rounded-xl p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-sm font-bold text-white block truncate">{t('signals.toggleTrading')}</span>
              <span className="text-xs text-slate-400 block mt-0.5 line-clamp-2">
                {t('signals.toggleDesc')}
              </span>
            </div>

            <button
              onClick={handleToggleClick}
              disabled={saving}
              className={`px-3.5 py-2 rounded-xl font-mono text-xs font-bold flex items-center gap-2 transition-all shadow-md shrink-0 ${
                isEnabled
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-dark-950 shadow-emerald-500/20'
                  : 'bg-dark-800 hover:bg-dark-700 text-slate-300 border border-dark-700'
              }`}
            >
              <Power className="w-3.5 h-3.5" />
              <span>{isEnabled ? t('signals.on') : t('signals.off')}</span>
            </button>
          </div>

          {/* Margin Allocation Slider */}
          <div className="bg-dark-950 border border-dark-800 rounded-xl p-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Percent className="w-4 h-4 text-honey-400" />
                {t('signals.balancePctLabel')}
              </span>
              <span className="text-sm font-mono font-bold text-honey-400">
                {balancePct}%
              </span>
            </div>

            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={balancePct}
              onChange={(e) => setBalancePct(Number(e.target.value))}
              onMouseUp={() => saveSettings({ balance_pct: balancePct })}
              onTouchEnd={() => saveSettings({ balance_pct: balancePct })}
              className="w-full accent-honey-500 h-2 bg-dark-800 rounded-lg cursor-pointer"
            />

            <div className="flex justify-between items-center text-[11px] font-mono text-slate-400 pt-1">
              <span>5%</span>
              <span className="text-slate-300 font-bold">
                {t('signals.simulatedMargin', { margin: estimatedMargin, notional: estimatedNotional })}
              </span>
              <span>100%</span>
            </div>
          </div>
        </div>

        {/* Right: Telegram Approaching Alerts & Panic Close */}
        <div className="space-y-4">
          {/* Telegram Alerts Block */}
          <div className="bg-dark-950 border border-dark-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-honey-400" />
                <span className="text-xs font-bold text-white">
                  {t('signals.telegramAlertsTitle')}
                </span>
              </div>

              <input
                type="checkbox"
                checked={alertReadiness}
                onChange={async (e) => {
                  const val = e.target.checked;
                  setAlertReadiness(val);
                  await saveSettings({ alert_readiness_enabled: val });
                }}
                className="w-4 h-4 accent-honey-500 rounded cursor-pointer"
              />
            </div>
            <p className="text-[11px] text-slate-400 leading-normal">
              {t('signals.telegramAlertsDesc')}
            </p>

            <div className="pt-2 border-t border-dark-800/80">
              <span className="text-[10px] uppercase font-mono text-slate-500 block mb-2">
                {t('signals.thresholdsLabel')}
              </span>
              <div className="flex flex-wrap gap-2">
                {[70, 80, 90, 95].map((th) => {
                  const active = thresholds.includes(th);
                  return (
                    <button
                      key={th}
                      onClick={() => handleThresholdToggle(th)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-colors ${
                        active
                          ? 'bg-honey-500/20 text-honey-400 border border-honey-500/40'
                          : 'bg-dark-800 text-slate-400 border border-dark-700 hover:text-slate-200'
                      }`}
                    >
                      {th}%
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Panic Close Button */}
          <div className="bg-dark-950 border border-dark-800 rounded-xl p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-xs font-bold text-rose-400 block truncate">
                {t('signals.panicCloseButton')}
              </span>
              <span className="text-[11px] text-slate-400 block mt-0.5 line-clamp-2">
                {strategySymbol === 'ETH'
                  ? 'Немедленно закрывает активную позицию ETH по рынку и выключает авто-торговлю.'
                  : t('signals.panicCloseDesc')}
              </span>
            </div>

            <button
              onClick={() => setIsPanicOpen(true)}
              disabled={!hasOpenPosition}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold font-mono transition-all flex items-center gap-1.5 shrink-0 ${
                hasOpenPosition
                  ? 'bg-rose-500 hover:bg-rose-400 text-white shadow-lg shadow-rose-500/20 cursor-pointer'
                  : 'bg-dark-800 text-slate-600 border border-dark-700 cursor-not-allowed'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Panic Close</span>
            </button>
          </div>
        </div>
      </div>

      {/* Confirm Toggle Modal */}
      <ConfirmModal
        isOpen={isConfirmToggleOpen}
        onClose={() => setIsConfirmToggleOpen(false)}
        onConfirm={handleConfirmToggle}
        title={isEnabled ? `Disable ${strategySymbol} Dip-Buy Trading?` : `Enable ${strategySymbol} Dip-Buy Trading?`}
        description={
          isEnabled
            ? `When disabled, incoming ${strategySymbol} dip signals will not open new trades on your exchange account. Open positions remain managed until exit.`
            : `When enabled, the worker will automatically replicate ${strategySymbol} dip-buy entries with ${leverage}x leverage using the configured % of free margin.`
        }
        confirmText={isEnabled ? 'Disable' : 'Enable Trading'}
        variant={isEnabled ? 'warning' : 'primary'}
      />

      {/* Panic Close Modal */}
      <PanicCloseModal
        isOpen={isPanicOpen}
        onCancel={() => setIsPanicOpen(false)}
        onConfirm={handlePanicClose}
        unrealizedPnl={0}
        openPositionsCount={hasOpenPosition ? 1 : 0}
      />
    </div>
  );
}
