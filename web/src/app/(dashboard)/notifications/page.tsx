'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useUserNotifications } from '@/components/notifications/useNotifications';
import { NotificationFeed, useOpenNotification } from '@/components/notifications/NotificationFeed';

const FILTERS = ['all', 'billing', 'trading', 'signals', 'grid', 'exchange', 'account', 'partners'] as const;

export default function NotificationsPage() {
  const { t } = useLanguage();
  const [userId, setUserId] = useState<string | null>(null);
  const [category, setCategory] = useState<(typeof FILTERS)[number]>('all');

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, []);

  const { rows, unread, loading, markRead, markAllRead } = useUserNotifications(userId, {
    limit: 80,
    category,
    toastNew: false,
  });
  const openRow = useOpenNotification(markRead);

  return (
    <div className="w-full space-y-6 p-4 sm:p-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">{t('notifications.title')}</h1>
          <p className="mt-1 text-sm text-slate-400">{t('notifications.subtitle')}</p>
        </div>
        {unread > 0 && (
          <button
            type="button"
            onClick={() => void markAllRead()}
            className="rounded-xl border border-dark-800 px-3 py-2 text-xs font-semibold text-honey-400 hover:border-honey-500/40"
          >
            {t('notifications.markAll')}
          </button>
        )}
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((item) => {
          const active = item === category;
          return (
            <button
              key={item}
              type="button"
              onClick={() => setCategory(item)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                active ? 'bg-honey-500 text-dark-950' : 'bg-dark-900 text-slate-400 hover:text-white'
              }`}
            >
              {t(`notifications.categories.${item}`)}
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-2xl border border-dark-800 bg-dark-900">
        <NotificationFeed
          rows={rows}
          loading={loading || !userId}
          emptyLabel={t('notifications.empty')}
          onOpen={(row) => void openRow(row)}
        />
      </div>
    </div>
  );
}
