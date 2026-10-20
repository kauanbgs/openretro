import { useState } from "react";
import {
  Plus,
  Sparkles,
  Heart,
  SlidersHorizontal,
  LayoutGrid,
  List,
  Library,
  FolderOpen,
  Search,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { GameCard } from "../../components/GameCard";
import { platforms } from "../../db/platforms";
import {
  catalog,
  metadataProvider,
} from "../../providers/metadata/MockMetadataProvider";
import type { GameMetadata, LibraryGame } from "../../types";
interface Props {
  page: "Library" | "Discover";
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
  page,
  library,
  isPending,
  query,
  setQuery,
  platform,
  setPlatform,
  onSelect,
  onImport,
}: Props) {
  const [filter, setFilter] = useState("all");
  const [layout, setLayout] = useState("grid");
  const [sort, setSort] = useState("recent");
  const { data: results = [] } = useQuery({
    queryKey: ["metadata", query],
    queryFn: () => metadataProvider.search(query),
  });
  const visible = library
    .filter(
      (x) =>
        (filter !== "favorites" || x.item.favorite) &&
        (platform === "all" || x.game.platformId === platform) &&
        x.game.title.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "title"
        ? a.game.title.localeCompare(b.game.title)
        : sort === "played"
          ? b.item.playtime - a.item.playtime
          : b.item.addedAt.localeCompare(a.item.addedAt),
    );
  const discovered = results.filter(
    (g) => platform === "all" || g.platformId === platform,
  );

  return (
    <div className="page-content">
      <div className="page-title">
        <div>
          <span className="eyebrow">
            {page === "Library"
              ? "EVERY ERA. ONE HOME."
              : "THERE’S ALWAYS ANOTHER ADVENTURE"}
          </span>
          <h1>
            {page === "Library" ? "Your library" : "Discover"}
            <span className="accent">.</span>
          </h1>
          <p>
            {page === "Library"
              ? `${library.length} game${library.length === 1 ? "" : "s"}. A collection that’s unmistakably yours.`
              : "Explore the development catalog. Bring your own authorized game files."}
          </p>
        </div>
        {page === "Library" ? (
          <button className="button primary" onClick={() => onImport()}>
            <Plus size={18} /> Add a game
          </button>
        ) : (
          <span className="badge">
            <Sparkles size={14} /> Fictional metadata
          </span>
        )}
      </div>
      <div className="library-toolbar">
        <div className="filter-tabs">
          <button
            className={filter === "all" ? "selected" : ""}
            onClick={() => setFilter("all")}
          >
            All games{" "}
            <span>{page === "Library" ? library.length : catalog.length}</span>
          </button>
          {page === "Library" && (
            <button
              className={filter === "favorites" ? "selected" : ""}
              onClick={() => setFilter("favorites")}
            >
              <Heart size={14} /> Favorites
            </button>
          )}
        </div>
        <div className="toolbar-right">
          <SlidersHorizontal size={15} />
          <select
            aria-label="Filter by platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
          >
            <option value="all">All platforms</option>
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {page === "Library" && (
            <select
              aria-label="Sort games"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="recent">Recently added</option>
              <option value="title">Title A–Z</option>
              <option value="played">Most played</option>
            </select>
          )}
          <div className="view-toggle">
            <button
              className={layout === "grid" ? "selected" : ""}
              aria-label="Grid view"
              onClick={() => setLayout("grid")}
            >
              <LayoutGrid size={16} />
            </button>
            <button
              className={layout === "list" ? "selected" : ""}
              aria-label="List view"
              onClick={() => setLayout("list")}
            >
              <List size={17} />
            </button>
          </div>
        </div>
      </div>
      {page === "Library" ? (
        isPending ? (
          <p className="muted">Opening your collection…</p>
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
                ? "No games match this view."
                : "A home for your favorite worlds."}
            </h2>
            <p>
              {library.length
                ? "Try a different search or platform filter."
                : "Import your first local game, choose an emulator, and make yourself at home."}
            </p>
            <button
              className="button primary"
              onClick={() =>
                library.length
                  ? (setQuery(""), setPlatform("all"), setFilter("all"))
                  : onImport()
              }
            >
              {library.length ? (
                "Clear filters"
              ) : (
                <>
                  <FolderOpen size={17} /> Import your first game
                </>
              )}
            </button>
          </div>
        )
      ) : discovered.length ? (
        <div
          className={
            layout === "grid" ? "games-grid library-grid" : "games-list"
          }
        >
          {discovered.map((g) => (
            <GameCard key={g.id} game={g} onClick={() => onSelect(g)} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Search size={32} />
          <h2>No adventures found.</h2>
          <p>Try another title, genre, or platform.</p>
          <button
            className="button secondary"
            onClick={() => {
              setQuery("");
              setPlatform("all");
            }}
          >
            Reset search
          </button>
        </div>
      )}
    </div>
  );
}
