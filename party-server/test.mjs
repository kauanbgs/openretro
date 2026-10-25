import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createPartyServer } from "./server.mjs";
import { turnConfiguration } from "./turn.mjs";

function inbox(ws) {
  const messages = [],
    waiters = [];
  ws.on("message", (value) => {
    const m = JSON.parse(value);
    const index = waiters.findIndex((w) => w.type === m.type);
    if (index >= 0) {
      const [w] = waiters.splice(index, 1);
      clearTimeout(w.timer);
      w.resolve(m);
    } else messages.push(m);
  });
  return (type) => {
    const index = messages.findIndex((m) => m.type === type);
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const w = {
        type,
        resolve,
        timer: setTimeout(
          () => reject(new Error(`Timeout waiting for ${type}`)),
          3000,
        ),
      };
      waiters.push(w);
    });
  };
}
test("clients create without keys; host owns approval, unique slots and shutdown", async () => {
  const app = createPartyServer({
    PUBLIC_URL: "http://localhost:8787",
    ALLOW_STUN_ONLY: "true",
  });
  await new Promise((resolve) => app.http.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.http.address().port}`;
  const sockets = [];
  const connect = async () => {
    const ws = new WebSocket(base.replace("http:", "ws:") + "/signal");
    sockets.push(ws);
    const next = inbox(ws);
    await new Promise((resolve) => ws.once("open", resolve));
    return { ws, next, send: (m) => ws.send(JSON.stringify(m)) };
  };
  try {
    const response = await fetch(base);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Entre na partida/);
    const host = await connect();
    host.send({ type: "create" });
    const created = await host.next("created");
    assert.equal(created.relay, false);
    const room = new URL(created.url).pathname.split("/").pop();
    assert.match(room, /^[A-Z2-9]{6}$/);
    assert.equal(created.code, room);
    assert.equal(created.policy, "all");
    assert.equal((await fetch(`${base}/party`)).status, 200);
    assert.equal((await fetch(`${base}/party/${room}`)).status, 200);
    const unknown = await connect();
    unknown.send({ type: "join", room: "missing", name: "Visitante" });
    assert.match((await unknown.next("error")).message, /inválido/);
    const guests = [];
    for (let i = 0; i < 4; i++) {
      const guest = await connect();
      guests.push(guest);
      guest.send({ type: "join", room, name: `Amigo ${i}` });
      await guest.next("waiting");
      let roster = await host.next("roster");
      while (roster.guests.length < i + 1) roster = await host.next("roster");
      guest.id = roster.guests.find((g) => g.name === `Amigo ${i}`).id;
      if (i < 3) {
        // Guest cannot self-approve or choose their controller port.
        guest.send({ type: "accept", id: guest.id });
        host.send({ type: "accept", id: guest.id });
        assert.equal((await guest.next("accepted")).player, i + 2);
        await host.next("peer");
        guest.send({
          type: "signal",
          id: "forged",
          signal: { type: "candidate", candidate: { candidate: "test" } },
        });
        assert.equal((await host.next("signal")).id, guest.id);
      } else {
        host.send({ type: "accept", id: guest.id });
        assert.match((await host.next("error")).message, /ocupados/);
      }
    }
    host.send({ type: "remove", id: guests[0].id });
    assert.match((await guests[0].next("ended")).message, /encerrou/);
    await host.next("left");
    host.send({ type: "accept", id: guests[3].id });
    assert.equal((await guests[3].next("accepted")).player, 2);
    host.ws.close();
    assert.match((await guests[1].next("ended")).message, /encerrou a sala/);
    const late = await connect();
    late.send({ type: "join", room, name: "Atrasado" });
    assert.match((await late.next("error")).message, /encerrou/);
  } finally {
    sockets.forEach((ws) => ws.terminate());
    await app.close();
  }
});
test("production rooms fail explicitly without TURN configuration", async () => {
  const app = createPartyServer({});
  await new Promise((resolve) => app.http.listen(0, "127.0.0.1", resolve));
  const ws = new WebSocket(`ws://127.0.0.1:${app.http.address().port}/signal`);
  const next = inbox(ws);
  try {
    await new Promise((resolve) => ws.once("open", resolve));
    ws.send(JSON.stringify({ type: "create" }));
    assert.match((await next("error")).message, /indisponível/);
  } finally {
    ws.terminate();
    await app.close();
  }
});

