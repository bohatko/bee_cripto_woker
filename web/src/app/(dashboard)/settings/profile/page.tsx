'use client';

import React, { useEffect, useState } from 'react';
import { User, Bot, Save, Send, Trash2, ShieldCheck, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { toast } from '@/components/ui/sonner';
import { useLanguage } from '@/lib/i18n/LanguageContext';

interface ProfileResponse {
  full_name: string;
  email: string;
  telegram_chat_id: string;
  telegram_enabled: boolean;
  has_telegram_token: boolean;
}

export default function ProfileSettingsPage() {
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
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 gap-2">
        <Loader2 className="w-5 h-5 animate-spin text-honey-400" />
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">{t('profile.title')}</h1>
        <p className="text-sm text-slate-400 mt-1">{t('profile.subtitle')}</p>
      </div>

      <section className="bg-dark-900 border border-dark-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2 text-honey-400">
          <User className="w-4 h-4" />
          <h2 className="text-sm font-semibold uppercase tracking-wide">{t('profile.identity')}</h2>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1.5">{t('profile.displayName')}</label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full bg-dark-950 border border-dark-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-honey-500/50"
            placeholder={t('profile.displayNamePlaceholder')}
          />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1.5">{t('profile.email')}</label>
          <input
            type="email"
            value={email}
            disabled
            className="w-full bg-dark-950/60 border border-dark-800 rounded-xl px-3 py-2.5 text-sm text-slate-400 font-mono cursor-not-allowed"
          />
        </div>
      </section>

      <section className="bg-dark-900 border border-dark-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-honey-400">
            <Bot className="w-4 h-4" />
            <h2 className="text-sm font-semibold uppercase tracking-wide">
              {t('profile.telegram')}
            </h2>
          </div>
          {hasToken && (
            <span className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-lg">
              <ShieldCheck className="w-3 h-3" />
              {t('profile.tokenConfigured')}
            </span>
          )}
        </div>

        <p className="text-xs text-slate-500 leading-relaxed">{t('profile.telegramHelp')}</p>

        <div>
          <label className="block text-xs text-slate-400 mb-1.5">{t('profile.botToken')}</label>
          <input
            type="password"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            autoComplete="off"
            className="w-full bg-dark-950 border border-dark-700 rounded-xl px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-honey-500/50"
            placeholder={
              hasToken ? t('profile.botTokenPlaceholderConfigured') : t('profile.botTokenPlaceholder')
            }
          />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1.5">{t('profile.chatId')}</label>
          <input
            type="text"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            className="w-full bg-dark-950 border border-dark-700 rounded-xl px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-honey-500/50"
            placeholder={t('profile.chatIdPlaceholder')}
          />
          <p className="text-[11px] text-slate-500 mt-1.5">{t('profile.chatIdHint')}</p>
        </div>

        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="w-4 h-4 rounded border-dark-600 bg-dark-950 text-honey-500 focus:ring-honey-500/40"
          />
          <span className="text-sm text-slate-200">{t('profile.enableNotifications')}</span>
        </label>

        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || saving}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium border border-dark-700 bg-dark-950 text-slate-200 hover:border-honey-500/40 hover:text-honey-300 disabled:opacity-50"
          >
            {testing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {t('profile.testConnection')}
          </button>

          {hasToken && (
            <button
              type="button"
              onClick={() => setClearModalOpen(true)}
              disabled={saving}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium border border-rose-500/30 text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
              {t('profile.clearToken')}
            </button>
          )}
        </div>
      </section>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-honey-500 text-dark-950 hover:bg-honey-400 disabled:opacity-50 shadow-lg shadow-honey-500/20"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {t('profile.save')}
        </button>
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
