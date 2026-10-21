import { PageHeader } from "../../components/PageHeader";
import { useState } from "react";
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
import { platforms } from "../../db/platforms";
import type { GameMetadata, LibraryGame } from "../../types";
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
    [sort, setSort] = useState("recent");
  const visible = library
    .filter(
      (x) =>
        (filter !== "favorites" || x.item.favorite) &&
        (filter !== "unplayed" || !x.item.lastPlayedAt) &&
        (filter !== "recent" || Boolean(x.item.lastPlayedAt)) &&
        (platform === "all" || x.game.platformId === platform) &&
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
    );
  return (
    <div className="page-content">
      <PageHeader
        title="Library"
        description={
          library.length
            ? `${library.length} game${library.length === 1 ? "" : "s"} in your collection.`
            : "Your games live here."
        }
        actions={
          <button className="button primary" onClick={onImport}>
            <Plus size={18} /> Add game
          </button>
        }
      />
      <div className="library-toolbar">
        <div className="filter-tabs">
          <button
            className={filter === "all" ? "selected" : ""}
            onClick={() => setFilter("all")}
          >
            All games <span>{library.length}</span>
          </button>
          <button
            className={filter === "favorites" ? "selected" : ""}
            onClick={() => setFilter("favorites")}
          >
            <Heart size={14} /> Favorites
          </button>
          <button
            className={filter === "recent" ? "selected" : ""}
            onClick={() => setFilter("recent")}
          >
            Recently played
          </button>
          <button
            className={filter === "unplayed" ? "selected" : ""}
            onClick={() => setFilter("unplayed")}
          >
            Never played{" "}
            <span>{library.filter((x) => !x.item.lastPlayedAt).length}</span>
          </button>
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
          <select
            aria-label="Sort games"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="recent">Recently added</option>
            <option value="lastPlayed">Last played</option>
            <option value="title">Title A–Z</option>
            <option value="played">Most played</option>
          </select>
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
      {isPending ? (
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
              : "No games added yet"}
          </h2>
          <p>
            {library.length
              ? "Try a different search or platform filter."
              : "Download a game from your sources in Downloads, or add a file from your computer."}
          </p>
          <button
            className="button primary"
            onClick={() => {
              if (library.length) {
                setQuery("");
                setPlatform("all");
                setFilter("all");
              } else onImport();
            }}
          >
            {library.length ? (
              "Clear filters"
            ) : (
              <>
                <FolderOpen size={17} /> Add game
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
