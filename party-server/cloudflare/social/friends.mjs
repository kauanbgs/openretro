import { authenticate, database } from "./auth.mjs";
import { AccountError, readJson } from "./http.mjs";
import { quota } from "./limits.mjs";
import { hubCall, presenceFor } from "./hub.mjs";
import { partyRoute } from "./invites.mjs";
import { FRIEND_CODE } from "./friend-code.mjs";
import { peopleRoute } from "./people.mjs";
import { historyRoute } from "./history.mjs";

export const friendView = (row) => ({
  id: row.id,
  displayName: row.display_name,
  friendCode: row.friend_code,
  avatar: row.avatar ?? 0,
});
export const primary = (env) => env.SOCIAL_DB.withSession("first-primary");
export async function related(db, user, friend) {
  return !!(await db
    .prepare(
      `SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?
    AND NOT EXISTS (SELECT 1 FROM blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?))`,
    )
    .bind(user, friend, user, friend, friend, user)
    .first());
}
export async function notifyUsers(env, ids, event = "changed") {
  if (!env.SOCIAL_HUB) return;
  await Promise.all(
    [...new Set(ids)].map((id) =>
      hubCall(env, id, "/refresh", { id, event }).catch(() => {}),
    ),
  );
}
export async function friendsRoute(request, env, url) {
  const db = database(env, url),
    now = Date.now();
  const { user, session } = await authenticate(request, db, now);
  if (url.pathname === "/api/friends/history")
    return historyRoute(request, env, { db, user, now });
  if (
    url.pathname === "/api/friends/people" ||
    url.pathname.startsWith("/api/friends/people/")
  )
    return peopleRoute(request, env, url, { db, user, now });
  if (url.pathname.startsWith("/api/friends/party/"))
    return partyRoute(request, env, url, { db, user, session, now });
  if (url.pathname === "/social") {
    if (
      request.method !== "GET" ||
      request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
    )
      throw new AccountError(426, "Use uma conexão WebSocket.");
    if (!env.SOCIAL_HUB)
      throw new AccountError(503, "O social ainda não está disponível.");
    // The token travels only in an Authorization header, never a URL or attachment.
    return {
      response: await hubCall(env, user.id, "/connect", {
        id: user.id,
        sessionId: session.id,
      }),
    };
  }
  if (url.pathname === "/api/friends" && request.method === "GET") {
    const queries = [
      `SELECT u.id,u.display_name,u.friend_code,u.avatar FROM users u JOIN friendships f ON f.friend_id=u.id WHERE f.user_id=?
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.user_id=? AND b.blocked_id=u.id) OR (b.user_id=u.id AND b.blocked_id=?))`,
      `SELECT u.id,u.display_name,u.friend_code,u.avatar FROM users u JOIN friend_requests r ON r.sender_id=u.id WHERE r.receiver_id=?`,
      `SELECT u.id,u.display_name,u.friend_code,u.avatar FROM users u JOIN friend_requests r ON r.receiver_id=u.id WHERE r.sender_id=?`,
      `SELECT u.id,u.display_name,u.friend_code,u.avatar FROM users u JOIN blocks b ON b.blocked_id=u.id WHERE b.user_id=?`,
    ];
    const [friends, incoming, outgoing, blocked] = await db.batch(
      queries.map((sql, i) =>
        db
          .prepare(sql)
          .bind(...(i === 0 ? [user.id, user.id, user.id] : [user.id])),
      ),
    );
    const rows = await Promise.all(
      friends.results.map(async (row) => ({
        ...friendView(row),
        presence: await presenceFor(env, user.id, row.id),
      })),
    );
    return {
      data: {
        friends: rows,
        incoming: incoming.results.map(friendView),
        outgoing: outgoing.results.map(friendView),
        blocked: blocked.results.map(friendView),
      },
    };
  }
  if (request.method !== "POST" || url.pathname !== "/api/friends/action")
    throw new AccountError(404, "Página não encontrada.");
  const body = await readJson(request);
  if (
    Object.keys(body).some((key) => !["action", "target"].includes(key)) ||
    typeof body.target !== "string"
  )
    throw new AccountError(400, "Dados de amizade inválidos.");
  const action = body.action;
  if (
    ![
      "request",
      "accept",
      "decline",
      "cancel",
      "remove",
      "block",
      "unblock",
    ].includes(action)
  )
    throw new AccountError(400, "Ação inválida.");
  await quota(db, env.AUTH_PEPPER, "friend-actions", user.id, 120, now);
  let target;
  if (action === "request") {
    const code = body.target.trim().toLowerCase();
    if (!FRIEND_CODE.test(code))
      throw new AccountError(400, "Confira o código de amigo.");
    target = await db
      .prepare("SELECT id FROM users WHERE friend_code = ?")
      .bind(code)
      .first();
  } else if (/^[a-f0-9-]{36}$/.test(body.target)) target = { id: body.target };
  if (!target || target.id === user.id)
    throw new AccountError(400, "Não foi possível encontrar esse jogador.");
  const id = target.id;
  const blocked = await db
    .prepare(
      "SELECT 1 FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)",
    )
    .bind(user.id, id, id, user.id)
    .first();
  if (action === "request") {
    // The daily quota is independent of pending requests: cancelling does not reset it.
    await quota(
      db,
      env.AUTH_PEPPER,
      "friend-requests-day",
      user.id,
      20,
      now,
      86400000,
    );
    if (blocked)
      throw new AccountError(
        400,
        "Não foi possível enviar o pedido para esse jogador.",
      );
    const count = await db
      .prepare("SELECT COUNT(*) AS n FROM friendships WHERE user_id=?")
      .bind(user.id)
      .first();
    if (count.n >= 200)
      throw new AccountError(400, "Você atingiu o limite de 200 amigos.");
    const result = await db
      .prepare(
        `INSERT OR IGNORE INTO friend_requests (sender_id,receiver_id,created_at)
      SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM friendships WHERE user_id=? AND friend_id=?)
      AND NOT EXISTS (SELECT 1 FROM friend_requests WHERE sender_id=? AND receiver_id=?)
      AND (SELECT COUNT(*) FROM friend_requests WHERE sender_id=?) < 100
      AND (SELECT COUNT(*) FROM friend_requests WHERE receiver_id=?) < 100
      AND NOT EXISTS (SELECT 1 FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?))`,
      )
      .bind(
        user.id,
        id,
        now,
        user.id,
        id,
        id,
        user.id,
        user.id,
        id,
        user.id,
        id,
        id,
        user.id,
      )
      .run();
    if (!result.meta.changes)
      throw new AccountError(
        409,
        "Já existe uma amizade ou um pedido entre vocês.",
      );
  } else if (action === "accept") {
    const condition = `EXISTS (SELECT 1 FROM friend_requests WHERE sender_id=? AND receiver_id=?)
      AND NOT EXISTS (SELECT 1 FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?))
      AND (SELECT COUNT(*) FROM friendships WHERE user_id=?) < 200 AND (SELECT COUNT(*) FROM friendships WHERE user_id=?) < 200`;
    // Both directed edges and removal of the request commit together.
    const args = [id, user.id, user.id, id, id, user.id, user.id, id];
    const results = await db.batch([
      db
        .prepare(
          `INSERT OR IGNORE INTO friendships SELECT ?,?,? WHERE ${condition}`,
        )
        .bind(user.id, id, now, ...args),
      db
        .prepare(
          `INSERT OR IGNORE INTO friendships SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM friendships WHERE user_id=? AND friend_id=?)`,
        )
        .bind(id, user.id, now, user.id, id),
      db
        .prepare(
          "DELETE FROM friend_requests WHERE ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)) AND EXISTS (SELECT 1 FROM friendships WHERE user_id=? AND friend_id=?)",
        )
        .bind(id, user.id, user.id, id, user.id, id),
    ]);
    if (!results[0].meta.changes)
      throw new AccountError(
        409,
        "Este pedido não está mais disponível ou o limite de amigos foi atingido.",
      );
  } else if (action === "decline" || action === "cancel") {
    await db
      .prepare(
        "DELETE FROM friend_requests WHERE sender_id=? AND receiver_id=?",
      )
      .bind(...(action === "cancel" ? [user.id, id] : [id, user.id]))
      .run();
  } else if (action === "unblock") {
    await db
      .prepare("DELETE FROM blocks WHERE user_id=? AND blocked_id=?")
      .bind(user.id, id)
      .run();
  } else {
    const statements = [
      db
        .prepare(
          "DELETE FROM friendships WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)",
        )
        .bind(user.id, id, id, user.id),
      db
        .prepare(
          "DELETE FROM friend_requests WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)",
        )
        .bind(user.id, id, id, user.id),
    ];
    if (action === "block") {
      const count = await db
        .prepare("SELECT COUNT(*) AS n FROM blocks WHERE user_id=?")
        .bind(user.id)
        .first();
      if (count.n >= 200)
        throw new AccountError(400, "Você atingiu o limite de 200 bloqueios.");
      statements.unshift(
        db
          .prepare(
            "INSERT OR IGNORE INTO blocks SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM users WHERE id=?)",
          )
          .bind(user.id, id, now, id),
      );
    }
    await db.batch(statements);
  }
  await notifyUsers(
    env,
    [user.id, id],
    action === "request"
      ? "request"
      : action === "accept"
        ? "accepted"
        : "changed",
  );
  return { status: 204 };
}
