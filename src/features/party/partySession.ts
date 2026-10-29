import { bridge } from "../../services/bridge";
import { invoke, isTauri } from "../../services/transport";
import { validatePartyServer } from "./partyConfig";
import { preferH264VideoCodec } from "./partyCodecs";
import { configurePartyVideo } from "./partyQuality";
import { microphoneFailure, openMicrophone } from "./partyVoice";
import {
  loudness,
  parsePartyReaction,
  reactionMessage,
  speakersMessage,
  talking,
  type PartyReactionId,
  type PartySpeaker,
} from "./partyLive";
import { socialStore } from "../../services/social";
import { accountFailure } from "../../services/account";
import { parsePartyRoster } from "./partyRoster";
import { parsePartyGuestLink, type PartyGuestLink } from "./partyGuestLink";
import { isRawPartyFrame } from "./partyFrames";
import {
  addChatLine,
  chatMessage,
  chatNote,
  parsePartyChat,
  type PartyChatLine,
} from "./partyChatLines";
import {
  paintWaiting,
  WAITING_HEIGHT,
  WAITING_INTERVAL_MS,
  WAITING_WIDTH,
} from "./partyWaiting";
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
  anonymous?: boolean;
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
  /** The open guest link, which holds one seat for a browser guest. */
  guestLink: PartyGuestLink | null;
  guestLinkBusy: boolean;
  /** The room's temporary chat; it ends with the room. */
  chat: PartyChatLine[];
  /** The host's microphone is open to the room. */
  mic: boolean;
  micError: string;
  /** The room's server relays reactions and seat moves. */
  live: boolean;
  /** Who is talking now: "host" or a guest's id. */
  speaking: string[];
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
  guestLink: null,
  guestLinkBusy: false,
  chat: [],
  mic: false,
  micError: "",
  live: false,
  speaking: [],
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
interface Peer {
  pc: RTCPeerConnection;
  pad: WebSocket;
  channel: RTCDataChannel;
  lastInput: number;
  lastState: string;
  seq: number;
  pending: RTCIceCandidateInit[];
  voice?: Voice;
  /** The seat this guest plays from; the host can move it. */
  player: number;
}
const peers = new Map<string, Peer>();
/** One guest's voice line: what they hear, and what they say. */
interface Voice {
  transceiver: RTCRtpTransceiver;
  /** The mix this guest hears: everyone's voice except their own. */
  out: MediaStreamAudioDestinationNode;
  heard?: {
    source: MediaStreamAudioSourceNode;
    gain: GainNode;
    element: HTMLAudioElement;
    meter: AnalyserNode;
  };
}
let microphone:
  | {
      track: MediaStreamTrack;
      source: MediaStreamAudioSourceNode;
      meter: AnalyserNode;
    }
  | undefined;
let voiceMeter: ReturnType<typeof setInterval> | undefined;
const lastLoud = new Map<string, number>();
const samples = new Float32Array(512);
const levelOf = (meter: AnalyserNode) => {
  meter.getFloatTimeDomainData(samples);
  return loudness(samples);
};
/** The current list of who is talking, as sent to every guest. */
let speakersMessageText = speakersMessage([]);
let speakersSentAt = 0;
/** The game channel may drop packets, so the list is repeated, not only sent on change. */
const SPEAKERS_REPEAT_MS = 1000;
function namedSpeakers(speaking: string[]): PartySpeaker[] {
  const user = socialStore.snapshot().session.user;
  return speaking.flatMap((id) => {
    if (id === "host")
      return [{ player: 1, name: user?.displayName ?? "Anfitrião" }];
    const guest = state.guests.find((g) => g.id === id);
    return guest?.player ? [{ player: guest.player, name: guest.name }] : [];
  });
}
/** Tells the room who is talking: on a change, and again every second. */
function listenToVoices() {
  clearInterval(voiceMeter);
  voiceMeter = setInterval(() => {
    const levels = new Map<string, number>();
    if (microphone) levels.set("host", levelOf(microphone.meter));
    for (const [id, peer] of peers)
      if (peer.voice?.heard) levels.set(id, levelOf(peer.voice.heard.meter));
    const speaking = talking(levels, lastLoud, performance.now());
    const changed = speaking.join() !== state.speaking.join();
    if (changed) update({ speaking });
    const now = performance.now();
    if (!changed && now - speakersSentAt < SPEAKERS_REPEAT_MS) return;
    // Names are looked up again each time, so a moved guest shows the new seat.
    speakersMessageText = speakersMessage(namedSpeakers(speaking));
    speakersSentAt = now;
    for (const peer of peers.values())
      if (peer.channel.readyState === "open")
        peer.channel.send(speakersMessageText);
  }, 100);
}
/**
 * Wires every voice again: each guest and the host's microphone feed the
 * host's speakers and every other guest's mix, never their own.
 */
