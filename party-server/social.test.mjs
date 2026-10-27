import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Log, LogLevel } from "miniflare";
import { runtime } from "./test-support/cloudflare.mjs";
import { sendLoginEmail } from "./cloudflare/social/email.mjs";
import {
  signInvite,
  verifyInvite,
} from "./cloudflare/social/invite-crypto.mjs";

const BASE = "https://social.example.test";
const EMAIL = "player@example.test";
const PEPPER = "test-only-auth-pepper-not-a-production-secret";
const INVITE_SECRET = "test-only-invite-secret-not-for-production";
test("profiles bound game history, preserve newer sessions and restrict it to owner and friends", () =>
  using(async (f) => {
    const a = await f.login("history@example.test"),
      b = await f.login("friend@example.test"),
      c = await f.login("stranger@example.test");
    const now = Date.now() - 120000;
    const game = {
      title: "Super Mario World",
      console: "Super Nintendo",
      cover: null,
      startedAt: now,
    };
    const write = (who, value) =>
      f.call("/api/friends/history", value, { token: who.token });
    const profile = async (who, id = a.user.id) =>
      (
        await f.call(`/api/friends/people/${id}`, undefined, {
          token: who.token,
        })
      ).json();
    assert.equal(
      (await f.call("/api/friends/history", { game, playSeconds: 0 })).status,
      401,
    );
    for (const body of [
      { game, playSeconds: -1 },
      { game, playSeconds: 99999999 },
      {
        game: { ...game, cover: "https://evil.test/image.png" },
        playSeconds: 0,
      },
      { game: { ...game, title: "private\npath" }, playSeconds: 0 },
      { game, playSeconds: 0, userId: b.user.id },
    ])
      assert.equal((await write(a, body)).status, 400);
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        write(a, {
          game: { ...game, title: `Game ${i}`, startedAt: now + i },
          playSeconds: 10,
        }),
      ),
    );
    let own = await profile(a);
    assert.equal(own.isSelf, true);
    assert.equal(own.recentGames.length, 10);
    assert.equal(own.recentGames[0].title, "Game 11");
    assert.equal(own.recentGames.at(-1).title, "Game 2");
    await write(a, {
      game: { ...game, title: "Game 11", startedAt: now + 11 },
      playSeconds: 60,
    });
    await write(a, {
      game: { ...game, title: "Game 11", startedAt: now + 11 },
      playSeconds: 0,
    });
    await write(a, {
      game: { ...game, title: "Game 11", startedAt: now },
      playSeconds: 90,
    });
    assert.equal((await profile(a)).recentGames[0].playSeconds, 60);
    const stranger = await profile(c);
    assert.equal(stranger.historyVisible, false);
    assert.deepEqual(stranger.recentGames, []);
    assert.deepEqual(stranger.presence, {
      status: "offline",
      playing: null,
      party: null,
    });
    assert.ok(!JSON.stringify(stranger).includes("@"));
    assert.equal(stranger.email, undefined);
    assert.equal(stranger.token, undefined);
    await pair(f, a, b);
    assert.equal((await profile(b)).recentGames.length, 10);
    await f.call(
      "/api/account/profile",
      { shareHistory: false, discoverable: false },
      { token: a.token, method: "PATCH" },
    );
    assert.equal((await profile(b)).historyVisible, false);
    assert.equal((await profile(a)).recentGames.length, 10);
    assert.equal(
      (
        await f.call(`/api/friends/people/${a.user.id}`, undefined, {
          token: c.token,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await f.call(
          "/api/account/profile",
          { shareHistory: "true" },
          { token: a.token, method: "PATCH" },
        )
      ).status,
      400,
    );
    const exported = await (
      await f.call("/api/account/export", undefined, { token: a.token })
    ).json();
    assert.equal(exported.recentGames.length, 10);
    await action(f, a, "block", b.user.id);
    assert.equal(
      (
        await f.call(`/api/friends/people/${a.user.id}`, undefined, {
          token: b.token,
        })
      ).status,
      404,
    );
    assert.equal((await profile(b, b.user.id)).recentGames.length, 0);
    await f.call("/api/account", undefined, {
      token: a.token,
      method: "DELETE",
    });
    assert.equal(
      (
        await f.db
          .prepare("SELECT COUNT(*) AS n FROM recent_games WHERE user_id=?")
          .bind(a.user.id)
          .first()
      ).n,
      0,
    );
  }));
