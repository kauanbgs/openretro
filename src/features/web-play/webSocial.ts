// Account, friends and messages for the web build. On the desktop these
// commands run in Rust (src-tauri/src/account); here the same commands talk to
// the same server from the browser, so the app's screens work unchanged.
//
// The session is an HttpOnly cookie the server sets on its own host
// (party-server/cloudflare/social/web-session.mjs). This code never sees a
// token: every request just sends credentials, and the server accepts the
// cookie only from the web build's origin.
import defaultOrigin from "../../../src-tauri/src/remote_play/party-url.txt?raw";

const ORIGIN = new URL(import.meta.env.VITE_SOCIAL_URL || defaultOrigin.trim())
  .origin;

interface Failure {
  message: string;
  kind: string;
  retryAfter: number;
}
const failure = (kind: string, message: string, retryAfter = 0): Failure => ({
  kind,
  message,
  retryAfter,
});
const offline = () =>
  failure(
    "offline",
    "Não foi possível conectar à sua conta. Seus jogos continuam disponíveis.",
  );
const invalid = (message = "Dados inválidos.") => failure("invalid", message);

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(ORIGIN + path, {
      method,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw offline();
  }
  if (response.status === 204) return null as T;
  const value = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  if (!response.ok) {
    const retry = Math.min(
      3600,
      Number(response.headers.get("Retry-After")) || 0,
    );
    throw failure(
      response.status === 401
        ? "unauthorized"
        : response.status === 429
          ? "limit"
          : "server",
      typeof value?.error === "string" && value.error.length < 500
        ? value.error
        : "Não foi possível acessar sua conta. Tente novamente.",
      retry,
    );
  }
  if (value === null) throw invalid();
  return value as T;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validEmail = (email: string) =>
  email.length <= 254 && /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/.test(email);

interface ServerSession {
  user: unknown;
  expiresAt: number;
}
const sessionView = (value: ServerSession) => ({
  supported: true,
  hasSession: true,
  online: true,
  user: value.user,
  expiresAt: value.expiresAt,
});
const noSession = {
  supported: true,
  hasSession: false,
  online: false,
  user: null,
  expiresAt: null,
};

// --- Realtime: presence, friend changes and new messages ---------------------

type Handler = (event: { payload: unknown }) => void;
const handlers = new Set<Handler>();
const emit = (payload: unknown) =>
  handlers.forEach((handler) => handler({ payload }));

/** The app's listen("social-event") in the web build. */
export function listenSocial(handler: Handler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

interface Playing {
  title: string;
  console: string;
  cover: null;
  startedAt: number;
}
let socket: WebSocket | undefined;
let running = false;
let idle = false;
let playing: Playing | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;

const presence = () =>
  JSON.stringify({
    type: "presence",
    presence: {
      status: idle && !playing ? "idle" : "online",
      playing,
      party: null,
    },
  });
function publish() {
  if (socket?.readyState === WebSocket.OPEN) socket.send(presence());
}

function connect(delay = 1) {
  if (!running) return;
  const url = new URL("/social", ORIGIN);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  // The browser sends the session cookie with the upgrade; nothing in the URL.
  const ws = new WebSocket(url);
  socket = ws;
  let opened = false,
    lastResponse = Date.now();
  ws.onopen = () => {
    opened = true;
    delay = 1;
    emit({ type: "connected" });
    ws.send(presence());
    heartbeat = setInterval(() => {
      if (Date.now() - lastResponse > 75000) ws.close();
      else ws.send('{"type":"heartbeat"}');
    }, 30000);
  };
  ws.onmessage = (message) => {
    lastResponse = Date.now();
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(String(message.data));
    } catch {
      return;
    }
    // Only known events with checked fields reach the app, as on the desktop.
    if (value.type === "expired") {
      stopSocial();
      emit({ type: "expired" });
    } else if (
      value.type === "presence" &&
      typeof value.id === "string" &&
      UUID.test(value.id) &&
      value.presence &&
      typeof value.presence === "object"
    )
      emit({ type: "presence", id: value.id, presence: value.presence });
    else if (
      value.type === "message" &&
      typeof value.peer === "string" &&
      UUID.test(value.peer)
    )
      emit({ type: "message", peer: value.peer });
    else if (value.type === "changed")
      emit({
        type: "changed",
        reason: ["request", "accepted", "changed"].includes(
          String(value.reason),
        )
          ? value.reason
          : "changed",
      });
  };
  ws.onclose = async (event) => {
    clearInterval(heartbeat);
    if (socket !== ws || !running) return;
    socket = undefined;
    emit({ type: "disconnected" });
    // A browser can't read the upgrade's status: a refused connection, or the
    // server ending the session, is checked with a normal request.
    if (!opened || event.code === 4001) {
      const signedIn = await request("GET", "/api/auth/session").then(
        () => true,
        (cause: Failure) => cause.kind !== "unauthorized",
      );
      if (!signedIn) {
        stopSocial();
        emit({ type: "expired" });
        return;
      }
    }
    const jitter = Math.random() * 1000;
    retry = setTimeout(
      () => connect(Math.min(delay * 2, 60)),
      delay * 1000 + jitter,
    );
  };
}

function startSocial() {
  stopSocial();
  running = true;
  connect();
}
function stopSocial() {
  running = false;
  clearTimeout(retry);
  clearInterval(heartbeat);
  const current = socket;
  socket = undefined;
  current?.close();
}

/** What the web player is running, for friends and the profile's history. */
export function webPlaying(game: { title: string; console: string } | null) {
  const previous = playing;
  playing = game
    ? {
        title: game.title,
        console: game.console,
        cover: null,
        startedAt: Date.now(),
      }
    : null;
  publish();
  // Best effort, like the desktop: once when the game starts and once when it
  // ends. keepalive lets the last write finish while the page unloads.
  const write = (game: Playing, playSeconds: number) =>
    fetch(ORIGIN + "/api/friends/history", {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ game, playSeconds }),
    }).catch(() => {});
  if (previous)
    void write(
      previous,
      Math.min(
        Math.round((Date.now() - previous.startedAt) / 1000),
        31 * 86400,
      ),
    );
  if (playing && running) void write(playing, 0);
}

