import React from 'react';

export function Pulse({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-dark-800/90 ${className}`}
      aria-hidden
    />
  );
}

export function CardShell({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-dark-900 border border-dark-800 rounded-2xl ${className}`}>
      {children}
    </div>
  );
}

export function PageHeaderSkeleton({
  actions = 1,
  className = '',
}: {
  actions?: number;
  className?: string;
}) {
  return (
    <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${className}`}>
      <div className="space-y-2">
        <Pulse className="h-8 w-48 sm:w-64" />
        <Pulse className="h-3.5 w-72 max-w-full" />
      </div>
      {actions > 0 && (
        <div className="flex items-center gap-3">
          {Array.from({ length: actions }).map((_, i) => (
            <Pulse key={i} className="h-10 w-28 rounded-xl" />
          ))}
        </div>
      )}
    </div>
  );
}

export function StatsGridSkeleton({
  count = 4,
  colsClass = 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
}: {
  count?: number;
  colsClass?: string;
}) {
  return (
    <div className={`grid ${colsClass} gap-3`}>
      {Array.from({ length: count }).map((_, i) => (
        <CardShell key={i} className="p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <Pulse className="h-3 w-24" />
            <Pulse className="h-4 w-4 rounded" />
          </div>
          <Pulse className="h-7 w-28" />
          <Pulse className="h-3 w-36" />
        </CardShell>
      ))}
    </div>
  );
}

export function ChartSkeleton({ heightClass = 'h-56' }: { heightClass?: string }) {
  return (
    <CardShell className="p-5 sm:p-6 space-y-4 shadow-xl">
      <div className="space-y-2">
        <Pulse className="h-4 w-48" />
        <Pulse className="h-3 w-64 max-w-full" />
      </div>
      <Pulse className={`w-full rounded-xl ${heightClass}`} />
    </CardShell>
  );
}

export function TableSkeleton({
  rows = 6,
  cols = 5,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <CardShell className="shadow-xl overflow-hidden">
      <div className="p-5 border-b border-dark-800 flex items-center justify-between">
        <Pulse className="h-4 w-40" />
        <Pulse className="h-3 w-20" />
      </div>
      <div className="p-5 space-y-3">
        {Array.from({ length: rows }).map((_, row) => (
          <div key={row} className="flex items-center gap-4">
            {Array.from({ length: cols }).map((_, col) => (
              <Pulse
                key={col}
                className={`h-4 ${col === 0 ? 'w-20' : col === cols - 1 ? 'w-16 ml-auto' : 'flex-1'}`}
              />
            ))}
          </div>
        ))}
      </div>
    </CardShell>
  );
}

export function FormSectionSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <CardShell className="p-6 sm:p-8 shadow-2xl space-y-6">
      <div className="flex items-center gap-3 pb-6 border-b border-dark-800">
        <Pulse className="h-12 w-12 rounded-xl" />
        <div className="space-y-2">
          <Pulse className="h-5 w-40" />
          <Pulse className="h-3 w-56" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Pulse className="h-3 w-24" />
            <Pulse className="h-10 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </CardShell>
  );
}

export function SkeletonPage({
  children,
  label = 'Loading page',
  className = 'p-4 sm:p-8 space-y-6 w-full',
}: {
  children: React.ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <div className={className} role="status" aria-busy="true" aria-label={label}>
      {children}
      <span className="sr-only">{label}…</span>
    </div>
  );
}
