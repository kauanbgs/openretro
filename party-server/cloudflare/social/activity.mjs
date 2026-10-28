/** How long the admin panel remembers what happened. */
export const ACTIVITY_DAYS = 180;

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
