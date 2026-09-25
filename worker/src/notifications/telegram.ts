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

  // ==============================================================================
  // DIP-BUY XRP SIGNALS NOTIFICATIONS
  // ==============================================================================

  public async notifySignalReadiness(
    threshold: number,
    liveState: { price: number; rolling_max: number; drop_pct: number; readiness_pct: number },
    targetUserIds?: string[],
    symbol = 'XRP'
  ): Promise<void> {
    const sym = symbol.toUpperCase();
    const message = [
      `👀 <b>СИГНАЛ БЛИЗОК: ${sym} DIP-BUY (${threshold}%)</b>`,
      `━━━━━━━━━━━━━━━━━━`,
      `⚡ <b>Readiness:</b> <code>${liveState.readiness_pct.toFixed(1)}%</code> (порог ${threshold}%)`,
      `📉 <b>Падение за период:</b> <code>-${liveState.drop_pct.toFixed(2)}%</code>`,
      `💰 <b>Текущая цена:</b> <code>$${liveState.price.toFixed(4)}</code>`,
      `🔝 <b>Локальный максимум:</b> <code>$${liveState.rolling_max.toFixed(4)}</code>`,
      `━━━━━━━━━━━━━━━━━━`,
      `ℹ️ <i>При достижении цели сработает автоматический вход LONG для активных аккаунтов.</i>`,
    ].join('\n');

    await this.sendToAdmins(message);

    if (targetUserIds && targetUserIds.length > 0) {
      for (const uid of targetUserIds) {
        await this.sendToUser(uid, message);
      }
    }
  }

  public async notifySignalFired(event: {
    symbol: string;
    signal_close: number;
    rolling_max: number;
    drop_pct: number;
    reference_entry_price: number;
  }, targetUserIds?: string[]): Promise<void> {
    const message = [
      `🚨 <b>СИГНАЛ СРАБОТАЛ: ${escapeHtml(event.symbol)} DIP-BUY</b>`,
      `━━━━━━━━━━━━━━━━━━`,
      `🎯 <b>Условие:</b> Падение ≥ 15% за 24h выполнено!`,
      `📉 <b>Зафиксированное падение:</b> <code>-${event.drop_pct.toFixed(2)}%</code>`,
      `💰 <b>Цена закрытия свечи:</b> <code>$${event.signal_close.toFixed(4)}</code>`,
      `🔝 <b>24h High:</b> <code>$${event.rolling_max.toFixed(4)}</code>`,
      `🚀 <b>Ориентир входа:</b> <code>~$${event.reference_entry_price.toFixed(4)}</code>`,
      `🎯 <b>Цели:</b> TP <code>+4.0%</code> | SL <code>-30.0%</code> | Плечо <code>3.0x</code>`,
      `━━━━━━━━━━━━━━━━━━`,
      `⚡ <i>Отправка ордеров на исполнение...</i>`,
    ].join('\n');

    await this.sendToAdmins(message);

    if (targetUserIds && targetUserIds.length > 0) {
      for (const uid of targetUserIds) {
        await this.sendToUser(uid, message);
      }
    }
  }

  public async notifySignalOpened(data: {
    isMaster?: boolean;
    userId?: string | null;
    userEmail?: string;
    exchange?: string;
    accountName?: string;
    symbol: string;
    entryPrice: number;
    qty: number;
    allocatedMargin: number;
    notional: number;
    leverage: number;
    tpPrice?: number | null;
    slPrice?: number | null;
  }): Promise<void> {
    const isMaster = Boolean(data.isMaster);
    const sourceBadge = isMaster
      ? '👑 <b>Master Paper Portfolio (Benchmark)</b>'
      : `⚡ <b>LIVE: ${escapeHtml((data.exchange || 'EXCHANGE').toUpperCase())}</b> (${escapeHtml(data.accountName || data.userEmail || 'User')})`;

    const message = [
      `🐝 <b>DIP-BUY ПОЗИЦИЯ ОТКРЫТА</b>`,
      `━━━━━━━━━━━━━━━━━━`,
      `${sourceBadge}`,
      `📊 <b>Монета:</b> <code>${escapeHtml(data.symbol)}/USDT</code> (LONG)`,
      `💰 <b>Цена входа:</b> <code>$${data.entryPrice.toFixed(4)}</code>`,
      `📦 <b>Количество:</b> <code>${data.qty} ${escapeHtml(data.symbol)}</code>`,
      `💵 <b>Маржа:</b> <code>$${data.allocatedMargin.toFixed(2)} USDT</code> (Плечо: <code>${data.leverage.toFixed(1)}x</code>)`,
      `📈 <b>Объем позиции:</b> <code>$${data.notional.toFixed(2)} USDT</code>`,
      data.tpPrice ? `🎯 <b>Take Profit:</b> <code>$${data.tpPrice.toFixed(4)} (+4.0%)</code>` : '',
      data.slPrice ? `🛡️ <b>Stop Loss:</b> <code>$${data.slPrice.toFixed(4)} (-30.0%)</code>` : '',
      `━━━━━━━━━━━━━━━━━━`,
      `⏱ <i>Время входа: ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} UTC</i>`,
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

  public async notifySignalClosed(data: {
    isMaster?: boolean;
    userId?: string | null;
    userEmail?: string;
    exchange?: string;
    accountName?: string;
    symbol: string;
    exitReason: string;
    realizedPnl: number;
    pnlPct: number;
    allocatedMargin: number;
    entryPrice: number;
    exitPrice: number;
    openedAt?: string;
    closedAt?: string;
  }): Promise<void> {
    const isMaster = Boolean(data.isMaster);
    const sourceBadge = isMaster
      ? '👑 <b>Master Paper Portfolio (Benchmark)</b>'
      : `⚡ <b>LIVE: ${escapeHtml((data.exchange || 'EXCHANGE').toUpperCase())}</b> (${escapeHtml(data.accountName || data.userEmail || 'User')})`;

    const isWin = data.realizedPnl >= 0;
    const pnlSign = isWin ? '+' : '';
    const pnlEmoji = isWin ? '🟢' : '🔴';

    let reasonBadge = 'Закрытие позиции';
    const reasonLower = (data.exitReason || '').toLowerCase();
    if (reasonLower === 'tp') {
      reasonBadge = '🎯 <b>TAKE PROFIT</b>';
    } else if (reasonLower === 'sl') {
      reasonBadge = '🛡️ <b>STOP LOSS</b>';
    } else if (reasonLower === 'panic' || reasonLower === 'panic_close') {
      reasonBadge = '🚨 <b>PANIC CLOSE (Экстренно)</b>';
    } else if (reasonLower === 'admin_close') {
      reasonBadge = '⚙️ <b>ADMIN CLOSE</b>';
    } else if (reasonLower === 'external_flat') {
      reasonBadge = '🔄 <b>EXTERNAL FLAT (Закрыто на бирже)</b>';
    }

    const durationStr = formatDuration(data.openedAt, data.closedAt);

    const message = [
      `🏁 <b>DIP-BUY ПОЗИЦИЯ ЗАКРЫТА</b>`,
      `━━━━━━━━━━━━━━━━━━`,
      `${sourceBadge}`,
      `📊 <b>Монета:</b> <code>${escapeHtml(data.symbol)}/USDT</code>`,
      `📌 <b>Причина:</b> ${reasonBadge}`,
      ``,
      `${pnlEmoji} <b>Итоговый PnL:</b> <b>${pnlSign}$${data.realizedPnl.toFixed(2)} USDT</b> (${pnlSign}${data.pnlPct.toFixed(2)}%)`,
      `💰 <b>Задействованная маржа:</b> <code>$${data.allocatedMargin.toFixed(2)} USDT</code>`,
      `🟢 <b>Вход:</b> <code>$${data.entryPrice.toFixed(4)}</code> ➔ <b>Выход:</b> <code>$${data.exitPrice.toFixed(4)}</code>`,
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

  public async notifyGridStarted(data: {
    userId: string;
    exchange: string;
    symbol: string;
    marginUsdt: number;
    leverage: number;
    lowerPrice: number;
    upperPrice: number;
    gridCount: number;
  }): Promise<void> {
    const message = [
      `🐝 <b>ГРИД-БОТ ЗАПУЩЕН</b>`,
      `━━━━━━━━━━━━━━━━━━`,
      `📊 <b>Монета:</b> <code>${escapeHtml(data.symbol)}/USDT</code>`,
      `🏦 <b>Биржа:</b> <code>${escapeHtml(data.exchange.toUpperCase())}</code>`,
      `💵 <b>Маржа:</b> <code>${data.marginUsdt.toFixed(2)} USDT</code>`,
      `📈 <b>Плечо:</b> <code>${data.leverage}x</code>`,
      `📐 <b>Диапазон:</b> <code>${data.lowerPrice} – ${data.upperPrice}</code>`,
      `▦ <b>Сетки:</b> <code>${data.gridCount}</code>`,
      `━━━━━━━━━━━━━━━━━━`,
      `⏱ <i>${new Date().toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })} UTC</i>`,
    ].join('\n');
    await this.sendToUser(data.userId, message);
  }

  public async notifyGridStopped(data: {
    userId: string;
    exchange: string;
    symbol: string;
    marginUsdt: number;
    reason: 'user' | 'exchange';
    pnlUsdt?: number | null;
  }): Promise<void> {
    const reason =
      data.reason === 'exchange' ? 'Биржа остановила бота' : 'Остановлен вручную';
    const pnl =
      data.pnlUsdt == null
        ? ''
        : `${data.pnlUsdt >= 0 ? '🟢' : '🔴'} <b>PnL:</b> <code>${data.pnlUsdt >= 0 ? '+' : ''}${data.pnlUsdt.toFixed(2)} USDT</code>`;
    const message = [
      `🏁 <b>ГРИД-БОТ ОСТАНОВЛЕН</b>`,
      `━━━━━━━━━━━━━━━━━━`,
      `📊 <b>Монета:</b> <code>${escapeHtml(data.symbol)}/USDT</code>`,
      `🏦 <b>Биржа:</b> <code>${escapeHtml(data.exchange.toUpperCase())}</code>`,
      `💵 <b>Маржа:</b> <code>${data.marginUsdt.toFixed(2)} USDT</code>`,
      `📌 <b>Причина:</b> ${reason}`,
      pnl,
      `━━━━━━━━━━━━━━━━━━`,
      `⏱ <i>${new Date().toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })} UTC</i>`,
    ]
      .filter(Boolean)
      .join('\n');
    await this.sendToUser(data.userId, message);
  }

  public async notifySubscriptionEnding(data: {
    userId: string;
    withinHours: 24 | 12;
    period: 'trial' | 'subscription';
    plan: string;
    intervalLabel: string;
    amountUsd: number;
    endsAtIso: string;
  }): Promise<void> {
    const when = data.withinHours === 24 ? 'меньше суток' : 'меньше 12 часов';
    const what = data.period === 'trial' ? 'Пробный период' : 'Оплаченная подписка';
    const ends = new Date(data.endsAtIso).toLocaleString('ru-RU', {
      timeZone: 'UTC',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const message = [
      `🐝 <b>НУЖНО ОПЛАТИТЬ ПОДПИСКУ</b>`,
      `━━━━━━━━━━━━━━━━━━`,
      `${what} заканчивается через <b>${when}</b>.`,
      `📦 <b>Тариф:</b> <code>${escapeHtml(data.plan)} · ${escapeHtml(data.intervalLabel)}</code>`,
      `💵 <b>Сумма:</b> <code>${data.amountUsd.toFixed(2)} USDT</code>`,
      `⏱ <b>Окончание:</b> <code>${ends} UTC</code>`,
      `━━━━━━━━━━━━━━━━━━`,
      `Оплатите в разделе <b>Оплата и инвойсы</b>, чтобы бот не перестал открывать новые сделки.`,
    ].join('\n');
    await this.sendToUser(data.userId, message);
  }
}

export const telegramNotifier = new TelegramNotifier();

