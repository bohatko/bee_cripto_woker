'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, RefreshCw, Send, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { toast } from '@/components/ui/sonner';

type AdminPayout = {
  id: string;
  user_id: string;
  amount_usd: number | string;
  payout_network: string;
  payout_address: string;
  status: 'requested' | 'approved' | 'rejected' | 'paid' | 'cancelled';
  tx_hash: string | null;
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
};

type PendingAction = {
  payout: AdminPayout;
  action: 'approved' | 'rejected' | 'paid';
};

const money = (value: number | string) => `$${Number(value).toFixed(2)}`;

export default function ReferralPayoutsAdminPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [payouts, setPayouts] = useState<AdminPayout[]>([]);
  const [txHashes, setTxHashes] = useState<Record<string, string>>({});
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const loadPayouts = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login');
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('users_profile')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      if (profileError) throw profileError;
      if (profile?.role !== 'admin') {
        router.replace('/dashboard');
        return;
      }

      const { data, error } = await supabase
        .from('referral_payout_requests')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setPayouts((data as AdminPayout[] | null) || []);
    } catch (error: any) {
      toast.error(error?.message || 'Unable to load referral payout requests.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPayouts();
  }, [router]);

  const beginAction = (payout: AdminPayout, action: PendingAction['action']) => {
    if (action === 'paid' && !txHashes[payout.id]?.trim()) {
      toast.error('Enter the on-chain transaction hash before marking this withdrawal paid.');
      return;
    }
    setPendingAction({ payout, action });
  };

  const confirmAction = async () => {
    if (!pendingAction) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('review_referral_withdrawal', {
        p_request_id: pendingAction.payout.id,
        p_action: pendingAction.action,
        p_tx_hash:
          pendingAction.action === 'paid' ? txHashes[pendingAction.payout.id]?.trim() || null : null,
        p_admin_note: null,
      });
      if (error) throw error;
      toast.success(
        pendingAction.action === 'approved'
          ? 'Withdrawal request approved.'
          : pendingAction.action === 'rejected'
          ? 'Withdrawal request rejected and funds released.'
          : 'Withdrawal marked paid.'
      );
      setPendingAction(null);
      await loadPayouts();
    } catch (error: any) {
      toast.error(error?.message || 'Unable to update withdrawal request.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-dark-950 text-slate-400 font-mono flex items-center justify-center">Loading referral payouts...</div>;
  }

  return (
    <div className="min-h-screen bg-dark-950 text-slate-100">
      <header className="border-b border-dark-800 bg-dark-900/90">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <Link href="/admin" className="flex items-center gap-2 text-xs font-semibold text-slate-300 hover:text-white">
            <ArrowLeft className="w-4 h-4" /> Back to administration
          </Link>
          <button
            type="button"
            onClick={loadPayouts}
            className="p-2 rounded-xl bg-dark-800 hover:bg-dark-700 text-slate-300 hover:text-white"
            aria-label="Refresh referral payouts"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 rounded-xl bg-honey-500/10 border border-honey-500/20 text-honey-400"><Send className="w-5 h-5" /></div>
          <div>
            <h1 className="text-2xl font-extrabold text-white">Referral payout requests</h1>
            <p className="text-sm text-slate-400 mt-1">Approve, reject, and record the on-chain payout transaction.</p>
          </div>
        </div>

        {payouts.length === 0 ? (
          <div className="rounded-2xl border border-dark-800 bg-dark-900 p-10 text-center text-sm font-mono text-slate-500">No referral payout requests.</div>
        ) : (
          <div className="rounded-2xl border border-dark-800 bg-dark-900 shadow-xl overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[850px]">
              <thead className="bg-dark-950/70 border-b border-dark-800 text-[10px] uppercase tracking-wider font-mono text-slate-500">
                <tr>
                  <th className="p-4">Requested</th>
                  <th className="p-4">User ID</th>
                  <th className="p-4">Amount</th>
                  <th className="p-4">Destination</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-800/70">
                {payouts.map((payout) => (
                  <tr key={payout.id} className="align-top">
                    <td className="p-4 font-mono text-slate-500 whitespace-nowrap">{new Date(payout.created_at).toLocaleString('en-US')}</td>
                    <td className="p-4 font-mono text-slate-400">{payout.user_id.slice(0, 8)}…</td>
                    <td className="p-4 font-mono font-bold text-honey-400 whitespace-nowrap">{money(payout.amount_usd)}</td>
                    <td className="p-4">
                      <p className="font-mono text-slate-300">{payout.payout_network}</p>
                      <p className="mt-1 max-w-64 truncate font-mono text-slate-500">{payout.payout_address}</p>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded-md uppercase text-[10px] font-bold ${payout.status === 'paid' ? 'bg-emerald-500/10 text-emerald-400' : payout.status === 'rejected' ? 'bg-rose-500/10 text-rose-400' : 'bg-honey-500/10 text-honey-400'}`}>{payout.status}</span>
                      {payout.tx_hash && <p className="mt-2 max-w-32 truncate font-mono text-[10px] text-slate-500">{payout.tx_hash}</p>}
                    </td>
                    <td className="p-4">
                      {payout.status === 'requested' && (
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => beginAction(payout, 'approved')} className="px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-dark-950 font-bold whitespace-nowrap"><CheckCircle2 className="inline w-3.5 h-3.5 mr-1" />Approve</button>
                          <button type="button" onClick={() => beginAction(payout, 'rejected')} className="px-3 py-2 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 font-bold whitespace-nowrap"><XCircle className="inline w-3.5 h-3.5 mr-1" />Reject</button>
                        </div>
                      )}
                      {payout.status === 'approved' && (
                        <div className="flex flex-col gap-2 min-w-60">
                          <input
                            type="text"
                            value={txHashes[payout.id] || ''}
                            onChange={(event) => setTxHashes((current) => ({ ...current, [payout.id]: event.target.value }))}
                            placeholder="Transaction hash"
                            className="w-full px-3 py-2 bg-dark-950 border border-dark-700 rounded-lg text-xs font-mono text-white outline-none focus:border-honey-500"
                          />
                          <button type="button" onClick={() => beginAction(payout, 'paid')} className="px-3 py-2 rounded-lg bg-honey-500 hover:bg-honey-400 text-dark-950 font-bold whitespace-nowrap">Mark paid</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      <ConfirmModal
        isOpen={pendingAction !== null}
        title={
          pendingAction?.action === 'approved'
            ? 'Approve withdrawal request'
            : pendingAction?.action === 'rejected'
            ? 'Reject withdrawal request'
            : 'Confirm on-chain payout'
        }
        description={
          pendingAction?.action === 'approved'
            ? `Approve ${money(pendingAction.payout.amount_usd)} for manual payment to ${pendingAction.payout.payout_address}?`
            : pendingAction?.action === 'rejected'
            ? `Reject ${money(pendingAction.payout.amount_usd)} and release the reserved balance back to the user?`
            : pendingAction
            ? `Mark ${money(pendingAction.payout.amount_usd)} as paid with transaction ${txHashes[pendingAction.payout.id] || '—'}?`
            : ''
        }
        confirmText={submitting ? 'Processing...' : pendingAction?.action === 'paid' ? 'Mark paid' : pendingAction?.action === 'approved' ? 'Approve' : 'Reject and release'}
        isDestructive={pendingAction?.action === 'rejected'}
        onConfirm={confirmAction}
        onCancel={() => !submitting && setPendingAction(null)}
      />
    </div>
  );
}
