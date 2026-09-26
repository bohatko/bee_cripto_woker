import { createServiceSupabase } from '@/lib/supabase/service';

type InboxInput = {
  userId: string;
  category: 'billing' | 'trading' | 'signals' | 'grid' | 'exchange' | 'account' | 'partners';
  eventType: string;
  severity: 'info' | 'success' | 'warning' | 'critical';
  href: string;
  dedupeKey: string;
  payload?: Record<string, unknown>;
};

/** Server-side inbox write. Duplicate keys are ignored. */
export async function recordUserNotification(input: InboxInput): Promise<void> {
  if (!input.userId) return;
  try {
    const admin = createServiceSupabase();
    const { error } = await admin.from('user_notifications').upsert(
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
    if (error) console.warn(`[INBOX] ${input.eventType}: ${error.message}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[INBOX] ${input.eventType}: ${message}`);
  }
}
