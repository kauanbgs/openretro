import { CalendarDays, Clock, Download, Heart, Library } from "lucide-react";
import type { GameMetadata, LibraryItem } from "../types";
import { platformById } from "../db/platforms";
import { GameArtwork } from "./GameArtwork";
import { t } from "../i18n";
import { formatPlaytime } from "../utils/format";
export function GameCard({
  game,
  item,
  downloadAvailable = false,
  note,
  onClick,
  onMenu,
}: {
  game: GameMetadata;
  item?: LibraryItem;
  downloadAvailable?: boolean;
  /** A short line under the title, such as why the game is suggested. */
  note?: string;
  onClick: () => void;
  /** Right-click or the menu key: actions for this game at that point. */
  onMenu?: (x: number, y: number) => void;
}) {
  const platform = platformById(game.platformId)?.shortName;
  return (
    <button
      className="game-card"
      onClick={onClick}
      onContextMenu={
        onMenu &&
        ((event) => {
          event.preventDefault();
          onMenu(event.clientX, event.clientY);
        })
      }
    >
      <GameArtwork game={game} hero loading="lazy" />
      {platform && <span className="game-card-platform">{platform}</span>}
      {item?.favorite && (
        <span className="game-card-favorite" aria-label={t("Favorito")}>
          <Heart size={13} fill="currentColor" />
        </span>
      )}
      <div className="game-card-content">
        <div className="game-card-title">
          <p>{game.title}</p>
        </div>
        {note && <small className="game-card-note">{note}</small>}
        <div className="game-card-specifics">
          {game.year > 0 && (
            <span>
              <CalendarDays size={13} /> {game.year}
            </span>
          )}
          {item?.playtime ? (
            <span>
              <Clock size={13} /> {formatPlaytime(item.playtime)}
            </span>
          ) : item ? (
            <span>
              <Library size={13} /> {t("Na biblioteca")}
            </span>
          ) : (
            downloadAvailable && (
              <span>
                <Download size={13} /> {t("Download disponível")}
              </span>
            )
          )}
        </div>
      </div>
    </button>
  );
}
