import { describe, expect, it } from "vitest";
import { coreForTizenPlatform, tizenPlatforms } from "./runtime";

describe("Tizen runtime core selection", () => {
  it("maps every advertised TV platform to a pinned lightweight core", () => {
    expect(
      tizenPlatforms.every((platform) => coreForTizenPlatform(platform)),
    ).toBe(true);
    expect(coreForTizenPlatform("gb")).toBe("gambatte");
    expect(coreForTizenPlatform("genesis")).toBe("genesis_plus_gx");
  });

  it("does not advertise heavy unsupported TV systems", () => {
    expect(coreForTizenPlatform("ps2")).toBeUndefined();
    expect(coreForTizenPlatform("n64")).toBeUndefined();
  });
});
