import { hmac } from "./crypto.mjs";
import { AccountError } from "./http.mjs";

export const QUOTA_MS = 15 * 60 * 1000;
export async function quota(db, pepper, scope, subject, max, now) {
  const key = await hmac(
    pepper,
    JSON.stringify(["auth-quota", scope, subject]),
  );
  // One conditional UPSERT serializes increments across Worker instances.
  const row = await db
    .prepare(
      `INSERT INTO auth_rate_limits (key, count, expires_at)
    VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET
    count = CASE WHEN expires_at <= ? THEN 1 ELSE count + 1 END,
    expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
    RETURNING count, expires_at`,
    )
    .bind(key, now + QUOTA_MS, now, now)
    .first();
  if (row.count > max)
    throw new AccountError(
      429,
      "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.",
      Math.max(1, Math.ceil((row.expires_at - now) / 1000)),
    );
}
export const emailQuotaKey = (pepper, email) =>
  hmac(pepper, JSON.stringify(["auth-quota", "start-email", email]));
export async function cleanupSocial(db, now = Date.now()) {
  await db.batch([
    db.prepare("DELETE FROM login_codes WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM auth_rate_limits WHERE expires_at <= ?").bind(now),
  ]);
}