// --- Commands ---------------------------------------------------------------

function validAction(action: string, target: string) {
  if (action === "request") return /^[a-z0-9]{1,16}#[a-z0-9]{4}$/.test(target);
  return (
    ["accept", "decline", "cancel", "remove", "block", "unblock"].includes(
      action,
    ) && UUID.test(target)
  );
}
const MAX_MESSAGE = 400;
/** Control and text-direction characters are refused, as on the server. */
function allowedCharacter(char: string) {
  const c = char.codePointAt(0) ?? 0;
  if (c === 0x0a) return true;
  return !(
    c < 0x20 ||
    (c >= 0x7f && c <= 0x9f) ||
    c === 0x061c ||
    c === 0x200e ||
    c === 0x200f ||
    c === 0x2028 ||
    c === 0x2029 ||
    (c >= 0x202a && c <= 0x202e) ||
    (c >= 0x2066 && c <= 0x2069)
  );
}
function validBody(body: string) {
  const count = [...body].length;
  return (
    count > 0 &&
    count <= MAX_MESSAGE &&
    body.trim() === body &&
    body.split("\n").length <= 12 &&
    [...body].every(allowedCharacter)
  );
}
function peerId(value: unknown) {
  if (typeof value !== "string" || !UUID.test(value))
    throw invalid("Jogador inválido.");
  return value;
}
const unsupported = () =>
  Promise.reject(
    failure(
      "unsupported",
      "O Party está disponível no aplicativo para Windows.",
    ),
  );