test("people discovery is authenticated, paginated, minimal and respects hiding and blocks", () =>
  using(async (f) => {
    const a = await f.login("alice@example.test"),
      b = await f.login("bob@example.test"),
      c = await f.login("carol@example.test");
    assert.equal(a.user.discoverable, true);
    assert.equal((await f.call("/api/friends/people")).status, 401);
    const people = async () =>
      (
        await f.call("/api/friends/people", undefined, { token: a.token })
      ).json();
    let page = await people();
    assert.equal(page.people.length, 2);
    assert.equal(page.next, null);
    for (const row of page.people)
      assert.deepEqual(Object.keys(row).sort(), [
        "avatar",
        "displayName",
        "friendCode",
        "id",
        "relationship",
      ]);
    assert.ok(!JSON.stringify(page).includes("example.test"));
    assert.equal(
      (
        await f.call("/api/friends/people?after=bad", undefined, {
          token: a.token,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.call("/api/friends/people?email=private", undefined, {
          token: a.token,
        })
      ).status,
      400,
    );
    assert.equal(
      (await f.call("/api/friends/people", {}, { token: a.token })).status,
      405,
    );
    await action(f, a, "request", b.user.friendCode);
    assert.equal(
      (await people()).people.find((p) => p.id === b.user.id).relationship,
      "outgoing",
    );
    assert.equal(
      (
        await (
          await f.call(`/api/friends/people/${a.user.id}`, undefined, {
            token: b.token,
          })
        ).json()
      ).relationship,
      "incoming",
    );
    await action(f, b, "accept", a.user.id);
    assert.equal(
      (await people()).people.find((p) => p.id === b.user.id).relationship,
      "friend",
    );
    assert.equal(
      (
        await f.call(
          "/api/account/profile",
          { discoverable: "false" },
          { method: "PATCH", token: b.token },
        )
      ).status,
      400,
    );
    await f.call(
      "/api/account/profile",
      { discoverable: false },
      { method: "PATCH", token: b.token },
    );
    assert.ok(!(await people()).people.some((p) => p.id === b.user.id));
    assert.equal(
      (
        await f.call(`/api/friends/people/${b.user.id}`, undefined, {
          token: a.token,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await f.call(`/api/friends/people/${b.user.id}`, undefined, {
          token: c.token,
        })
      ).status,
      404,
    );
    assert.ok((await list(f, a)).friends.some((p) => p.id === b.user.id));
    await f.call(
      "/api/account/profile",
      { discoverable: true, appearOffline: true, showPlaying: false },
      { method: "PATCH", token: b.token },
    );
    assert.ok((await people()).people.some((p) => p.id === b.user.id));
    await action(f, a, "block", b.user.id);
    assert.ok(!(await people()).people.some((p) => p.id === b.user.id));
    assert.equal(
      (
        await f.call(`/api/friends/people/${a.user.id}`, undefined, {
          token: b.token,
        })
      ).status,
      404,
    );
    await action(f, c, "block", a.user.id);
    assert.equal((await people()).people.length, 0);
    const seed = Array.from({ length: 26 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${i.toString().padStart(12, "0")}`,
      code: `player#${i.toString().padStart(4, "0")}`,
    }));
    await f.db.batch(
      seed.map((p) =>
        f.db
          .prepare(
            "INSERT INTO users(id,email,display_name,friend_code,created_at) VALUES(?,?,?,?,?)",
          )
          .bind(p.id, `${p.id}@example.test`, "Player", p.code, Date.now()),
      ),
    );
    page = await people();
    assert.equal(page.people.length, 24);
    assert.equal(page.next, page.people.at(-1).id);
    const last = await (
      await f.call(`/api/friends/people?after=${page.next}`, undefined, {
        token: a.token,
      })
    ).json();
    assert.equal(last.people.length, 2);
    assert.equal(last.next, null);
    assert.equal(
      new Set([...page.people, ...last.people].map((p) => p.id)).size,
      26,
    );
  }));
test("players choose four-character tags with case-insensitive, atomic conflict checks", () =>
  using(async (f) => {
    const a = await f.login("alice@example.test"),
      b = await f.login("bob@example.test");
    assert.match(a.user.friendCode, /^jogador#[a-z0-9]{4}$/);
    await f.db
      .prepare("UPDATE users SET friend_code=? WHERE id=?")
      .bind("jogador#0001", a.user.id)
      .run();
    await f.db
      .prepare("UPDATE users SET friend_code=? WHERE id=?")
      .bind("jogador#0002", b.user.id)
      .run();
    for (const friendTag of ["abc", "abcde", "a_b1", "é123", "ab#1", 1234]) {
      assert.equal(
        (
          await f.call(
            "/api/account/profile",
            { friendTag },
            { token: a.token, method: "PATCH" },
          )
        ).status,
        400,
      );
    }
    const responses = await Promise.all(
      [a, b].map((who) =>
        f.call(
          "/api/account/profile",
          {
            // The same name and tag give the same code: one must lose.
            friendTag: who === a ? "AB12" : "ab12",
            displayName: who === a ? "Alice" : "ALICE",
            showPlaying: false,
          },
          { token: who.token, method: "PATCH" },
        ),
      ),
    );
    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [200, 409],
    );
    const winner = responses[0].status === 200 ? a : b,
      loser = winner === a ? b : a;
    const current = await (
      await f.call("/api/auth/session", undefined, { token: winner.token })
    ).json();
    assert.equal(current.user.friendCode, "alice#ab12");
    const failed = await (
      await f.call("/api/auth/session", undefined, { token: loser.token })
    ).json();
    assert.equal(failed.user.displayName, null);
    assert.equal(failed.user.showPlaying, true);
    assert.equal((await action(f, loser, "request", "ALICE#AB12")).status, 204);
    assert.equal(
      (await action(f, winner, "accept", loser.user.id)).status,
      204,
    );
    assert.equal(
      (
        await f.call(
          "/api/account/profile",
          { friendTag: "z9x8" },
          { token: winner.token, method: "PATCH" },
        )
      ).status,
      200,
    );
    assert.equal((await list(f, loser)).friends[0].id, winner.user.id);
    assert.equal((await list(f, loser)).friends[0].friendCode, "alice#z9x8");
    // Renaming changes the prefix; accents, spaces and symbols drop out.
    const renamed = await f.call(
      "/api/account/profile",
      { displayName: "Kauã Plaza!" },
      { token: winner.token, method: "PATCH" },
    );
    assert.equal((await renamed.json()).user.friendCode, "kauaplaza#z9x8");
    assert.equal(
      (await list(f, loser)).friends[0].friendCode,
      "kauaplaza#z9x8",
    );
    const emoji = await f.call(
      "/api/account/profile",
      { displayName: "🎮🎮🎮" },
      { token: winner.token, method: "PATCH" },
    );
    assert.equal((await emoji.json()).user.friendCode, "jogador#z9x8");
    assert.equal(
      (await action(f, loser, "request", "jogador#123456789abc")).status,
      400,
    );
  }));
test("the short-code migration handles colliding legacy prefixes and preserves IDs, friendships and existing choices", () =>
  using(async (f) => {
    const a = await f.login("alice@example.test"),
      b = await f.login("bob@example.test"),
      c = await f.login("carol@example.test");
    await pair(f, a, b);
    for (const [who, code] of [
      [a, "jogador#aabb12345678"],
      [b, "jogador#aabb87654321"],
      [c, "jogador#0000"],
    ])
      await f.db
        .prepare("UPDATE users SET friend_code=? WHERE id=?")
        .bind(code, who.user.id)
        .run();
    const sql = (
      await readFile(
        new URL(
          "./cloudflare/migrations/0002_four_character_friend_codes.sql",
          import.meta.url,
        ),
        "utf8",
      )
    )
      .replace(/^--.*$/gm, "")
      .trim();
    await f.db.prepare(sql).run();
    const first = (
      await f.db.prepare("SELECT id,friend_code FROM users ORDER BY id").all()
    ).results;
    assert.equal(new Set(first.map((row) => row.friend_code)).size, 3);
    assert.ok(
      first.every((row) => /^jogador#[a-z0-9]{4}$/.test(row.friend_code)),
    );
    assert.equal(
      first.find((row) => row.id === c.user.id).friend_code,
      "jogador#0000",
    );
    assert.equal((await list(f, a)).friends[0].id, b.user.id);
    assert.equal(
      (await f.call("/api/auth/session", undefined, { token: b.token })).status,
      200,
    );
    await f.db.prepare(sql).run();
    assert.deepEqual(
      (await f.db.prepare("SELECT id,friend_code FROM users ORDER BY id").all())
        .results,
      first,
    );
  }));
const digest = (value) => createHash("sha256").update(value).digest("hex");
async function fixture(bindings = {}, options = {}) {
  const emails = [],
    logs = [];
  class QuietLog extends Log {
    constructor() {
      super(LogLevel.NONE);
    }
    info(message) {
      logs.push(message);
    }
  }
  const config = {
    AUTH_PEPPER: PEPPER,
    EMAIL_FROM: "OpenRetro <conta@example.test>",
    RESEND_API_KEY: "test-only-resend-key",
    ...bindings,
  };
  for (const key of Object.keys(config))
    if (config[key] === undefined) delete config[key];
  const mf = await runtime(config, {
    d1Databases: ["SOCIAL_DB"],
    log: new QuietLog(),
    handleStructuredLogs: ({ message }) => logs.push(message),
    outboundService: async (request) => {
      assert.equal(
        new URL(request.url).origin,
        "https://api.resend.com",
        "No real external service may be contacted",
      );
      assert.equal(
        request.headers.get("Authorization"),
        "Bearer test-only-resend-key",
      );
      emails.push(await request.json());
      return Response.json({ id: "test-message" });
    },
    ...options,
  });
  const db = await mf.getD1Database("SOCIAL_DB");
  const migration = (
    await Promise.all(
      (await readdir(new URL("./cloudflare/migrations/", import.meta.url)))
        .filter((name) => name.endsWith(".sql"))
        .sort()
        .map((name) =>
          readFile(
            new URL(`./cloudflare/migrations/${name}`, import.meta.url),
            "utf8",
          ),
        ),
    )
  ).join("\n");
  try {
    const statements = migration
      .replace(/^--.*$/gm, "")
      .split(";")
      .map((sql) => sql.trim())
      .filter(Boolean);
    await db.batch(statements.map((sql) => db.prepare(sql)));
  } catch (error) {
    await mf.dispose();
    throw error;
  }
  const call = (
    path,
    data,
    {
      token,
      ip = "192.0.2.1",
      method = data === undefined ? "GET" : "POST",
      origin,
      base = BASE,
    } = {},
  ) =>
    mf.dispatchFetch(base + path, {
      method,
      headers: {
        "CF-Connecting-IP": ip,
        ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    });
  const start = (email = EMAIL, options) =>
    call("/api/auth/start", { email }, options);
  const code = () => /é: (\d{6})/.exec(emails.at(-1)?.text || "")?.[1];
  const verify = (value = code(), email = EMAIL, options) =>
    call("/api/auth/verify", { email, code: value }, options);
  const login = async (email = EMAIL) => {
    assert.equal((await start(email)).status, 202);
    const response = await verify(code(), email);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const ageCode = () =>
    db
      .prepare("UPDATE login_codes SET created_at = ?")
      .bind(Date.now() - 61000)
      .run();
  return { mf, db, call, start, code, verify, login, ageCode, emails, logs };
}
async function using(fn, bindings, options) {
  const f = await fixture(bindings, options);
  try {
    await fn(f);
  } finally {
    await f.mf.dispose();
  }
}

const offlineSocial = { status: "offline", playing: null, party: null };
const action = (f, who, kind, target) =>
  f.call("/api/friends/action", { action: kind, target }, { token: who.token });
const list = async (f, who) => {
  const response = await f.call("/api/friends", undefined, {
    token: who.token,
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
};
async function pair(f, a, b) {
  assert.equal((await action(f, a, "request", b.user.friendCode)).status, 204);
  assert.equal((await action(f, b, "accept", a.user.id)).status, 204);
}
async function socialSocket(f, who) {
  const response = await f.mf.dispatchFetch(BASE + "/social", {
    headers: { Upgrade: "websocket", Authorization: `Bearer ${who.token}` },
  });
  assert.equal(response.status, 101);
  const ws = response.webSocket,
    messages = [];
  ws.addEventListener("message", (event) =>
    messages.push(JSON.parse(event.data)),
  );
  ws.accept();
  return { ws, messages };
}
async function eventually(check) {
  const deadline = Date.now() + 5000;
  do {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  assert.fail("Expected social state was not delivered");
}
async function roomSocket(f, code) {
  const response = await f.mf.dispatchFetch(
    `http://localhost/signal?room=${code}`,
    { headers: { Upgrade: "websocket" } },
  );
  assert.equal(response.status, 101);
  const ws = response.webSocket,
    messages = [];
  ws.addEventListener("message", (event) =>
    messages.push(
      event.data === "pong" ? { type: "pong" } : JSON.parse(event.data),
    ),
  );
  ws.accept();
  return { ws, messages, send: (value) => ws.send(JSON.stringify(value)) };
}
async function hostRoom(f, user, ip = "192.0.2.50") {
  // Hosts sign in: a room needs the host's session.
  const reservation = await f.call(
    "/api/rooms",
    {},
    { base: "http://localhost", ip, token: user.token },
  );
  assert.equal(reservation.status, 201, await reservation.clone().text());
  const { code, ticket } = await reservation.json(),
    host = await roomSocket(f, code);
  host.send({ type: "create", ticket });
  await eventually(() =>
    host.messages.some((message) => message.type === "created"),
  );
  const bind = (joinable) =>
    f.call(
      "/api/friends/party/host",
      { code, ticket, joinable },
      { token: user.token },
    );
  return { code, ticket, host, bind };
}
async function publishParty(f, user, room) {
  const socket = await socialSocket(f, user);
  socket.ws.send(
    JSON.stringify({
      type: "presence",
      presence: {
        status: "online",
        playing: null,
        party: { code: room.code, joinable: true },
      },
    }),
  );
  return socket;
}
const issueInvite = (f, guest, host) =>
  f.call(
    "/api/friends/party/join",
    { friendId: host.user.id },
    { token: guest.token },
  );
async function ticketFor(f, guest, host) {
  const response = await issueInvite(f, guest, host);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
async function pendingJoin(f, room, invite, name = "Entrada manual") {
  const guest = await roomSocket(f, room.code);
  guest.send({ type: "join", room: room.code, name, invite });
  // Without a valid ticket the room refuses the guest outright.
  await eventually(() =>
    guest.messages.some((message) =>
      ["accepted", "error"].includes(message.type),
    ),
  );
  return guest;
}
const refused = (guest) =>
  guest.messages.some(
    (message) =>
      message.type === "error" && /botão Entrar/.test(message.message),
  );
test("signed Party tickets expire and reject tampering without accepting unknown claims", async () => {
  const env = { PARTY_TICKET_SECRET: INVITE_SECRET };
  const fields = {
    room: "ABC234",
    hostId: crypto.randomUUID(),
    guestId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    epoch: crypto.randomUUID(),
  };
  const invite = await signInvite(env, fields, 10000);
  assert.equal(
    (await verifyInvite(env, invite, 11000)).guestId,
    fields.guestId,
  );
  assert.equal(await verifyInvite(env, invite, 130000), null);
  assert.equal(
    await verifyInvite(
      env,
      invite.slice(0, -1) + (invite.endsWith("a") ? "b" : "a"),
      11000,
    ),
    null,
  );
  assert.equal(await verifyInvite({}, invite, 11000), null);
  assert.equal(
    await verifyInvite(
      env,
      await signInvite(env, { ...fields, admin: true }, 10000),
      11000,
    ),
    null,
  );
});
test("Party friends prove ownership, get an automatic unique seat and cannot replay a used ticket", () =>
  using(
    async (f) => {
      const a = await f.login("alice@example.test"),
        b = await f.login("bob@example.test"),
        c = await f.login("carol@example.test"),
        d = await f.login("david@example.test"),
        e = await f.login("eve@example.test");
      for (const guest of [b, c, d, e]) await pair(f, a, guest);
      await f.call(
        "/api/account/profile",
        { displayName: "Bobby", avatar: 14 },
        { method: "PATCH", token: b.token },
      );
      const room = await hostRoom(f, a),
        sockets = [room.host.ws];
      try {
        assert.equal(
          (
            await f.call(
              "/api/friends/party/host",
              { code: room.code, ticket: "0".repeat(64), joinable: true },
              { token: b.token },
            )
          ).status,
          403,
        );
        assert.equal((await room.bind(true)).status, 200);
        const presence = await publishParty(f, a, room);
        sockets.push(presence.ws);
        await eventually(
          async () =>
            (await list(f, b)).friends[0].presence.party?.code === room.code,
        );
        const first = await ticketFor(f, b, a);
        const guest = await pendingJoin(
          f,
          room,
          first.invite,
          "Nome falsificado",
        );
        sockets.push(guest.ws);
        assert.equal(
          guest.messages.find((m) => m.type === "accepted").player,
          2,
        );
        const roster = await eventually(() =>
          room.host.messages.find(
            (m) =>
              m.type === "roster" && m.guests.some((g) => g.name === "Bobby"),
          ),
        );
        const member = roster.guests.find((g) => g.name === "Bobby");
        assert.equal(member.player, 2);
        assert.equal(member.avatar, 14);
        assert.equal(JSON.stringify(first).includes(b.token), false);
        room.host.send({ type: "remove", id: member.id });
        await eventually(() => guest.messages.some((m) => m.type === "ended"));
        const replay = await pendingJoin(
          f,
          room,
          first.invite,
          "Replay manual",
        );
        sockets.push(replay.ws);
        assert.equal(
          replay.messages.some((m) => m.type === "accepted"),
          false,
        );
        assert.ok(refused(replay));
        const used = [];
        for (const account of [c, d, e]) {
          const ticket = await ticketFor(f, account, a);
          const client = await pendingJoin(f, room, ticket.invite);
          sockets.push(client.ws);
          used.push(client.messages.find((m) => m.type === "accepted").player);
        }
        assert.deepEqual(used, [2, 3, 4]);
        const extra = await ticketFor(f, b, a);
        const full = await pendingJoin(f, room, extra.invite);
        sockets.push(full.ws);
        assert.ok(
          full.messages.some(
            (m) => m.type === "error" && /cheia/.test(m.message),
          ),
        );
      } finally {
        for (const ws of sockets) ws.close();
      }
    },
    { PARTY_TICKET_SECRET: INVITE_SECRET },
  ));
test("expired, forged, other-room, missing and switched-off Party tickets are refused", () =>
  using(
    async (f) => {
      const a = await f.login("alice@example.test"),
        b = await f.login("bob@example.test");
      await pair(f, a, b);
      const room = await hostRoom(f, a),
        other = await hostRoom(f, a, "192.0.2.51"),
        sockets = [room.host.ws, other.host.ws];
      try {
        assert.equal((await room.bind(true)).status, 200);
        assert.equal((await other.bind(true)).status, 200);
        const presence = await publishParty(f, a, room);
        sockets.push(presence.ws);
        await eventually(
          async () =>
            (await list(f, b)).friends[0].presence.party?.code === room.code,
        );
        const valid = await ticketFor(f, b, a),
          claims = await verifyInvite(
            { PARTY_TICKET_SECRET: INVITE_SECRET },
            valid.invite,
          );
        const fields = {
          room: claims.room,
          hostId: claims.hostId,
          guestId: claims.guestId,
          sessionId: claims.sessionId,
          epoch: claims.epoch,
        };
        const expired = await signInvite(
          { PARTY_TICKET_SECRET: INVITE_SECRET },
          fields,
          Date.now() - 121000,
        );
        const forged =
          valid.invite.slice(0, -1) + (valid.invite.endsWith("a") ? "b" : "a");
        for (const [target, token] of [
          [room, expired],
          [room, forged],
          [other, valid.invite],
          [room, undefined],
        ]) {
          const guest = await pendingJoin(f, target, token);
          sockets.push(guest.ws);
          assert.ok(refused(guest));
        }
        assert.equal((await room.bind(false)).status, 200);
        assert.equal((await issueInvite(f, b, a)).status, 403);
        assert.equal((await room.bind(true)).status, 200);
        const old = await pendingJoin(f, room, valid.invite);
        sockets.push(old.ws);
        assert.equal(
          old.messages.some((m) => m.type === "accepted"),
          false,
        );
        assert.ok(refused(old));
      } finally {
        for (const ws of sockets) ws.close();
      }
    },
    { PARTY_TICKET_SECRET: INVITE_SECRET },
  ));
test("blocking, session revocation and offline privacy invalidate an already issued Party ticket", () =>
  using(
    async (f) => {
      const a = await f.login("alice@example.test"),
        b = await f.login("bob@example.test"),
        c = await f.login("carol@example.test");
      await pair(f, a, b);
      const room = await hostRoom(f, a),
        sockets = [room.host.ws];
      try {
        assert.equal((await room.bind(true)).status, 200);
        const presence = await publishParty(f, a, room);
        sockets.push(presence.ws);
        await eventually(
          async () =>
            (await list(f, b)).friends[0].presence.party?.code === room.code,
        );
        assert.equal((await issueInvite(f, c, a)).status, 403);
        const valid = await ticketFor(f, b, a);
        await f.call(
          "/api/account/profile",
          { appearOffline: true },
          { method: "PATCH", token: a.token },
        );
        const hidden = await pendingJoin(f, room, valid.invite);
        sockets.push(hidden.ws);
        assert.equal(
          hidden.messages.some((m) => m.type === "accepted"),
          false,
        );
        await f.call(
          "/api/account/profile",
          { appearOffline: false },
          { method: "PATCH", token: a.token },
        );
        await action(f, b, "block", a.user.id);
        const blocked = await pendingJoin(f, room, valid.invite);
        sockets.push(blocked.ws);
        assert.equal(
          blocked.messages.some((m) => m.type === "accepted"),
          false,
        );
        await action(f, b, "unblock", a.user.id);
        await pair(f, a, b);
        const revoked = await ticketFor(f, b, a);
        await f.call("/api/auth/logout-all", {}, { token: b.token });
        const loggedOut = await pendingJoin(f, room, revoked.invite);
        sockets.push(loggedOut.ws);
        assert.equal(
          loggedOut.messages.some((m) => m.type === "accepted"),
          false,
        );
      } finally {
        for (const ws of sockets) ws.close();
      }
    },
    { PARTY_TICKET_SECRET: INVITE_SECRET },
  ));
test("a social client cannot advertise another host's Party, and a forged ticket is refused", () =>
  using(
    async (f) => {
      const a = await f.login("alice@example.test"),
        b = await f.login("bob@example.test");
      await pair(f, a, b);
      const room = await hostRoom(f, a),
        socket = await publishParty(f, b, room),
        sockets = [room.host.ws, socket.ws];
      try {
        socket.ws.send(JSON.stringify({ type: "heartbeat" }));
        await eventually(() => socket.messages.some((m) => m.type === "pong"));
        assert.equal((await list(f, a)).friends[0].presence.party, null);
        const guest = await pendingJoin(f, room, "forged");
        sockets.push(guest.ws);
        assert.ok(refused(guest));
      } finally {
        for (const ws of sockets) ws.close();
      }
    },
    { PARTY_TICKET_SECRET: INVITE_SECRET },
  ));
test("rooms need a signed-in host and the ticket secret", () =>
  using(async (f) => {
    const a = await f.login("alice@example.test");
    const create = (token) =>
      f.call("/api/rooms", {}, { base: "http://localhost", token });
    // Without the ticket secret nobody could join, so no room opens.
    assert.equal((await create(a.token)).status, 503);
  }).then(() =>
    using(
      async (f) => {
        const a = await f.login("alice@example.test");
        const create = (token) =>
          f.call("/api/rooms", {}, { base: "http://localhost", token });
        const anonymous = await create();
        assert.equal(anonymous.status, 401);
        assert.match((await anonymous.json()).error, /Entre na sua conta/);
        assert.equal((await create("f".repeat(64))).status, 401);
        assert.equal((await create(a.token)).status, 201);
      },
      { PARTY_TICKET_SECRET: INVITE_SECRET },
    ),
  ));
test("friend requests have ownership, duplicate, cancel, accept, remove and block semantics", () =>
  using(async (f) => {
    const a = await f.login("alice@example.test"),
      b = await f.login("bob@example.test"),
      c = await f.login("carol@example.test");
    assert.equal((await f.call("/api/friends")).status, 401);
    assert.equal(
      (await action(f, a, "request", a.user.friendCode)).status,
      400,
    );
    assert.equal(
      (await action(f, a, "request", b.user.friendCode)).status,
      204,
    );
    assert.equal(
      (await action(f, a, "request", b.user.friendCode)).status,
      409,
    );
    assert.equal((await action(f, c, "accept", a.user.id)).status, 409);
    assert.equal((await action(f, c, "cancel", b.user.id)).status, 204);
    assert.equal((await list(f, b)).incoming[0].id, a.user.id);
    assert.equal((await action(f, b, "decline", a.user.id)).status, 204);
    assert.equal((await list(f, a)).outgoing.length, 0);
    await pair(f, a, b);
    const friends = await list(f, a);
    assert.equal(friends.friends[0].id, b.user.id);
    assert.equal("email" in friends.friends[0], false);
    assert.equal(JSON.stringify(friends).includes("token"), false);
    assert.equal((await action(f, a, "remove", b.user.id)).status, 204);
    assert.equal((await list(f, b)).friends.length, 0);
    await pair(f, a, b);
    assert.equal((await action(f, a, "block", b.user.id)).status, 204);
    assert.equal((await list(f, b)).friends.length, 0);
    assert.equal((await list(f, a)).blocked[0].id, b.user.id);
    assert.equal(
      (await action(f, b, "request", a.user.friendCode)).status,
      400,
    );
    assert.equal(
      (await action(f, a, "request", b.user.friendCode)).status,
      400,
    );
    assert.equal((await action(f, b, "unblock", a.user.id)).status, 204);
    assert.equal(
      (await action(f, b, "request", a.user.friendCode)).status,
      400,
    );
    assert.equal((await action(f, a, "unblock", b.user.id)).status, 204);
    await pair(f, a, b);
    assert.equal((await list(f, b)).friends.length, 1);
  }));
test("daily friend request quota survives cancel and resets only after a day", () =>
  using(async (f) => {
    const a = await f.login("alice@example.test"),
      b = await f.login("bob@example.test");
    for (let i = 0; i < 20; i++) {
      assert.equal(
        (await action(f, a, "request", b.user.friendCode)).status,
        204,
      );
      assert.equal((await action(f, a, "cancel", b.user.id)).status, 204);
    }
    const denied = await action(f, a, "request", b.user.friendCode);
    assert.equal(denied.status, 429);
    assert.ok(Number(denied.headers.get("Retry-After")) > 86000);
  }));
test("SocialHub sends presence only to friends and applies privacy immediately", () =>
  using(async (f) => {
    const a = await f.login("alice@example.test"),
      b = await f.login("bob@example.test"),
      c = await f.login("carol@example.test");
    await pair(f, a, b);
    const sa = await socialSocket(f, a),
      sb = await socialSocket(f, b),
      sc = await socialSocket(f, c);
    try {
      const playing = {
        title: "Super Mario Kart",
        console: "Super Nintendo",
        cover: "https://images.igdb.com/test.jpg",
        startedAt: Date.now(),
      };
      sa.ws.send(
        JSON.stringify({
          type: "presence",
          presence: { status: "online", playing, party: null },
        }),
      );
      await eventually(() =>
        sb.messages.find(
          (m) =>
            m.type === "presence" &&
            m.presence.playing?.title === playing.title,
        ),
      );
      assert.equal(
        sc.messages.some((m) => m.type === "presence" && m.id === a.user.id),
        false,
      );
      const row = (await list(f, b)).friends[0];
      assert.equal(row.presence.playing.title, playing.title);
      const ownProfile = await (
        await f.call(`/api/friends/people/${a.user.id}`, undefined, {
          token: a.token,
        })
      ).json();
      assert.equal(ownProfile.presence.playing.title, playing.title);
      const friendProfile = await (
        await f.call(`/api/friends/people/${a.user.id}`, undefined, {
          token: b.token,
        })
      ).json();
      assert.equal(friendProfile.presence.playing.title, playing.title);
      const strangerProfile = await (
        await f.call(`/api/friends/people/${a.user.id}`, undefined, {
          token: c.token,
        })
      ).json();
      assert.equal(strangerProfile.presence.playing, null);
      assert.equal(
        (
          await f.call(
            "/api/account/profile",
            { showPlaying: false },
            { method: "PATCH", token: a.token },
          )
        ).status,
        200,
      );
      await eventually(
        () =>
          sb.messages.at(-1)?.type === "presence" &&
          sb.messages.at(-1).presence.playing === null,
      );
      assert.equal((await list(f, b)).friends[0].presence.status, "online");
      assert.equal((await list(f, b)).friends[0].presence.playing, null);
      assert.equal(
        (
          await f.call(
            "/api/account/profile",
            { appearOffline: true },
            { method: "PATCH", token: a.token },
          )
        ).status,
        200,
      );
      assert.deepEqual((await list(f, b)).friends[0].presence, offlineSocial);
      assert.equal(
        (
          await f.call(
            "/api/account/profile",
            { appearOffline: false, showPlaying: true },
            { method: "PATCH", token: a.token },
          )
        ).status,
        200,
      );
      assert.equal(
        (await list(f, b)).friends[0].presence.playing.title,
        playing.title,
      );
      await action(f, b, "block", a.user.id);
      const after = sb.messages.length;
      sa.ws.send(
        JSON.stringify({
          type: "presence",
          presence: {
            status: "online",
            playing: { ...playing, title: "Private game" },
            party: null,
          },
        }),
      );
      sa.ws.send(JSON.stringify({ type: "heartbeat" }));
      await eventually(() => sa.messages.some((m) => m.type === "pong"));
      assert.equal(
        sb.messages
          .slice(after)
          .some(
            (m) =>
              m.type === "presence" &&
              m.presence.playing?.title === "Private game",
          ),
        false,
      );
      assert.equal((await list(f, b)).friends.length, 0);
    } finally {
      sa.ws.close();
      sb.ws.close();
      sc.ws.close();
    }
  }));
test("SocialHub rejects unsafe covers and forged state and revokes existing sessions", () =>
  using(async (f) => {
    const a = await f.login("alice@example.test"),
      b = await f.login("bob@example.test");
    await pair(f, a, b);
    assert.equal(
      (
        await f.mf.dispatchFetch(BASE + "/social?token=" + a.token, {
          headers: { Upgrade: "websocket" },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await f.mf.dispatchFetch(BASE + "/social", {
          headers: {
            Upgrade: "websocket",
            Authorization: `Bearer ${a.token}`,
            Origin: "https://evil.test",
          },
        })
      ).status,
      403,
    );
    const sa = await socialSocket(f, a);
    let closed = false;
    sa.ws.addEventListener("close", () => {
      closed = true;
    });
    sa.ws.send(
      JSON.stringify({
        type: "presence",
        presence: {
          status: "online",
          playing: {
            title: "Secret",
            console: "SNES",
            cover: "https://images.igdb.com.evil.test/a",
            startedAt: Date.now(),
          },
          party: null,
        },
      }),
    );
    await eventually(() => closed);
    assert.deepEqual((await list(f, b)).friends[0].presence, offlineSocial);
    const second = await socialSocket(f, a);
    let revoked = false;
    second.ws.addEventListener("close", () => {
      revoked = true;
    });
    assert.equal(
      (await f.call("/api/auth/logout-all", {}, { token: a.token })).status,
      204,
    );
    await eventually(
      () =>
        revoked ||
        second.messages.some((message) => message.type === "expired"),
    );
    assert.deepEqual((await list(f, b)).friends[0].presence, offlineSocial);
    second.ws.close();
  }));

test(
  "a dropped socket becomes offline and a missed heartbeat expires presence without expiring the account",
  { timeout: 110000 },
  () =>
    using(async (f) => {
      const a = await f.login("alice@example.test"),
        b = await f.login("bob@example.test");
      await pair(f, a, b);
      const first = await socialSocket(f, a);
      assert.equal((await list(f, b)).friends[0].presence.status, "online");
      first.ws.close();
      await eventually(
        async () => (await list(f, b)).friends[0].presence.status === "offline",
      );
      const second = await socialSocket(f, a);
      try {
        second.ws.send(JSON.stringify({ type: "heartbeat" }));
        await eventually(() =>
          second.messages.some((message) => message.type === "pong"),
        );
        await new Promise((resolve) => setTimeout(resolve, 91500));
        assert.deepEqual((await list(f, b)).friends[0].presence, offlineSocial);
        assert.equal(
          (await f.call("/api/auth/session", undefined, { token: a.token }))
            .status,
          200,
        );
        assert.equal(
          second.messages.some((message) => message.type === "expired"),
          false,
        );
      } finally {
        second.ws.close();
      }
    }),
);

test("email login normalizes addresses, stores only credential hashes and consumes the code once", () =>
  using(async (f) => {
    const first = await f.start("  PLAYER@EXAMPLE.TEST  ");
    assert.equal(first.status, 202);
    const startBody = await first.json();
    assert.equal("code" in startBody, false);
    assert.equal(
      (await f.db.prepare("SELECT count(*) AS n FROM users").first()).n,
      0,
    );
    assert.deepEqual(f.emails[0].to, [EMAIL]);
    assert.match(f.code(), /^\d{6}$/);
    assert.match(f.emails[0].text, /10 minutos/);
    assert.match(f.emails[0].text, /Se não foi você, ignore/);
    assert.equal("html" in f.emails[0], false);
    const stored = await f.db.prepare("SELECT * FROM login_codes").first();
    assert.match(stored.code_hash, /^[a-f0-9]{64}$/);
    assert.match(stored.email_hash, /^[a-f0-9]{64}$/);
    assert.notEqual(stored.code_hash, f.code());
    assert.equal("email" in stored, false);
    const response = await f.verify(f.code(), " PLAYER@example.test ");
    assert.equal(response.status, 200);
    const session = await response.json();
    assert.match(session.token, /^[a-f0-9]{64}$/);
    assert.equal(session.user.email, EMAIL);
    assert.equal(session.user.showPlaying, true);
    assert.equal(session.user.appearOffline, false);
    assert.equal(session.needsProfile, true);
    const storedSession = await f.db.prepare("SELECT * FROM sessions").first();
    assert.equal(storedSession.token_hash, digest(session.token));
    assert.equal("token" in storedSession, false);
    assert.equal((await f.verify()).status, 401);
    await f.ageCode();
    const known = await f.start();
    assert.deepEqual(await known.json(), startBody);
    assert.ok(
      f.logs.every(
        (line) =>
          !line.includes("[OpenRetro local login]") && !line.includes(EMAIL),
      ),
    );
  }));

test("a code expires after ten minutes and resend invalidates the old challenge", () =>
  using(async (f) => {
    await f.start();
    const old = f.code();
    const cooldown = await f.start();
    assert.equal(cooldown.status, 429);
    assert.ok(Number(cooldown.headers.get("Retry-After")) > 0);
    await f.ageCode();
    await f.db
      .prepare("UPDATE login_codes SET expires_at = ?")
      .bind(Date.now() - 1)
      .run();
    assert.equal((await f.verify(old)).status, 401);
    assert.equal((await f.start()).status, 202);
    // A resend replaces the challenge and resets its attempt budget.
    if (old !== f.code()) assert.equal((await f.verify(old)).status, 401);
    const changed = await f.db.prepare("SELECT * FROM login_codes").first();
    assert.equal(changed.attempts, old !== f.code() ? 1 : 0);
    const response = await f.verify(f.code());
    assert.equal(response.status, 200);
  }));

test("five wrong attempts lock the code, including malformed codes", () =>
  using(async (f) => {
    await f.start();
    for (let i = 0; i < 5; i++)
      assert.equal(
        (await f.verify("not-six-digits")).status,
        i === 4 ? 429 : 401,
      );
    assert.equal((await f.verify()).status, 429);
    assert.equal(
      (await f.db.prepare("SELECT count(*) AS n FROM sessions").first()).n,
      0,
    );
    assert.equal(
      (await f.db.prepare("SELECT attempts FROM login_codes").first()).attempts,
      5,
    );
  }));

test("the correct fifth attempt succeeds and parallel verification issues only one session", () =>
  using(async (f) => {
    await f.start();
    for (let i = 0; i < 4; i++)
      assert.equal((await f.verify("bad")).status, 401);
    const responses = await Promise.all([f.verify(), f.verify(), f.verify()]);
    assert.equal(responses.filter((r) => r.status === 200).length, 1);
    assert.equal(
      (await f.db.prepare("SELECT count(*) AS n FROM sessions").first()).n,
      1,
    );
    assert.equal(
      (await f.db.prepare("SELECT count(*) AS n FROM users").first()).n,
      1,
    );
  }));

test("email quota survives resends and resets only after its window", () =>
  using(async (f) => {
    for (let i = 0; i < 3; i++) {
      assert.equal((await f.start()).status, 202);
      await f.ageCode();
    }
    assert.equal((await f.start()).status, 429);
    assert.equal(f.emails.length, 3);
    await f.db
      .prepare("UPDATE auth_rate_limits SET expires_at = ?")
      .bind(Date.now() - 1)
      .run();
    assert.equal((await f.start()).status, 202);
  }));

test("IP quotas are atomic across concurrent starts and also limit verification", () =>
  using(async (f) => {
    const responses = await Promise.all(
      Array.from({ length: 14 }, (_, i) => f.start(`player${i}@example.test`)),
    );
    assert.equal(responses.filter((r) => r.status === 202).length, 10);
    assert.equal(responses.filter((r) => r.status === 429).length, 4);
    for (let i = 0; i < 30; i++)
      assert.equal(
        (await f.verify("000000", "unknown@example.test", { ip: "192.0.2.2" }))
          .status,
        401,
      );
    const limited = await f.verify("000000", "unknown@example.test", {
      ip: "192.0.2.2",
    });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("Retry-After")) > 0);
    const quotaRows = await f.db
      .prepare("SELECT * FROM auth_rate_limits")
      .all();
    assert.ok(quotaRows.results.every((r) => /^[a-f0-9]{64}$/.test(r.key)));
  }));

test("sessions renew for ninety days, expire and support logout and logout-all", () =>
  using(async (f) => {
    const one = await f.login();
    await f.db
      .prepare("UPDATE sessions SET expires_at = ?")
      .bind(Date.now() + 60000)
      .run();
    const refreshed = await (
      await f.call("/api/auth/session", undefined, { token: one.token })
    ).json();
    assert.ok(refreshed.expiresAt > Date.now() + 89 * 86400000);
    await f.ageCode();
    const two = await f.login();
    assert.equal(two.user.id, one.user.id);
    assert.equal(
      (
        await f.call("/api/auth/logout", undefined, {
          token: one.token,
          method: "POST",
        })
      ).status,
      204,
    );
    assert.equal(
      (await f.call("/api/auth/session", undefined, { token: one.token }))
        .status,
      401,
    );
    assert.equal(
      (await f.call("/api/auth/session", undefined, { token: two.token }))
        .status,
      200,
    );
    await f.ageCode();
    const three = await f.login();
    assert.equal(
      (
        await f.call("/api/auth/logout-all", undefined, {
          token: two.token,
          method: "POST",
        })
      ).status,
      204,
    );
    assert.equal(
      (await f.call("/api/auth/session", undefined, { token: three.token }))
        .status,
      401,
    );
    await f.ageCode();
    await f.db
      .prepare("UPDATE auth_rate_limits SET expires_at = ?")
      .bind(Date.now() - 1)
      .run();
    const four = await f.login();
    await f.db
      .prepare("UPDATE sessions SET expires_at = ?")
      .bind(Date.now() - 1)
      .run();
    assert.equal(
      (await f.call("/api/auth/session", undefined, { token: four.token }))
        .status,
      401,
    );
  }));

test("export redacts credentials; deletion cascades through both sides of every relationship", () =>
  using(async (f) => {
    const one = await f.login(),
      two = await f.login("friend@example.test");
    const a = one.user.id,
      b = two.user.id,
      now = Date.now();
    for (const table of ["friend_requests", "friendships", "blocks"]) {
      const [x, y] =
        table === "friend_requests"
          ? ["sender_id", "receiver_id"]
          : table === "blocks"
            ? ["user_id", "blocked_id"]
            : ["user_id", "friend_id"];
      await f.db.batch([
        f.db
          .prepare(
            `INSERT INTO ${table} (${x}, ${y}, created_at) VALUES (?, ?, ?)`,
          )
          .bind(a, b, now),
        f.db
          .prepare(
            `INSERT INTO ${table} (${x}, ${y}, created_at) VALUES (?, ?, ?)`,
          )
          .bind(b, a, now),
      ]);
    }
    await f.ageCode();
    await f.start();
    const exportedResponse = await f.call("/api/account/export", undefined, {
      token: one.token,
    });
    assert.match(
      exportedResponse.headers.get("Content-Disposition"),
      /attachment/,
    );
    const exported = await exportedResponse.json();
    assert.equal(exported.user.email, EMAIL);
    assert.equal(exported.loginChallenges.length, 1);
    assert.equal("code_hash" in exported.loginChallenges[0], false);
    assert.equal(exported.friendRequests.length, 2);
    assert.equal(exported.friendships.length, 2);
    assert.equal(exported.blocks.length, 1);
    assert.equal(JSON.stringify(exported).includes(one.token), false);
    assert.equal(JSON.stringify(exported).includes("token_hash"), false);
    assert.equal(
      (
        await f.call("/api/account", undefined, {
          token: one.token,
          method: "DELETE",
        })
      ).status,
      204,
    );
    assert.equal(
      (await f.call("/api/auth/session", undefined, { token: one.token }))
        .status,
      401,
    );
    assert.equal(
      (await f.call("/api/auth/session", undefined, { token: two.token }))
        .status,
      200,
    );
    for (const table of ["friend_requests", "friendships", "blocks"])
      assert.equal(
        (await f.db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n,
        0,
      );
    assert.equal(
      (await f.db.prepare("SELECT count(*) AS n FROM users").first()).n,
      1,
    );
    assert.equal(
      (await f.db.prepare("SELECT count(*) AS n FROM login_codes").first()).n,
      1,
    );
  }));

test("CORS, bearer authentication, body limits and malformed input fail without exposing data", () =>
  using(async (f) => {
    assert.equal(
      (await f.start(EMAIL, { origin: "https://untrusted.example" })).status,
      403,
    );
    const preflight = await f.call("/api/auth/session", undefined, {
      method: "OPTIONS",
      origin: "tauri://localhost",
    });
    assert.equal(preflight.status, 204);
    assert.match(
      preflight.headers.get("Access-Control-Allow-Headers"),
      /Authorization/,
    );
    for (const path of ["/api/account/export", "/api/auth/session"])
      assert.equal((await f.call(path)).status, 401);
    assert.equal(
      (await f.call("/api/account", undefined, { method: "DELETE" })).status,
      401,
    );
    for (const email of [
      "bad",
      "a@b",
      ".a@example.test",
      "a..b@example.test",
      "a\n@example.test",
      {},
      "a".repeat(255) + "@example.test",
    ])
      assert.equal((await f.start(email)).status, 400);
    assert.equal(
      (await f.call("/api/auth/start", { email: "a".repeat(3000) })).status,
      413,
    );
    assert.equal((await f.call("/api/auth/start")).status, 405);
    assert.equal((await f.call("/api/auth/missing")).status, 404);
    const badJson = await f.mf.dispatchFetch(BASE + "/api/auth/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(badJson.status, 400);
    const form = await f.mf.dispatchFetch(BASE + "/api/auth/start", {
      method: "POST",
      body: "email=player@example.test",
    });
    assert.equal(form.status, 415);
  }));

test("public deployments cannot fall back to logging codes when email configuration is missing", () =>
  using(
    async (f) => {
      assert.equal((await f.start()).status, 503);
      assert.ok(
        f.logs.every(
          (line) =>
            !line.includes("[OpenRetro local login]") && !line.includes(EMAIL),
        ),
      );
      assert.equal(
        (await f.db.prepare("SELECT count(*) AS n FROM login_codes").first()).n,
        0,
      );
    },
    { RESEND_API_KEY: undefined },
  ));

test("local logging is explicitly opt-in and rejects public hosts", () =>
  using(
    async (f) => {
      assert.equal((await f.start()).status, 503);
      const response = await f.start(EMAIL, { base: "http://localhost" });
      assert.equal(response.status, 202);
      const line = f.logs.find((message) =>
        message.includes("[OpenRetro local login]"),
      );
      assert.ok(line);
      assert.equal(line.includes(EMAIL), false);
      assert.equal(f.emails.length, 0);
      const code = /Código: (\d{6})/.exec(line)[1];
      assert.equal(
        (await f.verify(code, EMAIL, { base: "http://localhost" })).status,
        200,
      );
    },
    { RESEND_API_KEY: undefined, SOCIAL_DEV_MODE: "true" },
  ));

test("a provider failure invalidates the unsent challenge and reveals no provider response", () =>
  using(
    async (f) => {
      const response = await f.start();
      assert.equal(response.status, 503);
      assert.equal(
        (await f.db.prepare("SELECT count(*) AS n FROM login_codes").first()).n,
        0,
      );
      assert.equal((await response.text()).includes(EMAIL), false);
      assert.ok(
        f.logs.every(
          (line) =>
            !line.includes("[OpenRetro local login]") && !line.includes(EMAIL),
        ),
      );
    },
    {},
    {
      outboundService: () =>
        new Response("provider detail: " + EMAIL, { status: 500 }),
    },
  ));

test("Party needs the account service, privacy does not; hourly cleanup removes expired records", async () => {
  const mf = await runtime();
  try {
    const response = await mf.dispatchFetch("http://localhost/api/auth/start", {
      method: "POST",
    });
    assert.equal(response.status, 503);
    // Party is not anonymous: without accounts no room can be created.
    assert.equal(
      (await mf.dispatchFetch("http://localhost/api/rooms", { method: "POST" }))
        .status,
      503,
    );
    const page = await mf.dispatchFetch("http://localhost/privacidade");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Responsável e contato/);
    assert.equal(page.headers.get("Cache-Control"), "no-store");
  } finally {
    await mf.dispose();
  }
  await using(async (f) => {
    await f.login();
    for (const table of ["sessions", "login_codes", "auth_rate_limits"])
      await f.db
        .prepare(`UPDATE ${table} SET expires_at = ?`)
        .bind(Date.now() - 1)
        .run();
    const worker = await f.mf.getWorker();
    await worker.scheduled({ cron: "0 * * * *", scheduledTime: Date.now() });
    for (const table of ["sessions", "login_codes", "auth_rate_limits"])
      assert.equal(
        (await f.db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n,
        0,
      );
    assert.equal(
      (await f.db.prepare("SELECT count(*) AS n FROM users").first()).n,
      1,
    );
  });
});

test("email transport isolates provider configuration and sends plain Portuguese without tracking", async () => {
  const sent = [],
    logged = [];
  await sendLoginEmail(
    {
      RESEND_API_KEY: "test-key",
      EMAIL_FROM: "OpenRetro <conta@example.test>",
    },
    { email: EMAIL, code: "123456", challenge: "test-challenge", local: false },
    async (url, options) => {
      assert.equal(url, "https://api.resend.com/emails");
      assert.equal(
        options.headers["Idempotency-Key"],
        "openretro-login/test-challenge",
      );
      sent.push(JSON.parse(options.body));
      return Response.json({ id: "fixture" });
    },
    { info: (...args) => logged.push(args) },
  );
  assert.equal(sent.length, 1);
  assert.equal("html" in sent[0], false);
  assert.match(sent[0].text, /123456/);
  assert.equal(logged.length, 0);
  await assert.rejects(
    sendLoginEmail({}, { local: false }, undefined, {
      info: (...args) => logged.push(args),
    }),
  );
  assert.equal(logged.length, 0);
});

test("simultaneous resends send one email and a different address cannot use its code", () =>
  using(async (f) => {
    const replies = await Promise.all([f.start(), f.start()]);
    assert.equal(replies.filter((r) => r.status === 202).length, 1);
    assert.equal(replies.filter((r) => r.status === 429).length, 1);
    assert.equal(f.emails.length, 1);
    assert.equal(
      (await f.verify(f.code(), "another@example.test")).status,
      401,
    );
    assert.equal((await f.verify()).status, 200);
  }));

test("profile edits validate Unicode names and privacy without changing identity or another account", () =>
  using(async (f) => {
    const one = await f.login(),
      two = await f.login("friend@example.test");
    const edit = (data, token = one.token) =>
      f.call("/api/account/profile", data, { token, method: "PATCH" });
    assert.equal((await edit({ displayName: "Kauan" }, undefined)).status, 200);
    for (const displayName of [
      "ab",
      "a".repeat(25),
      "a\u0000bc",
      "a\u200bbc",
      null,
      {},
    ])
      assert.equal((await edit({ displayName })).status, 400);
    for (const patch of [
      { email: "changed@example.test" },
      { friendCode: "forged#1234" },
      { showPlaying: "false" },
      {},
    ])
      assert.equal((await edit(patch)).status, 400);
    await Promise.all([
      edit({ displayName: "  Jogador 🎮  " }),
      edit({ showPlaying: false, appearOffline: true }),
    ]);
    const current = await (
      await f.call("/api/auth/session", undefined, { token: one.token })
    ).json();
    assert.equal(current.user.displayName, "Jogador 🎮");
    assert.equal(current.user.friendCode, one.user.friendCode);
    assert.equal(current.user.showPlaying, false);
    assert.equal(current.user.appearOffline, true);
    assert.equal(current.needsProfile, false);
    const other = await (
      await f.call("/api/auth/session", undefined, { token: two.token })
    ).json();
    assert.equal(other.user.displayName, null);
    assert.equal(other.user.showPlaying, true);
    assert.equal(
      (
        await f.call(
          "/api/account/profile",
          { displayName: "Other" },
          { method: "PATCH" },
        )
      ).status,
      401,
    );
  }));

test("accounts start with a random preset icon that friends see and players can change", () =>
  using(async (f) => {
    const a = await f.login("alice@example.test"),
      b = await f.login("bob@example.test");
    for (const who of [a, b]) {
      assert.ok(Number.isInteger(who.user.avatar));
      assert.ok(who.user.avatar >= 0 && who.user.avatar < 15);
    }
    for (const avatar of [-1, 15, 2.5, "3", null])
      assert.equal(
        (
          await f.call(
            "/api/account/profile",
            { avatar },
            { method: "PATCH", token: a.token },
          )
        ).status,
        400,
      );
    const changed = await f.call(
      "/api/account/profile",
      { avatar: 14 },
      { method: "PATCH", token: a.token },
    );
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).user.avatar, 14);
    await pair(f, a, b);
    const friends = await list(f, b);
    assert.equal(
      friends.friends.find((row) => row.id === a.user.id).avatar,
      14,
    );
  }));

test("accounts named before codes followed names move to their name when it is free", () =>
  using(async (f) => {
    const a = await f.login("alice@example.test"),
      b = await f.login("bob@example.test");
    const legacy = (who, name, code) =>
      f.db
        .prepare("UPDATE users SET display_name=?, friend_code=? WHERE id=?")
        .bind(name, code, who.user.id)
        .run();
    await legacy(a, "Bobby", "jogador#qq11");
    await legacy(b, "Bob", "bobby#qq11");
    const session = async (who) =>
      (
        await (
          await f.call("/api/auth/session", undefined, { token: who.token })
        ).json()
      ).user.friendCode;
    // bobby#qq11 belongs to someone else: keep the old code, do not fail.
    assert.equal(await session(a), "jogador#qq11");
    assert.equal(await session(b), "bob#qq11");
    assert.equal(await session(a), "bobby#qq11");
  }));

test("the host capability is checked, guests can be removed and the room ends with its host", () =>
  using(
    async (f) => {
      const a = await f.login("alice@example.test"),
        b = await f.login("bob@example.test");
      await pair(f, a, b);
      const room = await hostRoom(f, a),
        sockets = [room.host.ws];
      try {
        const impostor = await roomSocket(f, room.code);
        sockets.push(impostor.ws);
        impostor.send({ type: "create", ticket: "0".repeat(64) });
        await eventually(() =>
          impostor.messages.some(
            (m) => m.type === "error" && /inválido/.test(m.message),
          ),
        );
        room.host.ws.send("ping");
        await eventually(() =>
          room.host.messages.some((m) => m.type === "pong"),
        );
        assert.equal((await room.bind(true)).status, 200);
        const presence = await publishParty(f, a, room);
        sockets.push(presence.ws);
        await eventually(
          async () =>
            (await list(f, b)).friends[0].presence.party?.code === room.code,
        );
        const guest = await pendingJoin(
          f,
          room,
          (await ticketFor(f, b, a)).invite,
        );
        sockets.push(guest.ws);
        assert.equal(
          guest.messages.find((m) => m.type === "accepted").player,
          2,
        );
        // A guest cannot approve or remove anyone; only the host can.
        guest.send({ type: "accept", id: "anyone" });
        const roster = await eventually(() =>
          room.host.messages.find(
            (m) => m.type === "roster" && m.guests.length === 1,
          ),
        );
        room.host.send({ type: "remove", id: roster.guests[0].id });
        await eventually(() => guest.messages.some((m) => m.type === "ended"));
        room.host.ws.close(1000);
        await eventually(
          async () =>
            (
              await f.mf.dispatchFetch(
                `http://localhost/signal?room=${room.code}`,
                { headers: { Upgrade: "websocket" } },
              )
            ).status === 404,
        );
      } finally {
        for (const ws of sockets)
          try {
            ws.close();
          } catch {}
      }
    },
    { PARTY_TICKET_SECRET: INVITE_SECRET },
  ));

test("room quotas apply to signed-in hosts", () =>
  using(
    async (f) => {
      const a = await f.login("alice@example.test");
      const create = () =>
        f.call("/api/rooms", {}, { base: "http://localhost", token: a.token });
      assert.equal((await create()).status, 201);
      const perNetwork = await create();
      assert.equal(perNetwork.status, 429);
      assert.match((await perNetwork.json()).error, /Encerre uma sala/);
      assert.match((await (await create()).json()).error, /muitas salas/);
    },
    {
      PARTY_TICKET_SECRET: INVITE_SECRET,
      MAX_ROOMS_PER_IP: "1",
      MAX_CREATES_PER_10_MIN: "2",
    },
  ));

test("a host's guest link seats one named browser guest without an account, apart from friends", () =>
  using(
    async (f) => {
      const a = await f.login("alice@example.test"),
        b = await f.login("bob@example.test");
      await pair(f, a, b);
      const room = await hostRoom(f, a),
        sockets = [room.host.ws];
      const latest = (type) =>
        room.host.messages.filter((m) => m.type === type).at(-1);
      const guestJoin = async (guest, name, resume) => {
        const client = await roomSocket(f, room.code);
        sockets.push(client.ws);
        client.send({ type: "join", room: room.code, name, guest, resume });
        await eventually(() =>
          client.messages.some((m) => ["accepted", "error"].includes(m.type)),
        );
        return client;
      };
      const failure = (client) =>
        client.messages.find((m) => m.type === "error")?.message;
      try {
        room.host.send({ type: "guest-link" });
        const link = await eventually(() => latest("guest-link"));
        assert.equal(link.player, 2);
        const url = new URL(link.url);
        assert.equal(url.origin, "http://localhost");
        assert.match(url.pathname, /^\/[A-HJ-NP-Z2-9]{6}$/);
        assert.equal(url.hash, "");
        assert.equal((await f.mf.dispatchFetch(url.href)).status, 200);
        const token = new URL(link.url).pathname.slice(1);
        // The code alone names the room; a wrong or malformed one names nothing.
        const resolve = (code) =>
          f.mf.dispatchFetch(`http://localhost/api/guest-link/${code}`);
        const found = await resolve(token);
        assert.deepEqual(await found.json(), { room: room.code });
        assert.equal((await resolve("ABCDEF")).status, 404);
        assert.equal((await resolve("short")).status, 404);

        // Friends keep joining as before, but not into the reserved seat.
        assert.equal((await room.bind(true)).status, 200);
        const presence = await publishParty(f, a, room);
        sockets.push(presence.ws);
        await eventually(
          async () =>
            (await list(f, b)).friends[0].presence.party?.code === room.code,
        );
        const friend = await pendingJoin(
          f,
          room,
          (await ticketFor(f, b, a)).invite,
        );
        sockets.push(friend.ws);
        assert.equal(
          friend.messages.find((m) => m.type === "accepted").player,
          3,
        );

        // A name alone or a wrong token is not enough.
        const nameOnly = await pendingJoin(f, room, undefined, "Visitante");
        sockets.push(nameOnly.ws);
        assert.ok(refused(nameOnly));
        assert.match(failure(await guestJoin("ABCDEF", "X")), /expirou/);
        assert.match(failure(await guestJoin(token, "  ")), /nome/);

        const streamer = await guestJoin(token, "Streamer");
        const accepted = streamer.messages.find((m) => m.type === "accepted");
        assert.equal(accepted.player, 2);
        assert.match(accepted.resume, /^[a-f0-9]{64}$/);
        // The guest learns its seat and the media route, nothing social.
        assert.deepEqual(
          Object.keys(accepted).sort(),
          ["iceServers", "player", "policy", "relay", "resume", "type"].sort(),
        );
        const roster = await eventually(() =>
          room.host.messages.find(
            (m) => m.type === "roster" && m.guests.some((g) => g.anonymous),
          ),
        );
        const anonymous = roster.guests.find((g) => g.anonymous);
        assert.deepEqual(
          {
            name: anonymous.name,
            player: anonymous.player,
            avatar: anonymous.avatar,
          },
          { name: "Streamer", player: 2, avatar: 0 },
        );
        assert.equal(
          roster.guests.find((g) => g.name !== "Streamer").anonymous,
          undefined,
        );

        // Single use, except for the browser that claimed it.
        assert.match(failure(await guestJoin(token, "Viewer")), /Outra pessoa/);
        const back = await guestJoin(token, "Streamer", accepted.resume);
        assert.equal(
          back.messages.find((m) => m.type === "accepted").player,
          2,
        );
        await eventually(() =>
          streamer.messages.some(
            (m) => m.type === "ended" && /outra janela/.test(m.message),
          ),
        );

        // Removing the guest closes the link for good.
        const current = await eventually(() =>
          latest("roster")?.guests.find((g) => g.anonymous),
        );
        room.host.send({ type: "remove", id: current.id });
        await eventually(() => back.messages.some((m) => m.type === "ended"));
        await eventually(() => latest("guest-link")?.url === null);
        // Removing the guest also retires the code.
        assert.equal((await resolve(token)).status, 404);
        assert.match(
          failure(await guestJoin(token, "Streamer", accepted.resume)),
          /expirou/,
        );

        // A fresh link that the host closes before anyone arrives.
        room.host.send({ type: "guest-link" });
        const second = await eventually(
          () => latest("guest-link")?.url && latest("guest-link"),
        );
        room.host.send({ type: "guest-link-close" });
        await eventually(() => latest("guest-link")?.url === null);
        assert.match(
          failure(
            await guestJoin(new URL(second.url).pathname.slice(1), "Late"),
          ),
          /expirou/,
        );
      } finally {
        for (const ws of sockets)
          try {
            ws.close();
          } catch {}
      }
    },
    { PARTY_TICKET_SECRET: INVITE_SECRET },
  ));

const say = (f, who, peer, body, clientId = crypto.randomUUID()) =>
  f.call(
    `/api/friends/messages/${peer}`,
    { body, clientId },
    { token: who.token },
  );
const inbox = async (f, who) =>
  (
    await f.call("/api/friends/messages", undefined, { token: who.token })
  ).json();
const thread = (f, who, peer, query = "") =>
  f.call(`/api/friends/messages/${peer}${query}`, undefined, {
    token: who.token,
  });
const markRead = (f, who, peer, lastId) =>
  f.call(
    `/api/friends/messages/${peer}/read`,
    { lastId },
    { token: who.token },
  );
test("direct messages reach only the two friends, in near real time, with unread counts", () =>
  using(async (f) => {
    const a = await f.login("alice@example.test"),
      b = await f.login("bob@example.test"),
      c = await f.login("carol@example.test");
    assert.equal((await f.call("/api/friends/messages")).status, 401);
    assert.equal((await say(f, a, b.user.id, "Oi")).status, 403);
    await pair(f, a, b);
    const sb = await socialSocket(f, b),
      sa = await socialSocket(f, a),
      sc = await socialSocket(f, c);
    try {
      const sent = await say(
        f,
        a,
        b.user.id,
        "  Bora jogar\r\n\n\n\nMario Kart?  ",
      );
      assert.equal(sent.status, 201);
      const message = await sent.json();
      assert.deepEqual(Object.keys(message).sort(), [
        "body",
        "createdAt",
        "id",
        "senderId",
      ]);
      assert.equal(message.body, "Bora jogar\n\nMario Kart?");
      // Sockets carry only which conversation changed, never the text.
      const nudge = await eventually(() =>
        sb.messages.find((m) => m.type === "message"),
      );
      assert.deepEqual(nudge, { type: "message", peer: a.user.id });
      await eventually(() =>
        sa.messages.find((m) => m.type === "message" && m.peer === b.user.id),
      );
      assert.equal(
        sc.messages.some((m) => m.type === "message"),
        false,
      );
      let rows = (await inbox(f, b)).conversations;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].peer.id, a.user.id);
      assert.equal(rows[0].unread, 1);
      assert.equal(rows[0].canSend, true);
      assert.equal(rows[0].last.body, message.body);
      assert.ok(!JSON.stringify(rows).includes("@example.test"));
      assert.equal((await inbox(f, a)).conversations[0].unread, 0);
      // A stranger sees neither the conversation nor its messages.
      assert.deepEqual((await inbox(f, c)).conversations, []);
      const stranger = await (await thread(f, c, a.user.id)).json();
      assert.deepEqual(stranger.messages, []);
      assert.equal(stranger.canSend, false);
      assert.equal((await say(f, c, a.user.id, "Oi")).status, 403);
      const read = await (await thread(f, b, a.user.id)).json();
      assert.equal(read.messages.length, 1);
      assert.equal(read.peer.id, a.user.id);
      sa.messages.length = 0;
      // Marking past the newest message cannot pre-read future ones.
      assert.equal(
        (await markRead(f, b, a.user.id, message.id + 1000)).status,
        204,
      );
      await eventually(
        () => sb.messages.filter((m) => m.type === "message").length > 1,
      );
      rows = (await inbox(f, b)).conversations;
      assert.equal(rows[0].unread, 0);
      await say(f, a, b.user.id, "Ainda aí?");
      assert.equal((await inbox(f, b)).conversations[0].unread, 1);
      assert.equal((await markRead(f, c, a.user.id, 1)).status, 204);
      for (const bad of [0, -1, "1", 1.5])
        assert.equal((await markRead(f, b, a.user.id, bad)).status, 400);
      assert.equal(
        (
          await f.call(`/api/friends/messages/${a.user.id}/read`, undefined, {
            token: b.token,
          })
        ).status,
        405,
      );
    } finally {
      for (const s of [sa, sb, sc]) s.ws.close();
    }
  }));
test("direct messages validate text, deduplicate retries, page history and limit their rate", () =>
  using(async (f) => {
    const a = await f.login("alice@example.test"),
      b = await f.login("bob@example.test");
    await pair(f, a, b);
    for (const body of [
      "",
      "   ",
      "x".repeat(401),
      "a‮b",
      "a\u0000b",
      "a\n".repeat(13),
      12,
      null,
    ])
      assert.equal(
        (await say(f, a, b.user.id, body)).status,
        400,
        JSON.stringify(body),
      );
    assert.equal((await say(f, a, b.user.id, "😀".repeat(400))).status, 201);
    assert.equal((await say(f, a, b.user.id, "Oi", "not-a-uuid")).status, 400);
    assert.equal(
      (
        await f.call(
          `/api/friends/messages/${b.user.id}`,
          { body: "Oi", clientId: crypto.randomUUID(), to: "x" },
          { token: a.token },
        )
      ).status,
      400,
    );
    assert.equal((await say(f, a, a.user.id, "Eu")).status, 400);
    assert.equal((await thread(f, a, "not-a-user")).status, 400);
    assert.equal((await thread(f, a, b.user.id, "?before=abc")).status, 400);
    assert.equal((await thread(f, a, b.user.id, "?after=1")).status, 400);
    const id = crypto.randomUUID();
    const first = await (await say(f, a, b.user.id, "Uma vez", id)).json();
    const retry = await say(f, a, b.user.id, "Uma vez", id);
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).id, first.id);
    assert.equal((await say(f, a, b.user.id, "Outra", id)).status, 409);
    // The burst limit allows eight sends per ten seconds.
    const burst = await Promise.all(
      Array.from({ length: 8 }, (_, i) => say(f, b, a.user.id, `m${i}`)),
    );
    assert.deepEqual([...new Set(burst.map((r) => r.status))], [201]);
    const limited = await say(f, b, a.user.id, "demais");
    assert.equal(limited.status, 429);
    assert.match((await limited.json()).error, /rápido demais/);
    const now = Date.now();
    await f.db.batch(
      Array.from({ length: 520 }, (_, i) =>
        f.db
          .prepare(
            "INSERT INTO direct_messages (sender_id,receiver_id,client_id,body,created_at) VALUES (?,?,?,?,?)",
          )
          .bind(a.user.id, b.user.id, crypto.randomUUID(), `h${i}`, now),
      ),
    );
    const page = await (await thread(f, b, a.user.id)).json();
    assert.equal(page.messages.length, 50);
    assert.equal(page.more, true);
    assert.equal(page.messages.at(-1).body, "h519");
    assert.ok(page.messages[0].id < page.messages.at(-1).id);
    const older = await (
      await thread(f, b, a.user.id, `?before=${page.messages[0].id}`)
    ).json();
    assert.equal(older.messages.length, 50);
    assert.equal(older.messages.at(-1).id < page.messages[0].id, true);
    // Each conversation keeps only its newest 500 messages.
    await f.db.prepare("DELETE FROM auth_rate_limits").run();
    assert.equal((await say(f, a, b.user.id, "fim")).status, 201);
    const kept = await f.db
      .prepare(
        "SELECT COUNT(*) AS n FROM direct_messages WHERE (sender_id=?1 AND receiver_id=?2) OR (sender_id=?2 AND receiver_id=?1)",
      )
      .bind(a.user.id, b.user.id)
      .first();
    assert.equal(kept.n, 500);
  }));
test("removing a friend keeps history read-only; blocking and deletion erase the conversation", () =>
  using(async (f) => {
    const a = await f.login("alice@example.test"),
      b = await f.login("bob@example.test");
    await pair(f, a, b);
    await say(f, a, b.user.id, "Oi");
    await say(f, b, a.user.id, "Olá");
    const exported = await (
      await f.call("/api/account/export", undefined, { token: a.token })
    ).json();
    assert.equal(exported.directMessages.length, 2);
    // Two friend quotas (request, daily request) and two message quotas.
    assert.equal(exported.friendQuota.length, 4);
    await action(f, a, "remove", b.user.id);
    const old = await (await thread(f, b, a.user.id)).json();
    assert.equal(old.messages.length, 2);
    assert.equal(old.canSend, false);
    assert.equal((await inbox(f, b)).conversations[0].canSend, false);
    assert.equal((await say(f, b, a.user.id, "Volta")).status, 403);
    await pair(f, a, b);
    await action(f, b, "block", a.user.id);
    assert.equal((await thread(f, a, b.user.id)).status, 404);
    assert.deepEqual((await inbox(f, a)).conversations, []);
    assert.equal(
      (await f.db.prepare("SELECT COUNT(*) AS n FROM direct_messages").first())
        .n,
      0,
    );
    await action(f, b, "unblock", a.user.id);
    await pair(f, a, b);
    await say(f, a, b.user.id, "De novo");
    await markRead(f, b, a.user.id, 1e9);
    await f.call("/api/account", undefined, {
      token: a.token,
      method: "DELETE",
    });
    for (const table of ["direct_messages", "message_reads"])
      assert.equal(
        (await f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n,
        0,
      );
  }));
test("email alerts reach offline players for requests and quiet conversations, at most two a day", () =>
  using(async (f) => {
    const a = await f.login("alerts-a@example.test"),
      b = await f.login("alerts-b@example.test"),
      c = await f.login("alerts-c@example.test"),
      d = await f.login("alerts-d@example.test");
    const alerts = () =>
      f.emails.filter((email) => email.headers?.["List-Unsubscribe"]);
    const say = (from, to, body) =>
      f.call(
        `/api/friends/messages/${to.user.id}`,
        { body, clientId: crypto.randomUUID() },
        { token: from.token },
      );
    assert.equal(a.user.emailAlerts, true);
    // A friend request emails the receiver without the sender's address.
    await pair(f, a, b);
    assert.equal(alerts().length, 1);
    assert.deepEqual(alerts()[0].to, ["alerts-b@example.test"]);
    assert.match(alerts()[0].subject, /quer ser seu amigo/);
    assert.ok(!JSON.stringify(alerts()[0]).includes("alerts-a@"));
    // The first message emails; the next ones in the conversation do not.
    assert.equal((await say(b, a, "segredo")).status, 201);
    assert.equal(alerts().length, 2);
    assert.match(alerts()[1].subject, /te mandou uma mensagem/);
    assert.ok(!alerts()[1].text.includes("segredo"));
    assert.equal((await say(b, a, "de novo")).status, 201);
    assert.equal(alerts().length, 2);
    // A conversation quiet for a week emails again.
    await f.db
      .prepare("UPDATE direct_messages SET created_at = created_at - ?")
      .bind(8 * 86400000)
      .run();
    assert.equal((await say(b, a, "voltei")).status, 201);
    assert.equal(alerts().length, 3);
    // b has caused two alerts today, and a has received two.
    assert.equal(
      (await action(f, b, "request", c.user.friendCode)).status,
      204,
    );
    assert.equal(
      (await action(f, c, "request", a.user.friendCode)).status,
      204,
    );
    assert.equal(alerts().length, 3);
    assert.equal(
      (await action(f, c, "request", d.user.friendCode)).status,
      204,
    );
    assert.equal(alerts().length, 4);
    // Players with the app open are told there instead.
    await f.db.prepare("DELETE FROM email_alerts").run();
    const open = await socialSocket(f, d);
    assert.equal(
      (await action(f, a, "request", d.user.friendCode)).status,
      204,
    );
    assert.equal(alerts().length, 4);
    open.ws.close();
    // The link in the email turns alerts off, and only with a valid token.
    const link = new URL(alerts()[0].text.match(/https:\/\/\S+/)[0]);
    assert.equal(link.pathname, "/email/off");
    assert.equal((await f.mf.dispatchFetch(link.href)).status, 200);
    const forged = new URL(link);
    forged.searchParams.set("u", a.user.id);
    assert.equal(
      (await f.mf.dispatchFetch(forged.href, { method: "POST" })).status,
      400,
    );
    assert.equal(
      (await f.mf.dispatchFetch(link.href, { method: "POST" })).status,
      200,
    );
    const session = await (
      await f.call("/api/auth/session", undefined, { token: b.token })
    ).json();
    assert.equal(session.user.emailAlerts, false);
    assert.equal(
      (await action(f, d, "request", b.user.friendCode)).status,
      204,
    );
    assert.equal(alerts().length, 4);
    // The setting goes back on from the app.
    const patched = await f.call(
      "/api/account/profile",
      { emailAlerts: true },
      { token: b.token, method: "PATCH" },
    );
    assert.equal((await patched.json()).user.emailAlerts, true);
    assert.equal(
      (
        await f.call(
          "/api/account/profile",
          { emailAlerts: "no" },
          { token: b.token, method: "PATCH" },
        )
      ).status,
      400,
    );
  }));
test("the Party chat relays seated players' lines to the room and keeps nothing", () =>
  using(
    async (f) => {
      const a = await f.login("chat-host@example.test");
      await f.call(
        "/api/account/profile",
        { displayName: "Anfitriã" },
        { token: a.token, method: "PATCH" },
      );
      const room = await hostRoom(f, a),
        sockets = [room.host.ws];
      const lines = (client) =>
        client.messages.filter((m) => m.type === "chat");
      try {
        room.host.send({ type: "guest-link" });
        const link = await eventually(() =>
          room.host.messages.find((m) => m.type === "guest-link" && m.url),
        );
        // A socket that never joined cannot talk to the room.
        const stranger = await roomSocket(f, room.code);
        sockets.push(stranger.ws);
        stranger.send({ type: "chat", text: "oi" });
        const guest = await roomSocket(f, room.code);
        sockets.push(guest.ws);
        guest.send({
          type: "join",
          room: room.code,
          name: "Convidado",
          guest: new URL(link.url).pathname.slice(1),
        });
        await eventually(() =>
          guest.messages.some((m) => m.type === "accepted"),
        );
        guest.send({ type: "chat", text: "  bora   jogar  " });
        const line = await eventually(() => lines(room.host)[0]);
        assert.equal(line.text, "bora jogar");
        assert.equal(line.name, "Convidado");
        assert.equal(line.player, 2);
        await eventually(() => lines(guest).length === 1);
        room.host.send({ type: "chat", text: "vamos!" });
        const reply = await eventually(() => lines(guest)[1]);
        assert.equal(reply.from, "host");
        assert.equal(reply.name, "Anfitriã");
        assert.equal(reply.player, 1);
        // Invisible characters and long lines are dropped, not relayed.
        guest.send({ type: "chat", text: "a‮b" });
        guest.send({ type: "chat", text: "x".repeat(201) });
        guest.send({ type: "chat", text: 5 });
        // Six lines per ten seconds; the seventh is refused to its sender.
        for (let i = 0; i < 6; i++) guest.send({ type: "chat", text: `n${i}` });
        await eventually(() =>
          guest.messages.some((m) => m.type === "chat-error"),
        );
        assert.deepEqual(
          lines(room.host).map((m) => m.text),
          ["bora jogar", "vamos!", "n0", "n1", "n2", "n3", "n4"],
        );
        assert.equal(lines(stranger).length, 0);
      } finally {
        for (const ws of sockets)
          try {
            ws.close();
          } catch {}
      }
    },
    { PARTY_TICKET_SECRET: INVITE_SECRET },
  ));
