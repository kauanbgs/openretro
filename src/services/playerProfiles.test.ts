import { afterEach, expect, it, vi } from "vitest";
import { bridge } from "./bridge";

afterEach(() => vi.unstubAllGlobals());

it("keeps preview progress independent when switching players and returning", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  values.set(
    "openretro-preview-v1",
    JSON.stringify({
      library: [
        {
          game: { title: "Demo" },
          item: {
            id: "demo",
            favorite: true,
            playtime: 120,
            lastPlayedAt: "2026-10-21",
          },
        },
      ],
      emulators: [],
      settings: {},
    }),
  );
  await bridge.createProfile("Jogador 2");
  const profiles = await bridge.profiles();
  const second = profiles.players[1].id;
  expect(profiles.activeId).toBe("default");
  await bridge.selectProfile(second);
  expect((await bridge.library())[0].item).toMatchObject({
    favorite: false,
    playtime: 0,
    lastPlayedAt: null,
  });
  await bridge.favorite("demo", true);
  await bridge.selectProfile("default");
  expect((await bridge.library())[0].item).toMatchObject({
    favorite: true,
    playtime: 120,
    lastPlayedAt: "2026-10-21",
  });
  await bridge.selectProfile(second);
  expect((await bridge.library())[0].item).toMatchObject({
    favorite: true,
    playtime: 0,
  });
  await expect(bridge.selectProfile("missing")).rejects.toThrow(
    "Jogador não encontrado",
  );
  expect((await bridge.profiles()).activeId).toBe(second);
});

it("customizes a preview player's name, avatar and color", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  // Profiles stored before avatars existed still load with defaults.
  expect((await bridge.profiles()).players[0]).toMatchObject({
    avatar: "gamepad",
  });
  await bridge.createProfile("Jogador 2");
  const second = (await bridge.profiles()).players[1];
  expect(second.color).not.toBe((await bridge.profiles()).players[0].color);
  await bridge.updateProfile(second.id, " Ana ", "ghost", "#a78bfa");
  expect((await bridge.profiles()).players[1]).toMatchObject({
    name: "Ana",
    avatar: "ghost",
    color: "#a78bfa",
  });
  await expect(
    bridge.updateProfile("missing", "X", "ghost", "#a78bfa"),
  ).rejects.toThrow("Jogador não encontrado");
});
