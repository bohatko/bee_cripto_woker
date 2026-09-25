'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  KeyRound,
  History,
  CreditCard,
  Gift,
  LogOut,
  ShieldAlert,
  UserCog,
  Radar,
  Grid3x3,
  Star,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { toast } from '@/components/ui/sonner';
import { LanguageSwitcher } from '@/lib/i18n/LanguageSwitcher';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { playTradeOpenSound } from '@/lib/sound';
import { hasProModules } from '@/lib/pro-access';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLanguage();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadUser() {
      try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (!isMounted) return;
        if (error || !user) {
          router.replace('/login');
          if (typeof window !== 'undefined') {
            window.location.replace('/login');
          }
          return;
        }
        setUser(user);

        const { data: prof } = await supabase
          .from('users_profile')
          .select('*')
          .eq('id', user.id)
          .single();

        if (isMounted && prof) {
          setProfile(prof);
        }
      } catch {
        if (isMounted) {
          router.replace('/login');
          if (typeof window !== 'undefined') {
            window.location.replace('/login');
          }
        }
      } finally {
        if (isMounted) {
          setIsCheckingAuth(false);
        }
      }
    }
    loadUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        if (isMounted) {
          setUser(null);
          router.replace('/login');
        }
      }
    });

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    if (!profile) return;
    const proSection = pathname === '/grid' || pathname.startsWith('/grid/') || pathname === '/history' || pathname.startsWith('/history/');
    if (proSection && !hasProModules(profile)) {
      router.replace('/billing');
    }
  }, [profile, pathname, router]);

  // Real-time listener for new trade executions with Sound & Sonner Toast
  useEffect(() => {
    if (!user) return;

    const notifiedPosIds = new Set<string>();

    const channel = supabase
      .channel(`realtime_trade_alerts_${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'bot_positions',
        },
        (payload: any) => {
          const newPos = payload.new;
          if (!newPos || newPos.status !== 'open') return;

          const isUserPos = newPos.user_id === user.id;
          const isMaster = Boolean(newPos.is_master);

          if (!isUserPos && !isMaster) return;
          if (notifiedPosIds.has(newPos.id)) return;
          notifiedPosIds.add(newPos.id);

          // Audio chime
          playTradeOpenSound();

          // Sonner toast notification
          const pairSymbol = newPos.pair_symbol || '';
          const [longCoin, shortCoin] = pairSymbol.split('/');
          const shortTradeId = String(newPos.id || '').slice(0, 8).toUpperCase();

          toast.success(
            t('dashboard.toastTradeOpened', { pair: pairSymbol, id: shortTradeId }),
            {
              description: t('dashboard.toastTradeOpenedDesc', {
                long: longCoin || 'LONG',
                short: shortCoin || 'SHORT',
                leverage: '3.0',
              }),
              duration: 8000,
            }
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'signal_positions',
        },
        (payload: any) => {
          const newPos = payload.new;
          if (!newPos || newPos.status !== 'open') return;

          const isUserPos = newPos.user_id === user.id;
          const isMaster = Boolean(newPos.is_master);

          if (!isUserPos && !isMaster) return;
          if (notifiedPosIds.has(newPos.id)) return;
          notifiedPosIds.add(newPos.id);

          playTradeOpenSound();

          const sym = newPos.symbol || 'XRP';
          const notional = Number(newPos.notional_usd || 0).toFixed(0);

          toast.success(
            t('signals.toastTradeOpened', { symbol: sym, notional }),
            {
              description: isMaster ? 'Benchmark Master Strategy' : 'Live Exchange Position',
              duration: 8000,
            }
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, t]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsLogoutModalOpen(false);
    toast.info(t('sidebar.signedOut'));
    router.push('/login');
  };

  const navSections: Array<{
    label?: string;
    divided?: boolean;
    items: Array<{ name: string; href: string; icon: typeof LayoutDashboard; pro?: boolean }>;
  }> = [
    {
      items: [{ name: t('nav.dashboard'), href: '/dashboard', icon: LayoutDashboard }],
    },
    {
      label: t('nav.sectionSignals'),
      items: [
        { name: t('nav.signals'), href: '/signals', icon: Radar },
        { name: t('nav.grid'), href: '/grid', icon: Grid3x3, pro: true },
        { name: t('nav.pairTrading'), href: '/history', icon: History, pro: true },
      ],
    },
    {
      divided: true,
      items: [
        { name: t('nav.exchangeKeys'), href: '/settings/exchange', icon: KeyRound },
        { name: t('nav.billing'), href: '/billing', icon: CreditCard },
        { name: t('nav.referrals'), href: '/referrals', icon: Gift },
      ],
    },
  ];

  if (isCheckingAuth || !user) {
    return (
      <div className="h-dvh bg-dark-950 flex flex-col items-center justify-center text-slate-100">
        <div className="w-12 h-12 rounded-2xl bg-honey-500/10 border border-honey-500/30 flex items-center justify-center text-honey-500 font-bold text-2xl shadow-lg shadow-honey-500/20 animate-pulse mb-4">
          🐝
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-400 font-mono">
          <div className="w-2 h-2 rounded-full bg-honey-500 animate-ping" />
          <span>Authenticating...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh bg-dark-950 flex flex-col md:flex-row text-slate-100 overflow-hidden">
      <aside className="w-full md:w-64 md:h-full bg-dark-900 border-r border-dark-800 flex flex-col shrink-0">
        <div className="p-5 border-b border-dark-800 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-honey-500/10 border border-honey-500/30 flex items-center justify-center text-honey-500 font-bold text-xl shadow-lg shadow-honey-500/20">
            🐝
          </div>
          <div>
            <h1 className="font-extrabold tracking-tight text-white text-base">
              CRYPTO <span className="text-honey-400">BEE</span>
            </h1>
          </div>
        </div>

        <Link
          href="/settings/profile"
          className={`p-4 mx-3 my-3 bg-dark-950/80 border rounded-xl transition-colors block ${
            pathname === '/settings/profile' || pathname.startsWith('/settings/profile/')
              ? 'border-honey-500/40 bg-honey-500/5'
              : 'border-dark-800 hover:border-dark-700 hover:bg-dark-900/80'
          }`}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <UserCog className="w-4 h-4 text-honey-400 shrink-0" />
            <span className="text-xs font-semibold text-white truncate">
              {profile?.full_name || user?.email?.split('@')[0] || t('common.trader')}
              {profile?.role === 'admin' ? ' (Admin)' : ''}
            </span>
          </div>
          <div className="flex items-center justify-start gap-2 text-[11px] font-mono">
            <span className="text-slate-500">{t('common.status')}:</span>
            <span
              className={`px-1.5 py-0.5 rounded uppercase font-semibold ${
                profile?.subscription_status === 'trial'
                  ? 'bg-honey-500/15 text-honey-400'
                  : profile?.subscription_status === 'active'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-rose-500/15 text-rose-400'
              }`}
            >
              {profile?.subscription_status || t('common.trial')}
            </span>
          </div>
        </Link>

        <nav className="flex-1 px-3 py-2 space-y-3 overflow-y-auto">
          {navSections.map((section, sectionIdx) => (
            <div
              key={section.label || `section-${sectionIdx}`}
              className={`space-y-1 ${section.divided ? 'pt-3 mt-1 border-t border-dark-800' : ''}`}
            >
              {section.label && (
                <span className="px-3 text-[10px] uppercase tracking-wider font-mono text-slate-500 font-bold">
                  {section.label}
                </span>
              )}
              {section.items.map((item) => {
                const Icon = item.icon;
                const locked = Boolean(item.pro && !hasProModules(profile));
                const href = locked ? '/billing' : item.href;
                const isActive =
                  !locked &&
                  (item.href === '/history' || item.href === '/signals'
                    ? pathname === item.href
                    : pathname === item.href || pathname.startsWith(`${item.href}/`));
                return (
                  <Link
                    key={item.href}
                    href={href}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-honey-500 text-dark-950 font-bold shadow-md shadow-honey-500/20'
                        : 'text-slate-400 hover:text-white hover:bg-dark-850'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-dark-950' : 'text-slate-400'}`} />
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    {item.pro && (
                      <span
                        title={t('nav.proHint')}
                        className={`inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          isActive ? 'bg-dark-950/15 text-dark-950' : 'bg-honey-500/15 text-honey-300'
                        }`}
                      >
                        <Star className="h-2.5 w-2.5 fill-current" aria-hidden />
                        {t('nav.proBadge')}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}

          {profile?.role === 'admin' && (
            <div className="pt-3 mt-1 border-t border-dark-800">
              <span className="px-3 text-[10px] uppercase tracking-wider font-mono text-honey-400/80 font-bold">
                {t('nav.adminPanel')}
              </span>
              <Link
                href="/admin"
                className="flex items-center gap-3 px-3 py-2.5 mt-1 rounded-xl text-sm font-medium transition-colors text-honey-400/80 hover:text-honey-300 hover:bg-dark-850"
              >
                <ShieldAlert className="w-4 h-4 text-honey-400" />
                {t('nav.administration')}
              </Link>
            </div>
          )}
        </nav>

        <div className="border-t border-dark-800 px-4 py-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsLogoutModalOpen(true)}
              className="flex-1 flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-rose-400 hover:bg-dark-850 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              {t('nav.signOut')}
            </button>
            <LanguageSwitcher variant="icon" />
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-y-auto">
        {children}
      </main>

      <ConfirmModal
        isOpen={isLogoutModalOpen}
        title={t('sidebar.logoutTitle')}
        description={t('sidebar.logoutDescription')}
        confirmText={t('nav.signOut')}
        onConfirm={handleLogout}
        onCancel={() => setIsLogoutModalOpen(false)}
      />
    </div>
  );
}
