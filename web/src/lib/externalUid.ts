/**
 * Bee ID — unique 7-digit payment reference.
 *
 * The value is deterministic: it is derived from the user's UUID so the UI can
 * display and copy it even before `users_profile.external_uid` is populated.
 * The SQL migration uses the exact same formula, so the displayed value never
 * changes once the column is filled:
 *
 *   SQL: (((('x' || substr(replace(p_user_id::text, '-', ''), 1, 8))::bit(32)::bigint) % 9000000) + 1000000)::text
 */

const UID_RANGE = 9000000;
const UID_OFFSET = 1000000;

/** Deterministically derive the 7-digit Bee ID from a user UUID. */
export function deriveExternalUid(userId: string | null | undefined): string {
  if (!userId) return '';
  const hex = userId.replace(/-/g, '').slice(0, 8);
  const parsed = Number.parseInt(hex, 16);
  if (!Number.isFinite(parsed)) return '';
  const value = (parsed >>> 0) % UID_RANGE;
  return String(value + UID_OFFSET);
}

/**
 * Prefer the persisted `users_profile.external_uid`; fall back to the derived
 * value while the migration has not been applied yet or the row is empty.
 */
export function resolveExternalUid(
  userId: string | null | undefined,
  storedUid?: string | null
): string {
  const stored = (storedUid || '').trim();
  if (stored) return stored;
  return deriveExternalUid(userId);
}
