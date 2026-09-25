'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { ArrowRight, Lock, Mail, User, CheckCircle2, Send } from 'lucide-react';
import { SUPPORT_TELEGRAM_URL } from '@/lib/support';
import { toast } from '@/components/ui/sonner';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { LanguageSwitcher } from '@/lib/i18n/LanguageSwitcher';

export default function RegisterPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref') || '';
    const normalized = ref.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    if (normalized.length === 10) setReferralCode(normalized);
  }, []);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          ...(referralCode.length === 10 ? { referral_code: referralCode } : {}),
        },
      },
    });

    if (error) {
      setErrorMsg(error.message);
      toast.error(error.message);
      setLoading(false);
    } else {
      toast.success(t('auth.registrationSuccess'));
      router.push('/dashboard');
    }
  };

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
        <h2 className="text-2xl font-bold text-white tracking-tight">{t('auth.createAccountTitle')}</h2>
        <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-honey-500/10 border border-honey-500/20 text-xs font-mono text-honey-400">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>{t('auth.trialBadge')}</span>
        </div>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-dark-900 border border-dark-800 py-8 px-6 shadow-2xl rounded-2xl sm:px-10">
          {errorMsg && (
            <div className="mb-5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-mono">
              {errorMsg}
            </div>
          )}

          <form className="space-y-4" onSubmit={handleRegister}>
            <div>
              <label className="block text-xs font-medium text-slate-300 uppercase mb-1.5">
                {t('auth.fullName')}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <User className="h-4 w-4" />
                </div>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Alexander Trader"
                  className="w-full pl-10 pr-4 py-2.5 bg-dark-950 border border-dark-700 rounded-xl text-white text-sm outline-none focus:border-honey-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 uppercase mb-1.5">
                {t('auth.email')}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Mail className="h-4 w-4" />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="trader@example.com"
                  className="w-full pl-10 pr-4 py-2.5 bg-dark-950 border border-dark-700 rounded-xl text-white text-sm outline-none focus:border-honey-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 uppercase mb-1.5">
                {t('auth.password')}
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
                {t('auth.referralLabel')}
              </label>
              <input
                type="text"
                value={referralCode}
                maxLength={10}
                onChange={(e) =>
                  setReferralCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))
                }
                placeholder="ABC123XYZ0"
                className="w-full px-4 py-2.5 bg-dark-950 border border-dark-700 rounded-xl text-white font-mono text-sm tracking-wider outline-none focus:border-honey-500 transition-colors"
              />
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{t('auth.referralHint')}</p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3 px-4 rounded-xl font-bold text-sm bg-honey-500 hover:bg-honey-400 text-dark-950 shadow-lg shadow-honey-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {loading ? t('auth.settingUpTrial') : t('auth.createAccount')}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-slate-400">
            {t('auth.alreadyRegistered')}{' '}
            <Link href="/login" className="font-semibold text-honey-400 hover:text-honey-300">
              {t('auth.signIn')}
            </Link>
          </p>
          <a
            href={SUPPORT_TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex items-center justify-center gap-1.5 text-xs font-medium text-slate-400 hover:text-honey-300"
          >
            <Send className="h-3.5 w-3.5" />
            {t('auth.support')}
          </a>
        </div>
      </div>
    </div>
  );
}
