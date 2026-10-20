import {
  ArrowUpRight,
  ArrowRight,
  Gamepad2,
  Library,
  Sparkles,
} from "lucide-react";
import { Artwork } from "../../components/Artwork";
import { GameCard } from "../../components/GameCard";
import { catalog } from "../../providers/metadata/MockMetadataProvider";
import { isDesktop } from "../../services/bridge";
import { platformById } from "../../db/platforms";
import type { GameMetadata, LibraryGame } from "../../types";
export function HomePage({
  library,
  onSelect,
  onImport,
  onLibrary,
  onDiscover,
}: {
  library: LibraryGame[];
  onSelect: (game: GameMetadata) => void;
  onImport: () => void;
  onLibrary: () => void;
  onDiscover: () => void;
}) {
  const played = [...library]
    .filter((x) => x.item.lastPlayedAt)
    .sort((a, b) =>
      (b.item.lastPlayedAt ?? "").localeCompare(a.item.lastPlayedAt ?? ""),
    );
  const featured = played[0]?.game ?? catalog[0];
  return (
    <div className="home-content">
      <div className="welcome-line">
        <div>
          <span className="eyebrow">GOOD GAMES. GREAT MEMORIES.</span>
          <h1>
            Welcome home<span className="accent">.</span>
          </h1>
          <p>Your favorites are right where you left them.</p>
        </div>
        <span className="local-badge">
          <span className="status-dot" />
          {isDesktop
            ? "Your collection. Locally yours."
            : "Interactive browser preview"}
        </span>
      </div>
      <section className="featured-hero">
        <Artwork kind={featured.artwork} />
        <div className="hero-scrim" />
        <div className="hero-content">
          <div className="hero-kicker">
            <span className="tiny-pill">
              <span />
              {played.length ? "CONTINUE PLAYING" : "A NEW ADVENTURE AWAITS"}
            </span>
            <span>
              {platformById(featured.platformId)?.shortName} <b>·</b>{" "}
              {featured.year}
            </span>
          </div>
          <h2>
            {featured.title === "Astral Horizon" ? (
              <>
                Beyond the familiar.
                <br />
                Into the extraordinary.
              </>
            ) : (
              featured.title
            )}
          </h2>
          <p>
            {played.length
              ? "Pick up your story. There’s still a whole world out there."
              : "Rediscover the feeling of getting lost in a game.\nYour next great adventure starts here."}
          </p>
          <div className="hero-actions">
            <button
              className="button primary"
              onClick={() => onSelect(featured)}
            >
              {played.length ? (
                <Gamepad2 size={18} />
              ) : (
                <ArrowUpRight size={18} />
              )}{" "}
              {played.length ? "Continue adventure" : "Explore game"}
            </button>
            <button className="hero-secondary" onClick={() => onDiscover()}>
              Discover something new <ArrowRight size={16} />
            </button>
          </div>
        </div>
        <div className="hero-caption">
          <span className="hero-caption-line" />
          <span>
            {featured.title}
            <small>
              {played.length
                ? "FROM YOUR COLLECTION"
                : "FICTIONAL DEVELOPMENT SPOTLIGHT"}
            </small>
          </span>
        </div>
        <div className="hero-pagination">
          <i className="active" />
          <i />
          <i />
        </div>
      </section>
      {played.length > 0 && (
        <section className="game-section">
          <div className="section-heading">
            <h2>
              Continue playing <span>{played.length}</span>
            </h2>
            <button className="text-button" onClick={() => onLibrary()}>
              View library <ArrowRight size={15} />
            </button>
          </div>
          <div className="games-grid">
            {played.slice(0, 4).map((x) => (
              <GameCard
                key={x.item.id}
                game={x.game}
                item={x.item}
                onClick={() => onSelect(x.game)}
              />
            ))}
          </div>
        </section>
      )}
      <section className="game-section">
        <div className="section-heading">
          <div>
            <h2>
              {library.length ? "Recently added" : "Find your next favorite"}
              <span>{library.length || catalog.length}</span>
            </h2>
            <p>
              {library.length
                ? "Fresh additions to your personal collection."
                : "A few fictional worlds to explore while you make this space your own."}
            </p>
          </div>
          <button
            className="text-button"
            onClick={() => (library.length ? onLibrary() : onDiscover())}
          >
            View all <ArrowRight size={15} />
          </button>
        </div>
        <div className="games-grid">
          {(library.length
            ? library.slice(0, 4).map((x) => ({ game: x.game, item: x.item }))
            : catalog.slice(1, 5).map((game) => ({ game, item: undefined }))
          ).map((x) => (
            <GameCard
              key={x.game.id}
              game={x.game}
              item={x.item}
              onClick={() => onSelect(x.game)}
            />
          ))}
        </div>
      </section>
      <section className="library-banner">
        <div className="banner-icon">
          <Library size={26} />
        </div>
        <div>
          <h3>
            {library.length
              ? "Your library. Every era, one home."
              : "Every collection starts with one game."}
          </h3>
          <p>
            {library.length
              ? `${library.length} game${library.length === 1 ? "" : "s"} collected. Countless memories ahead.`
              : "Bring your classics together. We’ll take care of the details."}
          </p>
        </div>
        <button
          className="button secondary"
          onClick={() => (library.length ? onLibrary() : onImport())}
        >
          {library.length ? "Your Library" : "Import your first game"}
          <ArrowRight size={16} />
        </button>
      </section>
      <footer className="home-footer">
        <span>
          <Sparkles size={13} /> Built for the love of play.
        </span>
        <span>Open source. Yours to explore.</span>
      </footer>
    </div>
  );
}
