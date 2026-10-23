const $ = (id) => document.getElementById(id);
let room = /^\/party\/([A-Z2-9]{6})$/.exec(location.pathname)?.[1];
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
      [8, 0, 1, 9, 10, 11, 12, 13, 2, 3, 14, 15, 4, 5, 6, 7].forEach(
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
  requestAnimationFrame(pollPad);
}
if (typeof requestAnimationFrame === "function") requestAnimationFrame(pollPad);
function ended(message) {
  clearInterval(heartbeat);
  joined = false;
  clearInput();
  channel?.close();
  pc?.close();
  socket?.close();
  $("screen").srcObject = null;
  $("stage").hidden = true;
  $("lobby").hidden = false;
  $("join").disabled = false;
  $("join").textContent = "Tentar novamente";
  $("name").disabled = false;
  $("room-code").disabled = false;
  $("connection").textContent = "Conexão encerrada";
  status(message);
  if (document.fullscreenElement) void document.exitFullscreen();
}
if (!window.isSecureContext || !window.RTCPeerConnection) {
  status("Abra o convite em um navegador atualizado usando HTTPS.");
  $("join").disabled = true;
}
$("join-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (joined) return;
  if (!window.isSecureContext || !window.RTCPeerConnection) return;
  room = $("room-code").value.trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(room)) {
    status("Digite o código de seis caracteres enviado pelo seu amigo.");
    return;
  }
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
    send({ type: "join", room, name: $("name").value.trim() });
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
    ended(m.message);
    return;
  }
  if (m.type === "accepted") {
    player = m.player;
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
