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
