import { t } from "../../i18n";
import { neutralPad, PartyPadSender, type PadState } from "./partyInput";
import { tunePartyReceiver } from "./partyQuality";

export interface GuestRoom {
  code: string;
  invite: string;
  signal: string;
}
export type GuestPhase =
  | "joining"
  | "waiting"
  | "accepted"
  | "connected"
  | "disconnected"
  | "ended"
  | "error"
  | "left";
export interface GuestState {
  phase: GuestPhase;
  player?: number;
  message?: string;
  connectedOnce: boolean;
}
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;
function iceServers(value: unknown): value is RTCIceServer[] {
  return (
    Array.isArray(value) &&
    value.length <= 16 &&
    value.every((server) => {
      if (!record(server)) return false;
      const urls =
        typeof server.urls === "string" ? [server.urls] : server.urls;
      return (
        Array.isArray(urls) &&
        urls.length > 0 &&
        urls.length <= 16 &&
        urls.every(
          (url) =>
            text(url, 2048) && /^(stun|stuns|turn|turns):[^\s]+$/.test(url),
        ) &&
        (server.username === undefined || text(server.username, 1024)) &&
        (server.credential === undefined || text(server.credential, 2048))
      );
    })
  );
}
export function validGuestMessage(m: unknown): m is RecordValue {
  if (!record(m)) return false;
  if (m.type === "waiting") return true;
  if (m.type === "error" || m.type === "ended") return text(m.message, 4096);
  if (m.type === "accepted")
    return (
      [2, 3, 4].includes(m.player as number) &&
      iceServers(m.iceServers) &&
      ["all", "relay"].includes(m.policy as string)
    );
  if (m.type !== "signal" || !record(m.signal)) return false;
  const s = m.signal;
  if (s.type === "offer")
    return record(s.sdp) && s.sdp.type === "offer" && text(s.sdp.sdp, 65536);
  if (s.type !== "candidate" || !record(s.candidate)) return false;
  const c = s.candidate;
  return (
    text(c.candidate, 8192) &&
    (c.sdpMid == null || text(c.sdpMid, 256)) &&
    (c.sdpMLineIndex == null ||
      (Number.isInteger(c.sdpMLineIndex) &&
        (c.sdpMLineIndex as number) >= 0 &&
        (c.sdpMLineIndex as number) <= 65535)) &&
    (c.usernameFragment == null || text(c.usernameFragment, 256))
  );
}

