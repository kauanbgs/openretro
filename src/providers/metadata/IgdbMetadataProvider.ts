import { invoke } from "@tauri-apps/api/core";
import type { GameMetadata } from "../../types";
import type {
  CatalogRequest,
  CatalogReply,
  CatalogGenre,
  CatalogPlatform,
  CatalogPage,
  MetadataProvider,
} from "./types";
export type CatalogTransport = (
  request: CatalogRequest,
) => Promise<CatalogReply>;
const aliases: Record<string, string> = {
  nintendoentertainmentsystem: "nes",
  nintendoentertainmentsystemnes: "nes",
  nes: "nes",
  supernintendoentertainmentsystem: "snes",
  supernintendo: "snes",
  snes: "snes",
  nintendo64: "n64",
  n64: "n64",
  gameboy: "gb",
  gb: "gb",
  gameboycolor: "gbc",
  gbc: "gbc",
  gameboyadvance: "gba",
  gba: "gba",
  nintendods: "nds",
  nds: "nds",
  segamastersystem: "sms",
  sms: "sms",
  segamegadrivegenesis: "genesis",
  segagenesis: "genesis",
  segamegadrive: "genesis",
  genesis: "genesis",
  segagamegear: "gg",
  gamegear: "gg",
  playstation: "psx",
  ps: "psx",
  ps1: "psx",
  playstation2: "ps2",
  ps2: "ps2",
  playstationportable: "psp",
  psp: "psp",
  arcade: "arcade",
  dos: "dos",
};
const normalized = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export function mapIgdbPlatform(platform: {
  id: number;
  name: string;
  slug?: string;
  abbreviation?: string;
}): CatalogPlatform | undefined {
  const localId =
    aliases[normalized(platform.name)] ??
    aliases[normalized(platform.slug ?? "")] ??
    aliases[normalized(platform.abbreviation ?? "")];
  return localId
    ? { id: platform.id, name: platform.name, localId }
    : undefined;
}
export function igdbImage(
  id: unknown,
  size = "t_cover_big",
): string | undefined {
  if (
    typeof id !== "string" ||
    !/^[a-zA-Z0-9_]+$/.test(id) ||
    !/^t_[a-z0-9_]+$/.test(size)
  )
    return;
  return `https://images.igdb.com/igdb/image/upload/${size}/${id}.jpg`;
}
interface RawGame {
  id: number;
  name: string;
  slug?: string;
  summary?: string;
  storyline?: string;
  first_release_date?: number;
  platforms?: { id: number; name: string }[];
  genres?: CatalogGenre[];
  cover?: { image_id: string };
  artworks?: { image_id: string }[];
  screenshots?: { image_id: string }[];
  involved_companies?: { developer?: boolean; company?: { name: string } }[];
}
export function mapIgdbGame(
  raw: RawGame,
  platforms: CatalogPlatform[],
  preferred = "all",
): GameMetadata | undefined {
  const compatible = platforms.filter((p) =>
    raw.platforms?.some((r) => r.id === p.id),
  );
  const platform =
    compatible.find((p) => p.localId === preferred) ?? compatible[0];
  if (!platform) return;
  const sourceUrl =
    raw.slug && /^[a-z0-9-]+$/.test(raw.slug)
      ? `https://www.igdb.com/games/${raw.slug}`
      : undefined;
  return {
    id: `igdb-${raw.id}`,
    externalId: raw.id,
    metadataProvider: "igdb",
    title: raw.name,
    platformId: platform.localId,
    platformIds: [...new Set(compatible.map((p) => p.localId))],
    year: raw.first_release_date
      ? new Date(raw.first_release_date * 1000).getUTCFullYear()
      : 0,
    developer:
      raw.involved_companies
        ?.filter((c) => c.developer)
        .map((c) => c.company?.name)
        .filter(Boolean)
        .join(", ") || "Developer not listed",
    description:
      raw.summary ||
      raw.storyline ||
      "No overview is available for this game on IGDB yet.",
    genre: raw.genres?.map((g) => g.name).join(" · ") || "Uncategorized",
    genres: raw.genres?.map((g) => g.name) ?? [],
    genreIds: raw.genres?.map((g) => g.id) ?? [],
    artwork: "neutral",
    color: "#cced94",
    coverUrl: igdbImage(raw.cover?.image_id),
    backgroundUrl: igdbImage(raw.artworks?.[0]?.image_id, "t_1080p"),
    screenshots: raw.screenshots
      ?.map((s) => igdbImage(s.image_id, "t_1080p"))
      .filter((s): s is string => Boolean(s))
      .slice(0, 8),
    sourceUrl,
  };
}
export async function catalogTransport(
  request: CatalogRequest,
): Promise<CatalogReply> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window)
    return invoke("igdb_query", { request });
  let response: Response;
  try {
    response = await fetch("/api/igdb/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    throw new Error(
      "OpenRetro’s catalog service is unavailable. Use npm run dev or the desktop app.",
    );
  }
  const body = await response.json().catch(() => ({
    error:
      "Catalog service is unavailable. Use npm run dev or the desktop app.",
  }));
  if (!response.ok) throw new Error(body.error ?? "IGDB request failed.");
  return body;
}
export async function catalogStatus(): Promise<{ configured: boolean }> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window)
    return invoke("igdb_status");
  const response = await fetch("/api/igdb/status");
  if (!response.ok)
    throw new Error(
      "Catalog service is unavailable. Use npm run dev or the desktop app.",
    );
  return response.json();
}
export class IgdbMetadataProvider implements MetadataProvider {
  constructor(private transport: CatalogTransport = catalogTransport) {}
  private taxonomy?: Promise<{
    platforms: CatalogPlatform[];
    genres: CatalogGenre[];
  }>;
  async getTaxonomy() {
    if (!this.taxonomy) {
      this.taxonomy = Promise.all([
        this.transport({ kind: "platforms" }),
        this.transport({ kind: "genres" }),
      ])
        .then(([p, g]) => ({
          platforms: (
            p.data.platforms as Parameters<typeof mapIgdbPlatform>[0][]
          )
            .map(mapIgdbPlatform)
            .filter((p): p is CatalogPlatform => Boolean(p)),
          genres: g.data.genres as CatalogGenre[],
        }))
        .catch((e) => {
          this.taxonomy = undefined;
          throw e;
        });
    }
    return this.taxonomy;
  }
  async browse(
    query = "",
    platformId = "all",
    page = 1,
    genreId?: number,
    sort: CatalogRequest["sort"] = "popular",
  ): Promise<CatalogPage> {
    const taxonomy = await this.getTaxonomy();
    const ids = taxonomy.platforms
      .filter((p) => platformId === "all" || p.localId === platformId)
      .map((p) => p.id);
    if (!ids.length)
      return { games: [], hasNext: false, page, remainingAllowance: null };
    const reply = await this.transport({
      kind: "games",
      query,
      ids,
      page,
      genreId,
      sort,
    });
    return {
      games: (reply.data.games as RawGame[])
        .map((g) => mapIgdbGame(g, taxonomy.platforms, platformId))
        .filter((g): g is GameMetadata => Boolean(g)),
      hasNext: reply.hasNext,
      page,
      remainingAllowance: null,
    };
  }
  async search(query: string) {
    return (await this.browse(query)).games;
  }
  async getGame(id: string, platformId = "all"): Promise<GameMetadata> {
    if (!/^igdb-\d+$/.test(id))
      throw new Error("This is not an IGDB game identifier.");
    const taxonomy = await this.getTaxonomy();
    const reply = await this.transport({
      kind: "game",
      ids: [Number(id.slice(5))],
    });
    const raw = (reply.data.games as RawGame[])[0];
    if (!raw) throw new Error("This game was not found on IGDB.");
    const game = mapIgdbGame(raw, taxonomy.platforms, platformId);
    if (!game)
      throw new Error("This platform is not supported by OpenRetro yet.");
    return game;
  }
}
export const metadataProvider = new IgdbMetadataProvider();
