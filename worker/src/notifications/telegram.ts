import { supabase } from '../config.js';
import { decryptString } from '../security/encryption.js';

const CREDENTIALS_CACHE_TTL_MS = 60_000;

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatDuration(openedAt?: string, closedAt?: string): string {
  if (!openedAt) return '';
  const start = new Date(openedAt).getTime();
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  const diffSec = Math.max(0, Math.floor((end - start) / 1000));
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  if (mins < 60) return `${mins}м ${secs}с`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}ч ${remMins}м`;
}

function parseChatIds(raw: string | null | undefined): string[] {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface TradeOpenedNotification {
  isMaster?: boolean;
  userId?: string | null;
  userEmail?: string;
  exchange?: string;
  accountName?: string;
  pairSymbol: string;
  longSymbol: string;
  longQty: number;
  longPrice: number;
  shortSymbol: string;
  shortQty: number;
  shortPrice: number;
  entryRatio: number;
  allocatedMargin: number;
  totalVolume: number;
  leverage: number;
  takeProfitPct?: number;
  stopLossPct?: number;
}

export interface TradeClosedNotification {
  isMaster?: boolean;
  userId?: string | null;
  userEmail?: string;
  exchange?: string;
  accountName?: string;
  pairSymbol: string;
  exitReason: string;
  realizedPnl: number;
  pnlPct: number;
  allocatedMargin: number;
  longSymbol?: string;
  longEntryPrice: number;
  longExitPrice: number;
  shortSymbol?: string;
  shortEntryPrice: number;
  shortExitPrice: number;
  entryRatio: number;
  exitRatio: number;
  openedAt?: string;
  closedAt?: string;
}

interface TelegramCredentials {
  token: string;
  chatIds: string[];
}

interface CachedCredentials {
  value: TelegramCredentials | null;
  expiresAt: number;
}

class TelegramNotifier {
  private cache = new Map<string, CachedCredentials>();

  private async loadCredentials(userId: string): Promise<TelegramCredentials | null> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const { data, error } = await supabase
      .from('users_profile')
      .select('telegram_enabled, telegram_bot_token_enc, telegram_chat_id')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.warn(`⚠️ [TELEGRAM] Failed to load credentials for ${userId}:`, error.message);
      return null;
    }

    let credentials: TelegramCredentials | null = null;
    if (
      data?.telegram_enabled &&
      data.telegram_bot_token_enc &&
      data.telegram_chat_id
    ) {
      try {
        const token = decryptString(data.telegram_bot_token_enc);
        const chatIds = parseChatIds(data.telegram_chat_id);
        if (token && chatIds.length > 0) {
          credentials = { token, chatIds };
        }
      } catch (err: any) {
        console.warn(`⚠️ [TELEGRAM] Decrypt failed for ${userId}:`, err.message);
      }
    }

    this.cache.set(userId, {
      value: credentials,
      expiresAt: Date.now() + CREDENTIALS_CACHE_TTL_MS,
    });
    return credentials;
  }

  private async loadAdminCredentials(): Promise<TelegramCredentials[]> {
    const { data, error } = await supabase
      .from('users_profile')
      .select('id, telegram_enabled, telegram_bot_token_enc, telegram_chat_id')
      .eq('role', 'admin')
      .eq('telegram_enabled', true);

    if (error) {
      console.warn('⚠️ [TELEGRAM] Failed to load admin credentials:', error.message);
      return [];
    }

    const results: TelegramCredentials[] = [];
    for (const row of data || []) {
      const creds = await this.loadCredentials(row.id);
      if (creds) results.push(creds);
    }
    return results;
  }

  private async dispatch(token: string, chatIds: string[], htmlText: string): Promise<void> {
    for (const chatId of chatIds) {
      try {
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: htmlText,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          console.warn(`⚠️ [TELEGRAM] Failed to send to ${chatId}:`, errData);
        }
      } catch (err: any) {
        console.error(`❌ [TELEGRAM] Error sending message to ${chatId}:`, err.message);
      }
    }
  }

  public async sendToUser(userId: string, htmlText: string): Promise<void> {
    if (!userId) return;
    const creds = await this.loadCredentials(userId);
    if (!creds) return;
    await this.dispatch(creds.token, creds.chatIds, htmlText);
  }

  public async sendToAdmins(htmlText: string): Promise<void> {
    const all = await this.loadAdminCredentials();
    // Deduplicate by token+chatId so shared bots don't double-send
    const seen = new Set<string>();
    for (const creds of all) {
      for (const chatId of creds.chatIds) {
        const key = `${creds.token}:${chatId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await this.dispatch(creds.token, [chatId], htmlText);
      }
    }
  }

  public async notifyTradeOpened(data: TradeOpenedNotification): Promise<void> {
    const isMaster = Boolean(data.isMaster);
    const sourceBadge = isMaster
      ? '👑 <b>Мастер-стратегия (Benchmark)</b>'
      : `⚡ <b>LIVE: ${escapeHtml((data.exchange || 'EXCHANGE').toUpperCase())}</b> (${escapeHtml(data.accountName || data.userEmail || 'User')})`;

    const tp = data.takeProfitPct;
    const sl = data.stopLossPct;
    const goalsLine =
      tp != null && sl != null
        ? `🎯 <b>Цели:</b> TP <code>+${tp.toFixed(1)}%</code> | SL <code>-${sl.toFixed(1)}%</code>`
        : tp != null
          ? `🎯 <b>Цели:</b> TP <code>+${tp.toFixed(1)}%</code>`
          : sl != null
            ? `🎯 <b>Цели:</b> SL <code>-${sl.toFixed(1)}%</code>`
            : `🎯 <b>Цели:</b> TP disabled | ATR SL`;

    const message = [
      `🐝 <b>НОВАЯ СДЕЛКА В РЫНКЕ</b>`,
      `━━━━━━━━━━━━━━━━━━`,
      `${sourceBadge}`,
      `📊 <b>Пара:</b> <code>${escapeHtml(data.pairSymbol)}</code> (Нейтральная корзина)`,
      `📐 <b>Входной Ratio:</b> <code>${data.entryRatio.toFixed(4)}</code>`,
      ``,
      `🟢 <b>LONG:</b> ${escapeHtml(data.longSymbol)}`,
      `   • Объём: <code>${data.longQty}</code>`,
      `   • Цена входа: <code>$${data.longPrice.toFixed(2)}</code>`,
      ``,
      `🔴 <b>SHORT:</b> ${escapeHtml(data.shortSymbol)}`,
      `   • Объём: <code>${data.shortQty}</code>`,
      `   • Цена входа: <code>$${data.shortPrice.toFixed(2)}</code>`,
      ``,
      `💰 <b>Маржа:</b> <code>$${data.allocatedMargin.toFixed(2)} USDT</code> (Плечо: <code>${data.leverage.toFixed(1)}x</code>)`,
      `📈 <b>Позиция:</b> <code>$${data.totalVolume.toFixed(2)} USDT</code>`,
      goalsLine,
      `━━━━━━━━━━━━━━━━━━`,
      `⏱ <i>Время входа: ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} UTC</i>`,
    ].join('\n');

    if (isMaster) {
      await this.sendToAdmins(message);
      return;
    }
    if (data.userId) {
      await this.sendToUser(data.userId, message);
    }
  }

  public async notifyTradeClosed(data: TradeClosedNotification): Promise<void> {
    const isMaster = Boolean(data.isMaster);
    const sourceBadge = isMaster
      ? '👑 <b>Мастер-стратегия (Benchmark)</b>'
      : `⚡ <b>LIVE: ${escapeHtml((data.exchange || 'EXCHANGE').toUpperCase())}</b> (${escapeHtml(data.accountName || data.userEmail || 'User')})`;

    const isWin = data.realizedPnl >= 0;
    const pnlSign = isWin ? '+' : '';
    const pnlEmoji = isWin ? '🟢' : '🔴';

    let reasonBadge = 'Закрытие позиции';
    const reasonLower = (data.exitReason || '').toLowerCase();
    if (reasonLower === 'tp') {
      reasonBadge = '🎯 <b>TAKE PROFIT (+5.0%)</b>';
    } else if (reasonLower === 'sl') {
      reasonBadge = '🛡️ <b>STOP LOSS (-1.5%)</b>';
    } else if (reasonLower === 'trend_flip') {
      reasonBadge = '🔄 <b>TREND FLIP (Разворот 4h тренда)</b>';
    } else if (reasonLower === 'panic' || reasonLower === 'panic_close') {
      reasonBadge = '🚨 <b>PANIC CLOSE (Экстренная ликвидация)</b>';
    }

    const durationStr = formatDuration(data.openedAt, data.closedAt);

    const message = [
      `🏁 <b>СДЕЛКА ЗАКРЫТА</b>`,
      `━━━━━━━━━━━━━━━━━━`,
      `${sourceBadge}`,
      `📊 <b>Пара:</b> <code>${escapeHtml(data.pairSymbol)}</code>`,
      `📌 <b>Причина:</b> ${reasonBadge}`,
      ``,
      `${pnlEmoji} <b>Итоговый PnL:</b> <b>${pnlSign}$${data.realizedPnl.toFixed(2)} USDT</b> (${pnlSign}${data.pnlPct.toFixed(2)}%)`,
      `💰 <b>Задействованная маржа:</b> <code>$${data.allocatedMargin.toFixed(2)} USDT</code>`,
      ``,
      `📐 <b>Ratio:</b> <code>${data.entryRatio.toFixed(4)}</code> ➔ <code>${data.exitRatio.toFixed(4)}</code>`,
      `🟢 <b>LONG выход:</b> <code>$${data.longEntryPrice.toFixed(2)}</code> ➔ <code>$${data.longExitPrice.toFixed(2)}</code>`,
      `🔴 <b>SHORT выход:</b> <code>$${data.shortEntryPrice.toFixed(2)}</code> ➔ <code>$${data.shortExitPrice.toFixed(2)}</code>`,
      durationStr ? `⏱ <b>Длительность:</b> <code>${durationStr}</code>` : '',
      `━━━━━━━━━━━━━━━━━━`,
      `⏱ <i>Время закрытия: ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} UTC</i>`,
    ]
      .filter(Boolean)
      .join('\n');

    if (isMaster) {
      await this.sendToAdmins(message);
      return;
    }
    if (data.userId) {
      await this.sendToUser(data.userId, message);
    }
  }
}

export const telegramNotifier = new TelegramNotifier();
