'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { toast } from '@/components/ui/sonner';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { formatNotification, type NotificationRow } from '@/lib/notifications/format';

const SILENT_TOAST_EVENTS = new Set(['trade.opened', 'signal.opened']);

export function useUserNotifications(
  userId: string | null,
  options: { limit: number; category?: string; toastNew?: boolean }
) {
  const { t, formatDateTime } = useLanguage();
  const category = options.category || 'all';
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) return;
    let listQuery = supabase
      .from('user_notifications')
      .select('id, category, event_type, severity, href, payload, read_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(options.limit);
    if (category !== 'all') listQuery = listQuery.eq('category', category);

    const [{ data, error }, { count }] = await Promise.all([
      listQuery,
      supabase
        .from('user_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('read_at', null),
    ]);

    if (error) console.warn('[INBOX] load failed:', error.message);
    setRows((data || []) as NotificationRow[]);
    setUnread(count || 0);
    setLoading(false);
  }, [userId, options.limit, category]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`user_notifications_${userId}_${category}_${options.limit}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'user_notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as NotificationRow;
          if (!row?.id) return;
          if (!row.read_at) setUnread((count) => count + 1);
          setRows((prev) => {
            if (category !== 'all' && row.category !== category) return prev;
            if (prev.some((item) => item.id === row.id)) return prev;
            return [row, ...prev].slice(0, options.limit);
          });
          if (options.toastNew && !SILENT_TOAST_EVENTS.has(row.event_type)) {
            const copy = formatNotification(row, t, formatDateTime);
            const toastOptions = { description: copy.body, duration: 8000 };
            if (row.severity === 'critical') toast.error(copy.title, toastOptions);
            else if (row.severity === 'warning') toast.warning(copy.title, toastOptions);
            else if (row.severity === 'success') toast.success(copy.title, toastOptions);
            else toast.info(copy.title, toastOptions);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'user_notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as NotificationRow;
          if (!row?.id) return;
          setRows((prev) => {
            const existing = prev.find((item) => item.id === row.id);
            if (existing && !existing.read_at && row.read_at) {
              setUnread((count) => Math.max(0, count - 1));
            }
            if (!existing) return prev;
            return prev.map((item) => (item.id === row.id ? row : item));
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, category, options.limit, options.toastNew, t, formatDateTime]);

  const markRead = useCallback(
    async (id: string) => {
      const now = new Date().toISOString();
      let changed = false;
      setRows((prev) =>
        prev.map((item) => {
          if (item.id !== id || item.read_at) return item;
          changed = true;
          return { ...item, read_at: now };
        })
      );
      if (changed) setUnread((count) => Math.max(0, count - 1));
      const { error } = await supabase
        .from('user_notifications')
        .update({ read_at: now })
        .eq('id', id)
        .is('read_at', null);
      if (error) console.warn('[INBOX] mark read failed:', error.message);
    },
    []
  );

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    const now = new Date().toISOString();
    setRows((prev) => prev.map((item) => (item.read_at ? item : { ...item, read_at: now })));
    setUnread(0);
    const { error } = await supabase
      .from('user_notifications')
      .update({ read_at: now })
      .eq('user_id', userId)
      .is('read_at', null);
    if (error) console.warn('[INBOX] mark all failed:', error.message);
  }, [userId]);

  return { rows, unread, loading, markRead, markAllRead, reload: load };
}
