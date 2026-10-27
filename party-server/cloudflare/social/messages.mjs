import { AccountError, readJson } from "./http.mjs";
import { quota } from "./limits.mjs";
import { hubCall } from "./hub.mjs";
import { emailAlert, QUIET_MS } from "./alerts.mjs";

export const MAX_MESSAGE = 400;
const PAGE = 50,
  KEEP = 500,
  CONVERSATIONS = 50;
const uuid = (value) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
// Invisible and direction-changing characters can disguise a message.
const UNSAFE = /[\p{Cc}\p{Co}\p{Cn}\p{Cs}\p{Zl}\p{Zp}؜‎‏‪-‮⁦-⁩]/u;
const tooFast = "Você está enviando mensagens rápido demais. Aguarde um pouco.";

/** The stored form of a message, or an error the sender can act on. */
export function messageText(value) {
  if (typeof value !== "string")
    throw new AccountError(400, "Mensagem inválida.");
  const text = value
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) throw new AccountError(400, "Escreva uma mensagem.");
  if ([...text].length > MAX_MESSAGE)
    throw new AccountError(
      400,
      `A mensagem pode ter até ${MAX_MESSAGE} caracteres.`,
    );
  if (UNSAFE.test(text.replaceAll("\n", "")) || text.split("\n").length > 12)
    throw new AccountError(400, "Mensagem inválida.");
  return text;
}
const messageView = (row) => ({
  id: row.id,
  senderId: row.sender_id,
  body: row.body,
  createdAt: row.created_at,
});
const peerView = (row) => ({
  id: row.id,
  displayName: row.display_name,
  friendCode: row.friend_code,
  avatar: row.avatar ?? 0,
});
const between = `((sender_id=?1 AND receiver_id=?2) OR (sender_id=?2 AND receiver_id=?1))`;
const notBlocked = `NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.user_id=?1 AND b.blocked_id=?2) OR (b.user_id=?2 AND b.blocked_id=?1))`;
const friends = `EXISTS (SELECT 1 FROM friendships f WHERE f.user_id=?1 AND f.friend_id=?2)`;

/** Wakes the participants' open apps; they fetch what changed themselves. */
async function nudge(env, ids, peerOf) {
  if (!env.SOCIAL_HUB) return;
  await Promise.all(
    ids.map((id) =>
      hubCall(env, id, "/message", { id, peer: peerOf(id) }).catch(() => {}),
    ),
  );
}