type Args = Record<string, unknown>;
const commands: Record<string, (args: Args) => Promise<unknown> | unknown> = {
  account_session: () =>
    request<ServerSession>("GET", "/api/auth/session").then(
      sessionView,
      (cause: Failure) => {
        if (cause.kind === "unauthorized") return noSession;
        throw cause;
      },
    ),
  account_start: async ({ email, locale }) => {
    const address = String(email ?? "")
      .trim()
      .toLowerCase();
    if (!validEmail(address)) throw invalid("Digite um e-mail válido.");
    const value = await request<{ resendAfter?: number }>(
      "POST",
      "/api/auth/start",
      { email: address, locale },
    );
    const resendAfter = Number(value.resendAfter);
    if (!(resendAfter >= 1 && resendAfter <= 3600)) throw invalid();
    return { resendAfter };
  },
  account_verify: async ({ email, code }) => {
    const address = String(email ?? "")
      .trim()
      .toLowerCase();
    if (!validEmail(address)) throw invalid("Digite um e-mail válido.");
    if (!/^\d{6}$/.test(String(code ?? "")))
      throw invalid("Digite o código de seis dígitos.");
    // The server answers with the session as a cookie; the body has no token.
    const value = await request<ServerSession>("POST", "/api/auth/verify", {
      email: address,
      code,
    }).catch((cause: Failure) => {
      throw cause.kind === "unauthorized" ? { ...cause, kind: "code" } : cause;
    });
    return sessionView(value);
  },
  account_profile: async ({ patch }) =>
    sessionView(
      await request<ServerSession>("PATCH", "/api/account/profile", patch),
    ),
  account_logout: async ({ all }) => {
    await request(
      "POST",
      all ? "/api/auth/logout-all" : "/api/auth/logout",
    ).catch((cause: Failure) => {
      if (cause.kind !== "unauthorized") throw cause;
    });
    stopSocial();
  },
  // The browser can't drop an HttpOnly cookie itself: forgetting this device
  // signs it out on the server, which removes the cookie.
  account_forget: async () => {
    await request("POST", "/api/auth/logout").catch(() => {});
    stopSocial();
  },
  account_delete: async ({ confirmation }) => {
    if (confirmation !== "EXCLUIR")
      throw invalid("Digite EXCLUIR para confirmar a exclusão.");
    await request("DELETE", "/api/account");
    stopSocial();
  },
  account_export: async () => {
    const value = await request("GET", "/api/account/export");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    );
    link.download = "openretro-conta.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    return true;
  },
  account_privacy: () => new URL("/privacidade", ORIGIN).href,
  account_open_privacy: () => {
    window.open(new URL("/privacidade", ORIGIN).href, "_blank", "noopener");
  },

  social_start: () => startSocial(),
  social_stop: () => stopSocial(),
  social_idle: ({ idle: value }) => {
    if (idle !== Boolean(value)) {
      idle = Boolean(value);
      publish();
    }
  },
  social_friends: () => request("GET", "/api/friends"),
  social_action: async ({ action, target }) => {
    const value = String(target ?? "")
      .trim()
      .toLowerCase();
    if (!validAction(String(action), value))
      throw invalid("Confira o código de amigo e a ação escolhida.");
    await request("POST", "/api/friends/action", { action, target: value });
  },
  social_people: ({ after }) => {
    if (after != null && (typeof after !== "string" || !UUID.test(after)))
      throw invalid();
    return request(
      "GET",
      after ? `/api/friends/people?after=${after}` : "/api/friends/people",
    );
  },
  social_person: ({ userId }) =>
    request("GET", `/api/friends/people/${peerId(userId)}`),
  social_conversations: () => request("GET", "/api/friends/messages"),
  social_messages: ({ peer, before }) => {
    const id = peerId(peer);
    if (before != null && !(Number.isSafeInteger(before) && Number(before) > 0))
      throw invalid();
    return request(
      "GET",
      before
        ? `/api/friends/messages/${id}?before=${before}`
        : `/api/friends/messages/${id}`,
    );
  },
  social_send: ({ peer, body, clientId }) => {
    const id = peerId(peer);
    const text = String(body ?? "")
      .replace(/\r\n/g, "\n")
      .trim();
    if (
      typeof clientId !== "string" ||
      !UUID.test(clientId) ||
      !validBody(text)
    )
      throw invalid("Mensagem inválida.");
    return request("POST", `/api/friends/messages/${id}`, {
      body: text,
      clientId: clientId.toLowerCase(),
    });
  },
  social_read: async ({ peer, lastId }) => {
    const id = peerId(peer);
    if (!(Number.isSafeInteger(lastId) && Number(lastId) > 0)) throw invalid();
    await request("POST", `/api/friends/messages/${id}/read`, { lastId });
  },
  // Parties run in the desktop app.
  social_game_busy: () => false,
  social_join: unsupported,
  social_join_room: unsupported,
  social_party_reserve: unsupported,
  social_party: unsupported,
  social_party_clear: () => undefined,
};

export const handlesWebCommand = (command: string) => command in commands;

export async function webCommand<T>(command: string, args: Args = {}) {
  return (await commands[command](args)) as T;
}
