const $ = (id) => document.getElementById(id);
// A friend opens /party/ROOM with a ticket in the fragment. A host's guest
// link is just /CODE: six characters the server maps to the room.
const address = /^\/(?:party\/([A-Z2-9]{6})|([A-HJ-NP-Z2-9]{6}))$/.exec(
  location.pathname,
);
let room = address?.[1];
let inviteRoom = room;
const linkCode = address?.[2] || "";
let friendInvite =
  typeof location.hash === "string" &&
  /^#t=[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(location.hash) &&
  location.hash.length <= 2051
    ? location.hash.slice(3)
    : "";
// Remove the bearer capability from browser history before opening any connection.
if (location.hash || linkCode)
  history.replaceState(null, "", linkCode ? "/" : location.pathname);
// A host's guest link opens one seat without an account. This tab keeps the
// link (and, once claimed, the proof that it claimed it) so a reload rejoins.
const visitKey = "openretro-party-guest";
function remember(visit) {
  try {
    if (visit) sessionStorage.setItem(visitKey, JSON.stringify(visit));
    else sessionStorage.removeItem(visitKey);
  } catch {}
}
let visit = null;
if (!friendInvite) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(visitKey) || "null");
    if (
      saved &&
      /^[A-HJ-NP-Z2-9]{6}$/.test(saved.token) &&
      /^[A-Z2-9]{6}$/.test(saved.room) &&
      (linkCode ? saved.token === linkCode : saved.room === room)
    )
      visit = saved;
  } catch {}
  // A link this tab has not claimed yet: the server says which room it is for.
  if (linkCode && !visit) visit = { token: linkCode };
  if (visit?.room) {
    room = inviteRoom = visit.room;
    if (linkCode) history.replaceState(null, "", "/party/" + room);
  }
}
// Otherwise Party is not anonymous: guests arrive from the OpenRetro friends
// panel with a single-use ticket from their account.
const viaApp =
  "Abra o OpenRetro, vá em Amigos e clique em Entrar no Party do seu amigo.";
$("name").required = false;
$("room-code").required = false;
if (visit) {
  $("lead").textContent =
    "Você foi convidado para jogar pelo navegador. Não precisa de conta nem de instalar nada.";
  $("name-field").hidden = false;
  $("name").required = true;
  $("name").value = visit.name || "";
  $("join").textContent = "Entrar na partida";
  $("get-app").hidden = false;
  if (!visit.room) {
    $("join").disabled = true;
    $("status").textContent = "Abrindo o convite…";
    void fetch("/api/guest-link/" + visit.token)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !/^[A-Z2-9]{6}$/.test(data.room))
          throw new Error(
            typeof data.error === "string"
              ? data.error
              : "Não foi possível abrir o convite.",
          );
        room = inviteRoom = data.room;
        $("room-code").value = room;
        remember((visit = { ...visit, room }));
        history.replaceState(null, "", "/party/" + room);
        if (window.isSecureContext && window.RTCPeerConnection) {
          $("join").disabled = false;
          $("status").textContent = "";
        }
      })
      .catch((error) => {
        visit = null;
        remember(null);
        $("join").disabled = true;
        $("status").textContent = error.message;
      });
  }
} else if (!friendInvite) {
  $("join").disabled = true;
  $("status").textContent = viaApp;
}
$("get-app-close").addEventListener("click", () => {
  $("get-app").hidden = true;
});
$("room-code").value = room || "";
let socket,
  pc,
  channel,
  player,
  seq = 0,
  joined = false;
let heartbeat;
const held = new Map(),
  candidates = [];
const status = (text) => {
  $("status").textContent = text;
};
const send = (value) => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
};
function clearInput() {
  held.clear();
  document
    .querySelectorAll(".pressed")
    .forEach((el) => el.classList.remove("pressed"));
  input(true);
}
function reading(clear) {
  let buttons = 0,
    axes = [0, 0, 0, 0];
  if (!clear && !document.hidden && document.hasFocus()) {
    for (const bit of held.values()) buttons |= 1 << bit;
    const pad = [...(navigator.getGamepads?.() || [])].find(
      (pad) => pad?.mapping === "standard",
    );
    if (pad) {
      // By position, as the phone page and the PC's runtime read a pad: the
      // bottom button (✕ on PlayStation) is RetroPad B, which PS3 games see as ✕.
      [0, 8, 1, 9, 10, 11, 12, 13, 2, 3, 14, 15, 4, 5, 6, 7].forEach(
        (bit, index) => {
          if (pad.buttons[index]?.pressed) buttons |= 1 << bit;
        },
      );
      axes = axes.map((_, i) =>
        Math.round(Math.max(-1, Math.min(1, pad.axes[i] || 0)) * 32767),
      );
    }
  }
  return { buttons, axes };
}
let lastSent = "";
function input(clear = false) {
  if (channel?.readyState !== "open" || channel.bufferedAmount > 4096) return;
  const state = reading(clear);
  lastSent = JSON.stringify(state);
  channel.send(JSON.stringify({ seq: seq++, ...state }));
}
// The timer repeats the held state in case a packet is lost. A controller is
// also read every display frame and sent the moment it changes, instead of
// waiting up to 33 ms for the next repeat.
const inputTimer = setInterval(() => input(), 33);
function pollPad() {
  if (channel?.readyState === "open" && JSON.stringify(reading()) !== lastSent)
    input();
  showPad();
  requestAnimationFrame(pollPad);
}
let padNote = "";
/** Tells the guest whether their controller plays: the browser may not see
 * it, may not know its buttons, or this page may not have focus. */
