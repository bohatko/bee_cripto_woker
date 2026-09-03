'use client';

import React, { useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';

interface PanicCloseModalProps {
  isOpen: boolean;
  unrealizedPnl: number;
  openPositionsCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export const PanicCloseModal: React.FC<PanicCloseModalProps> = ({
  isOpen,
  unrealizedPnl,
  openPositionsCount,
  onConfirm,
  onCancel,
}) => {
  const [confirmationInput, setConfirmationInput] = useState('');

  if (!isOpen) return null;

  const isConfirmed = confirmationInput.trim().toUpperCase() === 'CLOSE';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
      <div className="relative w-full max-w-lg bg-dark-900 border-2 border-rose-600/40 rounded-2xl p-6 shadow-2xl">
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 text-slate-400 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 bg-rose-500/15 text-rose-500 rounded-xl border border-rose-500/30">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white tracking-tight">
              EMERGENCY PANIC CLOSE
            </h3>
            <p className="text-xs text-rose-400 uppercase font-semibold">
              High Priority Liquidation
            </p>
          </div>
        </div>

        <div className="bg-dark-850 border border-dark-700/60 rounded-xl p-4 my-4 space-y-2 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Positions to Liquidate:</span>
            <span className="font-semibold text-white">{openPositionsCount} Pairs (Long/Short)</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Current Floating PnL:</span>
            <span
              className={`font-semibold ${
                unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {unrealizedPnl >= 0 ? `+$${unrealizedPnl.toFixed(2)}` : `-$${Math.abs(unrealizedPnl).toFixed(2)}`}
            </span>
          </div>
          <p className="text-xs text-slate-400 pt-2 border-t border-dark-700">
            This will immediately transmit Market Sell and Market Buy orders to your exchange, terminating all open basket legs.
          </p>
        </div>

        <div className="space-y-2 mb-6">
          <label className="text-xs font-medium text-slate-300">
            Type <span className="text-rose-400 font-bold">CLOSE</span> to confirm:
          </label>
          <input
            type="text"
            value={confirmationInput}
            onChange={(e) => setConfirmationInput(e.target.value)}
            placeholder="CLOSE"
            className="w-full px-4 py-2.5 bg-dark-950 border border-dark-700 focus:border-rose-500 rounded-xl text-white font-mono text-center tracking-widest outline-none transition-colors"
          />
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            onClick={() => {
              setConfirmationInput('');
              onCancel();
            }}
            className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-dark-800 hover:bg-dark-700 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!isConfirmed}
            onClick={() => {
              setConfirmationInput('');
              onConfirm();
            }}
            className={`px-5 py-2.5 text-sm font-bold rounded-xl transition-all ${
              isConfirmed
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/50 cursor-pointer'
                : 'bg-dark-800 text-slate-600 border border-dark-700 cursor-not-allowed'
            }`}
          >
            Liquidate All Positions
          </button>
        </div>
      </div>
    </div>
  );
};
