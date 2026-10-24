import { bridge } from "../../services/bridge";
import { invoke, isTauri } from "../../services/transport";
import { validatePartyServer } from "./partyConfig";
import { preferH264VideoCodec } from "./partyCodecs";
import { socialStore } from "../../services/social";
import { accountFailure } from "../../services/account";
import { parsePartyRoster } from "./partyRoster";
import {
  canvasSource,
  frameTrack,
  frameTracksSupported,
  FULL_VIEW,
  packetDecoder,
  retire,
  type FrameTrack,
  type Source,
} from "../../services/frameTracks";

export interface PartyGuest {
  id: string;
  name: string;
  player: number | null;
  avatar?: number;
}
export interface PartyState {
  friendsAllowed: boolean;
  friendsReady: boolean;
  friendsBusy: boolean;
  friendsError: string;
  phase: "idle" | "connecting" | "open";
  url: string;
  code: string;
  guests: PartyGuest[];
  connected: string[];
  error: string;
  game: string;
  relay: boolean;
}
const initial: PartyState = {
  friendsAllowed: true,
  friendsReady: false,
  friendsBusy: false,
  friendsError: "",
  phase: "idle",
  url: "",
  code: "",
  guests: [],
  connected: [],
  error: "",
  game: "",
  relay: false,
};
let state = initial;
const listeners = new Set<() => void>();
function update(value: Partial<PartyState>) {
  state = { ...state, ...value };
  listeners.forEach((fn) => fn());
}
export const partyStore = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  snapshot: () => state,
};
let signaling: WebSocket | undefined;
let media: WebSocket | undefined;
let context: AudioContext | undefined;
let stream: MediaStream | undefined;
let timeout: ReturnType<typeof setTimeout> | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let generation = 0;
let hostTicket = "";
let confirmedFriendsAllowed = false;
let friendChanges = Promise.resolve();
export function setFriendsAllowed(value: boolean) {
  update({ friendsAllowed: value, friendsReady: false });
  syncFriendsAccess();
}
function syncFriendsAccess() {
  const run = generation,
    code = state.code,
    ticket = hostTicket,
    joinable = state.friendsAllowed;
  if (
    !isTauri ||
    state.phase !== "open" ||
    !socialStore.snapshot().session.hasSession
  )
    return;
  if (!ticket) {
    update({
      friendsError: "Os convites de amigos exigem o servidor Cloudflare.",
    });
    return;
  }
  update({ friendsBusy: true, friendsError: "" });
  friendChanges = friendChanges
    .catch(() => {})
    .then(async () => {
      if (run !== generation) return;
      try {
        await invoke("social_party", { code, ticket, joinable });
        if (run === generation && joinable === state.friendsAllowed) {
          confirmedFriendsAllowed = joinable;
          update({ friendsReady: joinable, friendsError: "" });
        }
      } catch (cause) {
        if (run === generation)
          update({
            friendsAllowed: confirmedFriendsAllowed,
            friendsReady: confirmedFriendsAllowed,
            friendsError: accountFailure(cause).message,
          });
      } finally {
        if (run === generation) update({ friendsBusy: false });
      }
    });
}
window.addEventListener("openretro-social-ready", () => syncFriendsAccess());
window.addEventListener("openretro-account-changed", () =>
  update({ friendsReady: false, friendsError: "" }),
);
let video: FrameTrack | undefined;
let latest: Source | undefined;
let decode = packetDecoder();
let refresh: ReturnType<typeof setInterval> | undefined;
let audioTime = 0;
let playing = false;
const peers = new Map<
  string,
  {
    pc: RTCPeerConnection;
    pad: WebSocket;
    channel: RTCDataChannel;
    lastInput: number;
    lastState: string;
    seq: number;
    pending: RTCIceCandidateInit[];
  }
