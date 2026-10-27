// A lease keeps launcher shortcuts disabled through connection errors and menus.
let owner = false;
export const partyOwnsInput = () => owner;
export function acquirePartyInput() {
  owner = true;
  return () => {
    owner = false;
  };
}
export const partyKeys: Record<string, number> = {
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
export type PadState = { buttons: number; axes: number[] };
export const neutralPad = (): PadState => ({ buttons: 0, axes: [0, 0, 0, 0] });
export class PartyExitGesture {
  private started?: number;
  latched = false;
  sample(pressed: boolean, now: number) {
    if (!pressed) {
      this.started = undefined;
      this.latched = false;
      return false;
    }
    this.started ??= now;
    if (!this.latched && now - this.started >= 1000) {
      this.latched = true;
      return true;
    }
    return false;
  }
}
export function readPartyPad(
  held: Iterable<number>,
  pad?: Pick<Gamepad, "buttons" | "axes" | "mapping"> | null,
  active = true,
): PadState {
  if (!active) return neutralPad();
  const state = neutralPad();
  for (const bit of held) state.buttons |= 1 << bit;
  if (pad?.mapping === "standard") {
    // By position, like the web guest and the phone: the bottom button (✕ on
    // PlayStation) is RetroPad B, which PS3 games see as ✕.
    [0, 8, 1, 9, 10, 11, 12, 13, 2, 3, 14, 15, 4, 5, 6, 7].forEach(
      (bit, index) => {
        if (pad.buttons[index]?.pressed) state.buttons |= 1 << bit;
      },
    );
    state.axes = state.axes.map((_, i) =>
      Math.round(
        Math.max(
          -1,
          Math.min(1, Number.isFinite(pad.axes[i]) ? pad.axes[i] : 0),
        ) * 32767,
      ),
    );
  }
  return state;
}

export class PartyPadSender {
  private seq = 0;
  private last = "";
  constructor(private channel: RTCDataChannel) {}
  send(state: PadState, repeat = false) {
    const value = JSON.stringify(state);
    if (
      this.channel.readyState !== "open" ||
      this.channel.bufferedAmount > 4096 ||
      (!repeat && value === this.last)
    )
      return;
    this.channel.send(JSON.stringify({ seq: this.seq++, ...state }));
    this.last = value;
  }
}
