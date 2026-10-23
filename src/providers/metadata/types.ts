import type { GameMetadata } from "../../types";
export interface MetadataProvider {
  search(query: string): Promise<GameMetadata[]>;
  getGame(id: string): Promise<GameMetadata>;
}
export interface CatalogRequest {
  kind: "platforms" | "genres" | "games" | "game";
  query?: string;
  ids?: number[];
  page?: number;
  genreId?: number;
  sort?: "popular" | "rating" | "title" | "newest" | "oldest";
  players?: PlayersFilter;
}
/** Games played together: 2+ players, co-op, or 3+ at once. */
export type PlayersFilter = "multi" | "coop" | "party";
export interface GamePlayers {
  maxPlayers: number | null;
  cooperative: boolean;
}
export interface CatalogReply {
  data: Record<string, unknown>;
  include?: Record<string, unknown>;
  hasNext: boolean;
  page: number;
  remainingAllowance: number | null;
}
export interface CatalogPage {
  games: GameMetadata[];
  hasNext: boolean;
  page: number;
  remainingAllowance: number | null;
}
export interface CatalogGenre {
  id: number;
  name: string;
}
export interface CatalogPlatform {
  id: number;
  name: string;
  alias?: string;
  localId: string;
}
