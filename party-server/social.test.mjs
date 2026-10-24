import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Log, LogLevel } from "miniflare";
import { runtime } from "./test-support/cloudflare.mjs";
import { sendLoginEmail } from "./cloudflare/social/email.mjs";

const BASE = "https://social.example.test";
const EMAIL = "player@example.test";
const PEPPER = "test-only-auth-pepper-not-a-production-secret";
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
  const migration = await readFile(
    new URL("./cloudflare/migrations/0001_social_auth.sql", import.meta.url),
    "utf8",
  );
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

test("social configuration is optional for Party and privacy; hourly cleanup removes expired records", async () => {
  const mf = await runtime();
  try {
    const response = await mf.dispatchFetch("http://localhost/api/auth/start", {
      method: "POST",
    });
    assert.equal(response.status, 503);
    assert.equal(
      (await mf.dispatchFetch("http://localhost/api/rooms", { method: "POST" }))
        .status,
      201,
    );
    const page = await mf.dispatchFetch("http://localhost/privacidade");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Rascunho para revisão/);
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