export async function messagesRoute(request, env, url, { db, user, now }) {
  const [peer, extra, ...rest] = url.pathname
    .slice("/api/friends/messages".length)
    .split("/")
    .filter(Boolean);
  const before = url.searchParams.get("before");
  if (
    rest.length ||
    (peer !== undefined && (!uuid(peer) || peer === user.id)) ||
    (extra !== undefined && extra !== "read") ||
    [...url.searchParams.keys()].some((key) => key !== "before") ||
    url.searchParams.getAll("before").length > 1 ||
    (before !== null && (!peer || extra || !/^[1-9][0-9]{0,15}$/.test(before)))
  )
    throw new AccountError(400, "Consulta de mensagens inválida.");
  const expected =
    !peer || (!extra && request.method === "GET") ? "GET" : "POST";
  if (request.method !== expected)
    throw new AccountError(405, "Método inválido.");

  if (request.method === "POST" && !extra) {
    const body = await readJson(request);
    if (
      Object.keys(body).some((key) => !["body", "clientId"].includes(key)) ||
      !uuid(body.clientId)
    )
      throw new AccountError(400, "Mensagem inválida.");
    const text = messageText(body.body);
    await quota(
      db,
      env.AUTH_PEPPER,
      "messages-burst",
      user.id,
      8,
      now,
      10000,
      tooFast,
    );
    await quota(
      db,
      env.AUTH_PEPPER,
      "messages-hour",
      user.id,
      300,
      now,
      3600000,
      tooFast,
    );
    // Friendship and blocks are checked in the same statement that writes.
    const [inserted, , stored] = await db.batch([
      db
        .prepare(
          `INSERT INTO direct_messages (sender_id,receiver_id,client_id,body,created_at)
          SELECT ?1,?2,?3,?4,?5 WHERE ${friends} AND ${notBlocked}
          ON CONFLICT(sender_id,client_id) DO NOTHING`,
        )
        .bind(user.id, peer, body.clientId, text, now),
      db
        .prepare(
          `DELETE FROM direct_messages WHERE ${between} AND id <=
          (SELECT id FROM direct_messages WHERE ${between} ORDER BY id DESC LIMIT 1 OFFSET ${KEEP})`,
        )
        .bind(user.id, peer),
      db
        .prepare(
          "SELECT id,sender_id,receiver_id,body,created_at FROM direct_messages WHERE sender_id=? AND client_id=?",
        )
        .bind(user.id, body.clientId),
    ]);
    const row = stored.results[0];
    if (!row) {
      throw new AccountError(
        403,
        "Vocês precisam ser amigos para trocar mensagens.",
      );
    }
    if (
      row.receiver_id !== peer ||
      (!inserted.meta.changes && row.body !== text)
    )
      throw new AccountError(409, "Esta mensagem já foi enviada.");
    await nudge(env, [peer, user.id], (id) => (id === peer ? user.id : peer));
    if (inserted.meta.changes) {
      // Only the first message, or one after a long quiet, becomes an email.
      const previous = await db
        .prepare(
          `SELECT MAX(created_at) AS at FROM direct_messages WHERE ${between} AND id < ?3`,
        )
        .bind(user.id, peer, row.id)
        .first();
      if (previous?.at == null || now - previous.at >= QUIET_MS)
        await emailAlert(env, db, {
          kind: "message",
          sender: user,
          receiver: peer,
          origin: url.origin,
          now,
        });
    }
    return {
      data: messageView(row),
      status: inserted.meta.changes ? 201 : 200,
    };
  }

  await quota(db, env.AUTH_PEPPER, "messages-read", user.id, 900, now);

  if (extra === "read") {
    const body = await readJson(request);
    if (
      Object.keys(body).some((key) => key !== "lastId") ||
      !Number.isSafeInteger(body.lastId) ||
      body.lastId < 1
    )
      throw new AccountError(400, "Dados de leitura inválidos.");
    // Never past the newest message the peer actually sent.
    const result = await db
      .prepare(
        `INSERT INTO message_reads (user_id,peer_id,last_read_id)
        SELECT ?1,?2,MIN(?3,newest) FROM (SELECT MAX(id) AS newest FROM direct_messages WHERE sender_id=?2 AND receiver_id=?1)
        WHERE newest IS NOT NULL ON CONFLICT(user_id,peer_id) DO UPDATE SET last_read_id=MAX(last_read_id,excluded.last_read_id)`,
      )
      .bind(user.id, peer, body.lastId)
      .run();
    // The reader's other devices update their unread counts.
    if (result.meta.changes) await nudge(env, [user.id], () => peer);
    return { status: 204 };
  }

  if (peer) {
    const person = await db
      .prepare(
        `SELECT u.id,u.display_name,u.friend_code,u.avatar,${friends} AS friend
        FROM users u WHERE u.id=?2 AND ${notBlocked}`,
      )
      .bind(user.id, peer)
      .first();
    if (!person)
      throw new AccountError(404, "Esta conversa não está disponível.");
    // Only the two participants match: the pair is always (user, peer).
    const { results } = await db
      .prepare(
        `SELECT id,sender_id,body,created_at FROM direct_messages
        WHERE ${between} ${before ? "AND id < ?3" : ""} ORDER BY id DESC LIMIT ${PAGE + 1}`,
      )
      .bind(user.id, peer, ...(before ? [Number(before)] : []))
      .all();
    const page = results.slice(0, PAGE).reverse();
    return {
      data: {
        peer: peerView(person),
        canSend: !!person.friend,
        messages: page.map(messageView),
        more: results.length > PAGE,
      },
    };
  }

  const { results } = await db
    .prepare(
      `WITH latest AS (
        SELECT CASE WHEN sender_id=?1 THEN receiver_id ELSE sender_id END AS peer, MAX(id) AS last_id
        FROM direct_messages WHERE sender_id=?1 OR receiver_id=?1 GROUP BY peer)
      SELECT u.id,u.display_name,u.friend_code,u.avatar,
        m.id AS message_id,m.sender_id,m.body,m.created_at,
        EXISTS (SELECT 1 FROM friendships f WHERE f.user_id=?1 AND f.friend_id=u.id) AS friend,
        (SELECT COUNT(*) FROM direct_messages d WHERE d.sender_id=u.id AND d.receiver_id=?1
          AND d.id > COALESCE((SELECT last_read_id FROM message_reads r WHERE r.user_id=?1 AND r.peer_id=u.id),0)) AS unread
      FROM latest JOIN users u ON u.id=latest.peer JOIN direct_messages m ON m.id=latest.last_id
      WHERE NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.user_id=?1 AND b.blocked_id=u.id) OR (b.user_id=u.id AND b.blocked_id=?1))
      ORDER BY m.id DESC LIMIT ${CONVERSATIONS}`,
    )
    .bind(user.id)
    .all();
  return {
    data: {
      conversations: results.map((row) => ({
        peer: peerView(row),
        canSend: !!row.friend,
        unread: row.unread,
        last: messageView({ ...row, id: row.message_id }),
      })),
    },
  };
}
