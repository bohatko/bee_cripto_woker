'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Lock, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from '@/components/ui/sonner';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { LanguageSwitcher } from '@/lib/i18n/LanguageSwitcher';

export default function UpdatePasswordPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function ensureRecoverySession() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!cancelled) {
        if (!session) {
          toast.error(t('auth.resetLinkInvalid'));
          router.replace('/login');
          return;
        }
        setCheckingSession(false);
      }
    }

    void ensureRecoverySession();

    return () => {
      cancelled = true;
    };
  }, [router, t]);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (password.length < 6) {
      setErrorMsg(t('auth.passwordTooShort'));
      toast.error(t('auth.passwordTooShort'));
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg(t('auth.passwordMismatch'));
      toast.error(t('auth.passwordMismatch'));
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setErrorMsg(error.message);
      toast.error(error.message);
      setLoading(false);
      return;
    }

    toast.success(t('auth.passwordUpdatedSuccess'));
    router.replace('/dashboard');
    router.refresh();
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-dark-950 flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-honey-400" />
        <p className="text-sm text-slate-400">{t('auth.verifyingResetLink')}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative">
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6">
        <LanguageSwitcher variant="compact" />
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <Link href="/" className="inline-flex items-center gap-2 mb-4">
          <div className="w-10 h-10 rounded-xl bg-honey-500/10 border border-honey-500/30 flex items-center justify-center text-honey-500 font-bold text-2xl">
            🐝
          </div>
          <span className="font-extrabold text-xl text-white tracking-tight">
            CRYPTO <span className="text-honey-400">BEE</span>
          </span>
        </Link>
        <h2 className="text-2xl font-bold text-white tracking-tight">{t('auth.updatePasswordTitle')}</h2>
        <p className="mt-2 text-sm text-slate-400">{t('auth.updatePasswordHint')}</p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-dark-900 border border-dark-800 py-8 px-6 shadow-2xl rounded-2xl sm:px-10">
          {errorMsg && (
            <div className="mb-5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-mono">
              {errorMsg}
            </div>
          )}

          <form className="space-y-5" onSubmit={handleUpdatePassword}>
            <div>
              <label className="block text-xs font-medium text-slate-300 uppercase mb-1.5">
                {t('auth.newPassword')}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Lock className="h-4 w-4" />
                </div>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('auth.passwordHint')}
                  className="w-full pl-10 pr-4 py-2.5 bg-dark-950 border border-dark-700 rounded-xl text-white text-sm outline-none focus:border-honey-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 uppercase mb-1.5">
                {t('auth.confirmPassword')}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Lock className="h-4 w-4" />
                </div>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-4 py-2.5 bg-dark-950 border border-dark-700 rounded-xl text-white text-sm outline-none focus:border-honey-500 transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl font-bold text-sm bg-honey-500 hover:bg-honey-400 text-dark-950 shadow-lg shadow-honey-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {loading ? t('auth.updatingPassword') : t('auth.saveNewPassword')}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
