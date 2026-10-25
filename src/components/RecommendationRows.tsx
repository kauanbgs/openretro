import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { GameCard } from "./GameCard";
import { useLibrary } from "../hooks/useLibrary";
import { useDownloadAvailability } from "../hooks/useDownloadAvailability";
import {
  reasonLabel,
  recommendationOpened,
  recommendations,
  recommendationsSeen,
  rowTitle,
  type RecommendationRow,
} from "../services/recommendations";
import { hasBackend } from "../services/transport";
import type { GameMetadata } from "../types";

/**
 * Suggestion rows from the player's activity; nothing shows until there is
 * some. `limit` keeps only the first rows, for pages with other content.
 */
export function RecommendationRows({
  ready,
  limit,
  onSelect,
}: {
  ready: boolean;
  limit?: number;
  onSelect: (game: GameMetadata) => void;
}) {
  const library = useLibrary().data ?? [];
  // Downloading, removing, favoriting or playing changes the suggestions.
  const signature = library
    .map((x) => `${x.item.id}:${x.item.playtime}:${x.item.favorite ? 1 : 0}`)
    .join(",");
  const result = useQuery({
    queryKey: ["recommendations", signature],
    queryFn: recommendations,
    enabled: ready && hasBackend,
    retry: false,
    staleTime: 30000,
    placeholderData: (previous) => previous,
  });
  const rows = useMemo(
    () => result.data?.rows.slice(0, limit) ?? [],
    [result.data, limit],
  );
  const shown = useMemo(
    () => rows.flatMap((row) => row.games.map((x) => x.game)),
    [rows],
  );
  const downloads = useDownloadAvailability(shown);
  if (!rows.length) return null;
  const open = (game: GameMetadata) => {
    recommendationOpened(game.id);
    onSelect(game);
  };
  return (
    <div className="recommendations">
      {rows.map((row, index) => (
        <RecommendationSection
          key={`${row.kind}-${index}-${rowTitle(row)}`}
          row={row}
          available={downloads}
          onOpen={open}
        />
      ))}
    </div>
  );
}

function RecommendationSection({
  row,
  available,
  onOpen,
}: {
  row: RecommendationRow;
  available: Set<string>;
  onOpen: (game: GameMetadata) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  // A suggestion counts as shown only once its row is actually on screen.
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        recommendationsSeen(row.games.map((x) => x.game.id));
        observer.disconnect();
      },
      { threshold: 0.5 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [row]);
  return (
    <section ref={ref} className="recommendation-section">
      <h2 className="home-section-title">
        {row.kind === "forYou" && <Sparkles size={20} aria-hidden="true" />}
        <span>{rowTitle(row)}</span>
      </h2>
      <div className="recommendation-row">
        {row.games.map(({ game, reason }) => (
          <GameCard
            key={game.id}
            game={game}
            note={reason && reasonLabel(reason)}
            downloadAvailable={available.has(game.title)}
            onClick={() => onOpen(game)}
          />
        ))}
      </div>
    </section>
  );
}
