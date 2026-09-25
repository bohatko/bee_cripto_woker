/** Public support contact. Opens a chat with the admin. */
export const SUPPORT_TELEGRAM_URL = 'https://t.me/bohvik';

/** Telegram chat, optionally with a prefilled message. */
export function supportTelegramUrl(text?: string): string {
  const trimmed = text?.trim();
  if (!trimmed) return SUPPORT_TELEGRAM_URL;
  return `${SUPPORT_TELEGRAM_URL}?text=${encodeURIComponent(trimmed)}`;
}
