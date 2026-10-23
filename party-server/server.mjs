import { createServer } from "node:http";
import { randomBytes, randomInt } from "node:crypto";
import { isIP } from "node:net";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { turnConfiguration } from "./turn.mjs";

const send = (ws, value) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value));
};
const id = () => randomBytes(18).toString("base64url");
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const roomCode = () =>
  Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(
    "",
  );

export function createPartyServer(config = process.env) {
  const rooms = new Map();
  const clients = new Set();
  const publicUrl = new URL(config.PUBLIC_URL || "http://localhost:8787");
  const maxRooms = Number(config.MAX_ROOMS || 32);
  const maxRoomsPerIp = Number(config.MAX_ROOMS_PER_IP || 2);
  const maxCreates = Number(config.MAX_CREATES_PER_10_MIN || 12);
  if (
    ![maxRooms, maxRoomsPerIp, maxCreates].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  )
    throw new Error("Invalid Party limits");
  const addresses = new Map();
  const http = createServer(async (req, res) => {
    const path = new URL(req.url, publicUrl).pathname;
    const files = {
      "/": ["index.html", "text/html; charset=utf-8"],
      "/guest.js": ["guest.js", "text/javascript; charset=utf-8"],
      "/guest.css": ["guest.css", "text/css; charset=utf-8"],
    };
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'",
    );
    res.setHeader("Cache-Control", "no-store");
    if (path === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
      return;
    }
    const file =
      path === "/party" || /^\/party\/[A-Z2-9]{6}$/.test(path)
        ? files["/"]
        : files[path];
    if (!file || req.method !== "GET") {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const data = await readFile(
        new URL(`./public/${file[0]}`, import.meta.url),
      );
      res.writeHead(200, { "Content-Type": file[1] });
      res.end(data);
    } catch {
      res.writeHead(500);
      res.end("Party unavailable");
    }
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 32 * 1024,
    perMessageDeflate: false,
  });
  http.on("upgrade", (req, socket, head) => {
    // This header must be overwritten by the operator's trusted reverse proxy.
    const forwarded =
      config.TRUST_PROXY === "true"
        ? req.headers["x-party-client-ip"]
        : undefined;
    const address =
      typeof forwarded === "string" && isIP(forwarded)
        ? forwarded
        : req.socket.remoteAddress;
    let limits = addresses.get(address);
    if (!limits) {
      limits = { connections: 0, rooms: 0, attempts: 0, window: Date.now() };
      addresses.set(address, limits);
    }
    if (
      new URL(req.url, publicUrl).pathname !== "/signal" ||
      clients.size >= 256 ||
      limits.connections >= 12
    ) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      limits.connections++;
      ws.once("close", () => {
        limits.connections--;
      });
      wss.emit("connection", ws, limits);
    });
  });
  function roster(room) {
    send(room.host, {
      type: "roster",
      guests: [...room.guests.values()].map((g) => ({
        id: g.id,
        name: g.name,
        player: g.player,
      })),
    });
  }
  wss.on("connection", (ws, limits) => {
    clients.add(ws);
    ws.alive = true;
    let room,
      guest,
      host = false,
      busy = false,
      count = 0,
      since = Date.now();
    ws.on("pong", () => {
      ws.alive = true;
    });
    ws.on("message", async (raw) => {
      if (Date.now() - since > 1000) {
        count = 0;
        since = Date.now();
      }
      if (++count > 100) {
        ws.close(1008, "Too many messages");
        return;
      }
      if (busy) return;
      try {
        const m = JSON.parse(raw.toString());
        if (!room) {
          if (m.type === "create") {
            if (Date.now() - limits.window > 600000) {
              limits.attempts = 0;
              limits.window = Date.now();
            }
            if (++limits.attempts > maxCreates)
              throw new Error(
                "Você criou muitas salas. Aguarde alguns minutos e tente novamente.",
              );
            if (limits.rooms >= maxRoomsPerIp)
              throw new Error(
                "Encerre uma sala aberta nesta rede antes de criar outra.",
              );
            if (rooms.size >= maxRooms)
              throw new Error(
                "Todas as salas estão ocupadas. Tente mais tarde.",
              );
            busy = true;
            const transport = turnConfiguration(config);
            if (ws.readyState !== WebSocket.OPEN) return;
            let code = roomCode();
            while (rooms.has(code)) code = roomCode();
            room = {
              id: code,
              host: ws,
              guests: new Map(),
              ice: transport.iceServers,
              policy: transport.policy,
              created: Date.now(),
            };
            host = true;
            limits.rooms++;
            rooms.set(room.id, room);
            send(ws, {
              type: "created",
              code: room.id,
              url: `${publicUrl.origin}/party/${room.id}`,
              iceServers: room.ice,
              policy: room.policy,
              relay: transport.relay,
            });
          } else if (m.type === "join") {
            room = rooms.get(m.room);
            if (!room)
              throw new Error(
                "Esta sala encerrou ou o convite é inválido. Peça um novo link.",
              );
            if (room.guests.size >= 8) {
              room = undefined;
              throw new Error("A sala está cheia.");
            }
            guest = {
              id: id(),
              name:
                typeof m.name === "string" ? m.name.trim().slice(0, 24) : "",
              player: null,
              ws,
            };
            if (!guest.name) {
              room = undefined;
              throw new Error("Digite seu nome para entrar.");
            }
            room.guests.set(guest.id, guest);
            send(ws, { type: "waiting" });
            roster(room);
          } else throw new Error("Entre pelo convite da Party.");
        } else if (host && m.type === "accept") {
          const g = room.guests.get(m.id);
          if (!g || g.player !== null) return;
          const player = [2, 3, 4].find(
            (p) => ![...room.guests.values()].some((g) => g.player === p),
          );
          if (!player) throw new Error("Os três lugares já estão ocupados.");
          g.player = player;
          send(g.ws, {
            type: "accepted",
            player,
            iceServers: room.ice,
            policy: room.policy,
          });
          send(ws, { type: "peer", id: g.id, player });
          roster(room);
        } else if (host && m.type === "remove") {
          const g = room.guests.get(m.id);
          if (g) {
            send(g.ws, {
              type: "ended",
              message: "O anfitrião encerrou sua participação.",
            });
            g.ws.close();
          }
        } else if (m.type === "signal") {
          const g = host ? room.guests.get(m.id) : guest;
          if (!g?.player) return;
          const signal = m.signal;
          if (
            !signal ||
            !["offer", "answer", "candidate"].includes(signal.type)
          )
            return;
          if (
            (host && signal.type === "answer") ||
            (!host && signal.type === "offer")
          )
            return;
          send(host ? g.ws : room.host, { type: "signal", id: g.id, signal });
        }
      } catch (error) {
        send(ws, {
          type: "error",
          message:
            error instanceof SyntaxError ? "Mensagem inválida." : error.message,
        });
      } finally {
        busy = false;
      }
    });
    ws.on("error", () => {});
    ws.on("close", () => {
      clients.delete(ws);
      if (!room) return;
      if (host) {
        limits.rooms--;
        rooms.delete(room.id);
        for (const g of room.guests.values()) {
          send(g.ws, {
            type: "ended",
            message: "O anfitrião encerrou a sala.",
          });
          g.ws.close();
        }
      } else if (guest) {
        room.guests.delete(guest.id);
        send(room.host, { type: "left", id: guest.id });
        roster(room);
      }
    });
  });
  const timer = setInterval(() => {
    for (const [address, limits] of addresses)
      if (
        !limits.connections &&
        !limits.rooms &&
        Date.now() - limits.window > 600000
      )
        addresses.delete(address);
    for (const ws of clients) {
      if (!ws.alive) ws.terminate();
      else {
        ws.alive = false;
        ws.ping();
      }
    }
    for (const room of rooms.values())
      if (Date.now() - room.created > 3 * 60 * 60 * 1000) {
        send(room.host, {
          type: "error",
          message: "A sala atingiu três horas. Crie outra sala para continuar.",
        });
        room.host.close();
      }
  }, 30000);
  timer.unref();
  return {
    http,
    close: async () => {
      clearInterval(timer);
      for (const ws of clients) ws.terminate();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => http.close(resolve));
    },
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createPartyServer();
  app.http.listen(
    Number(process.env.PORT || 8787),
    process.env.HOST || "127.0.0.1",
    () => console.log("OpenRetro Party listening"),
  );
}
