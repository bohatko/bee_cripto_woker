'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  KeyRound,
  History,
  CreditCard,
  LogOut,
  Shield,
  Activity,
  User,
  ShieldAlert,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { ConfirmModal } from '@/components/modals/ConfirmModal';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);

  useEffect(() => {
    async function loadUser() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // For development/preview if not authenticated, redirect to login or load guest
        router.push('/login');
        return;
      }
      setUser(user);

      const { data: prof } = await supabase
        .from('users_profile')
        .select('*')
        .eq('id', user.id)
        .single();

      if (prof) {
        setProfile(prof);
      }
    }
    loadUser();
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsLogoutModalOpen(false);
    router.push('/login');
  };

  const navItems = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Exchange Keys', href: '/settings/exchange', icon: KeyRound },
    { name: 'Trade History', href: '/history', icon: History },
    { name: 'Billing & Invoices', href: '/billing', icon: CreditCard },
  ];

  return (
    <div className="min-h-screen bg-dark-950 flex flex-col md:flex-row text-slate-100">
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-dark-900 border-r border-dark-800 flex flex-col shrink-0">
        <div className="p-5 border-b border-dark-800 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-honey-500/10 border border-honey-500/30 flex items-center justify-center text-honey-500 font-bold text-xl shadow-lg shadow-honey-500/20">
            🐝
          </div>
          <div>
            <h1 className="font-extrabold tracking-tight text-white text-base">BEE CRYPTO</h1>
            <p className="text-[10px] font-mono text-slate-400">TRADING SAAS</p>
          </div>
        </div>

        {/* User Quick Info */}
        <div className="p-4 mx-3 my-3 bg-dark-950/80 border border-dark-800 rounded-xl">
          <div className="flex items-center gap-2 mb-1.5">
            <User className="w-4 h-4 text-honey-400" />
            <span className="text-xs font-semibold text-white truncate">
              {profile?.full_name || user?.email?.split('@')[0] || 'Trader'}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono">
            <span className="text-slate-500">Status:</span>
            <span
              className={`px-1.5 py-0.5 rounded uppercase font-semibold ${
                profile?.subscription_status === 'trial'
                  ? 'bg-honey-500/15 text-honey-400'
                  : profile?.subscription_status === 'active'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-rose-500/15 text-rose-400'
              }`}
            >
              {profile?.subscription_status || 'Trial'}
            </span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-2 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-honey-500 text-dark-950 font-bold shadow-md shadow-honey-500/20'
                    : 'text-slate-400 hover:text-white hover:bg-dark-850'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-dark-950' : 'text-slate-400'}`} />
                {item.name}
              </Link>
            );
          })}

          {/* Admin link if user is administrator */}
          {profile?.role === 'admin' && (
            <div className="pt-3 mt-3 border-t border-dark-800">
              <span className="px-3 text-[10px] uppercase tracking-wider font-mono text-honey-400/80 font-bold">
                Admin Panel
              </span>
              <Link
                href="/admin"
                className={`flex items-center gap-3 px-3 py-2.5 mt-1 rounded-xl text-sm font-medium transition-colors ${
                  pathname.startsWith('/admin')
                    ? 'bg-amber-500/20 text-honey-400 border border-honey-500/30 font-bold shadow-md shadow-honey-500/10'
                    : 'text-honey-400/80 hover:text-honey-300 hover:bg-dark-850'
                }`}
              >
                <ShieldAlert className="w-4 h-4 text-honey-400" />
                Administration
              </Link>
            </div>
          )}
        </nav>

        {/* Logout button (opens confirmation modal) */}
        <div className="p-4 border-t border-dark-800">
          <button
            onClick={() => setIsLogoutModalOpen(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-rose-400 hover:bg-dark-850 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {children}
      </main>

      {/* Logout Confirmation Modal */}
      <ConfirmModal
        isOpen={isLogoutModalOpen}
        title="Sign Out of Bee Crypto Worker"
        description="Are you sure you want to exit your trading session? Your active background trades will continue to run safely on the server."
        confirmText="Sign Out"
        onConfirm={handleLogout}
        onCancel={() => setIsLogoutModalOpen(false)}
      />
    </div>
  );
}
