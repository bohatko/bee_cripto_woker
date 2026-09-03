/**
 * Site-wide date/time formatting: dd-mm-yyyy HH:mm
 */

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function toValidDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Format as dd-mm-yyyy (e.g. 04-09-2026) */
export function formatDate(value: string | number | Date | null | undefined): string {
  const d = toValidDate(value);
  if (!d) return '—';
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** Format as dd-mm-yyyy HH:mm (e.g. 04-09-2026 14:00) */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  const d = toValidDate(value);
  if (!d) return '—';
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Format as HH:mm (e.g. 14:00) */
export function formatTime(value: string | number | Date | null | undefined): string {
  const d = toValidDate(value);
  if (!d) return '—';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
