import { hubCall, offline } from "./hub.mjs";
import { sha256 } from "./crypto.mjs";
import { ONLINE_MS } from "./activity.mjs";

const MAX_LIVE = 100;
/** What the social hub says one account is doing; players who hide it read as offline. */
export async function presenceOf(env, id) {
  if (!env.SOCIAL_HUB) return offline();
  try {
    const response = await hubCall(env, id, "/presence", { id });
    return response.ok ? await response.json() : offline();
  } catch {
    return offline();
  }
}

/** Accounts seen in the last minute and a half, what they play and who shares a Party. */
export async function live(env, db, now) {
  const rows = await db
    .prepare(
      `SELECT u.id, u.display_name, u.friend_code, u.avatar, MAX(s.last_seen_at) AS seen
        FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.last_seen_at > ? GROUP BY u.id ORDER BY seen DESC LIMIT ?`,
    )
    .bind(now - ONLINE_MS, MAX_LIVE + 1)
    .all();
  const shown = rows.results.slice(0, MAX_LIVE);
  const presences = await Promise.all(shown.map((r) => presenceOf(env, r.id)));
  const parties = new Map();
  const online = [];
  for (const [i, row] of shown.entries()) {
    const p = presences[i];
    // The room code is a way in, so the panel only groups by a short hash of it.
    const room = p.party ? (await sha256(p.party.code)).slice(0, 8) : null;
    if (room) parties.set(room, [...(parties.get(room) ?? []), row.id]);
    online.push({
      id: row.id,
      displayName: row.display_name,
      friendCode: row.friend_code,
      avatar: row.avatar ?? 0,
      seenAt: row.seen,
      status: p.status,
      playing: p.playing
        ? {
            title: p.playing.title,
            console: p.playing.console,
            startedAt: p.playing.startedAt,
          }
        : null,
      party: room,
    });
  }
  return {
    online,
    more: rows.results.length > MAX_LIVE,
    parties: [...parties.entries()].map(([room, members]) => ({
      room,
      members,
    })),
  };
}
