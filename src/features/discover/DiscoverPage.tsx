import { useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Compass,
  Gamepad2,
  Grid2X2,
  List,
  LoaderCircle,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  metadataProvider,
  catalogStatus,
} from "../../providers/metadata/IgdbMetadataProvider";
import { platforms } from "../../db/platforms";
import { GameCard } from "../../components/GameCard";
import { CatalogConnection } from "./CatalogConnection";
import type { CatalogRequest } from "../../providers/metadata/types";
import type { GameMetadata } from "../../types";
export function DiscoverPage({
  query,
  setQuery,
  platform,
  setPlatform,
  onSelect,
}: {
  query: string;
  setQuery: (s: string) => void;
  platform: string;
  setPlatform: (s: string) => void;
  onSelect: (game: GameMetadata) => void;
}) {
  const [debounced, setDebounced] = useState(query);
  const [genre, setGenre] = useState<number | null>(null);
  const [sort, setSort] =
    useState<NonNullable<CatalogRequest["sort"]>>("popular");
  const [layout, setLayout] = useState("grid");
  const [family, setFamily] = useState("All");
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
    queryKey: ["catalog", debounced, platform, genre, sort],
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
  const loaded = [
    ...new Map(
      (browse.data?.pages.flatMap((p) => p.games) ?? []).map((game) => [
        game.id,
        game,
      ]),
    ).values(),
  ];
  const visible = loaded;

  const available = taxonomy.data?.platforms ?? [];
  const consoles = platforms.filter(
    (p) =>
      available.some((remote) => remote.localId === p.id) &&
      (family === "All" ||
        (family === "Other" ? !p.manufacturer : p.manufacturer === family)),
  );
  async function retry() {
    await client.invalidateQueries({ queryKey: ["catalog-status"] });
    await client.invalidateQueries({ queryKey: ["catalog-taxonomy"] });
    await client.invalidateQueries({ queryKey: ["catalog"] });
  }
  return (
    <div className="page-content discover-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">A CLASSIC FOR EVERY KIND OF PLAYER</span>
          <h1>
            Discover<span className="accent">.</span>
          </h1>
          <p>Real games. Iconic consoles. Find your next adventure.</p>
        </div>
        <a
          className="catalog-attribution"
          href="https://www.igdb.com/"
          target="_blank"
          rel="noreferrer"
        >
          <DatabaseMark /> Powered by <strong>IGDB</strong>
        </a>
      </div>
      {status.isPending ? (
        <div className="catalog-loading">
          <LoaderCircle className="spin" size={24} />
          <p>Connecting to your game catalog…</p>
        </div>
      ) : !status.data?.configured || status.error ? (
        <CatalogConnection
          error={status.error ? String(status.error) : undefined}
          onRetry={() => void retry()}
        />
      ) : (
        <>
          <section className="console-section">
            <div className="section-heading">
              <h2>Browse by console</h2>
              <div className="family-filters">
                {["All", "Nintendo", "Sega", "Sony", "Other"].map((f) => (
                  <button
                    key={f}
                    className={family === f ? "selected" : ""}
                    onClick={() => setFamily(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <div className="console-grid">
              <button
                className={`console-card ${platform === "all" ? "selected" : ""}`}
                onClick={() => setPlatform("all")}
              >
                <Compass size={23} />
                <strong>All consoles</strong>
                <span>{available.length} supported systems</span>
              </button>
              {consoles.map((p) => (
                <button
                  className={`console-card ${platform === p.id ? "selected" : ""}`}
                  key={p.id}
                  onClick={() => setPlatform(p.id)}
                >
                  <Gamepad2 size={23} />
                  <strong>{p.shortName}</strong>
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="catalog-results">
            <div className="catalog-search">
              <Search size={19} />
              <input
                aria-label="Search IGDB"
                maxLength={120}
                value={query}
                placeholder="Search real games by title…"
                onChange={(e) => setQuery(e.target.value)}
              />
              {browse.isFetching && <LoaderCircle size={17} className="spin" />}
            </div>
            <div className="genre-filters">
              <button
                className={genre === null ? "selected" : ""}
                onClick={() => setGenre(null)}
              >
                All genres
              </button>
              {(taxonomy.data?.genres ?? []).map((g) => (
                <button
                  key={g.id}
                  className={genre === g.id ? "selected" : ""}
                  onClick={() => setGenre(g.id)}
                >
                  {g.name}
                  {loaded.some((game) => game.genreIds?.includes(g.id)) && (
                    <span>
                      {
                        loaded.filter((game) => game.genreIds?.includes(g.id))
                          .length
                      }
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="catalog-result-heading">
              <div>
                <h2>
                  {query
                    ? `Results for “${debounced}”`
                    : platform === "all"
                      ? "Explore the classics"
                      : platforms.find((p) => p.id === platform)?.name}
                </h2>
                <p>
                  {visible.length} shown · {loaded.length} games loaded
                  {genre !== null ? " · Filtered by genre on IGDB" : ""}
                </p>
              </div>
              <div className="toolbar-right">
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
                    {debounced ? "Search relevance" : "Most rated"}
                  </option>
                  <option value="rating">Highest rated</option>
                  <option value="title">Title A–Z</option>
                  <option value="oldest">Oldest first</option>
                  <option value="newest">Newest first</option>
                </select>
                <div className="view-toggle">
                  <button
                    className={layout === "grid" ? "selected" : ""}
                    aria-label="Grid view"
                    onClick={() => setLayout("grid")}
                  >
                    <Grid2X2 size={16} />
                  </button>
                  <button
                    className={layout === "list" ? "selected" : ""}
                    aria-label="List view"
                    onClick={() => setLayout("list")}
                  >
                    <List size={16} />
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
                <LoaderCircle className="spin" size={25} />
                <p>Finding your next adventure…</p>
              </div>
            ) : browse.error && loaded.length === 0 ? (
              <div className="catalog-error">
                <h3>The catalog couldn’t be loaded.</h3>
                <p role="alert">{String(browse.error)}</p>
                <button
                  className="button secondary"
                  onClick={() => void browse.refetch()}
                >
                  <RefreshCw size={15} /> Try again
                </button>
              </div>
            ) : visible.length ? (
              <div
                className={
                  layout === "grid" ? "games-grid library-grid" : "games-list"
                }
              >
                {visible.map((game) => (
                  <GameCard
                    key={game.id}
                    game={game}
                    onClick={() => onSelect(game)}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <Search size={30} />
                <h2>
                  {genre !== null
                    ? "No games match this genre."
                    : "No games found."}
                </h2>
                <p>
                  {genre !== null && browse.hasNextPage
                    ? "Load another page or choose a different genre."
                    : "Try another title, genre, or console."}
                </p>
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
            {browse.error && loaded.length > 0 && (
              <p role="alert" className="error-message">
                {String(browse.error)}
              </p>
            )}
            {browse.hasNextPage && (
              <div className="load-more">
                <button
                  className="button secondary"
                  disabled={browse.isFetchingNextPage}
                  onClick={() => void browse.fetchNextPage()}
                >
                  {browse.isFetchingNextPage ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <Gamepad2 size={16} />
                  )}{" "}
                  {browse.isFetchingNextPage
                    ? "Loading more classics…"
                    : "Load more games"}
                </button>
                <small>Pages are cached locally for faster browsing.</small>
              </div>
            )}
            <footer className="catalog-footer">
              <span>Game data and artwork provided by IGDB.</span>
              <span>Metadata only · Bring your own game files</span>
            </footer>
          </section>
        </>
      )}
    </div>
  );
}
function DatabaseMark() {
  return <span className="provider-mark">IG</span>;
}
