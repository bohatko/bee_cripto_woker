import React from 'react';

function Pulse({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-dark-800/90 ${className}`}
      aria-hidden
    />
  );
}

function CardShell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-dark-900 border border-dark-800 rounded-2xl ${className}`}>
      {children}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div
      className="p-4 sm:p-8 space-y-6"
      role="status"
      aria-busy="true"
      aria-label="Loading dashboard"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <Pulse className="h-8 w-48 sm:w-64" />
          <Pulse className="h-3.5 w-72 max-w-full" />
        </div>
        <div className="flex items-center gap-3">
          <Pulse className="h-10 w-28 rounded-xl" />
          <Pulse className="h-10 w-36 rounded-xl" />
          <Pulse className="h-10 w-32 rounded-xl" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="bg-dark-900 border border-dark-800 p-3.5 rounded-xl flex items-center justify-between"
          >
            <div className="flex items-center gap-2.5">
              <Pulse className="w-2.5 h-2.5 rounded-full" />
              <Pulse className="h-3 w-28" />
            </div>
            <Pulse className="h-5 w-16 rounded" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <CardShell key={i} className="p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <Pulse className="h-3 w-24" />
              <Pulse className="h-4 w-4 rounded" />
            </div>
            <Pulse className="h-8 w-36" />
            <Pulse className="h-3 w-44" />
          </CardShell>
        ))}
      </div>

      <CardShell className="p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Pulse className="h-4 w-4 rounded" />
            <Pulse className="h-3 w-40" />
          </div>
          <Pulse className="h-3 w-24" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="bg-dark-950 border border-dark-800 p-4 rounded-xl space-y-3"
            >
              <div className="flex items-center gap-2">
                <Pulse className="w-2 h-2 rounded-full" />
                <Pulse className="h-3 w-16" />
              </div>
              <Pulse className="h-6 w-28" />
              <Pulse className="h-3 w-36" />
            </div>
          ))}
        </div>
      </CardShell>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {[0, 1].map((i) => (
          <CardShell key={i} className="p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <Pulse className="h-4 w-32" />
              <Pulse className="h-5 w-16 rounded-full" />
            </div>
            <Pulse className="h-24 w-full rounded-xl" />
            <div className="flex gap-2">
              <Pulse className="h-8 flex-1 rounded-lg" />
              <Pulse className="h-8 flex-1 rounded-lg" />
            </div>
          </CardShell>
        ))}
      </div>

      <CardShell className="shadow-2xl overflow-hidden">
        <div className="p-5 border-b border-dark-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Pulse className="h-5 w-5 rounded" />
            <div className="space-y-2">
              <Pulse className="h-4 w-36" />
              <Pulse className="h-3 w-48" />
            </div>
          </div>
          <Pulse className="h-3 w-24" />
        </div>
        <div className="p-5 space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <Pulse className="h-4 w-20" />
              <Pulse className="h-4 w-16" />
              <Pulse className="h-4 flex-1" />
              <Pulse className="h-4 w-20" />
              <Pulse className="h-4 w-16" />
            </div>
          ))}
        </div>
      </CardShell>

      <span className="sr-only">Loading dashboard data…</span>
    </div>
  );
}
