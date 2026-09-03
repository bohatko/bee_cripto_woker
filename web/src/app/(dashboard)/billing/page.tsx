'use client';

import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  CreditCard,
  Clock,
  Copy,
  Check,
  FileText,
  DollarSign,
  ShieldCheck,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { toast } from '@/components/ui/sonner';

export default function BillingPage() {
  const [profile, setProfile] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [selectedNetwork, setSelectedNetwork] = useState<'TRC20' | 'BEP20'>('TRC20');
  const [txHash, setTxHash] = useState('');
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);

  const walletAddresses = {
    TRC20: 'TJY4mFakeTRC20DepositWalletBeeWorkerXXXXXXXXXX',
    BEP20: '0x71C5FakeBEP20DepositWalletBeeWorkerXXXXXXXXXX',
  };

  async function loadBilling() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: prof } = await supabase
      .from('users_profile')
      .select('*')
      .eq('id', user.id)
      .single();

    if (prof) setProfile(prof);

    const { data: invs } = await supabase
      .from('invoices')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (invs) setInvoices(invs);
  }

  useEffect(() => {
    loadBilling();
  }, []);

  const activeInvoice = invoices.find((i) => ['issued', 'pending_review'].includes(i.status));

  const handleCopyWallet = () => {
    navigator.clipboard.writeText(walletAddresses[selectedNetwork]);
    setCopied(true);
    toast.success(`Deposit address (${selectedNetwork}) copied to clipboard!`);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmitPayment = async () => {
    if (!activeInvoice || !txHash) return;
    setSubmitting(true);
    setIsSubmitModalOpen(false);

    const { error } = await supabase
      .from('invoices')
      .update({
        tx_hash: txHash,
        payment_network: selectedNetwork,
        status: 'pending_review',
        user_notes: `Paid via ${selectedNetwork}`,
      })
      .eq('id', activeInvoice.id);

    setSubmitting(false);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Transaction submitted! Administrator will verify and update your subscription within 1 hour.');
      setTxHash('');
      loadBilling();
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
          Subscription & Invoices
        </h1>
        <p className="text-xs sm:text-sm text-slate-400 mt-1">
          7-day free trial, followed by $20/week + 10% performance fee on new net profits (High-Water Mark).
        </p>
      </div>

      {/* Subscription Summary Card */}
      <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs text-slate-400 uppercase font-medium">Subscription Status</span>
          <div className="flex items-center gap-3 mt-1">
            <span
              className={`text-lg font-bold uppercase font-mono px-2.5 py-0.5 rounded-lg ${
                profile?.subscription_status === 'trial'
                  ? 'bg-honey-500/15 text-honey-400 border border-honey-500/30'
                  : profile?.subscription_status === 'active'
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
              }`}
            >
              {profile?.subscription_status || 'Trial'}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              {profile?.subscription_status === 'trial'
                ? `Trial valid until ${new Date(profile?.trial_end_at || Date.now()).toLocaleDateString('en-US')}`
                : profile?.subscription_paid_until
                ? `Paid until ${new Date(profile.subscription_paid_until).toLocaleDateString('en-US')}`
                : 'Payment pending'}
            </span>
          </div>
        </div>

        <div className="text-right sm:border-l sm:border-dark-800 sm:pl-6">
          <span className="text-xs text-slate-400 uppercase font-medium">High-Water Mark</span>
          <p className="text-lg font-bold text-white font-mono mt-0.5">
            ${Number(profile?.high_water_mark_equity || 0).toFixed(2)} USDT
          </p>
        </div>
      </div>

      {/* Active Invoice & Payment Screen */}
      {activeInvoice ? (
        <div className="bg-dark-900 border border-honey-500/30 rounded-2xl p-6 sm:p-8 shadow-2xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-dark-800">
            <div>
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-honey-400" />
                <h2 className="text-lg font-bold text-white">
                  Invoice {activeInvoice.invoice_number}
                </h2>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Period: {new Date(activeInvoice.period_start).toLocaleDateString('en-US')} –{' '}
                {new Date(activeInvoice.period_end).toLocaleDateString('en-US')}
              </p>
            </div>

            <div className="text-right">
              <span className="text-xs text-slate-400">Total Due</span>
              <p className="text-3xl font-black text-honey-400 font-mono">
                ${Number(activeInvoice.total_amount_usd).toFixed(2)}{' '}
                <span className="text-sm font-normal text-slate-500">USDT</span>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-6">
            {/* Payment Details & QR Code */}
            <div className="flex flex-col items-center p-6 bg-dark-950 rounded-xl border border-dark-800 text-center">
              <span className="text-xs text-slate-400 mb-3 font-medium">
                Scan to pay {Number(activeInvoice.total_amount_usd).toFixed(2)} USDT
              </span>

              {/* QR Code */}
              <div className="p-3 bg-white rounded-xl shadow-lg">
                <QRCodeSVG
                  value={walletAddresses[selectedNetwork]}
                  size={160}
                  level="H"
                />
              </div>

              {/* Network Selector Tabs */}
              <div className="flex gap-2 mt-5">
                {(['TRC20', 'BEP20'] as const).map((net) => (
                  <button
                    key={net}
                    onClick={() => setSelectedNetwork(net)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition-colors ${
                      selectedNetwork === net
                        ? 'bg-honey-500 text-dark-950'
                        : 'bg-dark-850 text-slate-400 hover:text-white'
                    }`}
                  >
                    USDT {net}
                  </button>
                ))}
              </div>

              {/* Copy Address */}
              <div className="w-full mt-4 flex items-center gap-2 bg-dark-900 border border-dark-800 rounded-xl p-2.5">
                <span className="text-xs font-mono text-slate-300 truncate flex-1">
                  {walletAddresses[selectedNetwork]}
                </span>
                <button
                  onClick={handleCopyWallet}
                  className="p-1.5 hover:bg-dark-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submission Form */}
            <div className="space-y-5 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold text-white mb-2">Invoice Breakdown</h3>
                <div className="bg-dark-950 p-4 rounded-xl border border-dark-800 space-y-2 text-xs font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Weekly Fixed Platform Fee:</span>
                    <span className="text-white">${Number(activeInvoice.base_fee_usd).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Net Realized Profit in Period:</span>
                    <span className="text-emerald-400 font-semibold">
                      +${Number(activeInvoice.net_profit_in_period).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">10% Profit Success Fee:</span>
                    <span className="text-honey-400 font-semibold">
                      ${Number(activeInvoice.profit_fee_usd).toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="mt-5">
                  <label className="block text-xs font-medium text-slate-300 uppercase mb-1.5">
                    Enter Transaction Hash (TxID)
                  </label>
                  <input
                    type="text"
                    required
                    value={txHash}
                    onChange={(e) => setTxHash(e.target.value)}
                    placeholder="Paste your 64-character transaction hash here"
                    className="w-full px-4 py-2.5 bg-dark-950 border border-dark-700 rounded-xl text-white text-xs font-mono outline-none focus:border-honey-500 transition-colors"
                  />
                </div>
              </div>

              <button
                type="button"
                disabled={!txHash || submitting || activeInvoice.status === 'pending_review'}
                onClick={() => setIsSubmitModalOpen(true)}
                className="w-full py-3.5 rounded-xl font-bold text-sm bg-honey-500 hover:bg-honey-400 text-dark-950 shadow-lg shadow-honey-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {activeInvoice.status === 'pending_review'
                  ? 'Payment Under Admin Review'
                  : submitting
                  ? 'Submitting...'
                  : 'Submit Payment for Verification'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-8 text-center">
          <ShieldCheck className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
          <h3 className="text-base font-bold text-white">All Invoices Settled</h3>
          <p className="text-xs text-slate-400 mt-1">
            Your account is in good standing. Next invoice will generate at the end of your billing cycle.
          </p>
        </div>
      )}

      {/* Confirmation Modal */}
      <ConfirmModal
        isOpen={isSubmitModalOpen}
        title="Confirm Payment Submission"
        description={`Confirm sending TxID for ${selectedNetwork} payment of $${Number(activeInvoice?.total_amount_usd || 0).toFixed(2)} USDT?`}
        confirmText="Submit TxID"
        onConfirm={handleSubmitPayment}
        onCancel={() => setIsSubmitModalOpen(false)}
      />
    </div>
  );
}
