'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  User,
  Bot,
  Save,
  Send,
  Trash2,
  ShieldCheck,
  Loader2,
  Bell,
  BellOff,
  Mail,
  Copy,
  Check,
  Hash,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { resolveExternalUid } from '@/lib/externalUid';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { toast } from '@/components/ui/sonner';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { ProfileSkeleton } from '@/components/skeletons/PageSkeletons';

interface ProfileResponse {
  full_name: string;
  email: string;
  telegram_chat_id: string;
  telegram_enabled: boolean;
  has_telegram_token: boolean;
  subscription_status: string;
  external_uid: string;
}

export default function ProfileSettingsPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [clearModalOpen, setClearModalOpen] = useState(false);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [chatId, setChatId] = useState('');
  const [botToken, setBotToken] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState('trial');
  const [externalUid, setExternalUid] = useState('');
  const [uidCopied, setUidCopied] = useState(false);

  const handleCopyUid = () => {
    if (!externalUid) return;
    navigator.clipboard.writeText(externalUid);
    setUidCopied(true);
    toast.success(t('profile.paymentIdCopied'));
    setTimeout(() => setUidCopied(false), 2000);
  };

  async function authHeaders(): Promise<HeadersInit> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    };
  }

  async function loadProfile() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login');
        return;
      }

      const res = await fetch('/api/settings/profile', {
        headers: await authHeaders(),
        cache: 'no-store',
      });
      const data = (await res.json()) as ProfileResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load profile');
      }
      setFullName(data.full_name || '');
      setEmail(data.email || '');
      setChatId(data.telegram_chat_id || '');
      setEnabled(Boolean(data.telegram_enabled));
      setHasToken(Boolean(data.has_telegram_token));
      setSubscriptionStatus(data.subscription_status || 'trial');
      setExternalUid(resolveExternalUid(user.id, data.external_uid));
      setBotToken('');
    } catch (err: any) {
      toast.error(err.message || t('profile.loadError'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    if (!fullName.trim()) {
      toast.error(t('profile.nameRequired'));
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        full_name: fullName.trim(),
        telegram_chat_id: chatId.trim(),
        telegram_enabled: enabled,
      };
      if (botToken.trim()) {
        payload.telegram_bot_token = botToken.trim();
      }

      const res = await fetch('/api/settings/profile', {
        method: 'PATCH',
        headers: await authHeaders(),
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as ProfileResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save profile');
      }

      setFullName(data.full_name || '');
      setChatId(data.telegram_chat_id || '');
      setEnabled(Boolean(data.telegram_enabled));
      setHasToken(Boolean(data.has_telegram_token));
      setBotToken('');
      toast.success(t('profile.saved'));
    } catch (err: any) {
      toast.error(err.message || t('profile.saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const payload: Record<string, string> = {};
      if (botToken.trim()) payload.telegram_bot_token = botToken.trim();
      if (chatId.trim()) payload.telegram_chat_id = chatId.trim();

      const res = await fetch('/api/settings/telegram-test', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Telegram test failed');
      }
      toast.success(t('profile.testSuccess'));
    } catch (err: any) {
      toast.error(err.message || t('profile.testError'));
    } finally {
      setTesting(false);
    }
  }

  async function handleClearToken() {
    setClearModalOpen(false);
    setSaving(true);
    try {
      const res = await fetch('/api/settings/profile', {
        method: 'PATCH',
        headers: await authHeaders(),
        body: JSON.stringify({ clear_telegram_token: true }),
      });
      const data = (await res.json()) as ProfileResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to clear token');
      }
      setHasToken(false);
      setEnabled(false);
      setBotToken('');
      toast.success(t('profile.tokenCleared'));
    } catch (err: any) {
      toast.error(err.message || t('profile.saveError'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <ProfileSkeleton />;
  }

  const telegramReady = hasToken && Boolean(chatId.trim()) && enabled;

  return (
    <div className="p-4 sm:p-8 max-w-5xl space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            {t('profile.title')}
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">{t('profile.subtitle')}</p>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2.5 rounded-xl text-xs font-bold bg-honey-500 text-dark-950 hover:bg-honey-400 flex items-center gap-2 transition-all shadow-lg shadow-honey-500/20 disabled:opacity-50 self-start sm:self-auto"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {t('profile.save')}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-dark-900 border border-dark-800 p-5 rounded-2xl shadow-xl sm:col-span-2 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              {t('profile.identity')}
            </span>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase ${
                subscriptionStatus === 'trial'
                  ? 'text-honey-400 bg-honey-500/10 border-honey-500/20'
                  : subscriptionStatus === 'active'
                    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                    : 'text-rose-400 bg-rose-500/10 border-rose-500/20'
              }`}
            >
              {subscriptionStatus || t('common.trial')}
            </span>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <div className="p-3 rounded-xl border bg-honey-500/10 border-honey-500/30 text-honey-400">
              <User className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-black text-white tracking-wide truncate">
                {fullName || t('common.trader')}
              </p>
              <p className="text-xs text-slate-400 font-mono truncate flex items-center gap-1.5 mt-0.5">
                <Mail className="w-3 h-3 shrink-0" />
                {email}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-dark-900 border border-dark-800 p-5 rounded-2xl shadow-xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span className="font-bold uppercase tracking-wider">{t('profile.telegram')}</span>
            {telegramReady ? (
              <Bell className="w-4 h-4 text-honey-400" />
            ) : (
              <BellOff className="w-4 h-4 text-slate-500" />
            )}
          </div>
          <div className="mt-2">
            <p className="text-lg font-black text-white uppercase tracking-wide">
              {telegramReady ? t('profile.notificationsOn') : t('profile.notificationsOff')}
            </p>
            <p className="text-[11px] text-slate-400 font-mono mt-1">
              {hasToken ? t('profile.tokenConfigured') : t('profile.tokenMissing')}
            </p>
          </div>
        </div>
      </div>

      {/* Payment ID (external_uid) — required reference for OKX internal transfers */}
      <div className="bg-dark-900 border border-honey-500/30 rounded-2xl p-5 sm:p-6 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-honey-500/10 border border-honey-500/30 text-honey-400 shrink-0">
            <Hash className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              {t('profile.paymentId')}
            </p>
            <p className="text-2xl sm:text-3xl font-black text-honey-400 font-mono tracking-[0.35em] mt-1">
              {externalUid || '•••••••'}
            </p>
            <p className="text-[11px] text-slate-400 mt-1.5">{t('profile.paymentIdHint')}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleCopyUid}
          disabled={!externalUid}
          className="px-4 py-2.5 rounded-xl text-xs font-bold bg-honey-500 hover:bg-honey-400 text-dark-950 flex items-center gap-2 transition-all shadow-lg shadow-honey-500/20 disabled:opacity-40 self-start sm:self-auto shrink-0"
        >
          {uidCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {uidCopied ? t('profile.paymentIdCopied') : t('profile.copyPaymentId')}
        </button>
      </div>

      <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-dark-800 gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-dark-950 border border-dark-700 rounded-xl text-honey-400">
              <User className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-black text-white uppercase tracking-wider">
                  {t('profile.identity')}
                </h2>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{t('profile.displayName')}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              {t('profile.displayName')}
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full bg-dark-950 border border-dark-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-honey-500/50"
              placeholder={t('profile.displayNamePlaceholder')}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              {t('profile.email')}
            </label>
            <input
              type="email"
              value={email}
              disabled
              className="w-full bg-dark-950/60 border border-dark-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-400 font-mono cursor-not-allowed"
            />
          </div>
        </div>

        <div className="pt-2 border-t border-dark-800">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-dark-950 border border-dark-700 rounded-xl text-honey-400">
                <Bot className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-black text-white uppercase tracking-wider">
                    {t('profile.telegram')}
                  </h2>
                  {hasToken && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" />
                      {t('profile.tokenConfigured')}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">{t('profile.chatIdHint')}</p>
              </div>
            </div>

            {hasToken && (
              <button
                type="button"
                onClick={() => setClearModalOpen(true)}
                disabled={saving}
                className="px-3.5 py-2 text-xs font-semibold text-rose-400 hover:text-white bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-xl flex items-center gap-2 transition-all self-start sm:self-auto disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                {t('profile.clearToken')}
              </button>
            )}
          </div>

          <div className="bg-dark-950 border border-dark-800 rounded-xl p-3.5 flex items-center gap-3 mb-5">
            <ShieldCheck className="w-4 h-4 text-honey-400 shrink-0" />
            <p className="text-xs text-slate-400">{t('profile.telegramHelp')}</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                {t('profile.botToken')}
              </label>
              <input
                type="password"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                autoComplete="off"
                className="w-full bg-dark-950 border border-dark-700 rounded-xl px-3.5 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-honey-500/50"
                placeholder={
                  hasToken
                    ? t('profile.botTokenPlaceholderConfigured')
                    : t('profile.botTokenPlaceholder')
                }
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                {t('profile.chatId')}
              </label>
              <input
                type="text"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                className="w-full bg-dark-950 border border-dark-700 rounded-xl px-3.5 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-honey-500/50"
                placeholder={t('profile.chatIdPlaceholder')}
              />
            </div>

            <div
              className={`p-5 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                enabled
                  ? 'bg-honey-500/5 border-honey-500/30'
                  : 'bg-dark-950 border-dark-800'
              }`}
            >
              <div>
                <p className="text-sm font-bold text-white">{t('profile.enableNotifications')}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {enabled ? t('profile.notificationsOn') : t('profile.notificationsOff')}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                onClick={() => setEnabled((v) => !v)}
                className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border transition-colors ${
                  enabled
                    ? 'bg-honey-500 border-honey-400'
                    : 'bg-dark-800 border-dark-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow transition translate-y-0.5 ${
                    enabled ? 'translate-x-7' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={handleTest}
                disabled={testing || saving}
                className="px-4 py-2.5 rounded-xl text-xs font-bold bg-dark-950 border border-dark-700 hover:border-honey-500 text-slate-200 hover:text-white flex items-center gap-2 transition-all disabled:opacity-50"
              >
                {testing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-honey-400" />
                ) : (
                  <Send className="w-3.5 h-3.5 text-honey-400" />
                )}
                {t('profile.testConnection')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={clearModalOpen}
        title={t('profile.clearTokenTitle')}
        description={t('profile.clearTokenDescription')}
        confirmText={t('profile.clearToken')}
        isDestructive
        onConfirm={handleClearToken}
        onCancel={() => setClearModalOpen(false)}
      />
    </div>
  );
}
