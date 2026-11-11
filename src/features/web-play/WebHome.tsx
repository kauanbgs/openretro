// The Home of the web build: the desktop HomePage's layout, filled from the
// game list instead of the LaunchBox catalog.
import { useMemo, useState } from "react";
import { ChevronRight, Dices, Gamepad2, History, Sparkles } from "lucide-react";
import { GameArtwork } from "../../components/GameArtwork";
import { GameCard } from "../../components/GameCard";
import { Shelf } from "../../components/Shelf";
import { PixelLandscape } from "../../components/PixelLandscape";
import { platformById } from "../../db/platforms";
import type { GameMetadata, LibraryGame } from "../../types";
import { t } from "../../i18n";

const GRID_SIZE = 24;

export function WebHome({
  library,
  isPending,
  onSelect,
  onLibrary,
}: {
  library: LibraryGame[];
  isPending: boolean;
  onSelect: (game: GameMetadata) => void;
  onLibrary: () => void;
}) {
  const played = useMemo(
    () =>
      library
        .filter((x) => x.item.lastPlayedAt)
        .sort((a, b) =>
          (b.item.lastPlayedAt ?? "").localeCompare(a.item.lastPlayedAt ?? ""),
        ),
    [library],
  );
  // One tab per console in the list, in the order the consoles first appear.
  const consoles = useMemo(
    () => [...new Set(library.map((x) => x.game.platformId))],
    [library],
  );
  const [category, setCategory] = useState("all");
  const featured =
    played[0]?.game ??
    library.find((x) => x.game.description)?.game ??
    library[0]?.game;
  const grid = library
    .filter((x) => x.game.id !== featured?.id)
    .filter((x) => category === "all" || x.game.platformId === category)
    .slice(0, GRID_SIZE);
  const shelf = played.length ? played : library.slice(0, 12);

  return (
    <div className="page-content home">
      {featured ? (
        <button className="hero" onClick={() => onSelect(featured)}>
          <GameArtwork game={featured} hero />
          <div className="hero-backdrop">
            <div className="hero-content">
              <small>
                {played.length ? t("Continue jogando") : t("Destaque")}
              </small>
              <h2>{featured.title}</h2>
              <p>
                {featured.description || t("Jogue agora, direto no navegador.")}
              </p>
              <span>
                {platformById(featured.platformId)?.name}
                {featured.year ? `, ${featured.year}` : ""}
              </span>
            </div>
          </div>
        </button>
      ) : (
        <div className="hero hero-empty">
          <div className="artwork">
            <PixelLandscape />
          </div>
          <div className="hero-backdrop">
            <div className="hero-content">
              <h2>
                {isPending
                  ? t("Carregando jogos…")
                  : t("Seus clássicos começam aqui")}
              </h2>
              <p>
                {t("Jogos que rodam direto no navegador, sem instalar nada.")}
              </p>
            </div>
          </div>
        </div>
      )}
      {shelf.length > 0 && (
        <section
          className="library-shelf"
          aria-label={
            played.length ? t("Jogados recentemente") : t("Destaques")
          }
        >
          <div className="section-head">
            <h2 className="home-section-title">
              {played.length ? (
                <History size={20} aria-hidden="true" />
              ) : (
                <Sparkles size={20} aria-hidden="true" />
              )}
              {played.length ? t("Jogados recentemente") : t("Destaques")}
              <small>{played.length || library.length}</small>
            </h2>
            <button className="section-link" onClick={onLibrary}>
              {t("Ver tudo")}
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
          <Shelf>
            {shelf.map(({ game, item }) => (
              <GameCard
                key={item.id}
                game={game}
                item={item}
                onClick={() => onSelect(game)}
              />
            ))}
          </Shelf>
        </section>
      )}
      {library.length > 0 && (
        <>
          <div className="home-categories">
            <div role="tablist" aria-label={t("Consoles")}>
              {["all", ...consoles].map((id) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={category === id}
                  className={`button ${category === id ? "primary" : "outline"}`}
                  onClick={() => setCategory(id)}
                >
                  {id === "all" && <Gamepad2 size={16} aria-hidden="true" />}
                  {id === "all"
                    ? t("Todos")
                    : (platformById(id)?.shortName ?? id)}
                </button>
              ))}
            </div>
            <button
              className="button outline"
              onClick={() => {
                const pick =
                  library[Math.floor(Math.random() * library.length)];
                if (pick) onSelect(pick.game);
              }}
            >
              <Dices size={15} /> {t("Me surpreenda")}
            </button>
          </div>
          <h2 className="home-section-title">
            <Gamepad2 size={20} aria-hidden="true" />
            {category === "all"
              ? t("Todos os jogos")
              : platformById(category)?.name}
          </h2>
          <div className="cards-grid">
            {grid.map(({ game, item }) => (
              <GameCard
                key={item.id}
                game={game}
                item={item}
                onClick={() => onSelect(game)}
              />
            ))}
          </div>
          <div className="empty-panel">
            <button className="button outline" onClick={onLibrary}>
              {t("Ver todos os {count} jogos", { count: library.length })}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