>();
const canvas = document.createElement("canvas");
canvas.width = 1280;
canvas.height = 720;
const paint = canvas.getContext("2d")!;
function waiting() {
  canvas.width = 1280;
  canvas.height = 720;
  const theme = getComputedStyle(document.documentElement);
  paint.fillStyle = theme.getPropertyValue("--bg").trim() || "#121212";
  paint.fillRect(0, 0, 1280, 720);
  paint.textAlign = "center";
  paint.fillStyle = theme.getPropertyValue("--text").trim() || "#e9eaee";
  paint.font = "700 48px sans-serif";
  paint.fillText("OpenRetro Party", 640, 330);
  paint.fillStyle = theme.getPropertyValue("--body").trim() || "#8e919b";
  paint.font = "26px sans-serif";
  paint.fillText("Aguardando um jogo no PC…", 640, 390);
  if (frameTracksSupported) show(canvasSource(canvas));
}
/** Sends a frame to every guest; the previous one closes once unused. */
function show(source: Source) {
  if (latest) retire(latest);
  latest = source;
  void video?.show(source);
}
function send(message: object) {
  if (signaling?.readyState === WebSocket.OPEN)
    signaling.send(JSON.stringify(message));
}
function dropPeer(id: string) {
  const peer = peers.get(id);
  if (!peer) return;
  peers.delete(id);
  peer.channel.close();
  peer.pc.close();
  peer.pad.close();
  update({ connected: state.connected.filter((value) => value !== id) });
}
export function endParty() {
  generation++;
  hostTicket = "";
  confirmedFriendsAllowed = false;
  if (isTauri) void invoke("social_party_clear").catch(() => {});
  clearTimeout(timeout);
  clearInterval(heartbeat);
  const previous = signaling;
  signaling = undefined;
  previous?.close();
  media?.close();
  media = undefined;
  for (const id of [...peers.keys()]) dropPeer(id);
  clearInterval(refresh);
  video?.close();
  video = undefined;
  stream?.getTracks().forEach((track) => track.stop());
  stream = undefined;
  if (latest) retire(latest);
  latest = undefined;
  decode = packetDecoder();
  void context?.close();
  context = undefined;
  playing = false;
  audioTime = 0;
  update({ ...initial });
}
export function removeGuest(id: string) {
  dropPeer(id);
  send({ type: "remove", id });
}
export async function startParty() {
  endParty();
  const run = generation;
  update({ phase: "connecting" });
  waiting();
  try {
    if (!isTauri)
      throw new Error("Abra o aplicativo desktop para transmitir uma partida.");
    if (!frameTracksSupported)
      throw new Error(
        "Atualize o Microsoft Edge WebView2 para transmitir uma partida.",
      );
    const configuration = await invoke<{ url: string }>("party_configuration");
    if (run !== generation) return;
    if (!configuration.url)
      throw new Error("O serviço Party ainda não foi ativado nesta versão.");
    const url = validatePartyServer(configuration.url);
    context = new AudioContext();
    await context.resume();
    if (run !== generation) return;
    const audio = context.createMediaStreamDestination();
    // Party is not anonymous: the room is reserved with the account's
    // session, which only the Rust side holds, and only friends join.
    if (!socialStore.snapshot().session.hasSession)
      throw new Error("Entre na sua conta para criar um Party.");
    let reservation: { code: string; ticket: string };
    try {
      reservation = await invoke("social_party_reserve");
    } catch (cause) {
      throw new Error(accountFailure(cause).message);
    }
    if (run !== generation) return;
    // Every frame the server paces at 30 fps becomes a video frame, without
    // a canvas: a capture capped at that same rate dropped frames that
    // arrived close together and left doubled gaps.
    video = frameTrack(FULL_VIEW);
    stream = video.stream;
    for (const track of audio.stream.getAudioTracks()) stream.addTrack(track);
    // A guest who connects while nothing changes still gets a picture.
    refresh = setInterval(() => {
      if (!playing) waiting();
    }, 1000);
    const remote = await bridge.remotePlayStart();
    if (run !== generation) return;
    if (!remote.url)
      throw new Error("Não foi possível iniciar a captura do PC.");
    const local = new URL(remote.url);
    local.protocol = "ws:";
    local.hostname = "127.0.0.1";
    local.pathname = "/party-stream";
    media = new WebSocket(local);
    media.binaryType = "arraybuffer";
    media.onclose = () => {
      if (run === generation)
        fail("A captura foi interrompida. Crie a sala novamente.");
    };
    media.onmessage = async (event) => {
      if (run !== generation) return;
      if (typeof event.data === "string") {
        const message = JSON.parse(event.data);
        if (message.type === "status") {
          playing = Boolean(message.partyAvailable);
          update({ game: playing ? message.game : "" });
          if (!playing) waiting();
        }
        return;
      }
      if (!playing) return;
      const data = new DataView(event.data as ArrayBuffer);
      if (data.byteLength === 0) return;
      if (data.getUint8(0) === 4 || data.getUint8(0) === 3) {
        // Frames keep their aspect ratio instead of encoding black bars, and
        // small retro frames grow by whole pixels (frameTracks.ts).
        const frame = await decode(event.data as ArrayBuffer);
        if (!frame) return;
        if (playing && run === generation) show(frame);
        else retire(frame);
      } else if (data.getUint8(0) === 2 && context && data.byteLength >= 9) {
        const rate = data.getUint32(1, true),
          length = Math.floor((data.byteLength - 5) / 4);
        if (rate < 8000 || rate > 192000) return;
        const buffer = context.createBuffer(2, length, rate);
        for (let c = 0; c < 2; c++) {
          const samples = buffer.getChannelData(c);
          for (let i = 0; i < length; i++)
            samples[i] = data.getInt16(5 + i * 4 + c * 2, true) / 32768;
        }
        if (audioTime > context.currentTime + 0.2) return;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(audio);
        audioTime = Math.max(context.currentTime + 0.015, audioTime);
        source.start(audioTime);
        audioTime += buffer.duration;
      }
    };
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/signal";
    if (reservation.code) url.searchParams.set("room", reservation.code);
    const socket = new WebSocket(url);
    signaling = socket;
    let iceServers: RTCIceServer[] = [];
    let policy: RTCIceTransportPolicy = "relay";
    timeout = setTimeout(() => {
      if (run === generation && state.phase === "connecting")
        fail("O servidor não respondeu. Confira o endereço e tente novamente.");
    }, 15000);
    socket.onopen = () => {
      send({
        type: "create",
        ...(reservation.ticket ? { ticket: reservation.ticket } : {}),
      });
      if (reservation.ticket)
        heartbeat = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send("ping");
        }, 20000);
    };
    socket.onclose = () => {
      if (run === generation)
        fail("A conexão com a sala terminou. Crie outra sala para continuar.");
    };
    socket.onmessage = (event) => {
      if (event.data === "pong") return;
      void (async () => {
        if (run !== generation) return;
        const m = JSON.parse(event.data);
        if (m.type === "created") {
          clearTimeout(timeout);
          iceServers = m.iceServers;
          policy = m.policy === "all" ? "all" : "relay";
          update({ phase: "open", url: m.url, code: m.code, relay: m.relay });
          hostTicket = reservation.ticket || "";
          syncFriendsAccess();
        }
        if (m.type === "roster") update({ guests: parsePartyRoster(m.guests) });
        if (m.type === "error") {
          if (state.phase === "connecting") fail(m.message);
          else update({ error: m.message });
        }
        if (m.type === "left") dropPeer(m.id);
        if (m.type === "peer") {
          const pc = new RTCPeerConnection({
            iceServers,
            iceTransportPolicy: policy,
          });
          const pad = new WebSocket(local);
          const channel = pc.createDataChannel("pad", {
            ordered: false,
            maxRetransmits: 0,
          });
          const peer = {
            pc,
            pad,
            channel,
            lastInput: 0,
            lastState: "",
            seq: -1,
            pending: [] as RTCIceCandidateInit[],
          };
          peers.set(m.id, peer);
          pad.onclose = () => {
            if (peers.get(m.id) !== peer) return;
            removeGuest(m.id);
            update({
              error:
                "A conexão de um controle foi interrompida. Peça ao amigo para entrar novamente.",
            });
          };
          stream!.getTracks().forEach((track) => pc.addTrack(track, stream!));
          for (const transceiver of pc.getTransceivers()) {
            if (transceiver.sender.track?.kind === "video")
              preferH264VideoCodec(
                transceiver,
                RTCRtpSender.getCapabilities("video"),
                RTCRtpReceiver.getCapabilities("video"),
              );
          }
          for (const sender of pc.getSenders()) {
            if (sender.track?.kind !== "video") continue;
            const parameters = sender.getParameters();
            if (parameters.encodings.length) {
              parameters.encodings[0].maxBitrate = 5_000_000;
              // A ceiling above the paced rate, for the same reason.
              parameters.encodings[0].maxFramerate = 60;
              // Keep gameplay moving if the encoder or connection is overloaded.
              parameters.degradationPreference = "maintain-framerate";
              await sender.setParameters(parameters);
            }
          }
          channel.onmessage = (input) => {
            try {
              if (typeof input.data !== "string" || input.data.length > 512)
                return;
              const value = JSON.parse(input.data);
              // Repeats of the same state are throttled; a change always
              // passes, or a press right after a repeat would wait for the
              // guest's next repeat.
              const state = JSON.stringify([value.buttons, value.axes]);
              if (Date.now() - peer.lastInput < 8 && state === peer.lastState)
                return;
              if (
                !Number.isSafeInteger(value.seq) ||
                value.seq <= peer.seq ||
                !Number.isInteger(value.buttons) ||
                value.buttons < 0 ||
                value.buttons > 65535 ||
                !Array.isArray(value.axes) ||
                value.axes.length !== 4 ||
                !value.axes.every(
                  (n: number) =>
                    Number.isInteger(n) && n >= -32768 && n <= 32767,
                )
              )
                return;
              peer.seq = value.seq;
              peer.lastInput = Date.now();
              peer.lastState = state;
              if (playing && pad.readyState === WebSocket.OPEN)
                pad.send(
                  JSON.stringify({
                    type: "pad",
                    player: m.player,
                    buttons: value.buttons,
                    axes: value.axes,
                  }),
                );
            } catch {
              /* Ignore malformed guest input. */
            }
          };
          pc.onicecandidate = (event) => {
            if (event.candidate)
              send({
                type: "signal",
                id: m.id,
                signal: {
                  type: "candidate",
                  candidate: event.candidate.toJSON(),
                },
              });
          };
          pc.onconnectionstatechange = () => {
            update({
              connected: [...peers.entries()]
                .filter(([, p]) => p.pc.connectionState === "connected")
                .map(([id]) => id),
            });
            if (pc.connectionState === "failed") {
              removeGuest(m.id);
              update({
                error:
                  "Não foi possível conectar um amigo. Peça para ele entrar novamente.",
              });
            }
          };
          await pc.setLocalDescription(await pc.createOffer());
          send({
            type: "signal",
            id: m.id,
            signal: { type: "offer", sdp: pc.localDescription },
          });
        }
        if (m.type === "signal") {
          const peer = peers.get(m.id);
          if (!peer) return;
          if (m.signal.type === "answer") {
            await peer.pc.setRemoteDescription(m.signal.sdp);
            for (const candidate of peer.pending.splice(0))
              await peer.pc.addIceCandidate(candidate);
          } else if (m.signal.type === "candidate") {
            if (peer.pc.remoteDescription)
              await peer.pc.addIceCandidate(m.signal.candidate);
            else peer.pending.push(m.signal.candidate);
          }
        }
      })().catch(() => {
        if (run === generation)
          update({
            error:
              "Não foi possível conectar o participante. Remova-o e peça para entrar novamente.",
          });
      });
    };
  } catch (error) {
    if (run === generation)
      fail(String(error instanceof Error ? error.message : error));
  }
}
function fail(error: string) {
  endParty();
  update({ error });
}
