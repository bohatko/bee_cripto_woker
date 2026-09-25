'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  ArrowLeft,
  CreditCard,
  Grid3x3,
  Layers,
  Radar,
  Repeat,
  ShieldAlert,
  Users,
  Wallet,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { LanguageSwitcher } from '@/lib/i18n/LanguageSwitcher';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const NAV = [
  { href: '/admin', key: 'admin.overview', icon: Activity, exact: true },
  { href: '/admin/users', key: 'admin.usersNav', icon: Users, exact: false },
  { href: '/admin/invoices', key: 'admin.invoicesPayments', icon: CreditCard, exact: false, badge: true },
  { href: '/admin/positions', key: 'admin.livePositions', icon: Layers, exact: false },
  { href: '/admin/pairs', key: 'admin.pairsTab', icon: Repeat, exact: false },
  { href: '/admin/signals', key: 'admin.signalsNav', icon: Radar, exact: false },
  { href: '/admin/referrals', key: 'nav.partnerPayouts', icon: Wallet, exact: false },
  { href: '/admin/grid', key: 'nav.adminGrid', icon: Grid3x3, exact: false },
] as const;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLanguage();
  const [ready, setReady] = useState(false);
  const [pendingInvoices, setPendingInvoices] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        router.replace('/login');
        return;
      }
      const { data: profile } = await supabase.from('users_profile').select('role').eq('id', auth.user.id).single();
      if (profile?.role !== 'admin') {
        router.replace('/dashboard');
        return;
      }
      const { count } = await supabase
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending_review');
      if (!cancelled) {
        setPendingInvoices(count || 0);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, pathname]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-dark-950 text-slate-100 md:flex-row">
      <aside className="flex w-full shrink-0 flex-col border-b border-dark-800 bg-dark-900 md:h-full md:w-64 md:border-b-0 md:border-r">
        <div className="border-b border-dark-800 px-4 py-4">
          <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('admin.userDashboard')}
          </Link>
          <div className="mt-3 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-honey-400" />
            <span className="text-sm font-extrabold tracking-tight text-white">{t('admin.adminControl')}</span>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-honey-500 font-bold text-dark-950 shadow-md shadow-honey-500/20'
                    : 'text-slate-400 hover:bg-dark-850 hover:text-white'
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-dark-950' : 'text-slate-400'}`} />
                <span className="min-w-0 flex-1 truncate">{t(item.key)}</span>
                {'badge' in item && item.badge && pendingInvoices > 0 && (
                  <span
                    className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-black ${
                      active ? 'bg-dark-950 text-honey-300' : 'bg-amber-500 text-dark-950'
                    }`}
                  >
                    {pendingInvoices}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-dark-800 px-4 py-3">
          <LanguageSwitcher variant="icon" />
        </div>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        {ready ? children : (
          <div className="flex h-full items-center justify-center text-slate-400">
            <p className="font-mono text-sm">{t('common.loading')}</p>
          </div>
        )}
      </main>
    </div>
  );
}
