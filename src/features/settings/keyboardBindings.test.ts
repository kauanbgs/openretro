import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYOUT,
  KEY_ACTIONS,
  assignKey,
  keyFromCode,
  keyLabel,
  reservedReason,
  resolveLayout,
} from "./keyboardBindings";

describe("keyboard layout", () => {
  it("starts with one key per action and none of them reserved", () => {
    const keys = Object.values(DEFAULT_LAYOUT);
    expect(keys).toHaveLength(KEY_ACTIONS.length);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(reservedReason(key)).toBeUndefined();
  });

  it("reads physical keys with RetroArch's names", () => {
    expect(keyFromCode("KeyQ")).toBe("q");
    expect(keyFromCode("Digit7")).toBe("num7");
    expect(keyFromCode("Numpad4")).toBe("keypad4");
    expect(keyFromCode("ShiftRight")).toBe("rshift");
    expect(keyFromCode("Delete")).toBe("del");
    expect(keyFromCode("F2")).toBe("f2");
    expect(keyFromCode("MetaLeft")).toBeUndefined();
  });

  it("keeps OpenRetro's menu and the runtime's hotkeys away from the game", () => {
    for (const key of ["f1", "f2", "f8", "escape", "scroll_lock", "add"])
      expect(reservedReason(key)).toBeDefined();
    expect(reservedReason("space")).toBeUndefined();
  });

  it("stores only the changes and swaps a key another action had", () => {
    expect(assignKey(undefined, "a", "u")).toEqual({ a: "u" });
    // B had Z: A takes it and B gets A's old X.
    const swapped = assignKey(undefined, "a", "z");
    expect(swapped).toEqual({ a: "z", b: "x" });
    expect(resolveLayout(swapped).b).toBe("x");
    // Putting the defaults back leaves nothing to store.
    expect(assignKey(swapped, "a", "x")).toEqual({});
  });

  it("falls back to the defaults when a saved layout is broken", () => {
    expect(resolveLayout({ a: "f2" })).toEqual(DEFAULT_LAYOUT);
    expect(resolveLayout({ a: "nonsense" })).toEqual(DEFAULT_LAYOUT);
    expect(resolveLayout({ a: "z" })).toEqual(DEFAULT_LAYOUT);
    expect(resolveLayout(null)).toEqual(DEFAULT_LAYOUT);
  });

  it("prints keys the way the keyboard shows them", () => {
    expect(keyLabel("up")).toBe("↑");
    expect(keyLabel("q")).toBe("Q");
    expect(keyLabel("num3")).toBe("3");
  });
});
