import React from 'react';
import {
  Pulse,
  CardShell,
  PageHeaderSkeleton,
  StatsGridSkeleton,
  ChartSkeleton,
  TableSkeleton,
  FormSectionSkeleton,
  SkeletonPage,
} from '@/components/ui/skeleton';

export function DashboardSkeleton() {
  return (
    <SkeletonPage label="Loading dashboard">
      <PageHeaderSkeleton actions={3} />
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
      <StatsGridSkeleton count={3} colsClass="grid-cols-1 sm:grid-cols-3" />
      <CardShell className="p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <Pulse className="h-3 w-40" />
          <Pulse className="h-3 w-24" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="bg-dark-950 border border-dark-800 p-4 rounded-xl space-y-3">
              <Pulse className="h-3 w-16" />
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
      <TableSkeleton rows={4} cols={5} />
    </SkeletonPage>
  );
}

export function SignalsSkeleton() {
  return (
    <SkeletonPage label="Loading signals">
      <PageHeaderSkeleton actions={1} />
      <ChartSkeleton />
      <StatsGridSkeleton count={4} colsClass="grid-cols-2 sm:grid-cols-4" />
      <div className="space-y-4">
        <Pulse className="h-4 w-56" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {[0, 1].map((i) => (
            <CardShell key={i} className="p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <Pulse className="h-5 w-28" />
                <Pulse className="h-6 w-14 rounded-full" />
              </div>
              <Pulse className="h-20 w-full rounded-xl" />
              <Pulse className="h-24 w-full rounded-xl" />
            </CardShell>
          ))}
        </div>
      </div>
      <TableSkeleton rows={5} cols={6} />
    </SkeletonPage>
  );
}

export function SignalsBacktestSkeleton() {
  return (
    <SkeletonPage label="Loading signal backtest">
      <PageHeaderSkeleton actions={1} />
      <div className="flex items-center justify-between">
        <Pulse className="h-3 w-16" />
        <div className="flex gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Pulse key={i} className="h-8 w-16 rounded-xl" />
          ))}
        </div>
      </div>
      <ChartSkeleton heightClass="h-64" />
      <StatsGridSkeleton count={4} colsClass="grid-cols-2 sm:grid-cols-4" />
      <TableSkeleton rows={6} cols={7} />
    </SkeletonPage>
  );
}

export function HistorySkeleton() {
  return (
    <SkeletonPage label="Loading trade history">
      <PageHeaderSkeleton actions={1} />
      <CardShell className="p-5 space-y-3">
        <Pulse className="h-4 w-48" />
        <Pulse className="h-10 w-full rounded-xl" />
      </CardShell>
      <ChartSkeleton heightClass="h-64" />
      <StatsGridSkeleton count={5} colsClass="grid-cols-2 sm:grid-cols-5" />
      <div className="flex flex-wrap gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Pulse key={i} className="h-8 w-20 rounded-lg" />
        ))}
      </div>
      <TableSkeleton rows={7} cols={6} />
    </SkeletonPage>
  );
}

export function ProfileSkeleton() {
  return (
    <SkeletonPage label="Loading profile" className="p-4 sm:p-8 max-w-5xl space-y-8">
      <PageHeaderSkeleton actions={1} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <CardShell className="p-5 sm:col-span-2 space-y-4">
          <Pulse className="h-3 w-20" />
          <div className="flex items-center gap-3">
            <Pulse className="h-12 w-12 rounded-xl" />
            <div className="space-y-2 flex-1">
              <Pulse className="h-5 w-40" />
              <Pulse className="h-3 w-56" />
            </div>
          </div>
        </CardShell>
        <CardShell className="p-5 space-y-3">
          <Pulse className="h-3 w-24" />
          <Pulse className="h-6 w-32" />
          <Pulse className="h-3 w-40" />
        </CardShell>
      </div>
      <FormSectionSkeleton fields={4} />
      <FormSectionSkeleton fields={3} />
    </SkeletonPage>
  );
}

export function BillingSkeleton() {
  return (
    <SkeletonPage label="Loading billing" className="p-4 sm:p-8 max-w-5xl space-y-8">
      <PageHeaderSkeleton actions={0} />
      <CardShell className="p-6 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-3">
          <Pulse className="h-3 w-32" />
          <Pulse className="h-8 w-28 rounded-lg" />
          <Pulse className="h-3 w-48" />
        </div>
        <Pulse className="h-16 w-40 rounded-xl" />
      </CardShell>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CardShell className="p-6 space-y-4">
          <Pulse className="h-4 w-36" />
          <Pulse className="h-40 w-40 rounded-xl mx-auto" />
          <Pulse className="h-10 w-full rounded-xl" />
          <Pulse className="h-10 w-full rounded-xl" />
        </CardShell>
        <TableSkeleton rows={4} cols={3} />
      </div>
    </SkeletonPage>
  );
}

export function ExchangeSkeleton() {
  return (
    <SkeletonPage label="Loading exchange settings" className="p-4 sm:p-8 max-w-5xl space-y-8">
      <PageHeaderSkeleton actions={0} />
      <CardShell className="p-5 space-y-3">
        <Pulse className="h-4 w-48" />
        <Pulse className="h-3 w-full max-w-lg" />
        <Pulse className="h-10 w-56 rounded-xl" />
      </CardShell>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <Pulse key={i} className="h-12 w-full rounded-xl" />
        ))}
      </div>
      <FormSectionSkeleton fields={4} />
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <CardShell key={i} className="p-5 flex items-center justify-between gap-4">
            <div className="space-y-2 flex-1">
              <Pulse className="h-4 w-24" />
              <Pulse className="h-6 w-32" />
              <Pulse className="h-3 w-48" />
            </div>
            <Pulse className="h-9 w-24 rounded-xl" />
          </CardShell>
        ))}
      </div>
    </SkeletonPage>
  );
}

export function AdminSkeleton() {
  return (
    <div
      className="min-h-screen bg-dark-950 text-slate-100"
      role="status"
      aria-busy="true"
      aria-label="Loading admin panel"
    >
      <header className="border-b border-dark-800 bg-dark-900/90">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Pulse className="h-9 w-36 rounded-xl" />
            <Pulse className="h-5 w-px" />
            <Pulse className="h-6 w-40" />
          </div>
          <div className="flex items-center gap-2">
            <Pulse className="h-9 w-20 rounded-xl" />
            <Pulse className="h-9 w-9 rounded-xl" />
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-8">
        <StatsGridSkeleton count={4} colsClass="grid-cols-1 sm:grid-cols-4" />
        <CardShell className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <Pulse className="h-5 w-40" />
            <Pulse className="h-9 w-48 rounded-xl" />
          </div>
          <TableSkeleton rows={6} cols={6} />
        </CardShell>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TableSkeleton rows={4} cols={4} />
          <TableSkeleton rows={4} cols={4} />
        </div>
      </main>
      <span className="sr-only">Loading admin panel…</span>
    </div>
  );
}
