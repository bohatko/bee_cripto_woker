import type { TranslationVars } from '@/lib/i18n/types';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical';

export type NotificationRow = {
  id: string;
  category: string;
  event_type: string;
  severity: NotificationSeverity;
  href: string | null;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

type Translate = (path: string, vars?: TranslationVars) => string;

function field(payload: Record<string, unknown> | null, key: string): string {
  const value = payload?.[key];
  if (value == null) return '';
  return String(value);
}

function signed(value: string): string {
  if (!value) return '0.00';
  if (value.startsWith('-') || value.startsWith('+')) return value;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return value;
  return `+${value}`;
}

function planLabel(plan: string): string {
  if (plan === 'pro') return 'Pro';
  if (plan === 'lite') return 'Lite';
  return plan || 'Lite';
}

export function formatNotification(
  row: NotificationRow,
  t: Translate,
  formatDateTime: (value: string | number | Date | null | undefined) => string
): { title: string; body: string } {
  const payload = row.payload;
  const endsAt = field(payload, 'endsAt');
  const dueAt = field(payload, 'dueAt');
  const interval = field(payload, 'interval');
  const vars: TranslationVars = {
    invoiceNumber: field(payload, 'invoiceNumber'),
    amount: field(payload, 'amount') || '0.00',
    plan: planLabel(field(payload, 'plan')),
    interval:
      interval === 'year'
        ? t('notifications.intervalYear')
        : interval === 'month'
          ? t('notifications.intervalMonth')
          : interval,
    period:
      field(payload, 'period') === 'trial'
        ? t('notifications.periodTrial')
        : t('notifications.periodSubscription'),
    endsAt: endsAt ? formatDateTime(endsAt) : '',
    dueAt: dueAt ? formatDateTime(dueAt) : '',
    pair: field(payload, 'pair'),
    margin: field(payload, 'margin') || '0.00',
    leverage: field(payload, 'leverage'),
    pnl: signed(field(payload, 'pnl')),
    pnlPct: signed(field(payload, 'pnlPct')),
    symbol: field(payload, 'symbol'),
    dropPct: field(payload, 'dropPct'),
    strategy: field(payload, 'strategy'),
    exchange: field(payload, 'exchange'),
    message: field(payload, 'message'),
    network: field(payload, 'network'),
    threshold: field(payload, 'threshold'),
    readiness: field(payload, 'readiness'),
  };

  let key = row.event_type.replace(/\./g, '_');
  if (row.event_type === 'trade.closed' || row.event_type === 'signal.closed') {
    key = `${key}_${field(payload, 'reason') || 'other'}`;
  }
  if (row.event_type === 'signal.skipped') {
    key = `signal_skipped_${field(payload, 'reason') || 'other'}`;
  }

  return {
    title: t(`notifications.events.${key}_title`, vars),
    body: t(`notifications.events.${key}_body`, vars),
  };
}
