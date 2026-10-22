import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dices, Flame, History, Star } from "lucide-react";
import { GameArtwork } from "../../components/GameArtwork";
import { GameCard } from "../../components/GameCard";
import { useDownloadAvailability } from "../../hooks/useDownloadAvailability";
import {
  metadataProvider,
  catalogGameDetails,
  isCatalogGame,
  catalogStatus,
} from "../../providers/metadata/LaunchboxMetadataProvider";
import type { CatalogRequest } from "../../providers/metadata/types";
import { platformById } from "../../db/platforms";
import { enrichGameMetadata } from "../../utils/metadata";
import type { GameMetadata, LibraryGame } from "../../types";
interface Props {
  library: LibraryGame[];
  onSelect: (game: GameMetadata) => void;
  onImport: () => void;
  onLibrary: () => void;
  onDiscover: () => void;
  onDownloads: () => void;
}
type Sort = NonNullable<CatalogRequest["sort"]>;
const categories: { sort: Sort; label: string; icon: typeof Flame }[] = [
  { sort: "popular", label: "Em alta", icon: Flame },
  { sort: "rating", label: "Melhor avaliados", icon: Star },
  { sort: "oldest", label: "Clássicos", icon: History },
];
export function HomePage({ library, onSelect, onDiscover }: Props) {
  const [sort, setSort] = useState<Sort>("popular");
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
    queryKey: ["catalog-home", sort],
    queryFn: () => metadataProvider.browse("", "all", 1, undefined, sort),
    enabled: ready,
    retry: false,
    staleTime: 86400000,
  });
  const games = shelf.data?.games ?? [];
  const primary = played[0]?.game ?? games[0];
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
                {played.length ? "Continue jogando" : "Destaque do catálogo"}
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
                ? "Preparando o catálogo"
                : "Seus clássicos começam aqui"}
            </h2>
            <p>
              {status.data?.state === "building"
                ? "O OpenRetro está baixando a base de jogos do LaunchBox. Isso leva alguns minutos na primeira vez."
                : status.data?.state === "unavailable"
                  ? "O catálogo de jogos funciona no aplicativo desktop."
                  : "Adicione um jogo do seu computador ou explore o catálogo."}
            </p>
          </div>
        </div>
      )}
      <div className="home-categories">
        <div role="tablist" aria-label="Categorias">
          {categories.map((category) => (
            <button
              key={category.sort}
              role="tab"
              aria-selected={sort === category.sort}
              className={`button ${sort === category.sort ? "primary" : "outline"}`}
              onClick={() => setSort(category.sort)}
            >
              <category.icon size={15} /> {category.label}
            </button>
          ))}
        </div>
        <button
          className="button outline"
          disabled={!ready || surprising}
          onClick={() => void surprise()}
        >
          <Dices size={15} /> Me surpreenda
        </button>
      </div>
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
          <p>O catálogo aparece aqui quando estiver pronto.</p>
          <button className="button outline" onClick={onDiscover}>
            Abrir catálogo
          </button>
        </div>
      )}
    </div>
  );
}
