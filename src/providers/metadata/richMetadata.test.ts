import { expect, it } from "vitest";
import { mapIgdbGame, mapIgdbPlatform } from "./IgdbMetadataProvider";

const platforms = [{ id: 19, name: "Super Nintendo Entertainment System" }]
  .map(mapIgdbPlatform)
  .filter((p): p is NonNullable<typeof p> => Boolean(p));

it("maps detail-page metadata and drops unsafe or unsupported entries", () => {
  const game = mapIgdbGame(
    {
      id: 1,
      name: "Game",
      summary: "Summary",
      storyline: "Story",
      platforms: [{ id: 19, name: "SNES" }],
      total_rating: 86.6,
      total_rating_count: 40,
      involved_companies: [
        { developer: true, company: { name: "Dev" } },
        { publisher: true, company: { name: "Pub" } },
      ],
      videos: [
        { video_id: "dQw4w9WgXcQ", name: "Launch trailer" },
        { video_id: "bad/../id", name: "Unsafe" },
      ],
      game_modes: [{ name: "Single player" }, { name: "Co-operative" }],
      franchises: [{ name: "Series" }],
      similar_games: [
        { id: 2, name: "Similar", platforms: [{ id: 19, name: "SNES" }] },
        { id: 3, name: "Modern only", platforms: [{ id: 48, name: "PS4" }] },
      ],
    },
    platforms,
  )!;
  expect(game.rating).toBe(87);
  expect(game.publisher).toBe("Pub");
  expect(game.developer).toBe("Dev");
  expect(game.storyline).toBe("Story");
  expect(game.trailers).toEqual([
    { id: "dQw4w9WgXcQ", name: "Launch trailer" },
  ]);
  expect(game.gameModes).toEqual(["Single player", "Co-operative"]);
  expect(game.franchise).toBe("Series");
  expect(game.similar?.map((g) => g.title)).toEqual(["Similar"]);
});