test("own TURN uses temporary credentials, only the configured servers and forced relay", () => {
  const secret = "server-only-secret";
  const config = turnConfiguration(
    {
      TURN_URLS:
        "turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp",
      TURN_SECRET: secret,
    },
    1800000000000,
  );
  assert.equal(config.policy, "relay");
  assert.equal(config.relay, true);
  assert.equal(config.iceServers[0].urls.length, 2);
  assert.match(config.iceServers[0].username, /^1800014400:[a-f0-9]{24}$/);
  assert.match(config.iceServers[0].credential, /^[A-Za-z0-9+/]{27}=$/);
  assert.ok(!JSON.stringify(config).includes(secret));
  assert.throws(() =>
    turnConfiguration({
      TURN_URLS: "https://example.com",
      TURN_SECRET: secret,
    }),
  );
});

test("room creation limits replace client secrets and reject repeated requests", async () => {
  const app = createPartyServer({
    ALLOW_STUN_ONLY: "true",
    MAX_CREATES_PER_10_MIN: "2",
    MAX_ROOMS_PER_IP: "1",
  });
  await new Promise((resolve) => app.http.listen(0, "127.0.0.1", resolve));
  const url = `ws://127.0.0.1:${app.http.address().port}/signal`;
  const host = new WebSocket(url),
    other = new WebSocket(url);
  const first = inbox(host),
    next = inbox(other);
  try {
    await Promise.all([
      new Promise((resolve) => host.once("open", resolve)),
      new Promise((resolve) => other.once("open", resolve)),
    ]);
    host.send(JSON.stringify({ type: "create" }));
    await first("created");
    other.send(JSON.stringify({ type: "create" }));
    assert.match((await next("error")).message, /Encerre uma sala/);
    other.send(JSON.stringify({ type: "create" }));
    assert.match((await next("error")).message, /muitas salas/);
  } finally {
    host.terminate();
    other.terminate();
    await app.close();
  }
});

test("guest links open one reserved seat to a named browser guest until the host closes it", async () => {
  const app = createPartyServer({
    PUBLIC_URL: "http://localhost:8787",
    ALLOW_STUN_ONLY: "true",
  });
  await new Promise((resolve) => app.http.listen(0, "127.0.0.1", resolve));
  const base = `ws://127.0.0.1:${app.http.address().port}/signal`;
  const sockets = [];
  const connect = async () => {
    const ws = new WebSocket(base);
    sockets.push(ws);
    const next = inbox(ws);
    await new Promise((resolve) => ws.once("open", resolve));
    return { ws, next, send: (m) => ws.send(JSON.stringify(m)) };
  };
  try {
    const host = await connect();
    host.send({ type: "create" });
    const { code: room } = await host.next("created");
    // A guest cannot mint a link for themselves.
    const friend = await connect();
    friend.send({ type: "join", room, name: "Amiga" });
    await friend.next("waiting");
    friend.send({ type: "guest-link" });
    host.send({ type: "guest-link" });
    const link = await host.next("guest-link");
    assert.equal(link.player, 2);
    assert.ok(link.expires > Date.now());
    const url = new URL(link.url);
    assert.match(url.pathname, /^\/[A-HJ-NP-Z2-9]{6}$/);
    assert.equal(url.hash, "");
    // The code alone opens the guest page and resolves to its room.
    assert.equal(
      (
        await fetch(
          `http://127.0.0.1:${app.http.address().port}${url.pathname}`,
        )
      ).status,
      200,
    );
    const token = new URL(link.url).pathname.slice(1);
    const http = `http://127.0.0.1:${app.http.address().port}`;
    // The code alone names the room; a wrong or malformed one names nothing.
    const found = await fetch(`${http}/api/guest-link/${token}`);
    assert.deepEqual(await found.json(), { room });
    assert.equal((await fetch(`${http}/api/guest-link/ABCDEF`)).status, 404);
    // The friend asked first, but the link's seat stays reserved.
    let roster = await host.next("roster");
    host.send({ type: "accept", id: roster.guests[0].id });
    assert.equal((await friend.next("accepted")).player, 3);
    assert.equal((await host.next("peer")).player, 3);

    const forged = await connect();
    forged.send({ type: "join", room, name: "X", guest: "ABCDEF" });
    assert.match((await forged.next("error")).message, /expirou/);
    const nameless = await connect();
    nameless.send({ type: "join", room, name: " \u202e ", guest: token });
    assert.match((await nameless.next("error")).message, /nome/);

    const streamer = await connect();
    streamer.send({ type: "join", room, name: "Streamer\u0007", guest: token });
    const accepted = await streamer.next("accepted");
    assert.equal(accepted.player, 2);
    assert.match(accepted.resume, /^[a-f0-9]{64}$/);
    assert.equal((await host.next("peer")).player, 2);
    do roster = await host.next("roster");
    while (!roster.guests.some((g) => g.anonymous));
    const anonymous = roster.guests.find((g) => g.anonymous);
    assert.deepEqual(
      { name: anonymous.name, player: anonymous.player },
      { name: "Streamer", player: 2 },
    );
    assert.equal(
      roster.guests.find((g) => g.name === "Amiga").anonymous,
      undefined,
    );

    // Single use: someone else with the same link is refused, but the
    // browser that claimed it can come back.
    const viewer = await connect();
    viewer.send({ type: "join", room, name: "Viewer", guest: token });
    assert.match((await viewer.next("error")).message, /Outra pessoa/);
    const again = await connect();
    again.send({
      type: "join",
      room,
      name: "Streamer",
      guest: token,
      resume: accepted.resume,
    });
    assert.match((await streamer.next("ended")).message, /outra janela/);
    const back = await again.next("accepted");
    assert.equal(back.player, 2);
    assert.equal(back.resume, undefined);

    // Removing the guest closes the link for good.
    do roster = await host.next("roster");
    while (!roster.guests.some((g) => g.anonymous && g.player === 2));
    host.send({
      type: "remove",
      id: roster.guests.find((g) => g.anonymous).id,
    });
    assert.match((await again.next("ended")).message, /encerrou/);
    assert.equal((await host.next("guest-link")).url, null);
    // Closing the seat also retires the code.
    assert.equal((await fetch(`${http}/api/guest-link/${token}`)).status, 404);
    const retry = await connect();
    retry.send({
      type: "join",
      room,
      name: "Streamer",
      guest: token,
      resume: accepted.resume,
    });
    assert.match((await retry.next("error")).message, /expirou/);

    // A new link can be closed before anyone uses it.
    host.send({ type: "guest-link" });
    const second = await host.next("guest-link");
    assert.equal(second.player, 2);
    host.send({ type: "guest-link-close" });
    assert.equal((await host.next("guest-link")).url, null);
    const late = await connect();
    late.send({
      type: "join",
      room,
      name: "Late",
      guest: new URL(second.url).pathname.slice(1),
    });
    assert.match((await late.next("error")).message, /expirou/);
  } finally {
    sockets.forEach((ws) => ws.terminate());
    await app.close();
  }
});

