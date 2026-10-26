import { DurableObject } from "cloudflare:workers";
import { primary, related } from "./friends.mjs";
import { authorizedParty } from "./invites.mjs";

const TTL = 90000;
export const offline = () => ({
  status: "offline",
  playing: null,
  party: null,
});
export const hubCall = (env, id, path, body) =>
  env.SOCIAL_HUB.get(env.SOCIAL_HUB.idFromName(id)).fetch(
    `https://internal${path}`,
    path === "/connect"
      ? {
          headers: {
            Upgrade: "websocket",
            "X-Social-User": body.id,
            "X-Social-Session": body.sessionId,
          },
        }
      : { method: "POST", body: JSON.stringify(body) },
  );
const send = (ws, value) => {
  try {
    ws.send(JSON.stringify(value));
  } catch {
    /* A closing socket is removed by its close handler. */
  }
};
function text(value, max) {
  return (
    typeof value === "string" &&
    [...value].length > 0 &&
    [...value].length <= max &&
    !/[\p{C}\p{Zl}\p{Zp}]/u.test(value)
  );
}
export function validPresence(value, now = Date.now()) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid");
  const keys = Object.keys(value);
  if (
    !keys.every((key) => ["status", "playing", "party"].includes(key)) ||
    !["online", "idle"].includes(value.status)
  )
    throw new Error("invalid");
  let playing = null,
    party = null;
  if (value.playing != null) {
    const game = value.playing;
    if (
      Object.keys(game).some(
        (k) => !["title", "console", "cover", "startedAt"].includes(k),
      ) ||
      !text(game.title, 128) ||
      !text(game.console, 80) ||
      !Number.isSafeInteger(game.startedAt) ||
      game.startedAt < 0 ||
      game.startedAt > now + 60000
    )
      throw new Error("invalid");
    let cover = null;
    if (game.cover != null) {
      if (typeof game.cover !== "string" || game.cover.length > 1024)
        throw new Error("invalid");
      const url = new URL(game.cover);
      if (
        url.protocol !== "https:" ||
        !["images.igdb.com", "images.launchbox-app.com"].includes(
          url.hostname,
        ) ||
        url.username ||
        url.password ||
        url.port ||
        url.search ||
        url.hash
      )
        throw new Error("invalid");
      cover = url.href;
    }
    playing = {
      title: game.title,
      console: game.console,
      cover,
      startedAt: game.startedAt,
    };
  }
  if (value.party != null) {
    if (
      Object.keys(value.party).some((k) => !["code", "joinable"].includes(k)) ||
      !/^[A-HJ-NP-Z2-9]{6}$/.test(value.party.code) ||
      typeof value.party.joinable !== "boolean"
    )
      throw new Error("invalid");
    party = { code: value.party.code, joinable: value.party.joinable };
  }
  return { status: value.status, playing, party };
}
export async function presenceFor(env, viewer, subject) {
  if (
    !env.SOCIAL_HUB ||
    (viewer !== subject && !(await related(primary(env), viewer, subject)))
  )
    return offline();
  const response = await hubCall(env, subject, "/presence", { id: subject });
  return response.ok ? response.json() : offline();
}
export class SocialHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }
  async live() {
    const db = primary(this.env),
      now = Date.now(),
      result = [];
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a?.closed) continue;
      const session =
        a &&
        (await db
          .prepare(
            "SELECT 1 FROM sessions WHERE id=? AND user_id=? AND expires_at>?",
          )
          .bind(a.sessionId, a.id, now)
          .first());
      if (!a || a.lastSeen + TTL <= now || !session) {
        if (!session) send(ws, { type: "expired" });
        if (a) {
          a.closed = true;
          ws.serializeAttachment(a);
        }
        try {
          ws.close(4001, "Sessão encerrada");
        } catch {
          /* The close handshake may already be complete. */
        }
      } else if (!a.closed) result.push({ ws, a });
    }
    return result;
  }
  async current(id) {
    const user = await primary(this.env)
      .prepare("SELECT show_playing,appear_offline FROM users WHERE id=?")
      .bind(id)
      .first();
    const live = await this.live();
    if (!user || user.appear_offline || !live.length) return offline();
    const current = live.sort((a, b) => b.a.updatedAt - a.a.updatedAt)[0].a
      .presence;
    return { ...current, playing: user.show_playing ? current.playing : null };
  }
  async broadcast(id) {
    const presence = await this.current(id);
    const { results } = await primary(this.env)
      .prepare("SELECT friend_id FROM friendships WHERE user_id=?")
      .bind(id)
      .all();
    // Receivers never call back into the source hub while delivering a delta.
    await Promise.all(
      results.map((row) =>
        hubCall(this.env, row.friend_id, "/deliver", {
          id: row.friend_id,
          subject: id,
          presence,
        }),
      ),
    );
  }
  async fetch(request) {
    const path = new URL(request.url).pathname,
      body =
        path === "/connect"
          ? {
              id: request.headers.get("X-Social-User"),
              sessionId: request.headers.get("X-Social-Session"),
            }
          : await request.json();
    const id = body.id;
    // Only the authenticated Worker router or another hub can reach this binding.
    if (!/^[a-f0-9-]{36}$/.test(id)) return new Response(null, { status: 400 });
    if (path === "/presence") return Response.json(await this.current(id));
    if (path === "/connect") {
      const active = await this.live();
      if (active.length >= 5)
        return Response.json(
          { error: "Limite de conexões atingido." },
          { status: 429 },
        );
      const pair = new WebSocketPair(),
        client = pair[0],
        ws = pair[1],
        now = Date.now();
      this.ctx.acceptWebSocket(ws);
      ws.serializeAttachment({
        id,
        sessionId: body.sessionId,
        lastSeen: now,
        updatedAt: now,
        presence: { status: "online", playing: null, party: null },
        window: now,
        count: 0,
      });
      await this.ctx.storage.setAlarm(
        Math.min(now + TTL, ...active.map(({ a }) => a.lastSeen + TTL)),
      );
      send(ws, { type: "ready" });
      this.ctx.waitUntil(this.broadcast(id).catch(() => {}));
      return new Response(null, { status: 101, webSocket: client });
    }
    if (path === "/refresh") {
      for (const { ws } of await this.live())
        send(ws, { type: "changed", reason: body.event });
      await this.broadcast(id);
      return new Response(null, { status: 204 });
    }
    if (path === "/message") {
      // A conversation changed; the app fetches it with its own session.
      if (!/^[a-f0-9-]{36}$/.test(body.peer))
        return new Response(null, { status: 400 });
      for (const { ws } of await this.live())
        send(ws, { type: "message", peer: body.peer });
      return new Response(null, { status: 204 });
    }
    if (path === "/deliver") {
      // Recheck on receipt: a block/removal committed while fanout was in flight wins.
      const db = primary(this.env);
      if (!(await related(db, id, body.subject)))
        return new Response(null, { status: 204 });
      const user = await db
        .prepare("SELECT show_playing,appear_offline FROM users WHERE id=?")
        .bind(body.subject)
        .first();
      const presence =
        !user || user.appear_offline
          ? offline()
          : {
              ...body.presence,
              playing: user.show_playing ? body.presence.playing : null,
            };
      for (const { ws } of await this.live())
        send(ws, { type: "presence", id: body.subject, presence });
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  }
  async webSocketMessage(ws, message) {
    const a = ws.deserializeAttachment();
    if (!a || a.closed) return;
    try {
      if (
        typeof message !== "string" ||
        new TextEncoder().encode(message).length > 2048
      )
        throw new Error();
      const now = Date.now();
      if (a.window + 10000 <= now) {
        a.window = now;
        a.count = 0;
      }
      if (++a.count > 30) throw new Error();
      const db = primary(this.env);
      // A heartbeat both detects revocation and renews a still-valid session.
      const session = await db
        .prepare(
          "UPDATE sessions SET last_seen_at=?,expires_at=? WHERE id=? AND user_id=? AND expires_at>? RETURNING id",
        )
        .bind(now, now + 90 * 86400000, a.sessionId, a.id, now)
        .first();
      if (!session) {
        a.closed = true;
        ws.serializeAttachment(a);
        ws.close(4001, "Sessão encerrada");
        await this.broadcast(a.id);
        return;
      }
      const value = JSON.parse(message);
      a.lastSeen = now;
      if (value.type === "heartbeat" && Object.keys(value).length === 1) {
        ws.serializeAttachment(a);
        send(ws, { type: "pong" });
        return;
      }
      if (
        value.type !== "presence" ||
        Object.keys(value).some((k) => !["type", "presence"].includes(k))
      )
        throw new Error();
      a.presence = validPresence(value.presence, now);
      a.presence.party = await authorizedParty(
        this.env,
        a.id,
        a.sessionId,
        a.presence.party,
      );
      a.updatedAt = now;
      ws.serializeAttachment(a);
      await this.broadcast(a.id);
    } catch {
      a.closed = true;
      ws.serializeAttachment(a);
      ws.close(4002, "Dados inválidos");
      await this.broadcast(a.id);
    }
  }
  async webSocketClose(ws) {
    const a = ws.deserializeAttachment();
    if (!a) return;
    a.closed = true;
    ws.serializeAttachment(a);
    await this.broadcast(a.id);
  }
  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }
  async alarm() {
    const sockets = this.ctx.getWebSockets(),
      ids = [
        ...new Set(
          sockets.map((ws) => ws.deserializeAttachment()?.id).filter(Boolean),
        ),
      ];
    const activeBefore = sockets.filter(
      (ws) => !ws.deserializeAttachment()?.closed,
    ).length;
    const live = await this.live();
    // Heartbeats alone do not fan out unchanged presence to every friend.
    if (activeBefore !== live.length)
      await Promise.all(ids.map((id) => this.broadcast(id)));
    if (live.length)
      await this.ctx.storage.setAlarm(
        Math.min(...live.map(({ a }) => a.lastSeen + TTL)),
      );
    else await this.ctx.storage.deleteAll();
  }
}
