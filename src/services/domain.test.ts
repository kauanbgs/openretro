import { describe, expect, it } from "vitest";
import { detectPlatforms } from "../db/platforms";
import { catalog } from "../providers/metadata/MockMetadataProvider";
import { GameResolver } from "./GameResolver";
import { DownloadManager } from "./DownloadManager";
import { EmulatorManager } from "./EmulatorManager";
import type { Emulator, LibraryItem } from "../types";
const item: LibraryItem = {
  id: "item",
  gameId: "astral",
  platformId: "gba",
  sourceProvider: "local",
  sourcePath: "C:\\games\\a game.gba",
  emulatorId: null,
  installed: true,
  favorite: false,
  addedAt: "2026-10-19",
  lastPlayedAt: null,
  playtime: 0,
  sha256: "a".repeat(64),
  biosPath: null,
  runtimeArgs: [],
};
const emulator: Emulator = {
  id: "mgba",
  name: "mGBA",
  executablePath: "C:\\emulators\\mGBA.exe",
  supportedPlatforms: ["gba"],
  defaultPlatforms: ["gba"],
};
describe("platform detection", () => {
  it("detects case-insensitive extensions", () =>
    expect(detectPlatforms("MY GAME.GBA")).toEqual(["gba"]));
  it("preserves ambiguity for user confirmation", () => {
    expect(detectPlatforms("disc.bin")).toEqual(["genesis", "psx"]);
    expect(detectPlatforms("game.pbp")).toEqual(["psx", "psp"]);
  });
  it("does not infer support from a name with an executable suffix", () =>
    expect(detectPlatforms("game.gba.bat")).toEqual([]));
});
describe("GameResolver", () => {
  const resolver = new GameResolver(async () => true);
  it("explains unsupported platforms", async () =>
    expect(
      (
        await resolver.resolve({ ...catalog[0], platformId: "unknown" }, item, [
          emulator,
        ])
      ).state,
    ).toBe("UNSUPPORTED"));
  it("requires an accessible local game", async () =>
    expect(
      (
        await new GameResolver(async () => false).resolve(catalog[0], item, [
          emulator,
        ])
      ).state,
    ).toBe("MISSING_GAME"));
  it("requires a compatible emulator", async () =>
    expect((await resolver.resolve(catalog[0], item, [])).state).toBe(
      "MISSING_EMULATOR",
    ));
  it("does not silently replace an explicitly selected incompatible emulator", async () =>
    expect(
      (
        await resolver.resolve(catalog[0], { ...item, emulatorId: "removed" }, [
          emulator,
        ])
      ).state,
    ).toBe("MISSING_EMULATOR"));
  it("detects a missing executable", async () =>
    expect(
      (
        await new GameResolver(async (p) => p === item.sourcePath).resolve(
          catalog[0],
          item,
          [emulator],
        )
      ).state,
    ).toBe("MISSING_EMULATOR"));
  it("preserves paths as individual arguments without shell quoting", async () => {
    const r = await resolver.resolve(
      catalog[0],
      { ...item, runtimeArgs: ["--fullscreen", "{game}"] },
      [emulator],
    );
    expect(r.state).toBe("READY");
    expect(r.args).toEqual(["--fullscreen", item.sourcePath]);
  });
  it("appends the game path when no placeholder is supplied", async () =>
    expect((await resolver.resolve(catalog[0], item, [emulator])).args).toEqual(
      [item.sourcePath],
    ));
  it("requires BIOS and explicit BIOS arguments for PlayStation", async () => {
    const game = catalog[2];
    const psx = { ...item, gameId: game.id, platformId: "psx" };
    const runtime = { ...emulator, supportedPlatforms: ["psx"] };
    expect((await resolver.resolve(game, psx, [runtime])).state).toBe(
      "MISSING_BIOS",
    );
    expect(
      (
        await resolver.resolve(game, { ...psx, biosPath: "bios.bin" }, [
          runtime,
        ])
      ).state,
    ).toBe("CONFIGURATION_REQUIRED");
    expect(
      (
        await resolver.resolve(
          game,
          { ...psx, biosPath: "bios.bin", runtimeArgs: ["--bios", "{bios}"] },
          [runtime],
        )
      ).state,
    ).toBe("READY");
  });
});
describe("emulator selection", () => {
  it("prefers the platform default", () => {
    const preferred = { ...emulator, id: "default" };
    expect(
      new EmulatorManager([
        { ...emulator, defaultPlatforms: [] },
        preferred,
      ]).resolve("gba", null)?.id,
    ).toBe("default");
  });
});
describe("download boundaries", () => {
  const manager = new DownloadManager();
  const request = {
    name: "fixture",
    url: "https://example.org/game",
    sha256: "a".repeat(64),
  };
  it("rejects insecure protocols and embedded credentials", () => {
    for (const url of [
      "http://example.org/game",
      "file:///tmp/game",
      "https://user:password@example.org/game",
    ])
      expect(() => manager.validate({ ...request, url })).toThrow();
  });
  it("requires a SHA-256 checksum", () =>
    expect(() => manager.validate({ ...request, sha256: "bad" })).toThrow());
  it("does not pretend to download without an authorized transport", async () =>
    expect(
      manager.enqueue(request, new AbortController().signal, () => {}),
    ).rejects.toThrow("No authorized download source"));
});
