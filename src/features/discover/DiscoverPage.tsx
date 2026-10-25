import { useDownloadAvailability } from "../../hooks/useDownloadAvailability";
import { useEffect, useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Download, LoaderCircle, RefreshCw, Search } from "lucide-react";
import {
  metadataProvider,
  catalogStatus,
  catalogRefresh,
  playersFilters,
} from "../../providers/metadata/LaunchboxMetadataProvider";
import { platformById, platforms } from "../../db/platforms";
import { GameArtwork } from "../../components/GameArtwork";
import { PageLoading } from "../../components/PageLoading";
import { CatalogConnection } from "./CatalogConnection";
import { RecommendationRows } from "../../components/RecommendationRows";
import type {
  CatalogRequest,
  PlayersFilter,
} from "../../providers/metadata/types";
import type { GameMetadata } from "../../types";
import { useCatalogPagination } from "../../hooks/useCatalogPagination";
import { t } from "../../i18n";
interface Props {
  query: string;
  setQuery: (s: string) => void;
  platform: string;
  setPlatform: (s: string) => void;
  onSelect: (game: GameMetadata) => void;
}
export function DiscoverPage({
  query,
  setQuery,
  platform,
  setPlatform,
  onSelect,
}: Props) {
  const [debounced, setDebounced] = useState(query),
    [genre, setGenre] = useState<number | null>(null),
    [players, setPlayers] = useState<PlayersFilter | null>(null),
    [sort, setSort] = useState<NonNullable<CatalogRequest["sort"]>>("popular");
  const client = useQueryClient();
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 350);
    return () => clearTimeout(timer);
  }, [query]);
  const status = useQuery({
    queryKey: ["catalog-status"],
    queryFn: catalogStatus,
    refetchInterval: (query) =>
      ["building", "missing"].includes(query.state.data?.state ?? "")
        ? 1000
        : false,
    retry: false,
  });
  const taxonomy = useQuery({
    queryKey: ["catalog-taxonomy"],
    queryFn: () => metadataProvider.getTaxonomy(),
    enabled: status.data?.configured === true,
    retry: false,
    staleTime: 86400000,
  });
  const browse = useInfiniteQuery({
    queryKey: [
      "catalog",
      "artwork-v2",
      debounced,
      platform,
      genre,
      sort,
      players,
    ],
    queryFn: ({ pageParam }) =>
      metadataProvider.browse(
        debounced,
        platform,
        pageParam,
        genre ?? undefined,
        sort,
        players ?? undefined,
      ),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasNext ? last.page + 1 : undefined),
    enabled: status.data?.configured === true,
    retry: false,
    staleTime: 86400000,
  });
  const games = useMemo(
    () => [
      ...new Map(
        (browse.data?.pages.flatMap((p) => p.games) ?? []).map((game) => [
          game.id,
          game,
        ]),
      ).values(),
    ],
    [browse.data],
  );
  const available = taxonomy.data?.platforms ?? [];
  const sentinel = useCatalogPagination(
    Boolean(browse.hasNextPage && !browse.isFetching && !browse.error),
    browse.fetchNextPage,
  );
  const consoles = platforms.filter((p) =>
    available.some((r) => r.localId === p.id),
  );
  const selectedGenre = taxonomy.data?.genres.find((g) => g.id === genre)?.name;
  const selectedPlayers = playersFilters.find((p) => p.id === players)?.name;
  const availableDownloads = useDownloadAvailability(games);
  async function retry() {
    try {
      await catalogRefresh();
    } catch {
      /* Status polling exposes a retry if IPC is unavailable. */
    }
    await client.invalidateQueries({ queryKey: ["catalog-status"] });
    await client.invalidateQueries({ queryKey: ["catalog-taxonomy"] });
    await client.invalidateQueries({ queryKey: ["catalog"] });
  }
  return (
    <div className="page-content catalogue">
      {status.isPending ? (
        <PageLoading embedded label={t("Consultando o catálogo…")} />
      ) : !status.data?.configured || status.error ? (
        <CatalogConnection
          status={status.data}
          error={status.error ? String(status.error) : undefined}
          onRetry={() => void retry()}
        />
      ) : (
        <div className="catalogue-layout">
          <div className="catalogue-results">
            {/* Suggestions sit above the plain catalog, not above a search or filter. */}
            {!debounced &&
              genre === null &&
              players === null &&
              platform === "all" && (
                <RecommendationRows ready onSelect={onSelect} />
              )}
            <div className="catalogue-summary">
              <p>
                {browse.isFetching && !games.length
                  ? t("Carregando jogos…")
                  : debounced
                    ? t("Resultados para “{query}”", { query: debounced })
                    : platform === "all"
                      ? t("Todos os consoles")
                      : platforms.find((p) => p.id === platform)?.name}
                {selectedGenre && `, ${selectedGenre}`}
                {selectedPlayers && `, ${selectedPlayers}`}
              </p>
              {(debounced ||
                genre !== null ||
                players !== null ||
                platform !== "all") && (
                <button
                  className="text-button"
                  onClick={() => {
                    setGenre(null);
                    setPlayers(null);
                    setQuery("");
                    setPlatform("all");
                  }}
                >
                  {t("Limpar filtros")}
                </button>
              )}
            </div>
            {taxonomy.error && (
              <p className="error-message" role="alert">
                {String(taxonomy.error)}
              </p>
            )}
            {browse.isPending ? (
              <PageLoading embedded label={t("Carregando jogos…")} />
            ) : browse.error && games.length === 0 ? (
              <div className="empty-panel">
                <p role="alert">{String(browse.error)}</p>
                <button
                  className="button outline"
                  onClick={() => void browse.refetch()}
                >
                  <RefreshCw size={15} /> {t("Tentar novamente")}
                </button>
              </div>
            ) : games.length ? (
              <ul className="catalogue-list">
                {games.map((game) => (
                  <li key={game.id}>
                    <button onClick={() => onSelect(game)}>
                      <GameArtwork game={game} hero loading="lazy" />
                      <div className="catalogue-info">
                        <strong>{game.title}</strong>
                        <span>
                          {platformById(game.platformId)?.name}
                          {game.year ? `, ${game.year}` : ""}
                        </span>
                        <small>{game.genre}</small>
                      </div>
                      {availableDownloads.has(game.title) && (
                        <em>
                          <Download size={13} /> {t("Download disponível")}
                        </em>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-panel">
                <Search size={28} />
                <p>
                  {t(
                    "Nenhum jogo encontrado. Tente outro nome, console, gênero ou número de jogadores.",
                  )}
                </p>
              </div>
            )}
            {browse.error && games.length > 0 && (
              <p className="error-message" role="alert">
                {String(browse.error)}
              </p>
            )}
            {browse.hasNextPage && (
              <div className="load-more" ref={sentinel}>
                <button
                  className="button outline"
                  disabled={browse.isFetchingNextPage}
                  onClick={() => void browse.fetchNextPage()}
                >
                  {browse.isFetchingNextPage && (
                    <LoaderCircle size={15} className="spin" />
                  )}{" "}
                  {browse.isFetchingNextPage
                    ? "Carregando…"
                    : t("Carregar mais jogos")}
                </button>
              </div>
            )}
            <p className="catalogue-credit">
              {t("Dados e imagens do")}{" "}
              <a
                href="https://gamesdb.launchbox-app.com/"
                target="_blank"
                rel="noreferrer"
              >
                {t("LaunchBox Games Database")}
              </a>
              .
            </p>
          </div>
          <aside className="catalogue-filters" aria-label={t("Filtros")}>
            <section>
              <h3>{t("Ordenar por")}</h3>
              <select
                aria-label={t("Ordenar jogos")}
                disabled={Boolean(debounced)}
                value={sort}
                onChange={(e) =>
                  setSort(e.target.value as NonNullable<CatalogRequest["sort"]>)
                }
              >
                <option value="popular">
                  {debounced ? t("Relevância") : t("Mais avaliados")}
                </option>
                <option value="rating">{t("Melhor avaliados")}</option>
                <option value="title">{t("Título")}</option>
                <option value="newest">{t("Mais recentes")}</option>
                <option value="oldest">{t("Mais antigos")}</option>
              </select>
            </section>
            <section>
              <h3>{t("Consoles")}</h3>
              <ul className="filter-list">
                {[{ id: "all", name: t("Todos os consoles") }, ...consoles].map(
                  (p) => (
                    <li key={p.id}>
                      <label>
                        <input
                          type="radio"
                          name="catalogue-console"
                          checked={platform === p.id}
                          onChange={() => setPlatform(p.id)}
                        />
                        {p.name}
                      </label>
                    </li>
                  ),
                )}
              </ul>
            </section>
            <section>
              <h3>{t("Jogadores")}</h3>
              <ul className="filter-list">
                {[
                  { id: null, name: t("Qualquer número") },
                  ...playersFilters,
                ].map((p) => (
                  <li key={p.id ?? "all"}>
                    <label>
                      <input
                        type="radio"
                        name="catalogue-players"
                        checked={players === p.id}
                        onChange={() => setPlayers(p.id)}
                      />
                      {p.name}
                    </label>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3>{t("Gêneros")}</h3>
              <ul className="filter-list">
                {[
                  { id: null, name: t("Todos os gêneros") },
                  ...(taxonomy.data?.genres ?? []),
                ].map((g) => (
                  <li key={g.id ?? "all"}>
                    <label>
                      <input
                        type="radio"
                        name="catalogue-genre"
                        checked={genre === g.id}
                        onChange={() => setGenre(g.id)}
                      />
                      {g.name}
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
