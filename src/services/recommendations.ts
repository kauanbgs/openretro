// Recommendations are computed on the PC from the player's own activity.
// The interface only reports what the backend cannot see by itself: how long
// a game's page stayed on screen, which suggestions were shown and which
// were opened. Downloads, removals and playtime are noted by the backend.
import { useEffect, useRef } from "react";
import { hasBackend, invoke } from "./transport";
import { platformById } from "../db/platforms";
import type { GameMetadata } from "../types";
import { t } from "../i18n";

/** Why a game is suggested, kept short on purpose. */
export type RecommendationReason =
  | { kind: "franchise"; name: string }
  | { kind: "similar"; title: string }
  | { kind: "genre"; genre: string }
  | { kind: "viewed" }
  | { kind: "explore" };

/** One row of suggestions; `kind` and its fields name the row. */
export type RecommendationRow = {
  games: { game: GameMetadata; reason?: RecommendationReason }[];
} & (
  | { kind: "forYou" }
  | {
      kind: "because";
      title: string;
      source: "played" | "downloaded" | "viewed";
    }
  | { kind: "franchise"; name: string }
  | { kind: "genre"; genre: string }
  | { kind: "genrePlatform"; genre: string; platform: string }
  | { kind: "hidden"; genre: string }
  | { kind: "platform"; platform: string }
  | { kind: "decade"; decade: number }
  | { kind: "developer"; developer: string }
  | { kind: "together" }
  | { kind: "viewed" }
  | { kind: "explore" }
);

export interface Recommendations {
  rows: RecommendationRow[];
}

export const recommendations = () => invoke<Recommendations>("recommendations");

export function rowTitle(row: RecommendationRow) {
  const console = (id: string) => platformById(id)?.name ?? id;
  switch (row.kind) {
    case "forYou":
      return t("Recomendados para você");
    case "because":
      if (row.source === "played")
        return t("Porque você jogou {title}", { title: row.title });
      if (row.source === "downloaded")
        return t("Porque você baixou {title}", { title: row.title });
      return t("Porque você se interessou por {title}", { title: row.title });
    case "franchise":
      return t("Da franquia {name}", { name: row.name });
    case "genre":
      return t("Os melhores de {genre}", { genre: row.genre });
    case "genrePlatform":
      return t("{genre} no {platform}", {
        genre: row.genre,
        platform: console(row.platform),
      });
    case "hidden":
      return t("Joias escondidas de {genre}", { genre: row.genre });
    case "platform":
      return t("Clássicos do {platform}", { platform: console(row.platform) });
    case "decade":
      // 1990 reads "90"; 2000 and later keep the full year.
      return t("Sucessos dos anos {decade}", {
        decade: String(row.decade < 2000 ? row.decade % 100 : row.decade),
      });
    case "developer":
      return t("Mais de {developer}", { developer: row.developer });
    case "together":
      return t("Para jogar junto");
    case "viewed":
      return t("Você deu uma olhada");
    case "explore":
      return t("Algo diferente pra experimentar");
  }
}

export function reasonLabel(reason: RecommendationReason) {
  switch (reason.kind) {
    case "franchise":
      return t("Franquia {name}", { name: reason.name });
    case "similar":
      return t("Parecido com {title}", { title: reason.title });
    case "genre":
      return reason.genre
        ? t("Popular em {genre}", { genre: reason.genre })
        : t("Popular no catálogo");
    case "viewed":
      return t("Você deu uma olhada");
    case "explore":
      return t("Algo diferente");
  }
}

/** Signals are best effort: a lost one must never bother the player. */
function send(command: string, args: Record<string, unknown>) {
  if (hasBackend) void invoke(command, args).catch(() => undefined);
}

export function recommendationsSeen(ids: string[]) {
  if (ids.length) send("recommendations_seen", { ids: ids.slice(0, 50) });
}

export function recommendationOpened(id: string) {
  send("recommendation_opened", { id });
}

/** Shorter visits say nothing; longer ones were probably left open. */
const MIN_SECONDS = 3;
const MAX_SECONDS = 600;

function recordView(game: GameMetadata, seconds: number) {
  if (seconds < MIN_SECONDS) return;
  send("interest_view", {
    game: {
      id: game.id,
      title: game.title,
      platformId: game.platformId,
      year: game.year || 0,
      developer: game.developer ?? "",
      description: "",
      genre: game.genre ?? "",
      genres: game.genres,
      artwork: game.artwork ?? "neutral",
      color: game.color ?? "",
    },
    seconds: Math.min(seconds, MAX_SECONDS),
  });
}

/**
 * Measures how long a game's page is actually on screen: hidden windows and
 * time spent playing do not count. Reported when the page closes.
 */
export function usePageInterest(
  game: GameMetadata | undefined,
  paused: boolean,
) {
  const pausedRef = useRef(paused);
  const clock = useRef<{ total: number; since: number | null }>({
    total: 0,
    since: null,
  });
  const counting = () =>
    !pausedRef.current && typeof document !== "undefined" && !document.hidden;
  const stop = () => {
    const c = clock.current;
    if (c.since !== null) c.total += (Date.now() - c.since) / 1000;
    c.since = null;
  };
  const resume = () => {
    if (clock.current.since === null && counting())
      clock.current.since = Date.now();
  };
  useEffect(() => {
    pausedRef.current = paused;
    if (paused) stop();
    else resume();
  }, [paused]);
  useEffect(() => {
    if (!game) return;
    clock.current = { total: 0, since: null };
    resume();
    const visibility = () => (document.hidden ? stop() : resume());
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      stop();
      recordView(game, clock.current.total);
    };
    // A new page starts a new count; the same game re-rendered does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id]);
}
