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
