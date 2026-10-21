import { useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Grid2X2, List, LoaderCircle, RefreshCw, Search } from "lucide-react";
import {
  metadataProvider,
  catalogStatus,
} from "../../providers/metadata/IgdbMetadataProvider";
import { platforms } from "../../db/platforms";
import { GameCard } from "../../components/GameCard";
import { bridge } from "../../services/bridge";
import { PageHeader } from "../../components/PageHeader";
import { CatalogConnection } from "./CatalogConnection";
import type { CatalogRequest } from "../../providers/metadata/types";
import type { GameMetadata } from "../../types";
import { useCatalogPagination } from "../../hooks/useCatalogPagination";
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
    [sort, setSort] = useState<NonNullable<CatalogRequest["sort"]>>("popular"),
    [layout, setLayout] = useState("grid");
  const client = useQueryClient();
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 350);
    return () => clearTimeout(timer);
  }, [query]);
  const status = useQuery({
    queryKey: ["catalog-status"],
    queryFn: catalogStatus,
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
    queryKey: ["catalog", "artwork-v2", debounced, platform, genre, sort],
    queryFn: ({ pageParam }) =>
      metadataProvider.browse(
        debounced,
        platform,
        pageParam,
        genre ?? undefined,
        sort,
      ),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasNext ? last.page + 1 : undefined),
    enabled: status.data?.configured === true,
    retry: false,
    staleTime: 86400000,
  });
  const games = [
    ...new Map(
      (browse.data?.pages.flatMap((p) => p.games) ?? []).map((game) => [
        game.id,
        game,
      ]),
    ).values(),
  ];
  const available = taxonomy.data?.platforms ?? [];
  const sentinel = useCatalogPagination(
    Boolean(browse.hasNextPage && !browse.isFetching && !browse.error),
    browse.fetchNextPage,
  );
  const consoles = platforms.filter((p) =>
    available.some((r) => r.localId === p.id),
  );
  const selectedGenre = taxonomy.data?.genres.find((g) => g.id === genre)?.name;
  const availability = useQuery({
    queryKey: [
      "catalog-download-availability",
      games.map((game) => game.title),
    ],
    queryFn: () =>
      bridge.availableDownloadTitles(games.map((game) => game.title)),
    enabled: games.length > 0,
    staleTime: 30000,
  });
  const availableDownloads = new Set(availability.data ?? []);
  async function retry() {
    await client.invalidateQueries({ queryKey: ["catalog-status"] });
    await client.invalidateQueries({ queryKey: ["catalog-taxonomy"] });
    await client.invalidateQueries({ queryKey: ["catalog"] });
  }
  return (
    <div className="page-content discover-page">
      <PageHeader
        title="Discover"
        description="Browse the games that made their generation."
        actions={
          <a
            className="catalog-attribution"
            href="https://www.igdb.com/"
            target="_blank"
            rel="noreferrer"
          >
            <span className="provider-mark">IGDB</span> Game catalog
          </a>
        }
      />
      {status.isPending ? (
        <div className="catalog-loading">
          <LoaderCircle className="spin" size={24} />
          <p>Connecting to IGDB…</p>
        </div>
      ) : !status.data?.configured || status.error ? (
        <CatalogConnection
          error={status.error ? String(status.error) : undefined}
          onRetry={() => void retry()}
        />
      ) : (
        <>
          <nav className="console-browser" aria-label="Filter by console">
            <div className="console-browser-heading">
              <span>Consoles</span>
              <small>{available.length} systems</small>
            </div>
            <div className="console-rail">
              <button
                className={platform === "all" ? "selected" : ""}
                aria-pressed={platform === "all"}
                onClick={() => setPlatform("all")}
              >
                All consoles
              </button>
              {consoles.map((p) => (
                <button
                  key={p.id}
                  title={p.name}
                  aria-label={p.name}
                  aria-pressed={platform === p.id}
                  className={platform === p.id ? "selected" : ""}
                  onClick={() => setPlatform(p.id)}
                >
                  {p.shortName}
                </button>
              ))}
            </div>
          </nav>
          <div className="catalog-toolbar">
            <div className="catalog-context">
              <h2>
                {debounced
                  ? "Search results"
                  : platform === "all"
                    ? "All games"
                    : platforms.find((p) => p.id === platform)?.name}
              </h2>
              <p>
                {browse.isFetching
                  ? "Loading games…"
                  : `${games.length} games loaded`}
                {debounced && ` for “${debounced}”`}
                {selectedGenre && ` / ${selectedGenre}`}
              </p>
            </div>
            <div className="toolbar-right">
              <label className="select-label">
                <span>Genre</span>
                <select
                  aria-label="Filter by genre"
                  value={genre ?? "all"}
                  onChange={(e) =>
                    setGenre(
                      e.target.value === "all" ? null : Number(e.target.value),
                    )
                  }
                >
                  <option value="all">All genres</option>
                  {taxonomy.data?.genres.map((g) => (
                    <option value={g.id} key={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="select-label">
                <span>Sort by</span>
                <select
                  aria-label="Sort games"
                  disabled={Boolean(debounced)}
                  value={sort}
                  onChange={(e) =>
                    setSort(
                      e.target.value as NonNullable<CatalogRequest["sort"]>,
                    )
                  }
                >
                  <option value="popular">
                    {debounced ? "Relevance" : "Most rated"}
                  </option>
                  <option value="rating">Highest rated</option>
                  <option value="title">Title</option>
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </select>
              </label>
              <div className="view-toggle">
                <button
                  className={layout === "grid" ? "selected" : ""}
                  aria-label="Grid view"
                  aria-pressed={layout === "grid"}
                  onClick={() => setLayout("grid")}
                >
                  <Grid2X2 size={17} />
                </button>
                <button
                  className={layout === "list" ? "selected" : ""}
                  aria-label="List view"
                  aria-pressed={layout === "list"}
                  onClick={() => setLayout("list")}
                >
                  <List size={18} />
                </button>
              </div>
            </div>
          </div>
          {taxonomy.error && (
            <p className="error-message" role="alert">
              {String(taxonomy.error)}
            </p>
          )}
          {browse.isPending ? (
            <div className="catalog-loading">
              <LoaderCircle size={24} className="spin" />
              <p>Loading games…</p>
            </div>
          ) : browse.error && games.length === 0 ? (
            <div className="catalog-error">
              <h3>Couldn’t load the catalog</h3>
              <p role="alert">{String(browse.error)}</p>
              <button
                className="button secondary"
                onClick={() => void browse.refetch()}
              >
                <RefreshCw size={16} /> Try again
              </button>
            </div>
          ) : games.length ? (
            <div
              className={
                layout === "grid" ? "games-grid library-grid" : "games-list"
              }
            >
              {games.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  downloadAvailable={availableDownloads.has(game.title)}
                  onClick={() => onSelect(game)}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Search size={34} />
              <h2>No games match these filters</h2>
              <p>Try another title, console, or genre.</p>
              <button
                className="button secondary"
                onClick={() => {
                  setGenre(null);
                  setQuery("");
                  setPlatform("all");
                }}
              >
                Clear filters
              </button>
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
                className="button secondary"
                disabled={browse.isFetchingNextPage}
                onClick={() => void browse.fetchNextPage()}
              >
                {browse.isFetchingNextPage && (
                  <LoaderCircle size={16} className="spin" />
                )}{" "}
                {browse.isFetchingNextPage ? "Loading…" : "Load more games"}
              </button>
            </div>
          )}
          <footer className="page-footer">
            <span>Game data and artwork from IGDB.</span>
            <span>Open a game to find downloads in your sources.</span>
          </footer>
        </>
      )}
    </div>
  );
}
