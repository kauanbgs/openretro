import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { cloudflareTurn } from "./cloudflare/turn.mjs";

async function runtime(bindings = {}, options = {}) {
  return new Miniflare(
    convertV4MiniflareOptions({
      modules: ["worker.mjs", "turn.mjs"].map((name) => ({
        type: "ESModule",
        path: fileURLToPath(new URL(`./cloudflare/${name}`, import.meta.url)),
      })),
      compatibilityDate: "2026-10-23",
      durableObjects: {
        DIRECTORY: { className: "PartyDirectory", useSQLite: true },
        ROOMS: { className: "PartyRoom", useSQLite: true },
      },
      bindings: { ALLOW_LOCAL_TEST: "true", ...bindings },
      serviceBindings: {
        ASSETS: async (request) => {
          const path = new URL(request.url).pathname;
          if (!["/index.html", "/guest.js", "/guest.css"].includes(path))
            return new Response("Not found", { status: 404 });
          return new Response(
            await readFile(new URL(`./public${path}`, import.meta.url)),
            {
              headers: {
                "Content-Type": path.endsWith(".html")
                  ? "text/html"
                  : path.endsWith(".js")
                    ? "text/javascript"
                    : "text/css",
              },
            },
          );
        },
      },
      ...options,
    }),
  );
}
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

test("Cloudflare rooms authenticate the host capability, enforce slots and revoke on exit", async () => {
  const mf = await runtime();
  const sockets = [];
  try {
    const reservation = await create(mf);
    assert.equal(reservation.status, 201);
    const { code, ticket } = await reservation.json();
    assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
    assert.equal(ticket.length, 64);
    const impostor = await connect(mf, code);
    sockets.push(impostor);
    impostor.send({ type: "create", ticket: "0".repeat(64) });
    assert.match((await impostor.next("error")).message, /inválido/);
    const host = await connect(mf, code);
    sockets.push(host);
    host.send({ type: "create", ticket });
    const created = await host.next("created");
    assert.equal(created.code, code);
    assert.equal(created.url, `http://localhost/party/${code}`);
    host.ws.send("ping");
    await host.next("pong");
    const guests = [];
    for (let i = 0; i < 4; i++) {
      const guest = await connect(mf, code);
      sockets.push(guest);
      guests.push(guest);
      guest.send({ type: "join", room: code, name: `Amigo ${i}` });
      await guest.next("waiting");
      let roster = await host.next("roster");
      while (!roster.guests.some((g) => g.name === `Amigo ${i}`))
        roster = await host.next("roster");
      guest.id = roster.guests.find((g) => g.name === `Amigo ${i}`).id;
      // A guest cannot self-approve. The host must assign its exclusive port.
      guest.send({ type: "accept", id: guest.id });
      host.send({ type: "accept", id: guest.id });
      if (i === 3) {
        assert.match((await host.next("error")).message, /ocupados/);
        continue;
      }
      assert.equal((await guest.next("accepted")).player, i + 2);
      await host.next("peer");
      guest.send({
        type: "signal",
        id: "forged-id",
        signal: { type: "answer", sdp: { type: "answer", sdp: "fixture" } },
      });
      assert.equal((await host.next("signal")).id, guest.id);
    }
    host.send({ type: "remove", id: guests[0].id });
    await guests[0].next("ended");
    await host.next("left");
    host.send({ type: "accept", id: guests[3].id });
    assert.equal((await guests[3].next("accepted")).player, 2);
    host.ws.close(1000);
    await guests[1].next("ended");
    const expired = await mf.dispatchFetch(
      `http://localhost/signal?room=${code}`,
      { headers: { Upgrade: "websocket" } },
    );
    assert.equal(expired.status, 404);
  } finally {
    for (const s of sockets) {
      try {
        s.ws.close(1000);
      } catch {}
    }
    await mf.dispose();
  }
});

test("Cloudflare quotas and static invitation pages work in the Workers runtime", async () => {
  const mf = await runtime({
    MAX_ROOMS_PER_IP: "1",
    MAX_CREATES_PER_10_MIN: "2",
  });
  try {
    assert.equal((await create(mf)).status, 201);
    assert.equal((await create(mf)).status, 429);
    assert.match((await (await create(mf)).json()).error, /muitas salas/);
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
