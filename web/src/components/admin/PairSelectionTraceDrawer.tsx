'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { X, Terminal, Loader2, CheckCircle2, XCircle, Clock3, Activity, Square } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface PairSelectionProgressStep {
  at: string;
  stage: string;
  message: string;
  detail?: Record<string, unknown>;
}

export interface PairSelectionRunTrace {
  id: string;
  status: string;
  trigger_source: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  universe_size: number | null;
  applied: boolean | null;
  error: string | null;
  progress_log?: PairSelectionProgressStep[] | null;
  replacements?: unknown;
  candidates?: unknown;
}

interface PairSelectionTraceDrawerProps {
  isOpen: boolean;
  run: PairSelectionRunTrace | null;
  onClose: () => void;
  onStop?: () => void;
}

function statusTone(status: string) {
  switch (status) {
    case 'completed':
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    case 'failed':
      return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
    case 'cancelled':
      return 'bg-slate-500/15 text-slate-300 border-slate-500/30';
    case 'running':
      return 'bg-amber-500/20 text-amber-400 border-amber-500/40 animate-pulse';
    case 'pending':
      return 'bg-slate-500/15 text-slate-300 border-slate-500/30';
    default:
      return 'bg-dark-800 text-slate-400 border-dark-700';
  }
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle2 className="w-4 h-4" />;
  if (status === 'failed' || status === 'cancelled') return <XCircle className="w-4 h-4" />;
  if (status === 'running') return <Loader2 className="w-4 h-4 animate-spin" />;
  return <Clock3 className="w-4 h-4" />;
}

