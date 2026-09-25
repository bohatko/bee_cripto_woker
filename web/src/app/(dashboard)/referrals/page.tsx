'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Gift } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from '@/components/ui/sonner';
import { useLanguage } from '@/lib/i18n/LanguageContext';

type AttributionRow = {
  id: string;
  created_at: string;
  rewarded_at: string | null;
};

export default function ReferralsPage() {
  const { t, dateLocale } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [referralCode, setReferralCode] = useState('');
  const [rows, setRows] = useState<AttributionRow[]>([]);

  const referralLink = useMemo(() => {
    if (!referralCode || typeof window === 'undefined') return '';
    return `${window.location.origin}/register?ref=${referralCode}`;
  }, [referralCode]);

  const load = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setLoading(false);
      return;
    }

    const [profileResult, attributionResult] = await Promise.all([
      supabase.from('users_profile').select('referral_code').eq('id', userId).maybeSingle(),
      supabase
        .from('referral_attributions')
        .select('id, created_at, rewarded_at')
        .eq('inviter_user_id', userId)
        .order('created_at', { ascending: false }),
    ]);

    if (profileResult.error || attributionResult.error) {
      toast.error(profileResult.error?.message || attributionResult.error?.message || t('referrals.loadError'));
      setLoading(false);
      return;
    }

    setReferralCode(profileResult.data?.referral_code || '');
    setRows((attributionResult.data || []) as AttributionRow[]);
    setLoading(false);
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(value === referralCode ? t('referrals.codeCopied') : t('referrals.linkCopied'));
    } catch {
      toast.error(t('referrals.copyFailed'));
    }
  };

  const formatDate = (value: string) =>
    new Date(value).toLocaleDateString(dateLocale, { year: 'numeric', month: 'short', day: 'numeric' });

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center bg-dark-950 p-8">
        <p className="font-mono text-sm text-slate-400">{t('referrals.loading')}</p>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-dark-950 p-6 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-honey-500/30 bg-honey-500/10 text-honey-400">
            <Gift className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-white">{t('referrals.title')}</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">{t('referrals.subtitle')}</p>
          </div>
        </div>

        <section className="rounded-2xl border border-dark-800 bg-dark-900 p-5 shadow-xl sm:p-6">
          <h2 className="font-bold text-white">{t('referrals.codeTitle')}</h2>
          <p className="mt-1 text-xs text-slate-400">{t('referrals.codeHint')}</p>
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-dark-700 bg-dark-950 p-3">
            <code className="flex-1 truncate font-mono text-lg tracking-[0.18em] text-honey-400">
              {referralCode || '—'}
            </code>
            <button
              type="button"
              onClick={() => copy(referralCode)}
              disabled={!referralCode}
              className="rounded-lg border border-dark-700 p-2 text-slate-300 hover:text-honey-400 disabled:opacity-40"
              aria-label={t('referrals.copyCode')}
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-dark-700 bg-dark-950 p-3">
            <code className="flex-1 truncate font-mono text-xs text-slate-300">{referralLink || '—'}</code>
            <button
              type="button"
              onClick={() => copy(referralLink)}
              disabled={!referralLink}
              className="rounded-lg border border-dark-700 p-2 text-slate-300 hover:text-honey-400 disabled:opacity-40"
              aria-label={t('referrals.copyLink')}
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-dark-800 bg-dark-900 p-5 shadow-xl sm:p-6">
          <h2 className="font-bold text-white">{t('referrals.listTitle')}</h2>
          {rows.length === 0 ? (
            <p className="py-8 text-center font-mono text-sm text-slate-500">{t('referrals.empty')}</p>
          ) : (
            <table className="mt-4 w-full text-left text-sm">
              <thead className="border-b border-dark-800 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="pb-2 pr-3">{t('referrals.colDate')}</th>
                  <th className="pb-2">{t('referrals.colStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-dark-800/70">
                    <td className="py-3 pr-3 font-mono text-slate-400">{formatDate(row.created_at)}</td>
                    <td className="py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 font-mono text-[11px] ${
                          row.rewarded_at
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-honey-500/10 text-honey-400'
                        }`}
                      >
                        {row.rewarded_at ? t('referrals.rewarded') : t('referrals.waiting')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
