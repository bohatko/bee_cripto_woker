'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatNotification, type NotificationRow } from '@/lib/notifications/format';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const SEVERITY_DOT: Record<NotificationRow['severity'], string> = {
  info: 'bg-slate-400',
  success: 'bg-emerald-400',
  warning: 'bg-honey-400',
  critical: 'bg-rose-400',
};

export function NotificationFeed({
  rows,
  loading,
  emptyLabel,
  onOpen,
}: {
  rows: NotificationRow[];
  loading: boolean;
  emptyLabel: string;
  onOpen: (row: NotificationRow) => void;
}) {
  const { t, formatDateTime } = useLanguage();

  if (loading) {
    return <p className="px-4 py-8 text-center text-xs text-slate-500">{t('common.loading')}</p>;
  }

  if (rows.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-slate-500">{emptyLabel}</p>;
  }

  return (
    <ul className="divide-y divide-dark-800">
      {rows.map((row) => {
        const copy = formatNotification(row, t, formatDateTime);
        const unread = !row.read_at;
        return (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => onOpen(row)}
              className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-dark-850 ${
                unread ? 'bg-honey-500/5' : ''
              }`}
            >
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[row.severity] || SEVERITY_DOT.info}`} />
              <span className="min-w-0 flex-1">
                <span className={`block text-sm ${unread ? 'font-semibold text-white' : 'text-slate-200'}`}>
                  {copy.title}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-slate-400">{copy.body}</span>
                <span className="mt-1 block font-mono text-[10px] uppercase tracking-wide text-slate-500">
                  {formatDateTime(row.created_at)}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function NotificationFooterLink({ onClick }: { onClick?: () => void }) {
  const { t } = useLanguage();
  return (
    <Link
      href="/notifications"
      onClick={onClick}
      className="block border-t border-dark-800 px-4 py-2.5 text-center text-xs font-semibold text-honey-400 hover:bg-dark-850"
    >
      {t('notifications.viewAll')}
    </Link>
  );
}

export function useOpenNotification(markRead: (id: string) => Promise<void>) {
  const router = useRouter();
  return async (row: NotificationRow) => {
    if (!row.read_at) await markRead(row.id);
    if (row.href) router.push(row.href);
  };
}
