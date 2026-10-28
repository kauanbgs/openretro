const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const SERIES_DAYS = 30;
/** Hours of the day are shown in Brazil time, which has no daylight saving now. */
const BRT_HOURS = -3;

const query = (db, sql, ...args) => db.prepare(sql).bind(...args);
const one = (result) => result.results[0];
/** One value per UTC day for the last `days` days, oldest first. */
function perDay(rows, now, days, field = "n") {
  const today = Math.floor(now / DAY);
  const byDay = new Map(rows.map((row) => [row.day, row[field]]));
  return Array.from({ length: days }, (_, i) => {
    const day = today - (days - 1 - i);
    return { day: day * DAY, count: byDay.get(day) ?? 0 };
  });
}
const person = (row) => ({
  id: row.id,
  displayName: row.display_name,
  friendCode: row.friend_code,
  avatar: row.avatar ?? 0,
});

export async function insights(db, now) {
  const since = now - SERIES_DAYS * DAY;
  const [
    active,
    signups,
    messages,
    samples,
    funnel,
    games,
    consoles,
    buckets,
    social,
    topPlayers,
    mostBlocked,
    pendingSenders,
    alerts,
  ] = await db.batch([
    query(
      db,
      "SELECT day, COUNT(*) AS n FROM daily_active WHERE day >= ? GROUP BY day",
      Math.floor(since / DAY),
    ),
    query(
      db,
      "SELECT created_at / ? AS day, COUNT(*) AS n FROM users WHERE created_at > ? GROUP BY day",
      DAY,
      since,
    ),
    query(
      db,
      "SELECT created_at / ? AS day, COUNT(*) AS n FROM direct_messages WHERE created_at > ? GROUP BY day",
      DAY,
      since,
    ),
    query(
      db,
      "SELECT at, online FROM online_samples WHERE at > ? ORDER BY at",
      now - 14 * DAY,
    ),
    query(
      db,
      `SELECT COUNT(*) AS total,
        SUM(display_name IS NOT NULL) AS named,
        SUM(EXISTS (SELECT 1 FROM friendships f WHERE f.user_id = u.id)) AS withFriend,
        SUM(EXISTS (SELECT 1 FROM recent_games g WHERE g.user_id = u.id)) AS played,
        SUM(EXISTS (SELECT 1 FROM activity_log l WHERE l.kind = 'party-created' AND l.actor_id = u.id)) AS hosted
        FROM users u`,
    ),
    query(
      db,
      `SELECT title, console, COUNT(*) AS players, SUM(play_seconds) AS seconds
        FROM recent_games GROUP BY title, console ORDER BY players DESC, seconds DESC LIMIT 10`,
    ),
    query(
      db,
      `SELECT console, COUNT(DISTINCT user_id) AS players, SUM(play_seconds) AS seconds
        FROM recent_games GROUP BY console ORDER BY players DESC, seconds DESC LIMIT 8`,
    ),
    query(
      db,
      `SELECT CASE WHEN n = 0 THEN '0' WHEN n <= 2 THEN '1-2' WHEN n <= 5 THEN '3-5'
          WHEN n <= 10 THEN '6-10' ELSE '11+' END AS bucket, COUNT(*) AS users
        FROM (SELECT (SELECT COUNT(*) FROM friendships f WHERE f.user_id = u.id) AS n FROM users u)
        GROUP BY bucket`,
    ),
    query(
      db,
      `SELECT SUM(kind = 'friend-request') AS requests, SUM(kind = 'friend-accept') AS accepts
        FROM activity_log WHERE created_at > ?`,
      since,
    ),
    query(
      db,
      `SELECT u.id, u.display_name, u.friend_code, u.avatar, SUM(g.play_seconds) AS seconds
        FROM recent_games g JOIN users u ON u.id = g.user_id
        GROUP BY u.id ORDER BY seconds DESC LIMIT 10`,
    ),
    query(
      db,
      `SELECT u.id, u.display_name, u.friend_code, u.avatar, COUNT(*) AS n
        FROM blocks b JOIN users u ON u.id = b.blocked_id
        GROUP BY u.id ORDER BY n DESC LIMIT 10`,
    ),
    query(
      db,
      `SELECT u.id, u.display_name, u.friend_code, u.avatar, COUNT(*) AS n
        FROM friend_requests r JOIN users u ON u.id = r.sender_id
        GROUP BY u.id ORDER BY n DESC LIMIT 10`,
    ),
    query(
      db,
      "SELECT COUNT(*) AS n FROM email_alerts WHERE created_at > ?",
      now - DAY,
    ),
  ]);
  const f = one(funnel);
  const s = one(social);
  // Average online by hour of the day, over the days sampled.
  const byHour = Array.from({ length: 24 }, () => ({ sum: 0, n: 0 }));
  for (const { at, online } of samples.results) {
    const hour = (((Math.floor(at / HOUR) + BRT_HOURS) % 24) + 24) % 24;
    byHour[hour].sum += online;
    byHour[hour].n++;
  }
  const activeByDay = perDay(active.results, now, SERIES_DAYS);
  const signupsByDay = perDay(signups.results, now, SERIES_DAYS);
  const bucketOrder = ["0", "1-2", "3-5", "6-10", "11+"];
  return {
    activePerDay: activeByDay,
    signupsPerDay: signupsByDay,
    messagesPerDay: perDay(messages.results, now, SERIES_DAYS),
    onlineByHour: byHour.map(({ sum, n }) => (n ? sum / n : 0)),
    onlineSamples: samples.results.slice(-48),
    funnel: {
      total: f.total,
      named: f.named ?? 0,
      withFriend: f.withFriend ?? 0,
      played: f.played ?? 0,
      hosted: f.hosted ?? 0,
    },
    topGames: games.results,
    topConsoles: consoles.results,
    friendBuckets: bucketOrder.map((bucket) => ({
      bucket,
      users: buckets.results.find((row) => row.bucket === bucket)?.users ?? 0,
    })),
    acceptRate: s.requests ? Math.min(1, s.accepts / s.requests) : null,
    topPlayers: topPlayers.results.map((row) => ({
      ...person(row),
      seconds: row.seconds,
    })),
    mostBlocked: mostBlocked.results.map((row) => ({
      ...person(row),
      count: row.n,
    })),
    pendingSenders: pendingSenders.results.map((row) => ({
      ...person(row),
      count: row.n,
    })),
    emailAlertsDay: one(alerts).n,
  };
}
