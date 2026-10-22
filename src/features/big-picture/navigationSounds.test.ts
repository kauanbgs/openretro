import { describe, expect, it } from "vitest";
import { soundFor } from "./navigationSounds";

describe("navigation sounds", () => {
  it("maps console inputs to cues", () => {
    expect(soundFor("left")).toBe("move");
    expect(soundFor("rb")).toBe("move");
    expect(soundFor("a")).toBe("select");
    expect(soundFor("b")).toBe("back");
    expect(soundFor("search")).toBeUndefined();
  });
});
