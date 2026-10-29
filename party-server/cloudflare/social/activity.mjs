/** How long the admin panel remembers what happened. */
export const ACTIVITY_DAYS = 180;
/** Playtest counts follow the admin log; feedback is kept for a year. */
export const PLAYTEST_FEEDBACK_DAYS = 365;
/** The social hub drops a connection after this long without a heartbeat. */
export const ONLINE_MS = 90000;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/**
 * Notes an event for the admin panel. Never throws: a missed entry must not
 * fail the request that caused it.
 */
export async function recordActivity(db, kind, actor, target, now) {
  try {
    await db
      .prepare(
        "INSERT INTO activity_log (kind,actor_id,target_id,created_at) VALUES (?,?,?,?)",
      )
      .bind(kind, actor ?? null, target ?? null, now)
      .run();
  } catch {
    // The log is best effort.
  }
}

/** The hourly cron: marks who was active in the last hour and counts who is online. */
export async function sampleActivity(db, now = Date.now()) {
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO daily_active (day,user_id) SELECT ?, user_id FROM sessions WHERE last_seen_at > ?",
      )
      .bind(Math.floor((now - 1) / DAY), now - HOUR),
    db
      .prepare(
        "INSERT OR REPLACE INTO online_samples (at,online) SELECT ?, COUNT(DISTINCT user_id) FROM sessions WHERE last_seen_at > ?",
      )
      .bind(now - (now % HOUR), now - ONLINE_MS),
    db
      .prepare("DELETE FROM daily_active WHERE day < ?")
      .bind(Math.floor(now / DAY) - ACTIVITY_DAYS),
    db
      .prepare("DELETE FROM online_samples WHERE at < ?")
      .bind(now - ACTIVITY_DAYS * DAY),
  ]);
}
