import { backendAvailable, invoke } from "../../services/transport";
import { platforms } from "../../db/platforms";
import type { GameMetadata } from "../../types";
import type {
  CatalogGenre,
  CatalogPage,
  CatalogPlatform,
  CatalogRequest,
  GamePlayers,
  MetadataProvider,
  PlayersFilter,
} from "./types";
export interface CatalogStatus {
  configured: boolean;
  state: "missing" | "building" | "ready" | "failed" | "unavailable";
  progress: number;
  games: number;
  message?: string | null;
}
const desktop = backendAvailable;
export async function catalogStatus(): Promise<CatalogStatus> {
  if (!desktop())
    return { configured: false, state: "unavailable", progress: 0, games: 0 };
  const status =
    await invoke<Omit<CatalogStatus, "configured">>("catalog_status");
  return { ...status, configured: status.state === "ready" };
}
export async function catalogRefresh() {
  if (desktop()) await invoke("catalog_refresh");
}
export function isCatalogGame(game: GameMetadata) {
  return (
    game.metadataProvider === "launchbox" || game.metadataProvider === "igdb"
  );
}
export class LaunchboxMetadataProvider implements MetadataProvider {
  async getTaxonomy(): Promise<{
    platforms: CatalogPlatform[];
    genres: CatalogGenre[];
  }> {
    return {
      platforms: platforms.map((p, i) => ({
        id: i + 1,
        name: p.name,
        localId: p.id,
      })),
      genres: await invoke<CatalogGenre[]>("catalog_genres"),
    };
  }
  async browse(
    query = "",
    platformId = "all",
    page = 1,
    genreId?: number,
    sort: CatalogRequest["sort"] = "popular",
    players?: PlayersFilter,
  ): Promise<CatalogPage> {
    const result = await invoke<Omit<CatalogPage, "remainingAllowance">>(
      "catalog_browse",
      {
        query,
        platform: platformId,
        page,
        genreId: genreId ?? null,
        sort,
        players: players ?? null,
      },
    );
    return { ...result, remainingAllowance: null };
  }
  async search(query: string, platformId = "all") {
    return (await this.browse(query, platformId)).games;
  }
  async getGame(id: string, _platformId?: string): Promise<GameMetadata> {
    if (!/^lb-\d+$/.test(id))
      throw new Error("Identificador inválido do LaunchBox.");
    return invoke("catalog_game", { id: Number(id.slice(3)) });
  }
  async match(
    platformId: string,
    filename: string,
  ): Promise<GameMetadata | undefined> {
    return (
      (await invoke<GameMetadata | null>("catalog_match", {
        platform: platformId,
        name: filename,
      })) ?? undefined
    );
  }
}
export const metadataProvider = new LaunchboxMetadataProvider();
/** Player counts for library games, keyed by game id; empty without a catalog. */
export async function catalogPlayers(
  games: GameMetadata[],
): Promise<Record<string, GamePlayers>> {
  if (!desktop() || !games.length) return {};
  return invoke("catalog_players", {
    games: games.map((g) => ({
      id: g.id,
      title: g.title,
      platform: g.platformId,
    })),
  });
}
/** Whether a game fits the players filter; unknown counts never match. */
export function matchesPlayers(
  players: GamePlayers | undefined,
  filter: PlayersFilter,
) {
  if (!players) return false;
  if (filter === "coop") return players.cooperative;
  return (players.maxPlayers ?? 0) >= (filter === "party" ? 3 : 2);
}
/** Labels shown wherever the players filter appears. */
export const playersFilters: { id: PlayersFilter; name: string }[] = [
  { id: "multi", name: "Multijogador (2+)" },
  { id: "coop", name: "Cooperativo" },
  { id: "party", name: "3 jogadores ou mais" },
];
export async function catalogGameDetails(game: GameMetadata) {
  if (game.metadataProvider === "launchbox")
    return metadataProvider.getGame(
      `lb-${game.externalId ?? game.id.match(/^lb-(\d+)/)?.[1]}`,
    );
  if (game.metadataProvider === "igdb") {
    const match = await metadataProvider.match(game.platformId, game.title);
    return match ? metadataProvider.getGame(match.id) : game;
  }
  return game;
}
