import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PartyGuest, validGuestMessage, type GuestState } from "./partyGuest";
import {
  acquirePartyInput,
  neutralPad,
  PartyPadSender,
  PartyExitGesture,
  partyKeys,
  readPartyPad,
} from "./partyInput";
import { ControllerInput } from "../big-picture/controllerInput";

class Socket {
  static OPEN = 1;
  static last: Socket;
  readyState = 1;
  sent: string[] = [];
  onopen = () => {};
  onclose = () => {};
  onerror = () => {};
  onmessage = (_: { data: string }) => {};
  constructor() {
    Socket.last = this;
  }
  send(value: string) {
    this.sent.push(value);
  }
  close = vi.fn();
  message(value: unknown) {
    this.onmessage({ data: JSON.stringify(value) });
  }
}
class Peer {
  static last: Peer;
  connectionState = "new";
  remoteDescription: unknown;
  localDescription = { type: "answer", sdp: "answer" };
  onconnectionstatechange = () => {};
  ondatachannel = (_: { channel: RTCDataChannel }) => {};
  ontrack = (_: unknown) => {};
  onicecandidate = () => {};
  constructor(public config: unknown) {
    Peer.last = this;
  }
  close = vi.fn();
  setRemoteDescription = vi.fn(async (value) => {
    this.remoteDescription = value;
  });
  setLocalDescription = vi.fn(async () => {});
  createAnswer = vi.fn(async () => this.localDescription);
  addIceCandidate = vi.fn(async () => {});
  connect() {
    this.connectionState = "connected";
    this.onconnectionstatechange();
  }
}
const accepted = {
  type: "accepted",
  player: 3,
  iceServers: [{ urls: "stun:localhost" }],
  policy: "all",
};
const flush = async () => {
  await vi.advanceTimersByTimeAsync(0);
};
function setup() {
  const states: GuestState[] = [];
  const media = vi.fn();
  const guest = new PartyGuest((state) => states.push(state), media);
  const room = {
    code: "ABC234",
    invite: "ticket",
    signal: "wss://party.test/signal?room=ABC234",
  };
  guest.start(room);
  Socket.last.onopen();
  return { guest, states, media, room, socket: Socket.last };
}
const channel = () =>
  ({
    label: "pad",
    readyState: "open",
    bufferedAmount: 0,
    send: vi.fn(),
    close: vi.fn(),
  }) as unknown as RTCDataChannel;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("RTCPeerConnection", Peer);
  vi.stubGlobal(
    "MediaStream",
    class {
      addTrack = vi.fn();
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Party guest lifecycle", () => {
  it("joins once, negotiates queued candidates, connects, and closes with neutral input", async () => {
    const { guest, socket, states, room, media } = setup();
    expect(JSON.parse(socket.sent[0])).toEqual({
      type: "join",
      room: "ABC234",
      invite: "ticket",
    });
    expect(room.invite).toBe("");
    socket.message({ type: "waiting" });
    socket.message(accepted);
    socket.message({
      type: "signal",
      signal: { type: "candidate", candidate: { candidate: "candidate:1" } },
    });
    socket.message({
      type: "signal",
      signal: { type: "offer", sdp: { type: "offer", sdp: "offer" } },
    });
    await flush();
    expect(Peer.last.config).toEqual({
      iceServers: accepted.iceServers,
      iceTransportPolicy: "all",
    });
    expect(Peer.last.addIceCandidate).toHaveBeenCalledOnce();
    expect(socket.sent.map((s) => JSON.parse(s).signal?.type)).toContain(
      "answer",
    );
    const pad = channel();
    Peer.last.ondatachannel({ channel: pad });
    Peer.last.connect();
    guest.setInput({ buttons: 256, axes: [0, 0, 0, 0] });
    guest.leave();
    expect(states.map((s) => s.phase)).toEqual([
      "joining",
      "waiting",
      "accepted",
      "connected",
      "left",
    ]);
    expect(
      JSON.parse(vi.mocked(pad.send).mock.calls.at(-1)![0] as unknown as string)
        .buttons,
    ).toBe(0);
    expect(Peer.last.close).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledOnce();
    expect(media).toHaveBeenLastCalledWith(null);
    await vi.advanceTimersByTimeAsync(90000);
    expect(states.at(-1)?.phase).toBe("left");
  });
  it.each(["error", "ended"])(
    "preserves the server's %s message",
    async (type) => {
      const { guest, socket } = setup();
      socket.message({ type, message: "Mensagem original do anfitrião" });
      await flush();
      expect(guest.state).toMatchObject({
        phase: type,
        message: "Mensagem original do anfitrião",
        connectedOnce: false,
      });
    },
  );
  it("neutralizes during disconnection, recovers, and terminates a persistent failure", async () => {
    const { guest, socket } = setup();
    socket.message(accepted);
    await flush();
    const pad = channel();
    Peer.last.ondatachannel({ channel: pad });
    Peer.last.connect();
    guest.setInput({ buttons: 1, axes: [1, 0, 0, 0] });
    Peer.last.connectionState = "disconnected";
    Peer.last.onconnectionstatechange();
    expect(guest.state.phase).toBe("disconnected");
    expect(
      JSON.parse(vi.mocked(pad.send).mock.calls.at(-1)![0] as unknown as string)
        .buttons,
    ).toBe(0);
    Peer.last.connect();
    await vi.advanceTimersByTimeAsync(10001);
    expect(guest.state.phase).toBe("connected");
    Peer.last.connectionState = "disconnected";
    Peer.last.onconnectionstatechange();
    await vi.advanceTimersByTimeAsync(10001);
    expect(guest.state).toMatchObject({ phase: "error", connectedOnce: true });
  });
  it("handles socket loss and a missing WebRTC implementation", () => {
    const { guest, socket } = setup();
    socket.onclose();
    expect(guest.state.phase).toBe("error");
    vi.stubGlobal("RTCPeerConnection", undefined);
    const other = setup().guest;
    expect(other.state).toMatchObject({ phase: "error", connectedOnce: false });
  });
  it("bounds setup and heartbeat timeouts", async () => {
    const { guest } = setup();
    await vi.advanceTimersByTimeAsync(20000);
    expect(guest.state.phase).toBe("error");
    const next = setup();
    next.socket.message(accepted);
    await flush();
    Peer.last.connect();
    await vi.advanceTimersByTimeAsync(80000);
    expect(next.socket.sent).toContain("ping");
    expect(next.guest.state.phase).toBe("error");
  });
  it("sets a short jitter target and rejects unrelated data channels", async () => {
    const { socket, media, guest } = setup();
    socket.message(accepted);
    await flush();
    for (const kind of ["audio", "video"]) {
      const receiver = { jitterBufferTarget: 200, track: { kind } };
      Peer.last.ontrack({ receiver, track: { kind } });
      expect(receiver.jitterBufferTarget).toBe(kind === "video" ? 20 : 40);
    }
    expect(media).toHaveBeenCalledTimes(2);
    const other = { ...channel(), label: "other" } as RTCDataChannel;
    Peer.last.ondatachannel({ channel: other });
    expect(other.close).toHaveBeenCalledOnce();
    guest.leave();
  });
  it("rejects malformed network input and duplicate acceptance", async () => {
    for (const value of [
      null,
      { type: "accepted", ...{ player: 1, iceServers: [], policy: "all" } },
      { ...accepted, iceServers: [{ urls: "https://evil.test" }] },
      { type: "ended", message: {} },
      {
        type: "signal",
        signal: {
          type: "candidate",
          candidate: { candidate: "x", sdpMLineIndex: -1 },
        },
      },
    ])
      expect(validGuestMessage(value)).toBe(false);
    const { guest, socket } = setup();
    socket.message(accepted);
    socket.message(accepted);
    await flush();
    expect(guest.state.phase).toBe("error");
  });
});

