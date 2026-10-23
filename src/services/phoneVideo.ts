// Phone play video, encoded on the PC. While phone play runs, this webview
// takes raw frames from the local phone server, cuts each screen region a
// phone watches into its own video track and sends it over WebRTC, H.264
// first. Phones keep their JPEG feed until this picture plays and whenever it
// drops. Sound stays PCM over the phone's socket: phones play WebRTC audio
// like a voice call, at call volume.
import { bridge } from "./bridge";
import { isRemote, isTauri, listen } from "./transport";
import { preferH264VideoCodec } from "../features/party/partyCodecs";
import {
  frameTrack,
  frameTracksSupported,
  packetDecoder,
  retire,
  viewKey,
  type FrameTrack,
  type ScreenView,
  type Source,
} from "./frameTracks";

// The server paces frames to the phone smoothness setting (frames.rs).
// Encoding stays capped above it: a cap at the same rate drops a frame
// whenever two arrive close together, then leaves a doubled gap.
const MAX_FRAME_RATE = 60;
// Party's ceiling. Higher rates made each keyframe a burst that phone Wi-Fi
// drops, and every loss asks for another keyframe.
const MAX_BITRATE = 5_000_000;

interface Peer {
  pc: RTCPeerConnection;
  sender: RTCRtpSender;
  key: string;
  pending: RTCIceCandidateInit[];
}

let latest: Source | undefined;
const tracks = new Map<string, FrameTrack>();
const peers = new Map<number, Peer>();
let socket: WebSocket | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let decode = packetDecoder();
let frameRate = 30;

function trackFor(view: ScreenView): FrameTrack {
  const key = viewKey(view);
  const existing = tracks.get(key);
  if (existing) return existing;
  const created = frameTrack(view);
  tracks.set(key, created);
  if (latest) void created.show(latest);
  return created;
}

/** A region nobody watches stops costing an encoder. */
function release(key: string) {
  if ([...peers.values()].some((peer) => peer.key === key)) return;
  tracks.get(key)?.close();
  tracks.delete(key);
}

async function frame(packet: ArrayBuffer) {
  if (!tracks.size) return;
  const source = await decode(packet);
  if (!source) return;
  if (latest) retire(latest);
  latest = source;
  for (const target of tracks.values()) void target.show(source);
}

function send(message: object) {
  if (socket?.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify(message));
}

function dropPeer(id: number) {
  const peer = peers.get(id);
  if (!peer) return;
  peers.delete(id);
  peer.pc.close();
  release(peer.key);
}

async function join(id: number, view: ScreenView) {
  dropPeer(id);
  const target = trackFor(view);
  // Same network only: host candidates, no STUN or relay.
  const pc = new RTCPeerConnection({ iceServers: [] });
  const transceiver = pc.addTransceiver(target.track, {
    direction: "sendonly",
    streams: [target.stream],
  });
  const peer: Peer = {
    pc,
    sender: transceiver.sender,
    key: viewKey(view),
    pending: [],
  };
  peers.set(id, peer);
  preferH264VideoCodec(
    transceiver,
    RTCRtpSender.getCapabilities("video"),
    RTCRtpReceiver.getCapabilities("video"),
  );
  const parameters = peer.sender.getParameters();
  if (parameters.encodings.length) {
    parameters.encodings[0].maxBitrate = MAX_BITRATE;
    parameters.encodings[0].maxFramerate = MAX_FRAME_RATE;
    // A late frame is worth less than a blurrier one while playing.
    parameters.degradationPreference = "maintain-framerate";
    await peer.sender.setParameters(parameters);
  }
  pc.onicecandidate = (event) => {
    if (event.candidate)
      send({
        type: "signal",
        id,
        signal: { type: "candidate", candidate: event.candidate.toJSON() },
      });
  };
  // The phone notices too and returns to JPEG; a later hello starts over.
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" && peers.get(id) === peer) dropPeer(id);
  };
  await pc.setLocalDescription(await pc.createOffer());
  if (peers.get(id) !== peer) return;
  send({
    type: "signal",
    id,
    signal: { type: "offer", sdp: pc.localDescription },
  });
}

async function signal(
  id: number,
  value: {
    type?: string;
    sdp?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
  },
) {
  const peer = peers.get(id);
  if (!peer) return;
  if (value.type === "answer" && value.sdp) {
    await peer.pc.setRemoteDescription(value.sdp);
    for (const candidate of peer.pending.splice(0))
      await peer.pc.addIceCandidate(candidate);
  } else if (value.type === "candidate" && value.candidate) {
    if (peer.pc.remoteDescription)
      await peer.pc.addIceCandidate(value.candidate);
    else peer.pending.push(value.candidate);
  }
}

async function changeView(id: number, view: ScreenView) {
  const peer = peers.get(id);
  if (!peer || peer.key === viewKey(view)) return;
  const previous = peer.key;
  const target = trackFor(view);
  peer.key = viewKey(view);
  // Same connection, new picture: no renegotiation.
  await peer.sender.replaceTrack(target.track);
  release(previous);
}

function disconnect() {
  generation++;
  clearTimeout(retry);
  const previous = socket;
  socket = undefined;
  previous?.close();
  for (const id of [...peers.keys()]) dropPeer(id);
  for (const key of [...tracks.keys()]) release(key);
  if (latest) retire(latest);
  latest = undefined;
  decode = packetDecoder();
}

function connect(url: string) {
  disconnect();
  const run = generation;
  const local = new URL(url);
  local.protocol = "ws:";
  local.hostname = "127.0.0.1";
  local.pathname = "/phone-encoder";
  const ws = new WebSocket(local);
  ws.binaryType = "arraybuffer";
  socket = ws;
  ws.onopen = () => send({ type: "rate", fps: frameRate });
  ws.onmessage = (event) => {
    if (run !== generation) return;
    if (typeof event.data !== "string") {
      const packet = event.data as ArrayBuffer;
      return void (packet.byteLength && frame(packet));
    }
    const message = JSON.parse(event.data);
    const id = Number(message.id);
    let step: Promise<void> | undefined;
    if (message.type === "join") step = join(id, message.view);
    else if (message.type === "signal") step = signal(id, message.signal);
    else if (message.type === "view") step = changeView(id, message.view);
    else if (message.type === "leave") dropPeer(id);
    // A phone that cannot negotiate simply keeps its JPEG picture.
    step?.catch(() => dropPeer(id));
  };
  ws.onclose = () => {
    if (run !== generation) return;
    for (const id of [...peers.keys()]) dropPeer(id);
    retry = setTimeout(() => void sync(), 2000);
  };
}

async function sync() {
  try {
    const status = await bridge.remotePlayStatus();
    if (status.running && status.url) {
      if (!socket || socket.readyState > WebSocket.OPEN) connect(status.url);
    } else disconnect();
  } catch {
    disconnect();
  }
}

/** The phone smoothness setting; the server paces frames to it. */
export function setPhoneFrameRate(fps: number) {
  frameRate = fps === 60 ? 60 : 30;
  send({ type: "rate", fps: frameRate });
}

/** Runs once in the desktop app; phones never encode. Without track
 * generators phones keep their JPEG picture. */
export function startPhoneVideoHost(): () => void {
  if (!isTauri || isRemote || !frameTracksSupported) return () => {};
  void sync();
  const unlisten = listen<boolean>("remote-play-changed", () => void sync());
  return () => {
    void unlisten.then((fn) => fn());
    disconnect();
  };
}
