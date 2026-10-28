import { authenticate, database } from "./auth.mjs";
import { AccountError } from "./http.mjs";

const DAY = 24 * 60 * 60 * 1000;
const CHART_DAYS = 14;
const notFound = () => new AccountError(404, "Página não encontrada.");

/** The accounts allowed in, from the ADMIN_EMAILS secret (comma separated). */
export const adminEmails = (env) =>
  new Set(
    String(env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
// The panel lists people, so emails stay partly hidden: ka***@gmail.com.
export function maskEmail(email) {
  const [name, domain = ""] = String(email).split("@");
  return `${name.slice(0, 2)}***@${domain}`;
}
const person = (row, prefix = "") => ({
  id: row[`${prefix}id`],
  displayName: row[`${prefix}display_name`],
  friendCode: row[`${prefix}friend_code`],
  avatar: row[`${prefix}avatar`] ?? 0,
});
const clamp = (value, fallback, max) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
};
/** One count per UTC day for the last CHART_DAYS days, oldest first. */
function perDay(rows, now) {
  const today = Math.floor(now / DAY);
  const counts = new Map(rows.map((row) => [row.day, row.n]));
  return Array.from({ length: CHART_DAYS }, (_, i) => {
    const day = today - (CHART_DAYS - 1 - i);
    return { day: day * DAY, count: counts.get(day) ?? 0 };
  });
}
const count = (db, sql, ...args) => db.prepare(sql).bind(...args);

async function overview(db, now) {
  const since = now - CHART_DAYS * DAY;
  const [
    users,
    signups,
    active,
    online,
    friendships,
    requests,
    blocks,
    parties,
    signupDays,
    partyDays,
  ] = await db.batch([
    count(db, "SELECT COUNT(*) AS n FROM users"),
    count(
      db,
      "SELECT SUM(created_at > ?) AS d1, SUM(created_at > ?) AS d7, SUM(created_at > ?) AS d30 FROM users",
      now - DAY,
      now - 7 * DAY,
      now - 30 * DAY,
    ),
    count(
      db,
      `SELECT COUNT(DISTINCT CASE WHEN last_seen_at > ? THEN user_id END) AS d1,
        COUNT(DISTINCT CASE WHEN last_seen_at > ? THEN user_id END) AS d7 FROM sessions`,
      now - DAY,
      now - 7 * DAY,
    ),
    count(
      db,
      "SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE last_seen_at > ?",
      now - 5 * 60 * 1000,
    ),
    count(db, "SELECT COUNT(*) / 2 AS n FROM friendships"),
    count(db, "SELECT COUNT(*) AS n FROM friend_requests"),
    count(db, "SELECT COUNT(*) AS n FROM blocks"),
    count(
      db,
      `SELECT COUNT(*) AS total, SUM(created_at > ?) AS d1, SUM(created_at > ?) AS d7
        FROM activity_log WHERE kind = 'party-created'`,
      now - DAY,
      now - 7 * DAY,
    ),
    count(
      db,
      "SELECT created_at / ? AS day, COUNT(*) AS n FROM users WHERE created_at > ? GROUP BY day",
      DAY,
      since,
    ),
    count(
      db,
      `SELECT created_at / ? AS day, COUNT(*) AS n FROM activity_log
        WHERE kind = 'party-created' AND created_at > ? GROUP BY day`,
      DAY,
      since,
    ),
  ]);
  const one = (result) => result.results[0];
  return {
    users: one(users).n,
    signups: {
      day: one(signups).d1 ?? 0,
      week: one(signups).d7 ?? 0,
      month: one(signups).d30 ?? 0,
    },
    active: { day: one(active).d1, week: one(active).d7 },
    onlineNow: one(online).n,
    friendships: one(friendships).n,
    pendingRequests: one(requests).n,
    blocks: one(blocks).n,
    parties: {
      total: one(parties).total,
      day: one(parties).d1 ?? 0,
      week: one(parties).d7 ?? 0,
    },
    signupsPerDay: perDay(signupDays.results, now),
    partiesPerDay: perDay(partyDays.results, now),
  };
}

async function users(db, url) {
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 64);
  const limit = clamp(url.searchParams.get("limit"), 50, 100);
  const offset = clamp(url.searchParams.get("offset"), 0, 100000);
  const like = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.friend_code, u.avatar, u.created_at,
        (SELECT MAX(last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at,
        (SELECT COUNT(*) FROM friendships f WHERE f.user_id = u.id) AS friends
      FROM users u
      WHERE ?1 = '' OR u.display_name LIKE ?2 ESCAPE '\\' OR u.friend_code LIKE ?2 ESCAPE '\\'
        OR u.email LIKE ?2 ESCAPE '\\' OR u.id = ?1
      ORDER BY u.created_at DESC LIMIT ?3 OFFSET ?4`,
    )
    .bind(query, like, limit + 1, offset)
    .all();
  return {
    users: rows.results.slice(0, limit).map((row) => ({
      ...person(row),
      email: maskEmail(row.email),
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      friends: row.friends,
    })),
    more: rows.results.length > limit,
  };
}

const eventView = (row) => ({
  id: row.id,
  kind: row.kind,
  at: row.created_at,
  actor: row.actor_pk ? person(row, "actor_") : null,
  target: row.target_pk ? person(row, "target_") : null,
});
const EVENT_SQL = `SELECT l.id, l.kind, l.created_at,
  a.id AS actor_pk, a.id AS actor_id, a.display_name AS actor_display_name, a.friend_code AS actor_friend_code, a.avatar AS actor_avatar,
  t.id AS target_pk, t.id AS target_id, t.display_name AS target_display_name, t.friend_code AS target_friend_code, t.avatar AS target_avatar
  FROM activity_log l LEFT JOIN users a ON a.id = l.actor_id LEFT JOIN users t ON t.id = l.target_id`;

async function activity(db, url) {
  const kind = url.searchParams.get("kind") ?? "";
  const limit = clamp(url.searchParams.get("limit"), 50, 100);
  const before = clamp(url.searchParams.get("before"), Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const rows = await db
    .prepare(
      `${EVENT_SQL} WHERE (?1 = '' OR l.kind = ?1) AND l.id < ?2 ORDER BY l.id DESC LIMIT ?3`,
    )
    .bind(kind.slice(0, 32), before, limit + 1)
    .all();
  return {
    events: rows.results.slice(0, limit).map(eventView),
    more: rows.results.length > limit,
  };
}

async function userDetail(db, id) {
  const user = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  if (!user) throw notFound();
  const [seen, friends, counts, games, events] = await db.batch([
    count(db, "SELECT MAX(last_seen_at) AS at, COUNT(*) AS n FROM sessions WHERE user_id = ?", id),
    count(
      db,
      `SELECT u.id, u.display_name, u.friend_code, u.avatar, f.created_at FROM friendships f
        JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? ORDER BY f.created_at DESC LIMIT 200`,
      id,
    ),
    count(
      db,
      `SELECT (SELECT COUNT(*) FROM friend_requests WHERE sender_id = ?1) AS sent,
        (SELECT COUNT(*) FROM friend_requests WHERE receiver_id = ?1) AS received,
        (SELECT COUNT(*) FROM blocks WHERE user_id = ?1) AS blocking,
        (SELECT COUNT(*) FROM blocks WHERE blocked_id = ?1) AS blockedBy,
        (SELECT COUNT(*) FROM direct_messages WHERE sender_id = ?1) AS messagesSent`,
      id,
    ),
    count(
      db,
      "SELECT title, console, last_played_at, play_seconds FROM recent_games WHERE user_id = ? ORDER BY last_played_at DESC LIMIT 10",
      id,
    ),
    count(
      db,
      `${EVENT_SQL} WHERE l.actor_id = ?1 OR l.target_id = ?1 ORDER BY l.id DESC LIMIT 50`,
      id,
    ),
  ]);
  const c = counts.results[0];
  return {
    user: {
      ...person(user),
      email: maskEmail(user.email),
      createdAt: user.created_at,
      lastSeenAt: seen.results[0].at,
      sessions: seen.results[0].n,
      discoverable: Boolean(user.discoverable),
      appearOffline: Boolean(user.appear_offline),
    },
    friends: friends.results.map((row) => ({ ...person(row), since: row.created_at })),
    counts: {
      requestsSent: c.sent,
      requestsReceived: c.received,
      blocking: c.blocking,
      blockedBy: c.blockedBy,
      messagesSent: c.messagesSent,
    },
    games: games.results.map((row) => ({
      title: row.title,
      console: row.console,
      lastPlayedAt: row.last_played_at,
      playSeconds: row.play_seconds,
    })),
    events: events.results.map(eventView),
  };
}

/** Read-only panel API. Anyone who is not listed in ADMIN_EMAILS gets a plain 404. */
export async function adminRoute(request, env, url) {
  if (request.method !== "GET") throw notFound();
  const db = database(env, url),
    now = Date.now();
  let user;
  try {
    ({ user } = await authenticate(request, db, now));
  } catch (error) {
    if (error instanceof AccountError && error.status === 401) throw error;
    throw notFound();
  }
  if (!adminEmails(env).has(user.email.toLowerCase())) throw notFound();
  const path = url.pathname;
  if (path === "/api/admin/me") return { data: { ok: true } };
  if (path === "/api/admin/overview")
    return { data: await overview(db, now) };
  if (path === "/api/admin/users") return { data: await users(db, url) };
  if (path === "/api/admin/activity")
    return { data: await activity(db, url) };
  const match = /^\/api\/admin\/users\/([a-f0-9-]{36})$/.exec(path);
  if (match) return { data: await userDetail(db, match[1]) };
  throw notFound();
}
