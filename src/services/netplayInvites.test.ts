import { describe, expect, it } from "vitest";
import {
  checkInviteGame,
  createNetplayInvite,
  parseNetplayInvite,
  validNetplayHost,
} from "./netplayInvites";

const game = {
  address: "100.64.0.2",
  port: 55435,
  platformId: "snes",
  sha256: "ab".repeat(32),
  title: "Ação — edição japonesa 日本語",
};
function raw(value: unknown) {
  return (
    "OPENRETRO1." +
    btoa(JSON.stringify(value))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
  );
}

describe("portable VPN invitations", () => {
  it("round trips Unicode titles and custom ports without sharing passwords or paths", () => {
    const code = createNetplayInvite({
      ...game,
      port: 56001,
      password: "secret",
      sourcePath: "C:/games/game.sfc",
    } as typeof game);
    expect(parseNetplayInvite(`  ${code}\n`)).toEqual({ ...game, port: 56001 });
    expect(parseNetplayInvite(code)).not.toHaveProperty("password");
    expect(parseNetplayInvite(code)).not.toHaveProperty("sourcePath");
  });
  it("rejects different consoles, revisions and missing local fingerprints", () => {
    expect(() =>
      checkInviteGame(game, "snes", game.sha256.toUpperCase()),
    ).not.toThrow();
    for (const [platform, hash] of [
      ["nes", game.sha256],
      ["snes", "cd".repeat(32)],
      ["snes", ""],
    ]) {
      expect(() => checkInviteGame(game, platform, hash)).toThrow(
        "mesmo arquivo",
      );
    }
  });
  it("rejects corrupt, oversized and unsupported version codes", () => {
    for (const code of [
      "RETRO-123",
      "OPENRETRO2.abc",
      "OPENRETRO1.%%%",
      "OPENRETRO1." + "a".repeat(4096),
      raw(null),
      raw({}),
    ]) {
      expect(() => parseNetplayInvite(code)).toThrow();
    }
  });
  it("validates untrusted connection details and supported consoles", () => {
    const ascii = { ...game, title: "Test" };
    expect(parseNetplayInvite(raw(ascii))).toEqual(ascii);
    for (const patch of [
      { address: "--host" },
      { address: "100.64.0.2:55435" },
      { address: "https://example.com" },
      { port: 80 },
      { port: 65536 },
      { port: 55435.5 },
      { port: "55435" },
      { platformId: "ps3" },
      { sha256: "" },
      { title: "" },
      { title: "a".repeat(257) },
    ])
      expect(() => parseNetplayInvite(raw({ ...ascii, ...patch }))).toThrow();
  });
  it("accepts VPN IPv4, hostnames and bare IPv6 but rejects URL and argument syntax", () => {
    for (const host of [
      "100.64.0.2",
      "26.1.2.3",
      "pc.tailnet.ts.net",
      "fd7a:115c:a1e0::1",
    ])
      expect(validNetplayHost(host)).toBe(true);
    for (const host of [
      "",
      "-L",
      "host name",
      "host/path",
      "host:55435",
      "1.2.3.4:55435",
      "[::1]",
      "host;cmd",
    ])
      expect(validNetplayHost(host)).toBe(false);
  });
});

describe("invitations for translations and hacks", () => {
  const modded = {
    ...game,
    sha256: "cd".repeat(32),
    variant: "Tradução PT-BR 1.3",
  };
  it("carries the version name and requires the modified file's hash", () => {
    const invite = parseNetplayInvite(createNetplayInvite(modded));
    expect(invite.variant).toBe("Tradução PT-BR 1.3");
    expect(() => checkInviteGame(invite, "snes", modded.sha256)).not.toThrow();
    // The original file is a different version for the session.
    expect(() => checkInviteGame(invite, "snes", game.sha256)).toThrow(
      /Tradução PT-BR 1.3/,
    );
  });
  it("tells an original-game invite apart from a modified local copy", () => {
    const invite = parseNetplayInvite(createNetplayInvite(game));
    expect(invite).not.toHaveProperty("variant");
    expect(() => checkInviteGame(invite, "snes", modded.sha256)).toThrow(
      /jogo original/,
    );
  });
  it("rejects oversized version names", () => {
    expect(() =>
      createNetplayInvite({ ...modded, variant: "x".repeat(121) }),
    ).toThrow();
  });
});