describe("Party input ownership and transmission", () => {
  it("opens the exit menu after a continuous second, only once until release", () => {
    const gesture = new PartyExitGesture();
    expect(gesture.sample(true, 0)).toBe(false);
    expect(gesture.sample(true, 999)).toBe(false);
    expect(gesture.sample(true, 1000)).toBe(true);
    expect(gesture.sample(true, 2000)).toBe(false);
    expect(gesture.latched).toBe(true);
    gesture.sample(false, 2100);
    expect(gesture.latched).toBe(false);
    gesture.sample(true, 2200);
    gesture.sample(false, 2800);
    expect(gesture.sample(true, 3200)).toBe(false);
    expect(gesture.sample(true, 4200)).toBe(true);
  });
  it("matches the web guest keyboard and standard controller mapping", () => {
    expect(readPartyPad([partyKeys.KeyZ, partyKeys.Enter]).buttons).toBe(
      (1 << 0) | (1 << 3),
    );
    const mapping = [0, 8, 1, 9, 10, 11, 12, 13, 2, 3, 14, 15, 4, 5, 6, 7];
    mapping.forEach((bit, i) => {
      expect(
        readPartyPad([], {
          mapping: "standard",
          buttons: mapping.map(
            (_, n) => ({ pressed: n === i }) as GamepadButton,
          ),
          axes: [2, -2, NaN, 0.5],
        }),
      ).toEqual({ buttons: 1 << bit, axes: [32767, -32767, 0, 16384] });
    });
    expect(readPartyPad([0], null, false)).toEqual(neutralPad());
  });
  it("sends changes immediately and repeats held state at 33 ms", async () => {
    const { socket, guest } = setup();
    socket.message(accepted);
    await flush();
    const pad = channel();
    Peer.last.ondatachannel({ channel: pad });
    Peer.last.connect();
    guest.setInput(neutralPad());
    guest.setInput({ buttons: 1, axes: [0, 0, 0, 0] });
    expect(pad.send).toHaveBeenCalledTimes(2);
    guest.setInput({ buttons: 1, axes: [0, 0, 0, 0] });
    expect(pad.send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(32);
    expect(pad.send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(pad.send).toHaveBeenCalledTimes(3);
    guest.leave();
  });
  it("bounds channel backpressure", () => {
    const pad = channel();
    const sender = new PartyPadSender(pad);
    Object.defineProperty(pad, "bufferedAmount", { value: 5000 });
    sender.send(neutralPad(), true);
    expect(pad.send).not.toHaveBeenCalled();
  });
  it("consumes navigation buttons for the whole guest screen and does not replay held B on exit", () => {
    const input = new ControllerInput();
    const pad = {
      id: "test",
      mapping: "standard" as GamepadMappingType,
      axes: [0, 0],
      buttons: Array.from(
        { length: 16 },
        (_, i) => ({ pressed: i === 1 }) as GamepadButton,
      ),
    };
    const release = acquirePartyInput();
    expect(input.sample(pad, 0)).toEqual([]);
    expect(input.sample(pad, 500)).toEqual([]);
    release();
    expect(input.sample(pad, 600)).toEqual([]);
    input.sample(null, 700);
    expect(input.sample(pad, 800)).toEqual(["b"]);
  });

  describe("Party live extras", () => {
    const speakers = JSON.stringify({
      type: "voice",
      speaking: [{ player: 1, name: "Anfitrião" }],
    });
    it("follows a seat change, shows reactions and who is talking", async () => {
      const { guest, socket } = setup();
      socket.message({ ...accepted, live: true });
      await flush();
      expect(guest.state.live).toBe(true);
      socket.message({ type: "seat", player: 2 });
      await flush();
      expect(guest.state.player).toBe(2);
      socket.message({
        type: "reaction",
        id: "r1",
        reaction: "fire",
        name: "Ana",
        player: 3,
      });
      await flush();
      expect(guest.state.reactions?.map((r) => r.emoji)).toEqual(["🔥"]);
      socket.message({
        type: "reaction",
        id: "r2",
        reaction: "x",
        name: "A",
        player: 3,
      });
      await flush();
      expect(guest.state.phase).toBe("error");
    });
    it("reads the host's list from the game channel and ignores junk", async () => {
      const { guest, socket } = setup();
      socket.message({ ...accepted, live: true });
      await flush();
      const pad = channel() as unknown as { onmessage: (e: unknown) => void };
      Peer.last.ondatachannel({ channel: pad as unknown as RTCDataChannel });
      pad.onmessage({ data: speakers });
      expect(guest.state.speakers).toEqual([{ player: 1, name: "Anfitrião" }]);
      pad.onmessage({ data: "{" });
      pad.onmessage({ data: new ArrayBuffer(4) });
      expect(guest.state.speakers).toHaveLength(1);
      pad.onmessage({ data: JSON.stringify({ type: "voice", speaking: [] }) });
      expect(guest.state.speakers).toEqual([]);
    });
    it("sends a reaction only when the room relays them", async () => {
      const { guest, socket } = setup();
      socket.message(accepted);
      await flush();
      guest.sendReaction("clap");
      expect(socket.sent.some((m) => m.includes("reaction"))).toBe(false);
    });
    it("keeps the same reaction ids in the app, the server and the browser page", async () => {
      const { readFileSync } = await import("node:fs");
      const { PARTY_REACTIONS } = await import("./partyLive");
      const ids = PARTY_REACTIONS.map((r) => r.id);
      const server = readFileSync("party-server/cloudflare/worker.mjs", "utf8");
      const page = readFileSync("party-server/public/guest.js", "utf8");
      for (const id of ids) {
        expect(server).toContain(`"${id}"`);
        expect(page).toMatch(new RegExp(`${id}: "`));
      }
      expect(server).toContain(
        `new Set([${ids.map((i) => `"${i}"`).join(", ")}])`,
      );
    });
  });
});
