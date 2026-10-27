import { describe, expect, it } from "vitest";
import {
  detectSource,
  isPressed,
  pickPad,
  snapshot,
  toStandard,
  type PadMapping,
} from "./partyPadMapping";
import { readPartyPad } from "./partyInput";

const HAT_REST = 1.2857;
const HAT_UP = -1;
const HAT_DOWN = 0.1429;

function pad(
  pressed: number[] = [],
  axes: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, HAT_REST],
  id = "PLAYSTATION(R)3 Controller (Vendor: 054c Product: 0268)",
  mapping: GamepadMappingType = "",
) {
  return {
    id,
    mapping,
    axes,
    buttons: Array.from({ length: 13 }, (_, i) => ({
      pressed: pressed.includes(i),
      touched: pressed.includes(i),
      value: pressed.includes(i) ? 1 : 0,
    })),
  };
}

describe("controller mapping", () => {
  it("detects buttons, stick ends and hat positions against the pad at rest", () => {
    const rest = snapshot(pad());
    expect(detectSource(rest, pad([2]))).toEqual({ button: 2 });
    const stick = pad([], [0.98, 0, 0, 0, 0, 0, 0, 0, 0, HAT_REST]);
    expect(detectSource(rest, stick)).toEqual({ axis: 0, value: 0.98 });
    const hat = pad([], [0, 0, 0, 0, 0, 0, 0, 0, 0, HAT_DOWN]);
    expect(detectSource(rest, hat)).toEqual({ axis: 9, value: HAT_DOWN });
    // Small drift is not a press.
    expect(
      detectSource(rest, pad([], [0.2, 0, 0, 0, 0, 0, 0, 0, 0, HAT_REST])),
    ).toBeNull();
  });

  it("tells hat directions apart and reads stick ends past halfway", () => {
    const up = { axis: 9, value: HAT_UP };
    const down = { axis: 9, value: HAT_DOWN };
    const atDown = pad([], [0, 0, 0, 0, 0, 0, 0, 0, 0, HAT_DOWN]);
    expect(isPressed(atDown, down)).toBe(true);
    expect(isPressed(atDown, up)).toBe(false);
    const right = { axis: 0, value: 0.99 };
    expect(isPressed(pad([], [0.6, 0, 0, 0]), right)).toBe(true);
    expect(isPressed(pad([], [-0.6, 0, 0, 0]), right)).toBe(false);
  });

  it("presents a mapped pad as standard, so the game input reads it unchanged", () => {
    const mapping: PadMapping = {
      buttons: [{ button: 2 }, { button: 1 }],
      sticks: [
        { axis: 0, invert: false },
        { axis: 1, invert: true },
        null,
        null,
      ],
    };
    mapping.buttons[12] = { axis: 9, value: HAT_UP };
    const raw = pad([2], [0.5, 0.25, 0, 0, 0, 0, 0, 0, 0, HAT_UP]);
    const standard = toStandard(raw, mapping);
    expect(standard.mapping).toBe("standard");
    expect(standard.buttons[0].pressed).toBe(true);
    expect(standard.buttons[1].pressed).toBe(false);
    expect(standard.buttons[12].pressed).toBe(true);
    expect(standard.axes).toEqual([0.5, -0.25, 0, 0]);
    // Standard 0 (bottom: A on Xbox, ✕ on PlayStation) is RetroPad B, as on
    // the phone and the PC; 12 is up.
    const state = readPartyPad([], standard);
    expect(state.buttons & (1 << 0)).toBeTruthy();
    expect(state.buttons & (1 << 4)).toBeTruthy();
  });

  it("prefers a standard pad, then a mapped one, and names one still unmapped", () => {
    const ps3 = pad();
    const xbox = pad([], [0, 0, 0, 0], "Xbox Controller", "standard");
    expect(pickPad([ps3, xbox], () => null).pad).toBe(xbox);
    expect(pickPad([ps3], () => null)).toEqual({ pad: null, unmapped: ps3 });
    const mapped = pickPad([ps3], () => ({ buttons: [], sticks: [] }));
    expect(mapped.unmapped).toBeNull();
    expect(mapped.pad?.mapping).toBe("standard");
  });
});
