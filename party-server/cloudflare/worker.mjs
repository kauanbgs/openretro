import { socialResponse } from "./social/router.mjs";
import { cleanupSocial } from "./social/limits.mjs";
import { cloudflareTurn } from "./turn.mjs";
import { DurableObject } from "cloudflare:workers";

const ROOM_MS = 3 * 60 * 60 * 1000;
const RESERVATION_MS = 2 * 60 * 1000;
const CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const invalid =
  "Esta sala encerrou ou o convite é inválido. Peça um novo código.";
const safeError = "Não foi possível conectar à sala. Tente novamente.";
const json = (value, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const send = (ws, value) => {
  if (ws?.readyState === 1) ws.send(JSON.stringify(value));
};
const random = () =>
  [...crypto.getRandomValues(new Uint8Array(32))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
const code = () =>
  [...crypto.getRandomValues(new Uint8Array(6))]
    .map((n) => ALPHABET[n & 31])
    .join("");
const hash = async (value) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
const stub = (namespace, name) => namespace.get(namespace.idFromName(name));
const internal = (target, path, value) =>
  target.fetch(`https://internal/${path}`, {
    method: "POST",
    body: JSON.stringify(value),
  });
function limit(value, fallback) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

export default {
  async scheduled(_controller, env, ctx) {
    if (env.SOCIAL_DB) ctx.waitUntil(cleanupSocial(env.SOCIAL_DB));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowed =
      !origin ||
      origin === url.origin ||
      [
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
        "http://localhost:1420",
        "http://127.0.0.1:1420",
      ].includes(origin);
    const headers = {
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'",
      ...(origin && allowed
        ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
        : {}),
    };
    const reply = (value, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    try {
      if (
        url.pathname.startsWith("/api/auth/") ||
        url.pathname === "/api/account" ||
        url.pathname.startsWith("/api/account/")
      )
        return socialResponse(request, env, { allowed, headers });
      if (url.pathname === "/api/rooms") {
        if (!allowed) return reply({ error: "Origem não permitida." }, 403);
        if (request.method === "OPTIONS")
          return new Response(null, {
            status: 204,
            headers: {
              ...headers,
              "Access-Control-Allow-Methods": "POST",
              "Access-Control-Allow-Headers": "Content-Type",
            },
          });
        if (request.method !== "POST")
          return reply({ error: "Método inválido." }, 405);
        // Free local mode must never accidentally disable TURN on a public deployment.
        if (
          env.ALLOW_LOCAL_TEST === "true" &&
          !["localhost", "127.0.0.1"].includes(url.hostname)
        )
          return reply({ error: safeError }, 503);
        if (
          env.ALLOW_LOCAL_TEST !== "true" &&
          (!env.TURN_KEY_ID || !env.TURN_API_TOKEN)
        )
          return reply(
            { error: "O Party ainda não está disponível. Tente mais tarde." },
            503,
          );
        const ip = await hash(
          request.headers.get("CF-Connecting-IP") || "local",
        );
        const reserved = await internal(
          stub(env.DIRECTORY, "directory"),
          "reserve",
          { ip },
        );
        const reservation = await reserved.json();
        if (!reserved.ok) return reply(reservation, reserved.status);
        const initialized = await internal(
          stub(env.ROOMS, reservation.code),
          "initialize",
          {
            code: reservation.code,
            hostHash: await hash(reservation.ticket),
            origin: url.origin,
          },
        );
        if (!initialized.ok) {
          await internal(stub(env.DIRECTORY, "directory"), "release", {
            code: reservation.code,
            hostHash: await hash(reservation.ticket),
          });
          return reply({ error: safeError }, 503);
        }
        return reply(reservation, 201);
      }
      if (url.pathname === "/signal") {
        const room = url.searchParams.get("room");
        if (!allowed) return reply({ error: "Origem não permitida." }, 403);
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
          return reply({ error: "WebSocket necessário." }, 426);
        if (!CODE.test(room || "")) return reply({ error: invalid }, 404);
        const check = await internal(
          stub(env.DIRECTORY, "directory"),
          "lookup",
          {
            code: room,
            ip: await hash(request.headers.get("CF-Connecting-IP") || "local"),
          },
        );
        if (!check.ok) return reply(await check.json(), check.status);
        return stub(env.ROOMS, room).fetch(request);
      }
      if (url.pathname === "/health")
        return reply({
          ok: true,
          service: "openretro-party",
          platform: "cloudflare",
        });
      if (request.method !== "GET" && request.method !== "HEAD")
        return reply({ error: "Método inválido." }, 405);
      const assetPath =
        url.pathname === "/" ||
        url.pathname === "/party" ||
        /^\/party\/[A-Z2-9]{6}$/.test(url.pathname)
          ? "/index.html"
          : url.pathname === "/privacidade"
            ? "/privacy.html"
            : url.pathname;
      if (
        ![
          "/index.html",
          "/guest.js",
          "/guest.css",
          "/privacy.html",
          "/privacy.css",
        ].includes(assetPath)
      )
        return reply({ error: "Página não encontrada." }, 404);
      const asset = await env.ASSETS.fetch(
        new Request(new URL(assetPath, url), { method: request.method }),
      );
      const responseHeaders = new Headers(asset.headers);
      for (const [key, value] of Object.entries(headers))
        responseHeaders.set(key, value);
      return new Response(asset.body, {
        status: asset.status,
        headers: responseHeaders,
      });
    } catch {
      return reply({ error: safeError }, 503);
    }
  },
};

/** Small global directory: code uniqueness, reservations and persistent per-IP quotas. */
export class PartyDirectory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }
  async fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const path = new URL(request.url).pathname;
      const value = await request.json();
      const now = Date.now();
      const rooms = await this.ctx.storage.list({ prefix: "room:" });
      for (const [key, room] of rooms)
        if (room.expires <= now) {
          await this.ctx.storage.delete(key);
          rooms.delete(key);
        }
      if (path === "/reserve") {
        const key = `create:${value.ip}`;
        let attempts = await this.ctx.storage.get(key);
        if (!attempts || attempts.expires <= now)
          attempts = { count: 0, expires: now + 600000 };
        attempts.count++;
        await this.ctx.storage.put(key, attempts);
        await this.schedule();
        if (attempts.count > limit(this.env.MAX_CREATES_PER_10_MIN, 12))
          return json(
            { error: "Você criou muitas salas. Aguarde alguns minutos." },
            429,
          );
        if (
          [...rooms.values()].filter((r) => r.ip === value.ip).length >=
          limit(this.env.MAX_ROOMS_PER_IP, 2)
        )
          return json(
            {
              error: "Encerre uma sala aberta nesta rede antes de criar outra.",
            },
            429,
          );
        if (rooms.size >= limit(this.env.MAX_ROOMS, 32))
          return json(
            { error: "Todas as salas estão ocupadas. Tente mais tarde." },
            503,
          );
        let roomCode = code();
        while (rooms.has(`room:${roomCode}`)) roomCode = code();
        const ticket = random();
        await this.ctx.storage.put(`room:${roomCode}`, {
          ip: value.ip,
          hostHash: await hash(ticket),
          expires: now + RESERVATION_MS,
        });
        return json({ code: roomCode, ticket });
      }
      if (path === "/lookup") {
        const key = `join:${value.ip}`;
        let attempts = await this.ctx.storage.get(key);
        if (!attempts || attempts.expires <= now)
          attempts = { count: 0, expires: now + 60000 };
        attempts.count++;
        await this.ctx.storage.put(key, attempts);
        await this.schedule();
        if (attempts.count > 60)
          return json(
            { error: "Aguarde um instante antes de tentar entrar novamente." },
            429,
          );
        return rooms.has(`room:${value.code}`)
          ? json({ ok: true })
          : json({ error: invalid }, 404);
      }
      const current = rooms.get(`room:${value.code}`);
      if (!current || current.hostHash !== value.hostHash)
        return json({ error: invalid }, 404);
      if (path === "/activate") {
        await this.ctx.storage.put(`room:${value.code}`, {
          ...current,
          expires: value.expires,
        });
        await this.schedule();
        return json({ ok: true });
      }
      if (path === "/release") {
        await this.ctx.storage.delete(`room:${value.code}`);
        return json({ ok: true });
      }
      return json({ error: invalid }, 404);
    });
  }
  async schedule() {
    if ((await this.ctx.storage.getAlarm()) === null)
      await this.ctx.storage.setAlarm(Date.now() + 60000);
  }
  async alarm() {
    const entries = await this.ctx.storage.list();
    for (const [key, value] of entries)
      if (value.expires <= Date.now()) await this.ctx.storage.delete(key);
    if ((await this.ctx.storage.list({ limit: 1 })).size)
      await this.ctx.storage.setAlarm(Date.now() + 60000);
  }
}

