import { useQueries } from "@tanstack/react-query";
import { bridge } from "../services/bridge";
import { availabilityBatches } from "../services/downloadAvailability";
import type { GameMetadata } from "../types";
export function useDownloadAvailability(games: GameMetadata[]) {
  const results = useQueries({
    queries: availabilityBatches(games.map((game) => game.title)).map((titles) => ({
      queryKey: ["catalog-download-availability", titles],
      queryFn: () => bridge.availableDownloadTitles(titles),
      // SourceManager invalidates this prefix when sources change.
      staleTime: Infinity,
    })),
  });
  return new Set(results.flatMap((result) => result.data ?? []));
}
