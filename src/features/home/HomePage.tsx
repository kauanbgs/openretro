import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dices } from "lucide-react";
import { GameArtwork } from "../../components/GameArtwork";
import { GameCard } from "../../components/GameCard";
import { PlayTogether } from "../../components/PlayTogether";
import { RecommendationRows } from "../../components/RecommendationRows";
import { useDownloadAvailability } from "../../hooks/useDownloadAvailability";
import {
  metadataProvider,
  catalogGameDetails,
  isCatalogGame,
  catalogStatus,
} from "../../providers/metadata/LaunchboxMetadataProvider";
import type { PlayersFilter } from "../../providers/metadata/types";
import { platformById } from "../../db/platforms";
import { enrichGameMetadata } from "../../utils/metadata";
import type { GameMetadata, LibraryGame } from "../../types";
import { t } from "../../i18n";
interface Props {
  library: LibraryGame[];
  onSelect: (game: GameMetadata) => void;
  onImport: () => void;
  onLibrary: () => void;
  onDiscover: () => void;
  onDownloads: () => void;
  onPhone: () => void;
  onParty: () => void;
  onFriends: () => void;
}
type Category = "popular" | "multiplayer";
const categories: {
  id: Category;
  label: string;
  emoji: string;
  players?: PlayersFilter;
}[] = [
  { id: "popular", label: t("Em alta"), emoji: "🔥" },
  { id: "multiplayer", label: t("Multiplayer"), emoji: "🎮", players: "multi" },
];
export function HomePage({
  library,
  onSelect,
  onDiscover,
  onPhone,
  onParty,
  onFriends,
}: Props) {
  const [category, setCategory] = useState<Category>("popular");
  const current = categories.find((c) => c.id === category)!;
  const [surprising, setSurprising] = useState(false);
  const played = useMemo(
    () =>
      [...library]
        .filter((x) => x.item.lastPlayedAt)
        .sort((a, b) =>
          (b.item.lastPlayedAt ?? "").localeCompare(a.item.lastPlayedAt ?? ""),
        ),
    [library],
  );
  const status = useQuery({
    queryKey: ["catalog-status"],
    queryFn: catalogStatus,
    refetchInterval: (query) =>
      ["building", "missing"].includes(query.state.data?.state ?? "")
        ? 1000
        : false,
    retry: false,
  });
  const ready = status.data?.configured === true;
  const shelf = useQuery({
    queryKey: ["catalog-home", "popular", current.players ?? null],
    queryFn: () =>
      metadataProvider.browse(
        "",
        "all",
        1,
        undefined,
        "popular",
        current.players,
      ),
    enabled: ready,
    retry: false,
    staleTime: 86400000,
  });
  const games = shelf.data?.games ?? [];
  // The banner stays put while switching categories.
  const popular = useQuery({
    queryKey: ["catalog-home", "popular", null],
    queryFn: () => metadataProvider.browse("", "all", 1, undefined, "popular"),
    enabled: ready,
    retry: false,
    staleTime: 86400000,
  });
  const primary = played[0]?.game ?? popular.data?.games[0];
  const details = useQuery({
    queryKey: [
      "game-detail",
      primary?.metadataProvider,
      primary?.id,
      primary?.platformId,
    ],
    queryFn: () => catalogGameDetails(primary!),
    enabled: ready && Boolean(primary && isCatalogGame(primary)),
    retry: false,
    staleTime: 86400000,
  });
  const featured = useMemo(
    () => (primary ? enrichGameMetadata(primary, details.data) : undefined),
    [primary, details.data],
  );
  const grid = games.filter((game) => game.id !== featured?.id).slice(0, 12);
  const downloads = useDownloadAvailability(grid);
  const owned = new Map(library.map((x) => [x.game.id, x.item]));
  async function surprise() {
    setSurprising(true);
    try {
      const page = 1 + Math.floor(Math.random() * 40);
      const result = await metadataProvider.browse("", "all", page);
      const pick =
        result.games[Math.floor(Math.random() * result.games.length)];
      if (pick) onSelect(pick);
    } finally {
      setSurprising(false);
    }
  }
  return (
    <div className="page-content home">
      {featured ? (
        <button className="hero" onClick={() => onSelect(featured)}>
          <GameArtwork game={featured} hero />
          <div className="hero-backdrop">
            <div className="hero-content">
              <small>
                {played.length
                  ? t("Continue jogando")
                  : t("Destaque do catálogo")}
              </small>
              <h2>{featured.title}</h2>
              <p>{featured.description}</p>
              <span>
                {platformById(featured.platformId)?.name}
                {featured.year ? `, ${featured.year}` : ""}
              </span>
            </div>
          </div>
        </button>
      ) : (
        <div className="hero hero-empty">
          <div className="hero-content">
            <h2>
              {status.data?.state === "building"
                ? t("Preparando o catálogo")
                : t("Seus clássicos começam aqui")}
            </h2>
            <p>
              {status.data?.state === "building"
                ? t(
                    "O OpenRetro está baixando a base de jogos do LaunchBox. Isso leva alguns minutos na primeira vez.",
                  )
                : status.data?.state === "unavailable"
                  ? t("O catálogo de jogos funciona no aplicativo desktop.")
                  : t(
                      "Adicione um jogo do seu computador ou explore o catálogo.",
                    )}
            </p>
          </div>
        </div>
      )}
      <PlayTogether onPhone={onPhone} onParty={onParty} onFriends={onFriends} />
      <RecommendationRows ready={ready} limit={3} onSelect={onSelect} />
      <div className="home-categories">
        <div role="tablist" aria-label={t("Categorias")}>
          {categories.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={category === c.id}
              className={`button ${category === c.id ? "primary" : "outline"}`}
              onClick={() => setCategory(c.id)}
            >
              <span aria-hidden="true">{c.emoji}</span> {c.label}
            </button>
          ))}
        </div>
        <button
          className="button outline"
          disabled={!ready || surprising}
          onClick={() => void surprise()}
        >
          <Dices size={15} /> {t("Me surpreenda")}
        </button>
      </div>
      {ready && (
        <h2 className="home-section-title">
          <span aria-hidden="true">{current.emoji}</span> {current.label}
        </h2>
      )}
      {ready ? (
        <div className="cards-grid">
          {shelf.isPending
            ? Array.from({ length: 8 }, (_, i) => (
                <div className="game-card skeleton" key={i} />
              ))
            : grid.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  item={owned.get(game.id)}
                  downloadAvailable={downloads.has(game.title)}
                  onClick={() => onSelect(game)}
                />
              ))}
        </div>
      ) : (
        <div className="empty-panel">
          <p>{t("O catálogo aparece aqui quando estiver pronto.")}</p>
          <button className="button outline" onClick={onDiscover}>
            {t("Abrir catálogo")}
          </button>
        </div>
      )}
    </div>
  );
}
