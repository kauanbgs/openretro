import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  LaunchboxMetadataProvider,
  catalogGameDetails,
  catalogRefresh,
  catalogStatus,
  isCatalogGame,
} from "./LaunchboxMetadataProvider";
import { enrichGameMetadata } from "../../utils/metadata";
import type { GameMetadata } from "../../types";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const ipc = vi.mocked(invoke);
const game: GameMetadata = {
  id: "lb-299",
  externalId: 299,
  metadataProvider: "launchbox",
  title: "Super Metroid",
  platformId: "snes",
  year: 1994,
  developer: "Nintendo",
  description: "Samus",
  genre: "Platform",
  artwork: "neutral",
  color: "#ffffff",
};
beforeEach(() => {
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  ipc.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
describe("LaunchBox catalog", () => {
  it("does not invoke desktop IPC in browser status or refresh", async () => {
    vi.stubGlobal("window", {});
    expect(await catalogStatus()).toMatchObject({
      state: "unavailable",
      configured: false,
    });
    await catalogRefresh();
    expect(ipc).not.toHaveBeenCalled();
  });
  it("reports progress and enables queries only once ready", async () => {
    ipc
      .mockResolvedValueOnce({ state: "building", progress: 42, games: 0 })
      .mockResolvedValueOnce({ state: "ready", progress: 100, games: 46787 });
    expect(await catalogStatus()).toMatchObject({
      configured: false,
      progress: 42,
    });
    expect(await catalogStatus()).toMatchObject({
      configured: true,
      games: 46787,
    });
    await catalogRefresh();
    expect(ipc).toHaveBeenLastCalledWith("catalog_refresh");
  });
  it("sends console, genre, pagination and sorting through native arguments", async () => {
    ipc.mockResolvedValue({ games: [game], page: 2, hasNext: true });
    const provider = new LaunchboxMetadataProvider();
    expect(
      await provider.browse("metroid", "snes", 2, 7, "rating"),
    ).toMatchObject({
      games: [game],
      page: 2,
      hasNext: true,
      remainingAllowance: null,
    });
    expect(ipc).toHaveBeenLastCalledWith("catalog_browse", {
      query: "metroid",
      platform: "snes",
      page: 2,
      genreId: 7,
      sort: "rating",
    });
    await provider.search("metroid", "snes");
    expect(ipc).toHaveBeenLastCalledWith(
      "catalog_browse",
      expect.objectContaining({ platform: "snes", query: "metroid" }),
    );
  });
  it("keeps every supported platform and retries failed taxonomy loads", async () => {
    const provider = new LaunchboxMetadataProvider();
    ipc
      .mockRejectedValueOnce(new Error("building"))
      .mockResolvedValueOnce([{ id: 1, name: "Platform" }]);
    await expect(provider.getTaxonomy()).rejects.toThrow("building");
    const taxonomy = await provider.getTaxonomy();
    expect(taxonomy.platforms).toHaveLength(15);
    expect(taxonomy.genres).toEqual([{ id: 1, name: "Platform" }]);
  });
  it("rejects legacy or malformed IDs before game IPC", async () => {
    const provider = new LaunchboxMetadataProvider();
    for (const id of ["igdb-299", "lb-299-extra", "lb-NaN"])
      await expect(provider.getGame(id)).rejects.toThrow();
    expect(ipc).not.toHaveBeenCalled();
    ipc.mockResolvedValue(game);
    await provider.getGame("lb-299");
    expect(ipc).toHaveBeenCalledWith("catalog_game", { id: 299 });
  });
  it("loads details for locally suffixed LaunchBox IDs", async () => {
    ipc.mockResolvedValue(game);
    await catalogGameDetails({
      ...game,
      id: "lb-299-local-uuid",
      externalId: undefined,
    });
    expect(ipc).toHaveBeenCalledWith("catalog_game", { id: 299 });
  });
  it("matches legacy titles by console instead of reusing their provider IDs", async () => {
    const legacy = {
      ...game,
      id: "old-library-id",
      externalId: 999,
      metadataProvider: "igdb" as const,
      coverUrl: "legacy.jpg",
    };
    ipc.mockResolvedValueOnce(game).mockResolvedValueOnce(game);
    const remote = await catalogGameDetails(legacy);
    expect(ipc).toHaveBeenNthCalledWith(1, "catalog_match", {
      platform: "snes",
      name: "Super Metroid",
    });
    expect(ipc).toHaveBeenNthCalledWith(2, "catalog_game", { id: 299 });
    expect(enrichGameMetadata(legacy, remote)).toMatchObject({
      id: legacy.id,
      metadataProvider: "launchbox",
      coverUrl: "legacy.jpg",
    });
    ipc.mockResolvedValueOnce(null);
    expect(await catalogGameDetails(legacy)).toEqual(legacy);
    expect(isCatalogGame(legacy)).toBe(true);
    expect(isCatalogGame(game)).toBe(true);
    expect(isCatalogGame({ ...game, metadataProvider: "mock" })).toBe(false);
  });
});