export class PartyGuest {
  state: GuestState = { phase: "joining", connectedOnce: false };
  private socket?: WebSocket;
  private pc?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private sender?: PartyPadSender;
  private candidates: RTCIceCandidateInit[] = [];
  private timers: ReturnType<typeof setInterval>[] = [];
  private deadline?: ReturnType<typeof setTimeout>;
  private recovery?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private queue = Promise.resolve();
  private input = neutralPad();
  private lastPong = Date.now();
  constructor(
    private changed: (state: GuestState) => void,
    private media: (stream: MediaStream | null) => void,
  ) {}
  private update(
    phase: GuestPhase,
    message?: string,
    player = this.state.player,
  ) {
    this.state = {
      phase,
      message,
      player,
      connectedOnce: this.state.connectedOnce || phase === "connected",
    };
    this.changed(this.state);
  }
  start(room: GuestRoom) {
    try {
      if (typeof RTCPeerConnection === "undefined")
        throw new Error(t("WebRTC indisponível neste aplicativo."));
      this.update("joining");
      const socket = (this.socket = new WebSocket(room.signal));
      this.deadline = setTimeout(
        () =>
          this.finish(
            "error",
            t("A sala não respondeu. Confira sua conexão e tente novamente."),
          ),
        20000,
      );
      socket.onopen = () => {
        if (this.stopped) return;
        this.send({ type: "join", room: room.code, invite: room.invite });
        room.invite = "";
        this.lastPong = Date.now();
        this.timers.push(
          setInterval(() => {
            if (Date.now() - this.lastPong > 60000)
              this.finish("error", t("A conexão com o Party foi perdida."));
            else if (socket.readyState === WebSocket.OPEN) socket.send("ping");
          }, 20000),
        );
      };
      socket.onmessage = (event) => {
        if (this.stopped) return;
        if (event.data === "pong") {
          this.lastPong = Date.now();
          return;
        }
        try {
          if (!text(event.data, 131072)) throw new Error();
          const message: unknown = JSON.parse(event.data);
          if (!validGuestMessage(message)) throw new Error();
          // Serialize offers and candidates so asynchronous SDP work cannot reorder them.
          this.queue = this.queue
            .then(() => this.receive(message))
            .catch(() =>
              this.finish("error", t("Não foi possível conectar a partida.")),
            );
        } catch {
          this.finish("error", t("Resposta inválida do servidor Party."));
        }
      };
      socket.onclose = socket.onerror = () =>
        this.finish("error", t("A conexão com o Party foi perdida."));
      this.timers.push(
        setInterval(() => this.sender?.send(this.input, true), 33),
      );
    } catch (cause) {
      this.finish(
        "error",
        cause instanceof Error
          ? cause.message
          : t("Não foi possível conectar a partida."),
      );
    }
  }
  setInput(state: PadState) {
    this.input = this.state.phase === "connected" ? state : neutralPad();
    this.sender?.send(this.input);
  }
  private send(value: unknown) {
    if (!this.stopped && this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify(value));
  }
  private async receive(m: RecordValue) {
    if (this.stopped) return;
    if (m.type === "error" || m.type === "ended") {
      this.finish(m.type, m.message as string);
      return;
    }
    if (m.type === "waiting" && this.state.phase === "joining")
      this.update("waiting");
    if (m.type === "accepted") {
      if (this.pc) throw new Error("duplicate acceptance");
      this.update("accepted", undefined, m.player as number);
      const pc = (this.pc = new RTCPeerConnection({
        iceServers: m.iceServers as RTCIceServer[],
        iceTransportPolicy: m.policy as RTCIceTransportPolicy,
      }));
      pc.onicecandidate = (event) => {
        if (event.candidate)
          this.send({
            type: "signal",
            signal: { type: "candidate", candidate: event.candidate.toJSON() },
          });
      };
      pc.ondatachannel = (event) => {
        if (event.channel.label !== "pad" || this.channel || this.stopped) {
          event.channel.close();
          return;
        }
        this.channel = event.channel;
        this.sender = new PartyPadSender(event.channel);
        event.channel.onopen = () => this.sender?.send(neutralPad(), true);
        event.channel.onclose = () =>
          this.finish("error", t("A conexão com o Party foi perdida."));
      };
      const stream = new MediaStream();
      pc.ontrack = (event) => {
        if (this.stopped) return;
        tunePartyReceiver(event.receiver);
        stream.addTrack(event.track);
        this.media(stream);
      };
      pc.onconnectionstatechange = () => {
        if (this.stopped) return;
        if (pc.connectionState === "connected") {
          clearTimeout(this.deadline);
          clearTimeout(this.recovery);
          this.update("connected");
        } else if (pc.connectionState === "disconnected") {
          this.setInput(neutralPad());
          this.update("disconnected");
          clearTimeout(this.recovery);
          this.recovery = setTimeout(
            () => this.finish("error", t("A conexão com o Party foi perdida.")),
            10000,
          );
        } else if (["failed", "closed"].includes(pc.connectionState))
          this.finish("error", t("A conexão com o Party foi perdida."));
      };
    }
    if (m.type === "signal") {
      const pc = this.pc;
      if (!pc) throw new Error("signal before acceptance");
      const signal = m.signal as RecordValue;
      if (signal.type === "offer") {
        await pc.setRemoteDescription(signal.sdp as RTCSessionDescriptionInit);
        if (this.stopped) return;
        for (const candidate of this.candidates.splice(0))
          await pc.addIceCandidate(candidate);
        const answer = await pc.createAnswer();
        if (this.stopped) return;
        await pc.setLocalDescription(answer);
        this.send({
          type: "signal",
          signal: { type: "answer", sdp: pc.localDescription },
        });
      } else if (pc.remoteDescription)
        await pc.addIceCandidate(signal.candidate as RTCIceCandidateInit);
      else {
        if (this.candidates.length >= 256)
          throw new Error("candidate overflow");
        this.candidates.push(signal.candidate as RTCIceCandidateInit);
      }
    }
  }
  leave() {
    this.finish("left");
  }
  private finish(phase: GuestPhase, message?: string) {
    if (this.stopped) return;
    this.sender?.send(neutralPad(), true);
    this.stopped = true;
    clearTimeout(this.deadline);
    clearTimeout(this.recovery);
    this.timers.forEach(clearInterval);
    this.channel?.close();
    this.pc?.close();
    this.socket?.close();
    this.candidates = [];
    this.media(null);
    this.update(phase, message);
  }
}
