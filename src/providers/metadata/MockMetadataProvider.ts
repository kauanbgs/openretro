import type { GameMetadata } from "../../types";
export type GameSearchResult = GameMetadata;
export interface MetadataProvider {
  search(query: string): Promise<GameSearchResult[]>;
  getGame(id: string): Promise<GameMetadata>;
}
export const catalog: GameMetadata[] = [
  {
    id: "astral",
    title: "Astral Horizon",
    platformId: "gba",
    year: 2004,
    developer: "OpenRetro Studio",
    genre: "Adventure",
    artwork: "astral",
    color: "#c0a3f5",
    description:
      "A quiet signal. An unfamiliar world. Follow a young explorer beyond the last familiar star in this fictional space adventure. This is development metadata; no game file is included.",
  },
  {
    id: "verdant",
    title: "The Verdant Quest",
    platformId: "snes",
    year: 1995,
    developer: "OpenRetro Studio",
    genre: "Action RPG",
    artwork: "verdant",
    color: "#b4d18a",
    description:
      "Find your way through ancient forests, forgotten temples, and a kingdom slowly waking from a hundred-year sleep. An original fictional catalog entry for the OpenRetro preview.",
  },
  {
    id: "velocity",
    title: "Velocity 98",
    platformId: "psx",
    year: 1998,
    developer: "OpenRetro Studio",
    genre: "Racing",
    artwork: "velocity",
    color: "#f2a171",
    description:
      "Neon streets and late-night time trials. A fictional racing game used to demonstrate your personal library. Supply your own authorized game file to play.",
  },
  {
    id: "moonfall",
    title: "Moonfall",
    platformId: "nes",
    year: 1989,
    developer: "OpenRetro Studio",
    genre: "Platformer",
    artwork: "moonfall",
    color: "#91b8e7",
    description:
      "A tiny traveler crosses a moonlit kingdom, one impossible jump at a time. Fictional development metadata with original artwork.",
  },
  {
    id: "pocket",
    title: "Pocket Odyssey",
    platformId: "gb",
    year: 1992,
    developer: "OpenRetro Studio",
    genre: "Adventure",
    artwork: "pocket",
    color: "#c2cc83",
    description:
      "Big adventures belong in small cartridges. Explore a charming pixel world in this fictional handheld classic.",
  },
  {
    id: "solar",
    title: "Solar Strike",
    platformId: "genesis",
    year: 1993,
    developer: "OpenRetro Studio",
    genre: "Shoot ’em up",
    artwork: "solar",
    color: "#eb957f",
    description:
      "Take flight through a sea of stars. An original fictional entry for testing discovery and local file association.",
  },
  {
    id: "drift",
    title: "Drift Coast",
    platformId: "psp",
    year: 2006,
    developer: "OpenRetro Studio",
    genre: "Racing",
    artwork: "drift",
    color: "#7dc6c8",
    description:
      "Ocean air, winding roads, and one more lap. Fictional development metadata; no commercial content is distributed.",
  },
];
export class MockMetadataProvider implements MetadataProvider {
  async search(query: string) {
    const q = query.toLowerCase().trim();
    return catalog.filter((g) =>
      `${g.title} ${g.genre} ${g.developer}`.toLowerCase().includes(q),
    );
  }
  async getGame(id: string) {
    const game = catalog.find((g) => g.id === id);
    if (!game)
      throw new Error(
        "This game is no longer available in the development catalog.",
      );
    return game;
  }
}
export const metadataProvider: MetadataProvider = new MockMetadataProvider();
