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
