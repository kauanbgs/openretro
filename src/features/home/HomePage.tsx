import {
  ArrowUpRight,
  ArrowRight,
  Gamepad2,
  Library,
  Sparkles,
} from "lucide-react";
import { Artwork } from "../../components/Artwork";
import { useMemo } from "react";
import { enrichGameMetadata } from "../../utils/metadata";
import { GameArtwork } from "../../components/GameArtwork";
import { useQuery } from "@tanstack/react-query";
import { GameCard } from "../../components/GameCard";
import {
  metadataProvider,
  catalogStatus,
} from "../../providers/metadata/IgdbMetadataProvider";
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
  const status = useQuery({
    queryKey: ["catalog-status"],
    queryFn: catalogStatus,
    retry: false,
  });
  const { data: spotlight } = useQuery({
    queryKey: ["catalog-spotlight"],
    queryFn: () => metadataProvider.browse(),
    enabled: status.data?.configured === true,
    retry: false,
    staleTime: 86400000,
  });
  const suggestions = spotlight?.games ?? [];
  const primary = played[0]?.game ?? suggestions[0];
  const { data: featureDetails } = useQuery({
    queryKey: ["game-detail", primary?.externalId, primary?.platformId],
    queryFn: () =>
      metadataProvider.getGame(
        `igdb-${primary!.externalId}`,
        primary!.platformId,
      ),
    enabled:
      status.data?.configured === true &&
      primary?.metadataProvider === "igdb" &&
      Boolean(primary?.externalId),
    retry: false,
    staleTime: 86400000,
  });
  const featured = useMemo(
    () => (primary ? enrichGameMetadata(primary, featureDetails) : undefined),
    [primary, featureDetails],
  );
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
        {featured ? (
          <GameArtwork game={featured} hero />
        ) : (
          <Artwork kind="astral" />
        )}
        <div className="hero-scrim" />
        <div className="hero-content">
          <div className="hero-kicker">
            <span className="tiny-pill">
              <span />
              {played.length ? "CONTINUE PLAYING" : "A NEW ADVENTURE AWAITS"}
            </span>
            <span>
              {featured ? platformById(featured.platformId)?.shortName : "IGDB"}{" "}
              <b>·</b> {featured?.year || "CLASSIC GAMES"}
            </span>
          </div>
          <h2>
            {!featured ? (
              <>
                A world of classics.
                <br />
                One place to play.
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
              onClick={() => (featured ? onSelect(featured) : onDiscover())}
            >
              {played.length ? (
                <Gamepad2 size={18} />
              ) : (
                <ArrowUpRight size={18} />
              )}{" "}
              {played.length
                ? "Continue adventure"
                : featured
                  ? "Explore game"
                  : "Explore the catalog"}
            </button>
            <button className="hero-secondary" onClick={() => onDiscover()}>
              Discover something new <ArrowRight size={16} />
            </button>
          </div>
        </div>
        <div className="hero-caption">
          <span className="hero-caption-line" />
          <span>
            {featured?.title ?? "Every era. One home."}
            <small>
              {played.length ? "FROM YOUR COLLECTION" : "POWERED BY IGDB"}
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
              <span>{library.length || suggestions.length}</span>
            </h2>
            <p>
              {library.length
                ? "Fresh additions to your personal collection."
                : "Real games from IGDB, ready to join your personal collection."}
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
            : suggestions.slice(0, 4).map((game) => ({ game, item: undefined }))
          ).map((x) => (
            <GameCard
              key={x.game.id}
              game={x.game}
              item={x.item}
              onClick={() => onSelect(x.game)}
            />
          ))}
        </div>
        {!library.length && !suggestions.length && (
          <div className="home-catalog-prompt">
            <Gamepad2 size={27} />
            <div>
              <h3>
                {status.data?.configured
                  ? "Your catalog is ready to explore."
                  : "Connect your real game catalog."}
              </h3>
              <p>Browse games by console and genre with IGDB.</p>
            </div>
            <button className="button secondary" onClick={onDiscover}>
              {status.data?.configured ? "Open Discover" : "Set up IGDB"}
              <ArrowRight size={15} />
            </button>
          </div>
        )}
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
