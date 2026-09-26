import { supabase } from '../config.js';

type InboxInput = {
  userId: string;
  category: 'billing' | 'trading' | 'signals' | 'grid' | 'exchange' | 'account' | 'partners';
  eventType: string;
  severity: 'info' | 'success' | 'warning' | 'critical';
  href: string;
  dedupeKey: string;
  payload?: Record<string, unknown>;
};

/** Writes one inbox row. A repeated dedupe key is ignored. */
export async function recordUserNotification(input: InboxInput): Promise<void> {
  if (!input.userId) return;
  const { error } = await supabase.from('user_notifications').upsert(
    {
      user_id: input.userId,
      category: input.category,
      event_type: input.eventType,
      severity: input.severity,
      href: input.href,
      dedupe_key: input.dedupeKey,
      payload: input.payload ?? {},
    },
    { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true }
  );
  if (error) {
    console.warn(`⚠️ [INBOX] ${input.eventType} for ${input.userId}: ${error.message}`);
  }
}

export async function recordSignalSkipped(input: {
  userId: string;
  symbol: string;
  reason: 'invalid_keys' | 'low_margin' | 'frozen' | 'position_open';
}): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const href = input.reason === 'frozen' ? '/billing' : input.reason === 'invalid_keys' ? '/settings/exchange' : '/signals';
  await recordUserNotification({
    userId: input.userId,
    category: 'signals',
    eventType: 'signal.skipped',
    severity: 'warning',
    href,
    dedupeKey: `signal.skipped:${input.userId}:${input.symbol}:${input.reason}:${day}`,
    payload: { symbol: input.symbol, reason: input.reason },
  });
}