function showPad() {
  const pads = [...(navigator.getGamepads?.() || [])].filter(Boolean);
  const pad = pads.find((pad) => pad.mapping === "standard");
  const note = !pads.length
    ? "Controle USB ou Bluetooth também funciona em navegadores compatíveis. Conecte e pressione um botão."
    : !pad
      ? "Este navegador não reconhece os botões do seu controle. Tente o Chrome ou o Edge, ou jogue pelo teclado."
      : !document.hasFocus()
        ? "Controle pausado: clique nesta página para ele voltar a jogar."
        : `Controle pronto: ${(pad.id || "").replace(/\s*\(.*$/, "") || "conectado"}.`;
  if (note !== padNote) $("pad-note").textContent = padNote = note;
}
if (typeof requestAnimationFrame === "function") requestAnimationFrame(pollPad);
/** `final` is the room's own answer; a dropped connection is not. */
function ended(message, final = false) {
  clearInterval(heartbeat);
  joined = false;
  clearInput();
  channel?.close();
  pc?.close();
  socket?.close();
  $("screen").srcObject = null;
  $("stage").hidden = true;
  $("lobby").hidden = false;
  $("connection").textContent = "Conexão encerrada";
  if (visit && !final) {
    // The claimed link still holds the seat: the same tab can come back.
    $("join").disabled = false;
    $("name").disabled = false;
    $("join").textContent = "Entrar novamente";
    status(message);
  } else if (visit) {
    visit = null;
    remember(null);
    $("join").disabled = true;
    status(message);
  } else {
    // A ticket works once; joining again needs a new one from the app.
    $("join").disabled = true;
    status(`${message} ${viaApp}`);
  }
  if (document.fullscreenElement) void document.exitFullscreen();
}
if (!window.isSecureContext || !window.RTCPeerConnection) {
  status("Abra o convite em um navegador atualizado usando HTTPS.");
  $("join").disabled = true;
}
$("join-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (joined || (!friendInvite && !visit?.room) || room !== inviteRoom) return;
  if (!window.isSecureContext || !window.RTCPeerConnection) return;
  const name = visit ? $("name").value.trim().slice(0, 24) : "";
  if (visit && !name) {
    status("Digite seu nome para entrar.");
    $("name").focus();
    return;
  }
  if (visit) remember((visit = { ...visit, name }));
  history.replaceState(null, "", `/party/${room}`);
  joined = true;
  candidates.length = 0;
  $("join").disabled = true;
  $("name").disabled = true;
  $("room-code").disabled = true;
  status("Conectando à sala…");
  const url = new URL("/signal", location.href);
  url.searchParams.set("room", room);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(url);
  const thisSocket = socket;
  const timer = setTimeout(() => {
    if (thisSocket.readyState !== WebSocket.OPEN && joined)
      ended("A sala não respondeu. Confira sua conexão e tente novamente.");
  }, 15000);
  socket.onopen = () => {
    clearTimeout(timer);
    if (visit)
      send({
        type: "join",
        room,
        name,
        guest: visit.token,
        ...(visit.resume ? { resume: visit.resume } : {}),
      });
    // A friend's name comes from the account on the server, not this page.
    else send({ type: "join", room, invite: friendInvite });
    friendInvite = "";
    heartbeat = setInterval(() => {
      if (thisSocket.readyState === WebSocket.OPEN) thisSocket.send("ping");
    }, 20000);
  };
  socket.onclose = () => {
    clearTimeout(timer);
    if (joined && socket === thisSocket)
      ended("Você desconectou. Entre novamente para pedir seu lugar na sala.");
  };
  socket.onmessage = (event) => {
    if (event.data === "pong") return;
    void receive(JSON.parse(event.data)).catch(() =>
      ended(
        "Não foi possível conectar a partida. Peça ao anfitrião para conferir a conexão e tente novamente.",
      ),
    );
  };
});
async function receive(m) {
  if (m.type === "waiting") {
    status("Seu amigo recebeu o pedido. Aguarde ele aceitar sua entrada.");
    $("connection").textContent = "Aguardando o anfitrião";
  }
  if (m.type === "error" || m.type === "ended") {
    ended(m.message, true);
    return;
  }
  if (m.type === "accepted") {
    player = m.player;
    if (visit && typeof m.resume === "string")
      remember((visit = { ...visit, resume: m.resume }));
    status(`Seu lugar é J${player}. Conectando imagem e som…`);
    pc = new RTCPeerConnection({
      iceServers: m.iceServers,
      iceTransportPolicy: m.policy === "all" ? "all" : "relay",
    });
    pc.onicecandidate = (event) => {
      if (event.candidate)
        send({
          type: "signal",
          signal: { type: "candidate", candidate: event.candidate.toJSON() },
        });
    };
    pc.ondatachannel = (event) => {
      channel = event.channel;
      channel.onopen = () => input(true);
    };
    const tracks = new MediaStream();
    pc.ontrack = (event) => {
      // Play as soon as media decodes: the browser's default buffer suits
      // calls, not a game being played. Sound too, or lip sync would hold
      // the picture back to match it.
      try {
        if ("jitterBufferTarget" in event.receiver)
          event.receiver.jitterBufferTarget = 0;
        else if ("playoutDelayHint" in event.receiver)
          event.receiver.playoutDelayHint = 0;
      } catch {}
      tracks.addTrack(event.track);
      $("screen").srcObject = tracks;
      void activate();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        $("lobby").hidden = true;
        $("stage").hidden = false;
        $("player").textContent = `J${player} · Você está na partida`;
        $("connection").textContent = "Conectado à Party";
        void activate();
      }
      if (pc.connectionState === "disconnected") {
        clearInput();
        $("connection").textContent = "Tentando recuperar a conexão…";
      }
      if (pc.connectionState === "failed")
        ended(
          "A conexão não foi estabelecida. Tente entrar novamente em alguns instantes.",
        );
    };
  }
  if (m.type === "signal" && pc) {
    const signal = m.signal;
    if (signal.type === "offer") {
      await pc.setRemoteDescription(signal.sdp);
      for (const candidate of candidates.splice(0))
        await pc.addIceCandidate(candidate);
      await pc.setLocalDescription(await pc.createAnswer());
      send({
        type: "signal",
        signal: { type: "answer", sdp: pc.localDescription },
      });
    } else if (signal.type === "candidate") {
      if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate);
      else candidates.push(signal.candidate);
    }
  }
}
async function activate() {
  try {
    await $("screen").play();
    $("play").hidden = true;
  } catch {
    $("play").hidden = false;
  }
}
$("play").onclick = activate;
$("leave").onclick = () =>
  ended("Você saiu da partida. Pode pedir para entrar novamente.");