/** One independently hibernating object per room. Membership lives in socket attachments. */
export class PartyRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.meta = null;
    ctx.blockConcurrencyWhile(async () => {
      this.meta = (await ctx.storage.get("room")) || null;
    });
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
  }
  sockets() {
    return this.ctx
      .getWebSockets()
      .filter(
        (ws) =>
          ws.readyState === 1 &&
          ws.deserializeAttachment()?.generation === this.meta?.hostHash,
      );
  }
  host() {
    return this.sockets().find(
      (ws) => ws.deserializeAttachment().role === "host",
    );
  }
  guests() {
    return this.sockets().filter(
      (ws) => ws.deserializeAttachment().role === "guest",
    );
  }
  roster() {
    send(this.host(), {
      type: "roster",
      guests: this.guests().map((ws) => {
        const a = ws.deserializeAttachment();
        return { id: a.id, name: a.name, player: a.player };
      }),
    });
  }
  async fetch(request) {
    if (
      new URL(request.url).pathname === "/initialize" &&
      request.method === "POST"
    ) {
      return this.ctx.blockConcurrencyWhile(async () => {
        if (this.meta && this.meta.expires > Date.now())
          return json({ error: "Sala ocupada." }, 409);
        const data = await request.json();
        this.meta = {
          ...data,
          expires: Date.now() + RESERVATION_MS,
          active: false,
        };
        await this.ctx.storage.put("room", this.meta);
        await this.schedule();
        return json({ ok: true });
      });
    }
    if (!this.meta || this.meta.expires <= Date.now())
      return json({ error: invalid }, 404);
    if (this.sockets().length >= 12)
      return json({ error: "A sala está cheia." }, 429);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      id: crypto.randomUUID(),
      generation: this.meta.hostHash,
      role: "pending",
      player: null,
      name: "",
      joined: Date.now(),
      count: 0,
      window: Date.now(),
    });
    await this.schedule();
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, raw) {
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        if (!this.meta || this.meta.expires <= Date.now()) {
          ws.close(1008, "Room ended");
          return;
        }
        const a = ws.deserializeAttachment();
        if (a.generation !== this.meta.hostHash || a.role === "removed") {
          ws.close(1008, "Invalid session");
          return;
        }
        if (
          typeof raw !== "string" ||
          new TextEncoder().encode(raw).length > 32768
        ) {
          ws.close(1009, "Message too large");
          return;
        }
        if (Date.now() - a.window >= 1000) {
          a.window = Date.now();
          a.count = 0;
        }
        if (++a.count > 100) {
          ws.close(1008, "Too many messages");
          return;
        }
        ws.serializeAttachment(a);
        const m = JSON.parse(raw);
        if (a.role === "pending") {
          if (m.type === "create") {
            if (
              this.meta.active ||
              this.host() ||
              typeof m.ticket !== "string" ||
              m.ticket.length !== 64 ||
              (await hash(m.ticket)) !== this.meta.hostHash
            ) {
              send(ws, { type: "error", message: invalid });
              ws.close(1008, "Invalid session");
              return;
            }
            const transport = await cloudflareTurn(this.env);
            if (ws.readyState !== 1) {
              await this.finish();
              return;
            }
            this.meta = {
              ...this.meta,
              active: true,
              expires: Date.now() + ROOM_MS,
              transport,
            };
            await this.ctx.storage.put("room", this.meta);
            await internal(stub(this.env.DIRECTORY, "directory"), "activate", {
              code: this.meta.code,
              hostHash: this.meta.hostHash,
              expires: this.meta.expires,
            });
            a.role = "host";
            ws.serializeAttachment(a);
            send(ws, {
              type: "created",
              code: this.meta.code,
              url: `${this.meta.origin}/party/${this.meta.code}`,
              ...transport,
            });
            this.roster();
            await this.schedule();
            return;
          }
          if (
            m.type === "join" &&
            this.meta.active &&
            this.host() &&
            m.room === this.meta.code
          ) {
            if (this.guests().length >= 8) {
              send(ws, { type: "error", message: "A sala está cheia." });
              ws.close(1008, "Room full");
              return;
            }
            const name =
              typeof m.name === "string" ? m.name.trim().slice(0, 24) : "";
            if (!name) {
              send(ws, {
                type: "error",
                message: "Digite seu nome para entrar.",
              });
              return;
            }
            a.role = "guest";
            a.name = name;
            a.joined = Date.now();
            ws.serializeAttachment(a);
            send(ws, { type: "waiting" });
            this.roster();
            await this.schedule();
            return;
          }
          send(ws, { type: "error", message: invalid });
          ws.close(1008, "Invalid session");
          return;
        }
        if (a.role === "host" && m.type === "accept") {
          const guest = this.guests().find(
            (s) => s.deserializeAttachment().id === m.id,
          );
          if (!guest) return;
          const member = guest.deserializeAttachment();
          if (member.player !== null) return;
          const player = [2, 3, 4].find(
            (p) =>
              !this.guests().some(
                (s) => s.deserializeAttachment().player === p,
              ),
          );
          if (!player) {
            send(ws, {
              type: "error",
              message: "Os três lugares já estão ocupados.",
            });
            return;
          }
          member.player = player;
          guest.serializeAttachment(member);
          send(guest, { type: "accepted", player, ...this.meta.transport });
          send(ws, { type: "peer", id: member.id, player });
          this.roster();
          await this.schedule();
          return;
        }
        if (a.role === "host" && m.type === "remove") {
          const guest = this.guests().find(
            (s) => s.deserializeAttachment().id === m.id,
          );
          if (guest)
            this.remove(guest, "O anfitrião encerrou sua participação.");
          this.roster();
          return;
        }
        if (m.type === "signal") {
          const guest =
            a.role === "host"
              ? this.guests().find((s) => s.deserializeAttachment().id === m.id)
              : ws;
          const member = guest?.deserializeAttachment();
          const signal = m.signal;
          if (
            !member?.player ||
            !signal ||
            !["offer", "answer", "candidate"].includes(signal.type)
          )
            return;
          if (
            (a.role === "host" && signal.type === "answer") ||
            (a.role !== "host" && signal.type === "offer")
          )
            return;
          send(a.role === "host" ? guest : this.host(), {
            type: "signal",
            id: member.id,
            signal,
          });
        }
      } catch {
        send(ws, { type: "error", message: safeError });
      }
    });
  }
  remove(ws, message) {
    const a = ws.deserializeAttachment();
    a.role = "removed";
    ws.serializeAttachment(a);
    send(ws, { type: "ended", message });
    ws.close(1000, "Session ended");
    send(this.host(), { type: "left", id: a.id });
  }
  async webSocketClose(ws) {
    const a = ws.deserializeAttachment();
    try {
      ws.close(1000, "Closed");
    } catch {
      /* Already closed. */
    }
    if (!this.meta || a?.generation !== this.meta.hostHash) return;
    if (a.role === "host") {
      await this.finish();
      return;
    }
    if (a.role === "guest") {
      a.role = "removed";
      ws.serializeAttachment(a);
      send(this.host(), { type: "left", id: a.id });
      this.roster();
    }
  }
  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }
  async schedule() {
    if (!this.meta) return;
    let deadline = this.meta.expires;
    for (const ws of this.sockets()) {
      const a = ws.deserializeAttachment();
      if (a.role === "pending") deadline = Math.min(deadline, a.joined + 30000);
      if (a.role === "guest" && a.player === null)
        deadline = Math.min(deadline, a.joined + RESERVATION_MS);
    }
    await this.ctx.storage.setAlarm(deadline);
  }
  async alarm() {
    if (!this.meta) return;
    if (this.meta.expires <= Date.now()) {
      await this.finish();
      return;
    }
    for (const ws of this.sockets()) {
      const a = ws.deserializeAttachment();
      if (
        (a.role === "pending" && a.joined + 30000 <= Date.now()) ||
        (a.role === "guest" &&
          a.player === null &&
          a.joined + RESERVATION_MS <= Date.now())
      )
        this.remove(ws, "O pedido expirou. Entre novamente para participar.");
    }
    this.roster();
    await this.schedule();
  }
  async finish() {
    if (!this.meta) return;
    const meta = this.meta;
    for (const ws of this.sockets())
      this.remove(ws, "O anfitrião encerrou a sala.");
    this.meta = null;
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
    await internal(stub(this.env.DIRECTORY, "directory"), "release", {
      code: meta.code,
      hostHash: meta.hostHash,
    });
  }
}
