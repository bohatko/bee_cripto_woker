import { CONFIG } from '../config.js';

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

export interface TradeOpenedNotification {
  isMaster?: boolean;
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

class TelegramNotifier {
  private token: string;
  private chatIds: string[];

  constructor() {
    this.token = CONFIG.telegramBotToken;
    this.chatIds = CONFIG.telegramChatIds;
  }

  public async sendMessage(htmlText: string): Promise<void> {
    if (!this.token || this.chatIds.length === 0) {
      return;
    }

    for (const chatId of this.chatIds) {
      try {
        const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
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

  public async notifyTradeOpened(data: TradeOpenedNotification): Promise<void> {
    const isMaster = Boolean(data.isMaster);
    const sourceBadge = isMaster
      ? '👑 <b>Мастер-стратегия (Benchmark)</b>'
      : `⚡ <b>Живой аккаунт: ${escapeHtml((data.exchange || 'EXCHANGE').toUpperCase())}</b> (${escapeHtml(data.accountName || data.userEmail || 'User')})`;

    const tp = data.takeProfitPct ?? CONFIG.takeProfitPct;
    const sl = data.stopLossPct ?? CONFIG.stopLossPct;

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
      `🎯 <b>Цели:</b> TP <code>+${tp.toFixed(1)}%</code> | SL <code>-${sl.toFixed(1)}%</code>`,
      `━━━━━━━━━━━━━━━━━━`,
      `⏱ <i>Время входа: ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} UTC</i>`,
    ].join('\n');

    await this.sendMessage(message);
  }

  public async notifyTradeClosed(data: TradeClosedNotification): Promise<void> {
    const isMaster = Boolean(data.isMaster);
    const sourceBadge = isMaster
      ? '👑 <b>Мастер-стратегия (Benchmark)</b>'
      : `⚡ <b>Живой аккаунт: ${escapeHtml((data.exchange || 'EXCHANGE').toUpperCase())}</b> (${escapeHtml(data.accountName || data.userEmail || 'User')})`;

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
    } else if (reasonLower === 'panic') {
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
    ].filter(Boolean).join('\n');

    await this.sendMessage(message);
  }
}

export const telegramNotifier = new TelegramNotifier();
