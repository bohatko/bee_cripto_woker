'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { TrendingUp, Wallet, ArrowUpRight, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { resolveRealizedPnl } from '@/lib/positions';

interface EquityPoint {
  index: number;
  date: string;
  fullDate: string;
  equity: number;
  tradePnl: number;
  pair?: string;
  exitReason?: string;
  showLabel?: boolean;
  labelFormatted?: string;
}

interface EquityGrowthChartProps {
  positions: any[];
  startingBalance?: number;
  mode?: 'equity' | 'pnl';
  title?: string;
  subtitle?: string;
  isMaster?: boolean;
  emptyMessage?: string;
}

export function EquityGrowthChart({
  positions,
  startingBalance = 0,
  mode = 'equity',
  title,
  subtitle,
  isMaster = false,
  emptyMessage,
}: EquityGrowthChartProps) {
  const { t, dateLocale, formatDate } = useLanguage();
  const [mounted, setMounted] = useState(false);

  const isPnlMode = mode === 'pnl';

  useEffect(() => {
    setMounted(true);
  }, []);

  const chartData = useMemo<EquityPoint[]>(() => {
    if (!positions || positions.length === 0) return [];

    // Chronological order (oldest to newest)
    const sorted = [...positions].sort(
      (a, b) =>
        new Date(a.closed_at || a.opened_at).getTime() -
        new Date(b.closed_at || b.opened_at).getTime()
    );

    // In PnL mode: strictly tracks cumulative realized PnL starting from 0.
    // In Equity mode: starts from startingBalance ($50k for master).
    let runningVal = isPnlMode ? 0 : startingBalance > 0 ? startingBalance : 0;
    const points: EquityPoint[] = [];

    // Initial starting point before first trade closed
    const firstTradeDate = new Date(sorted[0].opened_at || sorted[0].closed_at);
    points.push({
      index: 0,
      date: formatDate(firstTradeDate),
      fullDate: firstTradeDate.toLocaleString(dateLocale),
      equity: Math.round(runningVal * 100) / 100,
      tradePnl: 0,
      pair: 'START',
      showLabel: true,
      labelFormatted: formatCompactValue(runningVal, isPnlMode),
    });

    let peakVal = runningVal;
    let peakIndex = 0;

    sorted.forEach((pos, idx) => {
      const { pnlUsd } = resolveRealizedPnl(pos);
      runningVal += pnlUsd;
      const closedDate = new Date(pos.closed_at || pos.opened_at);

      if (runningVal > peakVal) {
        peakVal = runningVal;
        peakIndex = idx + 1;
      }

      points.push({
        index: idx + 1,
        date: formatDate(closedDate),
        fullDate: closedDate.toLocaleString(dateLocale),
        equity: Math.round(runningVal * 100) / 100,
        tradePnl: pnlUsd,
        pair: pos.pair_symbol,
        exitReason: pos.exit_reason,
      });
    });

    // Determine milestone points for numeric labels above the curve
    const totalPoints = points.length;
    const targetMilestones = Math.min(14, Math.max(6, Math.floor(totalPoints / 6)));
    const step = Math.max(1, Math.floor(totalPoints / targetMilestones));

    points.forEach((pt, i) => {
      if (
        i === 0 ||
        i === totalPoints - 1 ||
        i === peakIndex ||
        (i % step === 0 && i !== totalPoints - 1)
      ) {
        pt.showLabel = true;
        pt.labelFormatted = formatCompactValue(pt.equity, isPnlMode);
      }
    });

    return points;
  }, [positions, startingBalance, isPnlMode, dateLocale, formatDate]);

  const summary = useMemo(() => {
    if (chartData.length === 0) {
      return {
        start: 0,
        current: 0,
        peak: 0,
        gainUsd: 0,
        gainPct: 0,
        totalTrades: 0,
        winrate: '0.0',
      };
    }
    const start = chartData[0].equity;
    const current = chartData[chartData.length - 1].equity;
    const peak = Math.max(...chartData.map((d) => d.equity));
    const gainUsd = current - start;
    const gainPct = start > 0 ? (gainUsd / start) * 100 : 0;

    const wins = positions.filter((p) => resolveRealizedPnl(p).pnlUsd > 0).length;
    const winrate =
      positions.length > 0 ? ((wins / positions.length) * 100).toFixed(1) : '0.0';

    return {
      start,
      current,
      peak,
      gainUsd,
      gainPct,
      totalTrades: positions.length,
      winrate,
    };
  }, [chartData, positions]);

  // Custom dot showing values above curve points (matching screenshot)
  const renderCustomDot = (props: any): React.ReactElement<SVGElement> => {
    const { cx, cy, payload, index } = props;
    if (!payload?.showLabel || cx == null || cy == null) {
      return <g key={`dot-empty-${payload?.index ?? index}`} />;
    }

    const isPositive = payload.equity >= 0;

    return (
      <g key={`dot-${payload.index}`}>
        <circle
          cx={cx}
          cy={cy}
          r={3.5}
          fill={isPositive ? '#10B981' : '#F43F5E'}
          stroke="#042F2E"
          strokeWidth={1.5}
        />
        <text
          x={cx}
          y={cy - 9}
          fill={isPositive ? '#34D399' : '#FB7185'}
          fontSize={10}
          fontWeight="700"
          textAnchor="middle"
          fontFamily="monospace"
        >
          {payload.labelFormatted}
        </text>
      </g>
    );
  };

  // Neo-Fintech Dark Tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;
    const data: EquityPoint = payload[0].payload;

    return (
      <div className="bg-dark-950/95 border border-dark-700/80 rounded-xl p-3 shadow-2xl backdrop-blur-md font-mono text-xs z-50 min-w-[190px]">
        <div className="flex items-center justify-between border-b border-dark-800 pb-1.5 mb-2 text-slate-400">
          <span>{data.fullDate || data.date}</span>
          {data.pair && data.pair !== 'START' && (
            <span className="font-bold text-white bg-dark-800 px-1.5 py-0.5 rounded text-[10px]">
              {data.pair}
            </span>
          )}
        </div>
        <div className="space-y-1">
          <div className="flex justify-between items-center gap-3">
            <span className="text-slate-400">
              {isPnlMode
                ? t('history.chartTooltipCumulativePnl')
                : t('history.chartTooltipEquity')}
              :
            </span>
            <span
              className={`font-bold text-sm ${
                data.equity >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {isPnlMode && data.equity > 0 ? '+' : ''}
              ${data.equity.toLocaleString(dateLocale, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
          {data.tradePnl !== 0 && (
            <div className="flex justify-between items-center gap-3">
              <span className="text-slate-400">{t('history.chartTooltipPnl')}:</span>
              <span
                className={`font-bold ${
                  data.tradePnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {data.tradePnl >= 0 ? '+' : ''}${data.tradePnl.toFixed(2)}
              </span>
            </div>
          )}
          {data.exitReason && (
            <div className="flex justify-between items-center gap-3 text-[10px] pt-0.5">
              <span className="text-slate-500">Exit:</span>
              <span className="uppercase text-honey-400 font-bold">{data.exitReason}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const isNetPositive = summary.current >= 0;
  const gradientId = `equityGrad-${isMaster ? 'bot' : isPnlMode ? 'user-pnl' : 'user'}`;

  return (
    <div className="bg-dark-900 border border-dark-800 rounded-2xl p-4 sm:p-6 shadow-xl relative overflow-hidden">
      {/* Background Glow */}
      <div
        className={`absolute top-0 right-1/4 w-80 h-32 blur-3xl rounded-full pointer-events-none ${
          isNetPositive ? 'bg-emerald-500/5' : 'bg-rose-500/5'
        }`}
      />

      {/* Top Header of Chart */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-lg border flex items-center justify-center font-bold ${
                isNetPositive
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                  : 'bg-rose-500/15 border-rose-500/30 text-rose-400'
              }`}
            >
              <TrendingUp className="w-4 h-4" />
            </div>
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              {title ||
                (isPnlMode ? t('history.pnlGrowthTitle') : t('history.equityGrowthTitle'))}
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold uppercase tracking-wider">
                {isMaster ? 'Master $50k' : isPnlMode ? 'Live Trades PnL' : 'Live Account'}
              </span>
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {subtitle ||
              (isMaster
                ? t('history.botEquitySubtitle')
                : isPnlMode
                ? t('history.userPnlSubtitle')
                : t('history.userEquitySubtitle'))}
          </p>
        </div>

        {/* Quick Stats Pill */}
        {chartData.length > 0 && (
          <div className="flex flex-wrap items-center gap-2.5 font-mono text-xs">
            {isPnlMode ? (
              <>
                <div className="bg-dark-950/80 border border-dark-800 px-3 py-1.5 rounded-xl">
                  <span className="text-slate-500 text-[10px] block">
                    {t('history.chartTradesCount')}
                  </span>
                  <span className="font-bold text-slate-300">{summary.totalTrades}</span>
                </div>

                <div className="bg-dark-950/80 border border-dark-800 px-3 py-1.5 rounded-xl">
                  <span className="text-slate-500 text-[10px] block">
                    {t('history.chartPeakPnl')}
                  </span>
                  <span className="font-bold text-amber-400">
                    {summary.peak > 0 ? '+' : ''}${summary.peak.toFixed(2)}
                  </span>
                </div>

                <div className="bg-dark-950/80 border border-emerald-500/30 px-3 py-1.5 rounded-xl">
                  <span className="text-slate-500 text-[10px] block">
                    {t('history.chartCurrentPnl')}
                  </span>
                  <span
                    className={`font-bold ${
                      summary.current >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {summary.current > 0 ? '+' : ''}${summary.current.toFixed(2)}
                  </span>
                </div>

                <div className="bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-xl flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="font-black text-emerald-400">{summary.winrate}%</span>
                </div>
              </>
            ) : (
              <>
                <div className="bg-dark-950/80 border border-dark-800 px-3 py-1.5 rounded-xl">
                  <span className="text-slate-500 text-[10px] block">
                    {t('history.chartStartCapital')}
                  </span>
                  <span className="font-bold text-slate-300">
                    ${summary.start.toLocaleString(dateLocale, { maximumFractionDigits: 0 })}
                  </span>
                </div>

                <div className="bg-dark-950/80 border border-dark-800 px-3 py-1.5 rounded-xl">
                  <span className="text-slate-500 text-[10px] block">
                    {t('history.chartPeakCapital')}
                  </span>
                  <span className="font-bold text-amber-400">
                    ${summary.peak.toLocaleString(dateLocale, { maximumFractionDigits: 0 })}
                  </span>
                </div>

                <div className="bg-dark-950/80 border border-emerald-500/30 px-3 py-1.5 rounded-xl">
                  <span className="text-slate-500 text-[10px] block">
                    {t('history.chartCurrentCapital')}
                  </span>
                  <span className="font-bold text-emerald-400">
                    ${summary.current.toLocaleString(dateLocale, { maximumFractionDigits: 0 })}
                  </span>
                </div>

                <div className="bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-xl flex items-center gap-1">
                  <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="font-black text-emerald-400">
                    {summary.gainPct >= 0 ? '+' : ''}
                    {summary.gainPct.toLocaleString(dateLocale, { maximumFractionDigits: 1 })}%
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Main Chart Area */}
      {!mounted ? (
        <div className="h-[280px] w-full flex items-center justify-center bg-dark-950/50 rounded-xl border border-dark-800 animate-pulse font-mono text-xs text-slate-500">
          {t('history.loading')}
        </div>
      ) : chartData.length === 0 ? (
        <div className="h-[200px] w-full flex flex-col items-center justify-center bg-dark-950/50 rounded-xl border border-dark-800 font-mono text-xs text-slate-500 p-6 text-center">
          <Wallet className="w-8 h-8 text-slate-600 mb-2" />
          <p>{emptyMessage || t('history.chartNoData')}</p>
        </div>
      ) : (
        <div className="h-[280px] sm:h-[300px] w-full pt-4">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 22, right: 16, left: 10, bottom: 20 }}
            >
              <defs>
                {/* Emerald-to-Deep-Navy gradient as seen in sample photo */}
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor={isNetPositive ? '#10B981' : '#F43F5E'}
                    stopOpacity={0.88}
                  />
                  <stop
                    offset="28%"
                    stopColor={isNetPositive ? '#059669' : '#E11D48'}
                    stopOpacity={0.65}
                  />
                  <stop offset="60%" stopColor="#0e7490" stopOpacity={0.4} />
                  <stop offset="85%" stopColor="#075985" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#082f49" stopOpacity={0.08} />
                </linearGradient>
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#1e293b"
                vertical={false}
                opacity={0.5}
              />

              <XAxis
                dataKey="date"
                stroke="#64748b"
                fontSize={10}
                fontFamily="monospace"
                tickLine={false}
                interval={Math.max(1, Math.floor(chartData.length / 10))}
                angle={-45}
                textAnchor="end"
                height={50}
                tick={{ fill: '#64748b' }}
              />

              <YAxis
                stroke="#64748b"
                fontSize={10}
                fontFamily="monospace"
                tickLine={false}
                axisLine={false}
                domain={[
                  (dataMin: number) =>
                    dataMin < 0
                      ? Math.floor(dataMin * 1.15)
                      : isPnlMode
                      ? 0
                      : Math.max(0, Math.floor(dataMin * 0.95)),
                  (dataMax: number) =>
                    Math.ceil((dataMax === 0 ? 1 : dataMax) * (isPnlMode ? 1.25 : 1.08)),
                ]}
                tickFormatter={(val: number) => formatCompactValue(val, isPnlMode)}
                tick={{ fill: '#64748b' }}
                width={55}
              />

              <Tooltip content={<CustomTooltip />} />

              <Area
                type="monotone"
                dataKey="equity"
                stroke={isNetPositive ? '#10B981' : '#F43F5E'}
                strokeWidth={2.5}
                fill={`url(#${gradientId})`}
                dot={renderCustomDot}
                activeDot={{
                  r: 5,
                  fill: isNetPositive ? '#34D399' : '#FB7185',
                  stroke: '#042F2E',
                  strokeWidth: 2,
                }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function formatCompactValue(val: number, isPnlMode: boolean = false): string {
  const sign = isPnlMode ? (val > 0 ? '+' : val < 0 ? '-' : '') : '';
  const abs = Math.abs(val);

  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 10_000) {
    return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  }
  if (abs >= 1_000) {
    return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  }
  if (isPnlMode) {
    return `${sign}$${abs.toFixed(2)}`;
  }
  return `$${abs >= 10 ? Math.round(abs) : abs.toFixed(1)}`;
}