function routeVoice() {
  if (!context) return;
  microphone?.source.disconnect();
  // Disconnecting the source drops every output, the level meter included.
  microphone?.source.connect(microphone.meter);
  for (const peer of peers.values()) peer.voice?.heard?.gain.disconnect();
  for (const [id, peer] of peers) {
    const heard = peer.voice?.heard;
    if (!heard) continue;
    heard.gain.connect(context.destination);
    for (const [otherId, other] of peers)
      if (otherId !== id && other.voice) heard.gain.connect(other.voice.out);
  }
  if (microphone)
    for (const peer of peers.values())
      if (peer.voice) microphone.source.connect(peer.voice.out);
}
function hear(peer: Peer, track: MediaStreamTrack) {
  if (!context || !peer.voice) return;
  const stream = new MediaStream([track]);
  // Chromium feeds a remote track to Web Audio only while an element holds it.
  const element = new Audio();
  element.muted = true;
  element.srcObject = stream;
  void element.play().catch(() => {});
  const source = context.createMediaStreamSource(stream);
  const gain = context.createGain();
  source.connect(gain);
  const meter = context.createAnalyser();
  meter.fftSize = 512;
  source.connect(meter);
  peer.voice.heard = { source, gain, element, meter };
  routeVoice();
}
function silence(voice: Voice | undefined) {
  if (!voice) return;
  voice.heard?.gain.disconnect();
  voice.heard?.source.disconnect();
  voice.heard?.meter.disconnect();
  voice.heard?.element.pause();
  if (voice.heard) voice.heard.element.srcObject = null;
  voice.out.disconnect();
}
function stopMicrophone() {
  microphone?.source.disconnect();
  microphone?.meter.disconnect();
  microphone?.track.stop();
  microphone = undefined;
}
/** Opens or closes the host's microphone to everyone in the room. */
export async function setPartyMicrophone(on: boolean) {
  if (state.phase !== "open" || !context) return;
  if (!on) {
    stopMicrophone();
    update({ mic: false, micError: "" });
    routeVoice();
    return;
  }
  if (microphone) return;
  const run = generation;
  try {
    const track = await openMicrophone();
    if (run !== generation || !context || microphone) {
      track.stop();
      return;
    }
    const source = context.createMediaStreamSource(new MediaStream([track]));
    const meter = context.createAnalyser();
    meter.fftSize = 512;
    source.connect(meter);
    microphone = { track, source, meter };
    update({ mic: true, micError: "" });
    routeVoice();
  } catch (cause) {
    if (run === generation) update({ micError: microphoneFailure(cause) });
  }
}
const canvas = document.createElement("canvas");
canvas.width = WAITING_WIDTH;
canvas.height = WAITING_HEIGHT;
const paint = canvas.getContext("2d")!;
function waiting() {
  canvas.width = WAITING_WIDTH;
  canvas.height = WAITING_HEIGHT;
  const user = socialStore.snapshot().session.user;
  paintWaiting(
    paint,
    {
      host: { name: user?.displayName ?? null, avatar: user?.avatar },
      guests: state.guests,
      connected: state.connected,
    },
    performance.now(),
  );
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
  silence(peer.voice);
  routeVoice();
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
  stopMicrophone();
  clearInterval(voiceMeter);
  lastLoud.clear();
  speakersMessageText = speakersMessage([]);
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
export function sendPartyChat(text: string) {
  const message = chatMessage(text);
  if (message && state.phase === "open") send(message);
}
/** Sends a quick reaction, shown over the game to everyone in the room. */
export function sendPartyReaction(id: PartyReactionId) {
  if (state.phase === "open" && state.live) send(reactionMessage(id));
}
/** Puts a guest in another seat; whoever sits there takes the guest's seat. */
export function moveGuest(id: string, player: number) {
  if (state.phase === "open" && state.live) send({ type: "move", id, player });
}
export function removeGuest(id: string) {
  dropPeer(id);
  send({ type: "remove", id });
}
/** Opens one seat to anyone with the link, from a browser, without an
 * account. A new link replaces the previous one and its guest. */
export function createGuestLink() {
  if (state.phase !== "open") return;
  update({ guestLinkBusy: true, error: "" });
  send({ type: "guest-link" });
}
/** Closes the link's seat, and removes whoever came in through it. */
export function closeGuestLink() {
  if (state.phase !== "open") return;
  for (const guest of state.guests) if (guest.anonymous) dropPeer(guest.id);
  update({ guestLink: null, guestLinkBusy: false });
  send({ type: "guest-link-close" });
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
    context = new AudioContext({ latencyHint: "interactive" });
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
    // Every frame the server paces up to 60 fps becomes a video frame, without
    // a canvas: a capture capped at that same rate dropped frames that
    // arrived close together and left doubled gaps.
    video = frameTrack(FULL_VIEW);
    stream = video.stream;
    for (const track of audio.stream.getAudioTracks()) stream.addTrack(track);
    // A guest who connects while nothing changes still gets a picture.
    refresh = setInterval(() => {
      if (!playing) waiting();
    }, WAITING_INTERVAL_MS);
    const remote = await bridge.remotePlayStart();
    if (run !== generation) return;
    if (!remote.url)
      throw new Error("Não foi possível iniciar a captura do PC.");
    const local = new URL(remote.url);
    local.protocol = "ws:";
    local.hostname = "127.0.0.1";
    local.pathname = "/party-stream";
    // Guests' controllers use their own sockets, which carry no media.
    const controls = new URL(local);
    controls.pathname = "/party-input";
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
      if (isRawPartyFrame(data.getUint8(0)) || data.getUint8(0) === 3) {
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
          update({
            phase: "open",
            url: m.url,
            code: m.code,
            relay: m.relay,
            live: m.live === true,
          });
          listenToVoices();
          hostTicket = reservation.ticket || "";
          syncFriendsAccess();
        }
        if (m.type === "roster") update({ guests: parsePartyRoster(m.guests) });
        if (m.type === "chat") {
          const line = parsePartyChat(m);
          if (line) update({ chat: addChatLine(state.chat, line) });
        }
        if (m.type === "reaction") {
          const reaction = parsePartyReaction(m);
          // Shown with the chat, so the host sees them over the game too.
          if (reaction)
            update({
              chat: addChatLine(state.chat, {
                id: reaction.id,
                from: reaction.player === 1 ? "host" : "reaction",
                name: reaction.name,
                player: reaction.player,
                text: reaction.emoji,
                at: reaction.at,
              }),
            });
        }
        if (m.type === "seat" && typeof m.id === "string") {
          const moved = peers.get(m.id);
          if ([2, 3, 4].includes(m.player) && moved) {
            const old = moved.player;
            moved.player = m.player;
            // Let go of what the guest held in the old seat, unless a swap
            // has already put someone else there.
            setTimeout(() => {
              if (
                [...peers.values()].some((p) => p.player === old) ||
                moved.pad.readyState !== WebSocket.OPEN
              )
                return;
              moved.pad.send(
                JSON.stringify({
                  type: "pad",
                  player: old,
                  buttons: 0,
                  axes: [0, 0, 0, 0],
                }),
              );
            }, 80);
          }
        }
        if (m.type === "chat-error" && typeof m.message === "string")
          update({ chat: addChatLine(state.chat, chatNote(m.message)) });
        if (m.type === "guest-link")
          update({
            guestLink: parsePartyGuestLink(m, state.url),
            guestLinkBusy: false,
          });
        if (m.type === "error") {
          if (state.phase === "connecting") fail(m.message);
          else update({ error: m.message, guestLinkBusy: false });
        }
        if (m.type === "left") dropPeer(m.id);
        if (m.type === "peer") {
          const pc = new RTCPeerConnection({
            iceServers,
            iceTransportPolicy: policy,
          });
          const pad = new WebSocket(controls);
          const channel = pc.createDataChannel("pad", {
            ordered: false,
            maxRetransmits: 0,
          });
          const peer: Peer = {
            pc,
            pad,
            channel,
            lastInput: 0,
            lastState: "",
            seq: -1,
            pending: [],
            player: m.player,
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
          channel.onopen = () => channel.send(speakersMessageText);
          stream!.getTracks().forEach((track) => pc.addTrack(track, stream!));
          // A second audio line after the game's sound carries the voices.
          const out = context!.createMediaStreamDestination();
          const voiceSender = pc.addTrack(
            out.stream.getAudioTracks()[0],
            out.stream,
          );
          const voiceLine = pc
            .getTransceivers()
            .find((transceiver) => transceiver.sender === voiceSender);
          if (voiceLine) peer.voice = { transceiver: voiceLine, out };
          pc.ontrack = (event) => {
            if (peer.voice && event.transceiver === peer.voice.transceiver)
              hear(peer, event.track);
          };
          routeVoice();
          for (const transceiver of pc.getTransceivers()) {
            if (transceiver.sender.track?.kind === "video")
              preferH264VideoCodec(
                transceiver,
                RTCRtpSender.getCapabilities("video"),
                RTCRtpReceiver.getCapabilities("video"),
              );
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
                    player: peer.player,
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
          // Encodings may be empty before the local description is installed.
          // Apply limits after negotiation has created the sender's encoding.
          for (const sender of pc.getSenders())
            if (sender.track?.kind === "video")
              await configurePartyVideo(sender);
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
