import { PageHeader } from "../../components/PageHeader";
import { PageLoading } from "../../components/PageLoading";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Plus,
  Heart,
  SlidersHorizontal,
  LayoutGrid,
  List,
  Library,
  FolderOpen,
} from "lucide-react";
import { GameCard } from "../../components/GameCard";
import { Capsule } from "../../components/Capsule";
import { isRemote } from "../../services/transport";
import { platforms } from "../../db/platforms";
import {
  catalogPlayers,
  matchesPlayers,
  playersFilters,
} from "../../providers/metadata/LaunchboxMetadataProvider";
import type { PlayersFilter } from "../../providers/metadata/types";
import type { GameMetadata, LibraryGame } from "../../types";
import { t } from "../../i18n";
interface Props {
  library: LibraryGame[];
  isPending: boolean;
  query: string;
  setQuery: (value: string) => void;
  platform: string;
  setPlatform: (value: string) => void;
  onSelect: (game: GameMetadata) => void;
  onImport: () => void;
}
export function CollectionPage({
  library,
  isPending,
  query,
  setQuery,
  platform,
  setPlatform,
  onSelect,
  onImport,
}: Props) {
  const [filter, setFilter] = useState("all"),
    [layout, setLayout] = useState("grid"),
    [sort, setSort] = useState("recent"),
    [players, setPlayers] = useState<PlayersFilter | "all">("all");
  // Looked up only once the filter is used; the catalog knows player counts.
  const counts = useQuery({
    queryKey: ["library-players", library.map((x) => x.game.id).join(",")],
    queryFn: () => catalogPlayers(library.map((x) => x.game)),
    enabled: players !== "all",
    staleTime: Infinity,
    retry: false,
  });
  const visible = useMemo(
    () =>
      library
        .filter(
          (x) =>
            (filter !== "favorites" || x.item.favorite) &&
            (filter !== "unplayed" || !x.item.lastPlayedAt) &&
            (filter !== "recent" || Boolean(x.item.lastPlayedAt)) &&
            (platform === "all" || x.game.platformId === platform) &&
            (players === "all" ||
              matchesPlayers(counts.data?.[x.game.id], players)) &&
            x.game.title.toLowerCase().includes(query.toLowerCase()),
        )
        .sort((a, b) =>
          sort === "title"
            ? a.game.title.localeCompare(b.game.title)
            : sort === "played"
              ? b.item.playtime - a.item.playtime
              : sort === "lastPlayed"
                ? (b.item.lastPlayedAt ?? "").localeCompare(
                    a.item.lastPlayedAt ?? "",
                  )
                : b.item.addedAt.localeCompare(a.item.addedAt),
        ),
    [library, filter, platform, players, counts.data, query, sort],
  );
  return (
    <div className="page-content">
      <PageHeader
        title={t("Biblioteca")}
        description={
          library.length
            ? `${library.length} ${library.length === 1 ? t("jogo na sua coleção") : t("jogos na sua coleção")}.`
            : t("Sua próxima partida começa aqui.")
        }
        actions={
          <button className="button primary" onClick={onImport}>
            <Plus size={18} /> {t("Adicionar jogo")}
          </button>
        }
      />
      <div className="library-toolbar">
        <div className="filter-tabs">
          <button
            className={filter === "all" ? "selected" : ""}
            onClick={() => setFilter("all")}
          >
            {t("Todos os jogos")} <span>{library.length}</span>
          </button>
          <button
            className={filter === "favorites" ? "selected" : ""}
            onClick={() => setFilter("favorites")}
          >
            <Heart size={14} /> {t("Favoritos")}
          </button>
          <button
            className={filter === "recent" ? "selected" : ""}
            onClick={() => setFilter("recent")}
          >
            {t("Jogados recentemente")}
          </button>
          <button
            className={filter === "unplayed" ? "selected" : ""}
            onClick={() => setFilter("unplayed")}
          >
            {t("Nunca jogados")}{" "}
            <span>{library.filter((x) => !x.item.lastPlayedAt).length}</span>
          </button>
        </div>
        <div className="toolbar-right">
          <SlidersHorizontal size={15} />
          <select
            aria-label={t("Filter by platform")}
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
          >
            <option value="all">{t("Todos os consoles")}</option>
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            aria-label={t("Filtrar por número de jogadores")}
            value={players}
            onChange={(e) =>
              setPlayers(e.target.value as PlayersFilter | "all")
            }
          >
            <option value="all">{t("Qualquer número de jogadores")}</option>
            {playersFilters.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            aria-label={t("Sort games")}
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="recent">{t("Adicionados recentemente")}</option>
            <option value="lastPlayed">{t("Última partida")}</option>
            <option value="title">{t("Título A–Z")}</option>
            <option value="played">{t("Mais jogados")}</option>
          </select>
          <div className="view-toggle">
            <button
              className={layout === "grid" ? "selected" : ""}
              aria-label={t("Grid view")}
              onClick={() => setLayout("grid")}
            >
              <LayoutGrid size={16} />
            </button>
            <button
              className={layout === "list" ? "selected" : ""}
              aria-label={t("List view")}
              onClick={() => setLayout("list")}
            >
              <List size={17} />
            </button>
          </div>
        </div>
      </div>
      {isPending || (players !== "all" && counts.isPending) ? (
        <PageLoading embedded label={t("Abrindo sua coleção…")} />
      ) : visible.length && isRemote ? (
        <div className="cover-grid">
          {visible.map((x) => (
            <Capsule
              key={x.item.id}
              game={x.game}
              cover
              detail={
                platforms.find((p) => p.id === x.game.platformId)?.shortName
              }
              onClick={() => onSelect(x.game)}
            />
          ))}
        </div>
      ) : visible.length ? (
        <div
          className={
            layout === "grid" ? "games-grid library-grid" : "games-list"
          }
        >
          {visible.map((x) => (
            <GameCard
              key={x.item.id}
              game={x.game}
              item={x.item}
              onClick={() => onSelect(x.game)}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <div className="large-icon">
            <Library size={34} />
          </div>
          <h2>
            {library.length
              ? t("Nenhum jogo nesta seleção.")
              : t("Sua biblioteca está vazia")}
          </h2>
          <p>
            {library.length
              ? t("Tente outro nome ou remova os filtros.")
              : t(
                  "Encontre jogos no catálogo ou importe seus arquivos para começar.",
                )}
          </p>
          <button
            className="button primary"
            onClick={() => {
              if (library.length) {
                setQuery("");
                setPlatform("all");
                setFilter("all");
                setPlayers("all");
              } else onImport();
            }}
          >
            {library.length ? (
              t("Limpar filtros")
            ) : (
              <>
                <FolderOpen size={17} /> {t("Adicionar jogo")}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
