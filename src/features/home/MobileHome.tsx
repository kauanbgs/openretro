import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Capsule } from "../../components/Capsule";
import { GameArtwork } from "../../components/GameArtwork";
import { platformById } from "../../db/platforms";
import {
  catalogStatus,
  metadataProvider,
} from "../../providers/metadata/LaunchboxMetadataProvider";
import type { PlayersFilter } from "../../providers/metadata/types";
import type { GameMetadata, LibraryGame } from "../../types";
import { t } from "../../i18n";

function useShelf(ready: boolean, players?: PlayersFilter) {
  return useQuery({
    queryKey: ["catalog-home", "popular", players ?? null],
    queryFn: () =>
      metadataProvider.browse("", "all", 1, undefined, "popular", players),
    enabled: ready,
    retry: false,
    staleTime: 86400000,
  });
}

/** The phone's home, laid out like a mobile game store: a swipeable
 * featured carousel, then horizontal shelves. */
export function MobileHome({
  library,
  onSelect,
  onDiscover,
  onLibrary,
}: {
  library: LibraryGame[];
  onSelect: (game: GameMetadata) => void;
  onDiscover: () => void;
  onLibrary: () => void;
}) {
  const status = useQuery({
    queryKey: ["catalog-status"],
    queryFn: catalogStatus,
    retry: false,
  });
  const ready = status.data?.configured === true;
  const popular = useShelf(ready);
  const multiplayer = useShelf(ready, "multi");
  const played = useMemo(
    () =>
      [...library]
        .filter((x) => x.item.lastPlayedAt)
        .sort((a, b) =>
          (b.item.lastPlayedAt ?? "").localeCompare(a.item.lastPlayedAt ?? ""),
        ),
    [library],
  );
  const featured = useMemo(
    () =>
      [...played.slice(0, 2).map((x) => x.game), ...(popular.data?.games ?? [])]
        .filter(
          (game, index, all) =>
            all.findIndex((other) => other.id === game.id) === index,
        )
        .slice(0, 6),
    [played, popular.data],
  );
  const lastPlayed = new Set(played.slice(0, 2).map((x) => x.game.id));
  const [page, setPage] = useState(0);
  const shelves: { title: string; games: GameMetadata[]; more: () => void }[] =
    [
      {
        title: t("▶️ Continue jogando"),
        games: played.slice(0, 10).map((x) => x.game),
        more: onLibrary,
      },
      {
        title: t("🔥 Em alta"),
        games: popular.data?.games.slice(6) ?? [],
        more: onDiscover,
      },
      {
        title: t("🎮 Multiplayer"),
        games: multiplayer.data?.games ?? [],
        more: onDiscover,
      },
    ];
  return (
    <div className="mobile-home">
      {featured.length > 0 && (
        <section className="featured" aria-label={t("Destaques")}>
          <div
            className="featured-track"
            onScroll={(event) => {
              const track = event.currentTarget;
              setPage(Math.round(track.scrollLeft / track.clientWidth));
            }}
          >
            {featured.map((game) => (
              <button
                className="featured-card"
                key={game.id}
                onClick={() => onSelect(game)}
              >
                <GameArtwork game={game} hero />
                <span className="featured-caption">
                  <small>
                    {lastPlayed.has(game.id)
                      ? t("Continue jogando")
                      : t("Destaque do catálogo")}
                  </small>
                  <strong>{game.title}</strong>
                  <span>
                    {[platformById(game.platformId)?.name, game.year || null]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div className="featured-dots" aria-hidden="true">
            {featured.map((game, index) => (
              <i key={game.id} className={index === page ? "on" : ""} />
            ))}
          </div>
        </section>
      )}
      {shelves
        .filter((row) => row.games.length > 0)
        .map((row) => (
          <section className="shelf" key={row.title}>
            <header>
              <h2>{row.title}</h2>
              <button onClick={row.more}>{t("Ver tudo")}</button>
            </header>
            <div className="shelf-track">
              {row.games.map((game) => (
                <Capsule
                  key={game.id}
                  game={game}
                  onClick={() => onSelect(game)}
                />
              ))}
            </div>
          </section>
        ))}
      {!ready && (
        <div className="empty-panel">
          <p>
            {status.data?.state === "building"
              ? t("O computador está preparando o catálogo de jogos.")
              : t("O catálogo de jogos aparece aqui quando estiver pronto.")}
          </p>
        </div>
      )}
    </div>
  );
}