test("guest links are rate limited per room", async () => {
  const app = createPartyServer({ ALLOW_STUN_ONLY: "true" });
  await new Promise((resolve) => app.http.listen(0, "127.0.0.1", resolve));
  const ws = new WebSocket(`ws://127.0.0.1:${app.http.address().port}/signal`);
  const next = inbox(ws);
  try {
    await new Promise((resolve) => ws.once("open", resolve));
    ws.send(JSON.stringify({ type: "create" }));
    await next("created");
    for (let i = 0; i < 10; i++) {
      ws.send(JSON.stringify({ type: "guest-link" }));
      await next("guest-link");
    }
    ws.send(JSON.stringify({ type: "guest-link" }));
    assert.match((await next("error")).message, /muitos links/);
  } finally {
    ws.terminate();
    await app.close();
  }
});

test("an unclaimed guest link expires after thirty minutes", async () => {
  const app = createPartyServer({ ALLOW_STUN_ONLY: "true" });
  await new Promise((resolve) => app.http.listen(0, "127.0.0.1", resolve));
  const url = `ws://127.0.0.1:${app.http.address().port}/signal`;
  const host = new WebSocket(url),
    guest = new WebSocket(url);
  const fromHost = inbox(host),
    fromGuest = inbox(guest);
  const now = Date.now;
  try {
    await Promise.all(
      [host, guest].map((ws) => new Promise((r) => ws.once("open", r))),
    );
    host.send(JSON.stringify({ type: "create" }));
    const { code } = await fromHost("created");
    host.send(JSON.stringify({ type: "guest-link" }));
    const link = await fromHost("guest-link");
    Date.now = () => now() + 31 * 60 * 1000;
    guest.send(
      JSON.stringify({
        type: "join",
        room: code,
        name: "Tarde",
        guest: new URL(link.url).pathname.slice(1),
      }),
    );
    assert.match((await fromGuest("error")).message, /expirou/);
  } finally {
    Date.now = now;
    host.terminate();
    guest.terminate();
    await app.close();
  }
});
