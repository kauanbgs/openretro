import { describe, expect, it, vi } from "vitest";
import { enrichGameMetadata } from "../../utils/metadata";
import {
  IgdbMetadataProvider,
  igdbImage,
  mapIgdbGame,
  mapIgdbPlatform,
  type CatalogTransport,
} from "./IgdbMetadataProvider";
import type { CatalogReply } from "./types";
const systems = [
  { id: 18, name: "Nintendo Entertainment System", slug: "nes" },
  { id: 19, name: "Super Nintendo Entertainment System", slug: "snes" },
];
const platforms = systems
  .map(mapIgdbPlatform)
  .filter((p): p is NonNullable<typeof p> => Boolean(p));
const raw = {
  id: 123,
  name: "Test title",
  slug: "test-title",
  first_release_date: Date.UTC(1995, 2, 11) / 1000,
  platforms: systems,
  genres: [{ id: 12, name: "Role-playing (RPG)" }],
  cover: { image_id: "co_123" },
  artworks: [{ image_id: "ar_1" }],
  screenshots: [{ image_id: "sc_1" }],
  involved_companies: [
    { developer: true, company: { name: "Developer" } },
    { developer: false, company: { name: "Publisher" } },
  ],
};
const reply = (data: Record<string, unknown>): CatalogReply => ({
  data,
  hasNext: false,
  page: 1,
  remainingAllowance: null,
});
describe("IGDB data adapter", () => {
  it("keeps local library identity while enriching catalog metadata", () => {
    const remote = mapIgdbGame(raw, platforms)!;
    const local = { ...remote, id: "local-import-uuid", platformId: "snes" };
    const enriched = enrichGameMetadata(local, remote);
    expect(enriched.id).toBe(local.id);
    expect(enriched.platformId).toBe("snes");
    expect(enriched.externalId).toBe(remote.externalId);
  });
  it("maps legacy systems without treating modern consoles as compatible", () => {
    expect(mapIgdbPlatform(systems[0])?.localId).toBe("nes");
    expect(
      mapIgdbPlatform({ id: 29, name: "Sega Mega Drive/Genesis" })?.localId,
    ).toBe("genesis");
    expect(
      mapIgdbPlatform({
        id: 64,
        name: "Sega Master System/Mark III",
        slug: "sms",
      })?.localId,
    ).toBe("sms");
    expect(mapIgdbPlatform({ id: 48, name: "PlayStation 4" })).toBeUndefined();
  });
  it("uses the chosen console for games released on several systems", () => {
    const game = mapIgdbGame(raw, platforms, "snes")!;
    expect(game.platformId).toBe("snes");
    expect(game.platformIds).toEqual(["nes", "snes"]);
    expect(game.year).toBe(1995);
    expect(game.developer).toBe("Developer");
    expect(game.genreIds).toEqual([12]);
    expect(game.coverUrl).toBe(
      "https://images.igdb.com/igdb/image/upload/t_cover_big/co_123.jpg",
    );
    expect(game.sourceUrl).toBe("https://www.igdb.com/games/test-title");
  });
  it("does not fabricate a release year or artwork", () => {
    const game = mapIgdbGame(
      { id: 99, name: "Unknown", platforms: systems },
      platforms,
    )!;
    expect(game.year).toBe(0);
    expect(game.coverUrl).toBeUndefined();
    expect(game.artwork).toBe("neutral");
  });
  it("rejects image identifiers that can escape the official CDN path", () => {
    for (const id of [
      "../secret",
      "https://evil.example/x",
      "x?token=secret",
      "x/y",
    ])
      expect(igdbImage(id)).toBeUndefined();
  });
  it("ignores unsupported games", () =>
    expect(
      mapIgdbGame(
        { ...raw, platforms: [{ id: 48, name: "PlayStation 4" }] },
        platforms,
      ),
    ).toBeUndefined());
  it("loads taxonomy once and forwards remote genre/sort/page filters", async () => {
    const transport = vi.fn<CatalogTransport>(async (r) =>
      r.kind === "platforms"
        ? reply({ platforms: systems })
        : r.kind === "genres"
          ? reply({ genres: raw.genres })
          : reply({ games: [raw] }),
    );
    const provider = new IgdbMetadataProvider(transport);
    const result = await provider.browse("test", "snes", 2, 12, "rating");
    expect(result.games[0].platformId).toBe("snes");
    expect(transport).toHaveBeenCalledWith({
      kind: "games",
      query: "test",
      ids: [19],
      page: 2,
      genreId: 12,
      sort: "rating",
    });
    await provider.getTaxonomy();
    expect(transport).toHaveBeenCalledTimes(3);
  });
  it("retries taxonomy after a connection failure instead of caching a rejected promise", async () => {
    let failed = true;
    const transport: CatalogTransport = async (r) => {
      if (failed) {
        failed = false;
        throw new Error("offline");
      }
      return r.kind === "platforms"
        ? reply({ platforms: systems })
        : reply({ genres: raw.genres });
    };
    const provider = new IgdbMetadataProvider(transport);
    await expect(provider.getTaxonomy()).rejects.toThrow();
    expect((await provider.getTaxonomy()).platforms).toHaveLength(2);
  });
  it("retains the local platform when fetching detail", async () => {
    const transport: CatalogTransport = async (r) =>
      r.kind === "platforms"
        ? reply({ platforms: systems })
        : r.kind === "genres"
          ? reply({ genres: raw.genres })
          : reply({ games: [raw] });
    const provider = new IgdbMetadataProvider(transport);
    expect((await provider.getGame("igdb-123", "snes")).platformId).toBe(
      "snes",
    );
    await expect(provider.getGame("not-an-id")).rejects.toThrow();
  });
});
