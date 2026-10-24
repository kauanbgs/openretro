import test from "node:test";
import assert from "node:assert/strict";
import { cloudflareTurn } from "./cloudflare/turn.mjs";
import { runtime } from "./test-support/cloudflare.mjs";

const create = (mf, ip = "192.0.2.1") =>
  mf.dispatchFetch("http://localhost/api/rooms", {
    method: "POST",
    headers: { "CF-Connecting-IP": ip },
  });
function inbox(ws) {
  const messages = [],
    waiting = [];
  ws.addEventListener("message", (event) => {
    const m = event.data === "pong" ? { type: "pong" } : JSON.parse(event.data);
    const index = waiting.findIndex((w) => w.type === m.type);
    if (index >= 0) {
      const [w] = waiting.splice(index, 1);
      clearTimeout(w.timer);
      w.resolve(m);
    } else messages.push(m);
  });
  ws.accept();
  return {
    ws,
    send: (value) => ws.send(JSON.stringify(value)),
    next(type) {
      const index = messages.findIndex((m) => m.type === type);
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = {
          type,
          resolve,
          timer: setTimeout(() => reject(new Error(`Timeout: ${type}`)), 5000),
        };
        waiting.push(w);
      });
    },
  };
}
async function connect(mf, code) {
  const response = await mf.dispatchFetch(
    `http://localhost/signal?room=${code}`,
    { headers: { Upgrade: "websocket", "CF-Connecting-IP": "192.0.2.2" } },
  );
  assert.equal(response.status, 101);
  return inbox(response.webSocket);
}

// Room hosting, guests and quotas need accounts; social.test.mjs covers them.
test("Cloudflare never opens an anonymous room", async () => {
  const mf = await runtime();
  try {
    const anonymous = await create(mf);
    assert.equal(anonymous.status, 503);
    const guest = await connect(mf, "ABC234").catch(() => null);
    assert.equal(guest, null);
  } finally {
    await mf.dispose();
  }
});

test("Cloudflare invitation pages and origin checks work in the Workers runtime", async () => {
  const mf = await runtime();
  try {
    for (const path of ["/party", "/party/5JKL3A", "/guest.js", "/guest.css"]) {
      const response = await mf.dispatchFetch(`http://localhost${path}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
    }
    const denied = await mf.dispatchFetch("http://localhost/api/rooms", {
      method: "POST",
      headers: { Origin: "https://other.example.com" },
    });
    assert.equal(denied.status, 403);
    const preflight = await mf.dispatchFetch("http://localhost/api/rooms", {
      method: "OPTIONS",
      headers: { Origin: "http://tauri.localhost" },
    });
    assert.equal(
      preflight.headers.get("Access-Control-Allow-Origin"),
      "http://tauri.localhost",
    );
    const prodLocal = await mf.dispatchFetch(
      "https://party.example.com/api/rooms",
      { method: "POST" },
    );
    assert.equal(prodLocal.status, 503);
  } finally {
    await mf.dispose();
  }
});

test("Cloudflare production fails closed when TURN secrets are missing", async () => {
  const mf = await runtime({ ALLOW_LOCAL_TEST: "false" });
  try {
    assert.equal((await create(mf)).status, 503);
  } finally {
    await mf.dispose();
  }
});

test("Cloudflare TURN uses the current credential endpoint and never exposes the permanent token", async () => {
  const result = await cloudflareTurn(
    { TURN_KEY_ID: "key/id", TURN_API_TOKEN: "permanent-token" },
    async (url, options) => {
      assert.equal(
        url,
        "https://rtc.live.cloudflare.com/v1/turn/keys/key%2Fid/credentials/generate-ice-servers",
      );
      assert.equal(options.headers.Authorization, "Bearer permanent-token");
      assert.equal(JSON.parse(options.body).ttl, 14400);
      return Response.json({
        iceServers: [
          { urls: ["stun:stun.cloudflare.com:3478"] },
          {
            urls: [
              "turn:turn.cloudflare.com:53?transport=udp",
              "turns:turn.cloudflare.com:443?transport=tcp",
            ],
            username: "temporary-user",
            credential: "temporary-password",
          },
        ],
      });
    },
  );
  assert.equal(result.policy, "relay");
  assert.deepEqual(result.iceServers[0].urls, [
    "turns:turn.cloudflare.com:443?transport=tcp",
  ]);
  assert.ok(!JSON.stringify(result).includes("permanent-token"));
  await assert.rejects(cloudflareTurn({}), /indisponível/);
  await assert.rejects(
    cloudflareTurn(
      { TURN_KEY_ID: "id", TURN_API_TOKEN: "secret" },
      async () => new Response("failure", { status: 403 }),
    ),
    /indisponível/,
  );
});
