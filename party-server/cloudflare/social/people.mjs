import { AccountError } from "./http.mjs";
import { quota } from "./limits.mjs";
import { presenceFor, offline } from "./hub.mjs";

const uuid = (value) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const view = (row) => ({
  id: row.id,
  displayName: row.display_name,
  friendCode: row.friend_code,
  avatar: row.avatar,
  relationship: row.relationship,
});
export async function peopleRoute(request, env, url, { db, user, now }) {
  if (request.method !== "GET") throw new AccountError(405, "Método inválido.");
  await quota(db, env.AUTH_PEPPER, "people-read", user.id, 120, now);
  const detail = url.pathname !== "/api/friends/people";
  const id = detail ? url.pathname.slice("/api/friends/people/".length) : null;
  const cursor = url.searchParams.get("after");
  if (
    [...url.searchParams.keys()].some((key) => key !== "after") ||
    url.searchParams.getAll("after").length > 1 ||
    (detail && (url.search || !uuid(id))) ||
    (!detail && cursor !== null && !uuid(cursor))
  )
    throw new AccountError(400, "Consulta de pessoas inválida.");
  // Discovery lists identity only; the detail response adds authorized activity.
  const sql = `SELECT u.id,u.display_name,u.friend_code,u.avatar,
    CASE WHEN EXISTS (SELECT 1 FROM friendships f WHERE f.user_id=? AND f.friend_id=u.id) THEN 'friend'
    WHEN EXISTS (SELECT 1 FROM friend_requests r WHERE r.sender_id=? AND r.receiver_id=u.id) THEN 'outgoing'
    WHEN EXISTS (SELECT 1 FROM friend_requests r WHERE r.receiver_id=? AND r.sender_id=u.id) THEN 'incoming'
    ELSE 'none' END AS relationship
    FROM users u WHERE ${detail ? "(u.discoverable=1 OR u.id=? OR EXISTS (SELECT 1 FROM friendships f WHERE f.user_id=? AND f.friend_id=u.id))" : "u.discoverable=1 AND u.id<>?"}
    AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.user_id=? AND b.blocked_id=u.id) OR (b.user_id=u.id AND b.blocked_id=?))
    AND u.id ${detail ? "=" : ">"} ? ORDER BY u.id ASC LIMIT ${detail ? 1 : 25}`;
  const result = await db
    .prepare(sql)
    .bind(
      user.id,
      user.id,
      user.id,
      ...(detail ? [user.id, user.id] : [user.id]),
      user.id,
      user.id,
      detail ? id : (cursor ?? ""),
    )
    .all();
  if (detail) {
    if (!result.results.length)
      throw new AccountError(404, "Este perfil não está disponível.");
    const person = view(result.results[0]);
    const self = person.id === user.id;
    const settings = await db
      .prepare("SELECT share_history,created_at FROM users WHERE id=?")
      .bind(person.id)
      .first();
    const historyVisible =
      self || (person.relationship === "friend" && !!settings.share_history);
    const games = historyVisible
      ? (
          await db
            .prepare(
              "SELECT title,console,cover,last_played_at AS lastPlayedAt,play_seconds AS playSeconds FROM recent_games WHERE user_id=? ORDER BY last_played_at DESC,title,console LIMIT 10",
            )
            .bind(person.id)
            .all()
        ).results
      : [];
    return {
      data: {
        ...person,
        isSelf: self,
        createdAt: settings.created_at,
        historyVisible,
        recentGames: games,
        presence:
          self || person.relationship === "friend"
            ? await presenceFor(env, user.id, person.id)
            : offline(),
      },
    };
  }
  const rows = result.results.slice(0, 24);
  return {
    data: {
      people: rows.map(view),
      next: result.results.length > 24 ? rows.at(-1).id : null,
    },
  };
}