export function PairSelectionTraceDrawer({ isOpen, run, onClose, onStop }: PairSelectionTraceDrawerProps) {
  const { t, formatDateTime } = useLanguage();
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const steps = useMemo(() => {
    if (!run) return [] as PairSelectionProgressStep[];
    return Array.isArray(run.progress_log) ? run.progress_log : [];
  }, [run]);

  useEffect(() => {
    if (!isOpen) return;
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [isOpen, steps.length, run?.status]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen || !run) return null;

  const isLive = run.status === 'pending' || run.status === 'running';
  const topCandidates = Array.isArray(run.candidates) ? run.candidates.slice(0, 8) : [];
  const replacements = Array.isArray(run.replacements) ? run.replacements : [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label={t('common.cancel')}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      <aside className="relative h-full w-full max-w-xl bg-dark-950 border-l border-dark-800 shadow-2xl flex flex-col animate-fadeIn">
        <header className="px-5 py-4 border-b border-dark-800 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-honey-400 shrink-0" />
              <h2 className="text-base font-bold text-white truncate">{t('admin.traceTitle')}</h2>
            </div>
            <p className="text-[11px] text-slate-500 mt-1 font-mono truncate">
              {t('admin.traceRunId')}: {run.id}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-dark-900 hover:bg-dark-800 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="px-5 py-4 border-b border-dark-800 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold uppercase border ${statusTone(
                run.status
              )}`}
            >
              <StatusIcon status={run.status} />
              {run.status}
            </span>
            <span className="px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold uppercase bg-dark-900 border border-dark-800 text-slate-400">
              {run.trigger_source}
            </span>
            {isLive && (
              <span className="inline-flex items-center gap-1 text-[10px] font-mono text-amber-400">
                <Activity className="w-3 h-3" />
                {t('admin.traceLive')}
              </span>
            )}
            {onStop && isLive && (
              <button
                type="button"
                onClick={onStop}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold uppercase border border-rose-500/40 bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 transition-colors"
              >
                <Square className="w-3 h-3 fill-current" />
                {t('admin.stopRun')}
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
            <div className="bg-dark-900 border border-dark-800 rounded-xl px-3 py-2">
              <div className="text-slate-500">{t('admin.colCreated')}</div>
              <div className="text-slate-200 mt-0.5">{formatDateTime(run.created_at)}</div>
            </div>
            <div className="bg-dark-900 border border-dark-800 rounded-xl px-3 py-2">
              <div className="text-slate-500">{t('admin.traceStarted')}</div>
              <div className="text-slate-200 mt-0.5">
                {run.started_at ? formatDateTime(run.started_at) : '—'}
              </div>
            </div>
            <div className="bg-dark-900 border border-dark-800 rounded-xl px-3 py-2">
              <div className="text-slate-500">{t('admin.colUniverse')}</div>
              <div className="text-slate-200 mt-0.5">{run.universe_size ?? '—'}</div>
            </div>
            <div className="bg-dark-900 border border-dark-800 rounded-xl px-3 py-2">
              <div className="text-slate-500">{t('admin.colApplied')}</div>
              <div className="text-slate-200 mt-0.5">
                {run.applied ? t('admin.appliedYes') : t('admin.appliedNo')}
              </div>
            </div>
          </div>

          {run.status === 'pending' && steps.length === 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200 leading-relaxed">
              {t('admin.traceWaitingWorker')}
            </div>
          )}

          {run.error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300 font-mono break-words">
              {run.error}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
              {t('admin.traceTimeline')}
            </h3>

            {steps.length === 0 ? (
              <div className="rounded-xl border border-dashed border-dark-700 bg-dark-900/50 px-4 py-8 text-center text-xs text-slate-500 font-mono">
                {t('admin.traceNoSteps')}
              </div>
            ) : (
              <ol className="relative space-y-3 border-l border-dark-800 ml-2 pl-4">
                {steps.map((step, idx) => (
                  <li key={`${step.at}-${step.stage}-${idx}`} className="relative">
                    <span className="absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full bg-honey-500 shadow-[0_0_0_3px_rgba(245,158,11,0.15)]" />
                    <div className="bg-dark-900 border border-dark-800 rounded-xl px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-mono font-bold uppercase text-honey-400">
                          {step.stage}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500 shrink-0">
                          {formatDateTime(step.at)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-200 mt-1 leading-relaxed">{step.message}</p>
                      {step.detail && Object.keys(step.detail).length > 0 && (
                        <pre className="mt-2 text-[10px] font-mono text-slate-500 whitespace-pre-wrap break-words bg-dark-950/70 border border-dark-850 rounded-lg p-2 max-h-40 overflow-auto">
                          {JSON.stringify(step.detail, null, 2)}
                        </pre>
                      )}
                    </div>
                  </li>
                ))}
                <div ref={logEndRef} />
              </ol>
            )}
          </section>

          {replacements.length > 0 && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                {t('admin.colReplacements')}
              </h3>
              <pre className="text-[10px] font-mono text-slate-400 bg-dark-900 border border-dark-800 rounded-xl p-3 overflow-auto max-h-40">
                {JSON.stringify(replacements, null, 2)}
              </pre>
            </section>
          )}

          {topCandidates.length > 0 && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                {t('admin.topCandidates', { count: topCandidates.length })}
              </h3>
              <div className="overflow-x-auto rounded-xl border border-dark-800">
                <table className="w-full text-left text-[11px] font-mono">
                  <thead className="bg-dark-900 text-slate-500 uppercase">
                    <tr>
                      <th className="px-3 py-2">{t('admin.candColPair')}</th>
                      <th className="px-3 py-2">{t('admin.candColScore')}</th>
                      <th className="px-3 py-2">{t('common.status')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-800">
                    {topCandidates.map((c: any, i: number) => (
                      <tr key={`${c.pair_symbol || i}`} className="bg-dark-950/40">
                        <td className="px-3 py-2 text-white">{c.pair_symbol || '—'}</td>
                        <td className="px-3 py-2 text-honey-400">
                          {c.score === null || c.score === undefined ? '—' : Number(c.score).toFixed(3)}
                        </td>
                        <td className="px-3 py-2">
                          {c.valid ? (
                            <span className="text-emerald-400">valid</span>
                          ) : (
                            <span className="text-slate-500">rejected</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
