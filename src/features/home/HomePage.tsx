import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Download,
  FolderOpen,
  Library,
  Play,
  Plus,
} from "lucide-react";
import { Artwork } from "../../components/Artwork";
import { GameArtwork } from "../../components/GameArtwork";
import { GameCard } from "../../components/GameCard";
import { PageHeader } from "../../components/PageHeader";
import {
  metadataProvider,
  catalogStatus,
} from "../../providers/metadata/IgdbMetadataProvider";
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
export function HomePage({
  library,
  onSelect,
  onImport,
  onLibrary,
  onDiscover,
  onDownloads,
}: Props) {
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
    retry: false,
  });
  const spotlight = useQuery({
    queryKey: ["catalog-spotlight"],
    queryFn: () => metadataProvider.browse(),
    enabled: status.data?.configured === true,
    retry: false,
    staleTime: 86400000,
  });
  const suggestions = spotlight.data?.games ?? [];
  const primary = played[0]?.game ?? suggestions[0];
  const details = useQuery({
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
    () => (primary ? enrichGameMetadata(primary, details.data) : undefined),
    [primary, details.data],
  );
  const shelf = library.slice(0, 3);
  return (
    <div className="page-content home-content">
      <PageHeader
        title="Início"
        description="Continue sua última partida ou descubra o próximo jogo."
        actions={
          <button className="text-button" onClick={onLibrary}>
            <Library size={16} /> Abrir biblioteca
          </button>
        }
      />
      <div className="home-lead">
        <section
          className="feature-stage"
          aria-label={played.length ? "Continue jogando" : "Jogo em destaque"}
        >
          {featured ? (
            <GameArtwork game={featured} hero />
          ) : (
            <Artwork kind="astral" />
          )}
          <div className="feature-shade" />
          <div className="feature-topline">
            <span className="feature-label">
              {played.length ? "Continue jogando" : "From the catalog"}
            </span>
            {featured && (
              <span className="feature-system">
                {platformById(featured.platformId)?.shortName}
              </span>
            )}
          </div>
          <div className="feature-copy">
            <h2>{featured?.title ?? "Your next game is out there."}</h2>
            {featured ? (
              <div className="feature-facts">
                <span>{platformById(featured.platformId)?.name}</span>
                <span>{featured.year || "Release year unknown"}</span>
              </div>
            ) : (
              <p>
                Explore the classics or add a game from your own collection.
              </p>
            )}
            <div className="hero-actions">
              <button
                className="button primary"
                onClick={() => (featured ? onSelect(featured) : onDiscover())}
              >
                {played.length ? (
                  <Play size={17} fill="currentColor" />
                ) : (
                  <ArrowUpRight size={18} />
                )}{" "}
                {played.length
                  ? "Continue game"
                  : featured
                    ? "View game"
                    : "Explore games"}
              </button>
              {featured && (
                <button className="button on-art" onClick={onDiscover}>
                  Explorar catálogo
                </button>
              )}
            </div>
          </div>
        </section>
        <aside className="collection-shelf">
          <div className="shelf-heading">
            <h2>Your collection</h2>
            <span>
              {library.length} {library.length === 1 ? "game" : "games"}
            </span>
          </div>
          {shelf.length ? (
            <div className="shelf-games">
              {shelf.map(({ game, item }) => (
                <button
                  className="shelf-game"
                  key={item.id}
                  onClick={() => onSelect(game)}
                >
                  <GameArtwork game={game} />
                  <span>
                    <strong>{game.title}</strong>
                    <small>{platformById(game.platformId)?.shortName}</small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="shelf-empty">
              <div className="cartridge-outline">
                <span />
                <i />
              </div>
              <h3>No games added yet</h3>
              <p>Download a game from your sources or add a local file.</p>
            </div>
          )}
          <button
            className="button secondary shelf-import"
            onClick={shelf.length ? onImport : onDownloads}
          >
            {shelf.length ? (
              <>
                <Plus size={17} /> Add a game
              </>
            ) : (
              <>
                <Download size={17} /> Find downloads
              </>
            )}
          </button>
        </aside>
      </div>
      {played.length > 0 && (
        <section className="game-section">
          <div className="section-heading">
            <h2>Continue jogando</h2>
            <button className="text-button" onClick={onLibrary}>
              Ver biblioteca
            </button>
          </div>
          <div className="games-grid home-game-grid">
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
              {library.length ? "Adicionados recentemente" : "Worth a look"}
            </h2>
            {!library.length && <p>Classics from the IGDB catalog.</p>}
          </div>
          <button
            className="text-button"
            onClick={library.length ? onLibrary : onDiscover}
          >
            {library.length ? "Ver biblioteca" : "Browse all games"}
            <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="games-grid home-game-grid">
          {(library.length
            ? library.slice(0, 4).map((x) => ({ game: x.game, item: x.item }))
            : suggestions.slice(1, 5).map((game) => ({ game, item: undefined }))
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
          <div className="catalog-invitation">
            <FolderOpen size={24} />
            <div>
              <h3>
                {status.data?.configured
                  ? "The catalog is unavailable right now."
                  : "Connect your game catalog."}
              </h3>
              <p>
                {status.data?.configured
                  ? "You can still add and play local games."
                  : "Set up IGDB to browse games and cover art."}
              </p>
            </div>
            <button className="button secondary" onClick={onDiscover}>
              {status.data?.configured ? "Open Discover" : "Connect IGDB"}
            </button>
          </div>
        )}
      </section>
      <footer className="page-footer">
        <span>OpenRetro</span>
        <span>Game data and artwork from IGDB.</span>
      </footer>
    </div>
  );
}
