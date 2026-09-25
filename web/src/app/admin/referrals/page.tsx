'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { toast } from '@/components/ui/sonner';
import { useLanguage } from '@/lib/i18n/LanguageContext';

type PayoutRow = {
  id: string;
  amount_usd: number;
  network: string;
  wallet_address: string;
  status: 'requested' | 'paid' | 'rejected';
  created_at: string;
  users_profile: { full_name: string | null; email: string | null } | null;
};

export default function AdminReferralPayoutsPage() {
  const router = useRouter();
  const { t, dateLocale } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [pending, setPending] = useState<{ id: string; status: 'paid' | 'rejected'; name: string; amount: string; network: string } | null>(null);

  const load = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      router.replace('/login');
      return;
    }

    const { data: profile } = await supabase
      .from('users_profile')
      .select('role')
      .eq('id', userData.user.id)
      .single();

    if (profile?.role !== 'admin') {
      router.replace('/dashboard');
      return;
    }

    const { data, error } = await supabase
      .from('referral_withdrawal_requests')
      .select('id, amount_usd, network, wallet_address, status, created_at, users_profile:users_profile!referral_withdrawal_requests_user_id_fkey(full_name, email)')
      .order('created_at', { ascending: false });

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    setRows((data || []) as unknown as PayoutRow[]);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const formatUsd = (value: number) =>
    `$${Number(value || 0).toLocaleString(dateLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const review = async () => {
    if (!pending) return;
    const { error } = await supabase.rpc('review_referral_withdrawal', {
      p_id: pending.id,
      p_status: pending.status,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t('referrals.reviewSaved'));
    setPending(null);
    await load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <p className="font-mono text-sm">{t('referrals.loading')}</p>
      </div>
    );
  }

  return (
    <div className="p-4 text-slate-100 sm:p-8">
      <div className="max-w-5xl">
        <h1 className="text-2xl font-extrabold text-white">{t('referrals.adminTitle')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">{t('referrals.adminSubtitle')}</p>

        {rows.length === 0 ? (
          <p className="py-10 font-mono text-sm text-slate-500">{t('referrals.adminEmpty')}</p>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-2xl border border-dark-800 bg-dark-900">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-dark-800 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">{t('referrals.colPartner')}</th>
                  <th className="px-4 py-3">{t('referrals.colAmount')}</th>
                  <th className="px-4 py-3">{t('referrals.colNetwork')}</th>
                  <th className="px-4 py-3">{t('referrals.colAddress')}</th>
                  <th className="px-4 py-3">{t('referrals.colStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const name = row.users_profile?.full_name || row.users_profile?.email || 'Trader';
                  return (
                    <tr key={row.id} className="border-b border-dark-800/70">
                      <td className="px-4 py-3">
                        <p className="text-slate-100">{name}</p>
                        <p className="font-mono text-[11px] text-slate-500">{row.users_profile?.email}</p>
                      </td>
                      <td className="px-4 py-3 font-mono">{formatUsd(Number(row.amount_usd))}</td>
                      <td className="px-4 py-3 font-mono">{row.network}</td>
                      <td className="max-w-[220px] truncate px-4 py-3 font-mono text-xs text-slate-300">{row.wallet_address}</td>
                      <td className="px-4 py-3">
                        {row.status === 'requested' ? (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setPending({
                                  id: row.id,
                                  status: 'paid',
                                  name,
                                  amount: formatUsd(Number(row.amount_usd)),
                                  network: row.network,
                                })
                              }
                              className="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs font-bold text-emerald-400"
                            >
                              {t('referrals.markPaid')}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setPending({
                                  id: row.id,
                                  status: 'rejected',
                                  name,
                                  amount: formatUsd(Number(row.amount_usd)),
                                  network: row.network,
                                })
                              }
                              className="rounded-lg bg-rose-500/15 px-2.5 py-1 text-xs font-bold text-rose-400"
                            >
                              {t('referrals.rejectRequest')}
                            </button>
                          </div>
                        ) : (
                          <span className="font-mono text-[11px] text-slate-400">
                            {row.status === 'paid' ? t('referrals.statusPaid') : t('referrals.statusRejected')}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={Boolean(pending)}
        title={pending?.status === 'paid' ? t('referrals.confirmPaidTitle') : t('referrals.confirmRejectTitle')}
        description={
          pending?.status === 'paid'
            ? t('referrals.confirmPaidDesc', {
                amount: pending.amount,
                network: pending.network,
                name: pending.name,
              })
            : t('referrals.confirmRejectDesc', {
                amount: pending?.amount || '',
                name: pending?.name || '',
              })
        }
        isDestructive={pending?.status === 'rejected'}
        onConfirm={review}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
