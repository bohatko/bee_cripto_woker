'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useUserNotifications } from '@/components/notifications/useNotifications';
import { NotificationFeed, NotificationFooterLink, useOpenNotification } from '@/components/notifications/NotificationFeed';

export function NotificationBell({ userId }: { userId: string }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { rows, unread, loading, markRead, markAllRead } = useUserNotifications(userId, {
    limit: 8,
    toastNew: true,
  });
  const openRow = useOpenNotification(markRead);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={t('notifications.title')}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-dark-800 text-slate-300 transition-colors hover:border-honey-500/40 hover:text-honey-300"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-honey-500 px-1 text-[10px] font-bold text-dark-950">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed left-3 top-[4.75rem] z-[60] w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-dark-800 bg-dark-900 shadow-2xl shadow-black/40 md:left-[17.5rem]">
          <div className="flex items-center justify-between gap-3 border-b border-dark-800 px-4 py-3">
            <p className="text-sm font-semibold text-white">{t('notifications.title')}</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="text-[11px] font-semibold text-honey-400 hover:text-honey-300"
              >
                {t('notifications.markAll')}
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            <NotificationFeed
              rows={rows}
              loading={loading}
              emptyLabel={t('notifications.empty')}
              onOpen={(row) => {
                setOpen(false);
                void openRow(row);
              }}
            />
          </div>
          <NotificationFooterLink onClick={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