$("fullscreen").onclick = () => {
  void (
    document.fullscreenElement
      ? document.exitFullscreen()
      : $("stage").requestFullscreen()
  ).catch(() => {
    $("connection").textContent = "Tela cheia indisponível neste navegador";
  });
};
const keys = {
  ArrowUp: 4,
  ArrowDown: 5,
  ArrowLeft: 6,
  ArrowRight: 7,
  KeyZ: 0,
  KeyX: 8,
  KeyA: 1,
  KeyS: 9,
  Enter: 3,
  ShiftRight: 2,
  KeyQ: 10,
  KeyW: 11,
};
document.addEventListener("keydown", (event) => {
  if ($("stage").hidden || !(event.code in keys)) return;
  event.preventDefault();
  held.set(event.code, keys[event.code]);
  input();
});
document.addEventListener("keyup", (event) => {
  if (!(event.code in keys)) return;
  held.delete(event.code);
  input();
});
for (const button of document.querySelectorAll("[data-bit]")) {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    held.set(event.pointerId, Number(button.dataset.bit));
    button.classList.add("pressed");
    input();
  });
  const release = (event) => {
    held.delete(event.pointerId);
    button.classList.remove("pressed");
    input();
  };
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
}
window.addEventListener("blur", clearInput);
document.addEventListener("visibilitychange", clearInput);
window.addEventListener("pagehide", () => {
  clearInterval(heartbeat);
  clearInput();
  clearInterval(inputTimer);
  socket?.close();
  pc?.close();
});
if (
  (friendInvite || (visit?.resume && visit.name)) &&
  room &&
  window.isSecureContext &&
  window.RTCPeerConnection
)
  $("join-form").requestSubmit();
