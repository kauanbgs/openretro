import { socialResponse } from "./social/router.mjs";
export { SocialHub } from "./social/hub.mjs";
import { cleanupSocial } from "./social/limits.mjs";
import { alertsOffRoute } from "./social/alerts.mjs";
import {
  hostAvailable,
  inviteConfigured,
  signInvite,
  verifyInvite,
} from "./social/invites.mjs";
import { related } from "./social/friends.mjs";
import { authenticate, database } from "./social/auth.mjs";
import { AccountError } from "./social/http.mjs";
import { recordActivity } from "./social/activity.mjs";
import { cloudflareTurn } from "./turn.mjs";
import { DurableObject } from "cloudflare:workers";

const ROOM_MS = 3 * 60 * 60 * 1000;
const RESERVATION_MS = 2 * 60 * 1000;
// A guest link opens one seat to someone without an account. Unclaimed, it
// expires; once claimed it belongs to that browser until the host closes it.
const GUEST_LINK_MS = 30 * 60 * 1000;
const GUEST_LINKS_PER_10_MIN = 10;
const linkClosed =
  "Este convite expirou ou foi fechado. Peça um novo link ao anfitrião.";
const linkTaken =
  "Outra pessoa já entrou por este convite. Peça um novo link ao anfitrião.";
const guestName = (value) =>
  typeof value === "string"
    ? [
        ...value
          .replace(
            /[\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,
            "",
          )
          .trim(),
      ]
        .slice(0, 24)
        .join("")
        .trim()
    : "";
const CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const invalid =
  "Esta sala encerrou ou o convite é inválido. Peça um novo código.";
const safeError = "Não foi possível conectar à sala. Tente novamente.";
const json = (value, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const CHAT_MAX = 200;
const CHAT_WINDOW_MS = 10000,
  CHAT_PER_WINDOW = 6;
// Invisible and direction-changing characters can disguise a message.
const CHAT_UNSAFE = /[\p{Cc}\p{Co}\p{Cn}\p{Cs}\p{Zl}\p{Zp}؜‎‏‪-‮⁦-⁩]/u;
/** A chat line as the room relays it, or null when it cannot be shown. */
function chatText(value) {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || [...text].length > CHAT_MAX || CHAT_UNSAFE.test(text))
    return null;
  return text;
}
const send = (ws, value) => {
  if (ws?.readyState === 1) ws.send(JSON.stringify(value));
};
const random = () =>
  [...crypto.getRandomValues(new Uint8Array(32))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
// A guest link is one code of six characters (30 bits) that the directory
// maps to its room. It is short enough to read and trust, a single-use,
// 30-minute capability, and lookups are rate limited, so it cannot be searched for.
const linkToken = () =>
  [...crypto.getRandomValues(new Uint8Array(6))]
    .map((n) => ALPHABET[n & 31])
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
      // With ADMIN_HOST set, the panel lives only on that host and that host
      // serves nothing else, so the panel has an origin of its own.
      if (env.ADMIN_HOST) {
        const adminPath =
          url.pathname.startsWith("/api/admin/") ||
          ["/admin", "/admin.html", "/admin.js", "/admin.css"].includes(
            url.pathname,
          );
        const onAdmin = url.hostname === env.ADMIN_HOST;
        if (
          onAdmin
            ? !(
                adminPath ||
                url.pathname === "/" ||
                url.pathname.startsWith("/api/auth/") ||
                url.pathname === "/health"
              )
            : adminPath
        )
          return reply({ error: "Página não encontrada." }, 404);
      }
      if (url.pathname === "/email/off")
        return alertsOffRoute(request, env, url, headers);
      if (
        url.pathname === "/social" ||
        url.pathname.startsWith("/api/friends") ||
        url.pathname.startsWith("/api/admin/") ||
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
              "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
        // Hosts sign in, and guests join with a friend ticket, which needs
        // the ticket secret, or through a guest link the host made.
        if (!inviteConfigured(env))
          return reply(
            { error: "O Party ainda não está disponível. Tente mais tarde." },
            503,
          );
        let host;
        try {
          ({ user: host } = await authenticate(
            request,
            database(env, url),
            Date.now(),
          ));
        } catch (error) {
          if (!(error instanceof AccountError)) throw error;
          return reply(
            {
              error:
                error.status === 401
                  ? "Entre na sua conta para criar um Party."
                  : error.message,
            },
            error.status,
          );
        }
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
            // The name the room's chat shows for the host.
            hostName: host.display_name || host.friend_code,
          },
        );
        if (!initialized.ok) {
          await internal(stub(env.DIRECTORY, "directory"), "release", {
            code: reservation.code,
            hostHash: await hash(reservation.ticket),
          });
          return reply({ error: safeError }, 503);
        }
        await recordActivity(
          database(env, url),
          "party-created",
          host.id,
          null,
          Date.now(),
        );
        return reply(reservation, 201);
      }
      if (url.pathname.startsWith("/api/guest-link/")) {
        if (!allowed) return reply({ error: "Origem não permitida." }, 403);
        if (request.method !== "GET")
          return reply({ error: "Método inválido." }, 405);
        const link = url.pathname.slice("/api/guest-link/".length);
        if (!/^[A-HJ-NP-Z2-9]{6}$/.test(link))
          return reply({ error: linkClosed }, 404);
        const found = await internal(
          stub(env.DIRECTORY, "directory"),
          "link-lookup",
          {
            link: await hash(link),
            ip: await hash(request.headers.get("CF-Connecting-IP") || "local"),
          },
        );
        return reply(await found.json(), found.status);
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
        env.ADMIN_HOST &&
        url.hostname === env.ADMIN_HOST &&
        url.pathname === "/"
          ? "/admin.html"
          : url.pathname === "/" ||
              url.pathname === "/party" ||
              /^(\/party\/[A-Z2-9]{6}|\/[A-HJ-NP-Z2-9]{6})$/.test(url.pathname)
            ? "/index.html"
            : url.pathname === "/privacidade"
              ? "/privacy.html"
              : url.pathname === "/admin"
                ? "/admin.html"
                : url.pathname;
      if (
        ![
          "/index.html",
          "/guest.js",
          "/guest.css",
          "/privacy.html",
          "/privacy.css",
          "/admin.html",
          "/admin.js",
          "/admin.css",
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
      if (path === "/link-lookup") {
        // Six characters are short, so this lookup is limited more than the others.
        const key = `glink:${value.ip}`;
        let attempts = await this.ctx.storage.get(key);
        if (!attempts || attempts.expires <= now)
          attempts = { count: 0, expires: now + 60000 };
        attempts.count++;
        await this.ctx.storage.put(key, attempts);
        await this.schedule();
        if (attempts.count > 20)
          return json(
            { error: "Aguarde um instante antes de tentar entrar novamente." },
            429,
          );
        const link = await this.ctx.storage.get(`link:${value.link}`);
        return link && link.expires > now && rooms.has(`room:${link.room}`)
          ? json({ room: link.room })
          : json({ error: linkClosed }, 404);
      }
      const current = rooms.get(`room:${value.code}`);
      if (!current || current.hostHash !== value.hostHash)
        return json({ error: invalid }, 404);
      const dropLinks = async () => {
        for (const [key, link] of await this.ctx.storage.list({
          prefix: "link:",
        }))
          if (link.room === value.code || link.expires <= now)
            await this.ctx.storage.delete(key);
      };
      if (path === "/link-set") {
        await dropLinks();
        if (await this.ctx.storage.get(`link:${value.link}`))
          return json({ error: "taken" }, 409);
        await this.ctx.storage.put(`link:${value.link}`, {
          room: value.code,
          expires: value.expires,
        });
        await this.schedule();
        return json({ ok: true });
      }
      if (path === "/link-clear") {
        await dropLinks();
        return json({ ok: true });
      }
      if (path === "/activate") {
        await this.ctx.storage.put(`room:${value.code}`, {
          ...current,
          expires: value.expires,
        });
        await this.schedule();
        return json({ ok: true });
      }
      if (path === "/release") {
        await dropLinks();
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
        return {
          id: a.id,
          name: a.name,
          player: a.player,
          avatar: a.avatar ?? 0,
          ...(a.anonymous ? { anonymous: true } : {}),
        };
      }),
    });
  }
  /** The first free seat; the guest link's seat stays out of reach of friends. */
  freeSeat(reserved = this.meta.guestLink?.player) {
    return [2, 3, 4].find(
      (p) =>
        p !== reserved &&
        !this.guests().some((ws) => ws.deserializeAttachment().player === p),
    );
  }
  approve(guest, player = this.freeSeat(), extra = {}) {
    const member = guest.deserializeAttachment();
    if (member.player !== null) return false;
    if (!player) return false;
    member.player = player;
    guest.serializeAttachment(member);
    send(guest, { type: "accepted", player, ...this.meta.transport, ...extra });
    send(this.host(), { type: "peer", id: member.id, player });
    return true;
  }
  anonymousGuests() {
    return this.guests().filter((ws) => ws.deserializeAttachment().anonymous);
  }
  async createGuestLink(host) {
    const now = Date.now();
    const recent = (this.meta.guestLinkLog || []).filter(
      (at) => at > now - 600000,
    );
    if (recent.length >= GUEST_LINKS_PER_10_MIN) {
      send(host, {
        type: "error",
        message: "Você gerou muitos links. Aguarde alguns minutos.",
      });
      return;
    }
    // A new link replaces the old one and whoever came in through it.
    await this.closeGuestLink("O anfitrião trocou o link do convite.", false);
    const player = this.freeSeat(null);
    if (!player) {
      send(host, {
        type: "error",
        message: "Os três lugares já estão ocupados.",
      });
      await this.ctx.storage.put("room", this.meta);
      return;
    }
    const directory = stub(this.env.DIRECTORY, "directory");
    let token;
    for (let attempt = 0; attempt < 5 && !token; attempt++) {
      const candidate = linkToken();
      const stored = await internal(directory, "link-set", {
        code: this.meta.code,
        hostHash: this.meta.hostHash,
        link: await hash(candidate),
        expires: now + GUEST_LINK_MS,
      });
      if (stored.ok) token = candidate;
      else if (stored.status !== 409) break;
    }
    if (!token) {
      send(host, { type: "error", message: safeError });
      await this.ctx.storage.put("room", this.meta);
      return;
    }
    this.meta.guestLink = {
      hash: await hash(token),
      player,
      expires: now + GUEST_LINK_MS,
      resumeHash: null,
    };
    this.meta.guestLinkLog = [...recent, now];
    await this.ctx.storage.put("room", this.meta);
    send(host, {
      type: "guest-link",
      url: `${this.meta.origin}/${token}`,
      player,
      expires: this.meta.guestLink.expires,
    });
  }
  async closeGuestLink(message, notify = true) {
    for (const ws of this.anonymousGuests()) this.remove(ws, message);
    if (!this.meta.guestLink) return;
    this.meta.guestLink = null;
    await internal(stub(this.env.DIRECTORY, "directory"), "link-clear", {
      code: this.meta.code,
      hostHash: this.meta.hostHash,
    });
    if (notify) send(this.host(), { type: "guest-link", url: null });
  }
  async anonymousGuest(ws, a, m) {
    const refuse = (message) => {
      send(ws, { type: "error", message });
      ws.close(1008, "Guest link refused");
    };
    const link = this.meta.guestLink;
    if (
      !link ||
      typeof m.guest !== "string" ||
      !/^[A-HJ-NP-Z2-9]{6}$/.test(m.guest) ||
      (await hash(m.guest)) !== link.hash
    )
      return refuse(linkClosed);
    const name = guestName(m.name);
    if (!name) return refuse("Digite seu nome para entrar.");
    let resume;
    if (link.resumeHash) {
      // Only the browser that claimed the link can come back with it.
      if (
        typeof m.resume !== "string" ||
        !/^[a-f0-9]{64}$/.test(m.resume) ||
        (await hash(m.resume)) !== link.resumeHash
      )
        return refuse(linkTaken);
      for (const old of this.anonymousGuests())
        this.remove(old, "Você entrou de novo em outra janela.");
    } else {
      if (link.expires <= Date.now()) return refuse(linkClosed);
      resume = random();
      link.resumeHash = await hash(resume);
    }
    if (
      this.guests().some(
        (guest) => guest.deserializeAttachment().player === link.player,
      )
    )
      return refuse("A sala está cheia.");
    a.role = "guest";
    a.name = name;
    a.avatar = 0;
    a.anonymous = true;
    a.joined = Date.now();
    ws.serializeAttachment(a);
    await this.ctx.storage.put("room", this.meta);
    this.approve(ws, link.player, resume ? { resume } : {});
    this.roster();
    await this.schedule();
  }
  async social(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (!this.meta?.active || this.meta.expires <= Date.now() || !this.host())
        return json({ error: invalid }, 404);
      const data = await request.json(),
        path = new URL(request.url).pathname;
      if (path === "/social-bind") {
        if (
          typeof data.ticket !== "string" ||
          data.ticket.length !== 64 ||
          (await hash(data.ticket)) !== this.meta.hostHash
        )
          return json({ error: invalid }, 403);
        if (
          typeof data.joinable !== "boolean" ||
          (data.joinable && !inviteConfigured(this.env))
        )
          return json({ error: invalid }, 503);
        const previous = this.meta.social;
        const unchanged =
          previous?.owner === data.owner &&
          previous.sessionId === data.sessionId &&
          previous.joinable === data.joinable;
        this.meta.social = {
          owner: data.owner,
          sessionId: data.sessionId,
          joinable: data.joinable,
          epoch: unchanged ? previous.epoch : crypto.randomUUID(),
        };
        await this.ctx.storage.put("room", this.meta);
        return json({ ok: true });
      }
      const social = this.meta.social;
      if (!(await hostAvailable(this.env, social)))
        return json({ error: invalid }, 403);
      if (path === "/social-status")
        return json({
          joinable:
            social.owner === data.owner && social.sessionId === data.sessionId,
        });
      if (path !== "/social-issue" || social.owner !== data.hostId)
        return json({ error: invalid }, 403);
      const db = this.env.SOCIAL_DB.withSession("first-primary");
      if (
        !(await related(db, data.guestId, data.hostId)) ||
        !(await db
          .prepare(
            "SELECT 1 FROM sessions WHERE id=? AND user_id=? AND expires_at>?",
          )
          .bind(data.sessionId, data.guestId, Date.now())
          .first())
      )
        return json({ error: invalid }, 403);
      const token = await signInvite(this.env, {
        room: this.meta.code,
        hostId: social.owner,
        guestId: data.guestId,
        sessionId: data.sessionId,
        epoch: social.epoch,
      });
      return json({ code: this.meta.code, invite: token });
    });
  }
  async automaticGuest(invite) {
    const ticket = await verifyInvite(this.env, invite);
    const social = this.meta.social;
    if (
      !ticket ||
      ticket.room !== this.meta.code ||
      ticket.epoch !== social?.epoch ||
      ticket.hostId !== social.owner ||
      !(await hostAvailable(this.env, social))
    )
      return null;
    if (
      this.guests().some(
        (ws) => ws.deserializeAttachment().userId === ticket.guestId,
      )
    )
      return null;
    const db = this.env.SOCIAL_DB.withSession("first-primary");
    if (!(await related(db, ticket.guestId, ticket.hostId))) return null;
    const profile = await db
      .prepare(
        "SELECT u.display_name,u.friend_code,u.avatar FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=? AND s.id=? AND s.expires_at>?",
      )
      .bind(ticket.guestId, ticket.sessionId, Date.now())
      .first();
    if (!profile) return null;
    this.meta.usedInvites = Object.fromEntries(
      Object.entries(this.meta.usedInvites || {}).filter(
        ([, expires]) => expires > Date.now(),
      ),
    );
    if (
      this.meta.usedInvites[ticket.nonce] ||
      Object.keys(this.meta.usedInvites).length >= 128
    )
      return null;
    return {
      ticket,
      name: profile.display_name || profile.friend_code,
      avatar: profile.avatar,
    };
  }
  async fetch(request) {
    if (
      new URL(request.url).pathname.startsWith("/social-") &&
      request.method === "POST"
    )
      return this.social(request);
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
            // The host's guest link: one seat, no account, no social data.
            if (m.guest !== undefined) {
              await this.anonymousGuest(ws, a, m);
              return;
            }
            // Otherwise only friends with a valid ticket from their account join;
            // there is no anonymous entry by name.
            const automatic = await this.automaticGuest(m.invite).catch(
              () => null,
            );
            if (!automatic) {
              send(ws, {
                type: "error",
                message:
                  "Para entrar, use o botão Entrar na lista de amigos do OpenRetro.",
              });
              ws.close(1008, "Account required");
              return;
            }
            if (!this.freeSeat()) {
              send(ws, { type: "error", message: "A sala está cheia." });
              ws.close(1008, "Room full");
              return;
            }
            a.role = "guest";
            a.name = automatic.name;
            a.avatar = automatic.avatar;
            a.joined = Date.now();
            a.userId = automatic.ticket.guestId;
            ws.serializeAttachment(a);
            this.meta.usedInvites[automatic.ticket.nonce] =
              automatic.ticket.expiresAt;
            await this.ctx.storage.put("room", this.meta);
            this.approve(ws);
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
          if (!this.approve(guest)) {
            send(ws, {
              type: "error",
              message: "Os três lugares já estão ocupados.",
            });
            return;
          }
          this.roster();
          await this.schedule();
          return;
        }
        if (a.role === "host" && m.type === "remove") {
          const guest = this.guests().find(
            (s) => s.deserializeAttachment().id === m.id,
          );
          // Removing the link's guest also closes the link, or they could
          // simply come back with it.
          if (guest?.deserializeAttachment().anonymous) {
            await this.closeGuestLink("O anfitrião encerrou sua participação.");
            await this.ctx.storage.put("room", this.meta);
          } else if (guest)
            this.remove(guest, "O anfitrião encerrou sua participação.");
          this.roster();
          return;
        }
        if (a.role === "host" && m.type === "guest-link") {
          await this.createGuestLink(ws);
          this.roster();
          return;
        }
        if (a.role === "host" && m.type === "guest-link-close") {
          await this.closeGuestLink("O anfitrião fechou o lugar do convite.");
          await this.ctx.storage.put("room", this.meta);
          this.roster();
          return;
        }
        if (m.type === "chat") {
          // Seated players talk; nothing is stored, so the chat ends with the room.
          if (a.role !== "host" && !a.player) return;
          const text = chatText(m.text);
          if (!text) return;
          const now = Date.now();
          if (now - (a.chatWindow ?? 0) >= CHAT_WINDOW_MS) {
            a.chatWindow = now;
            a.chatCount = 0;
          }
          if (++a.chatCount > CHAT_PER_WINDOW) {
            ws.serializeAttachment(a);
            send(ws, {
              type: "chat-error",
              message: "Você está mandando mensagens rápido demais.",
            });
            return;
          }
          ws.serializeAttachment(a);
          const line = {
            type: "chat",
            id: crypto.randomUUID(),
            from: a.role === "host" ? "host" : a.id,
            name:
              a.role === "host" ? this.meta.hostName || "Anfitrião" : a.name,
            player: a.role === "host" ? 1 : a.player,
            text,
            at: now,
          };
          send(this.host(), line);
          for (const guest of this.guests())
            if (guest.deserializeAttachment().player) send(guest, line);
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
