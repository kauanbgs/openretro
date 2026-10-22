import { CalendarDays, Download, Heart, Library } from "lucide-react";
import type { GameMetadata, LibraryItem } from "../types";
import { platformById } from "../db/platforms";
import { GameArtwork } from "./GameArtwork";
export function GameCard({
  game,
  item,
  downloadAvailable = false,
  onClick,
}: {
  game: GameMetadata;
  item?: LibraryItem;
  downloadAvailable?: boolean;
  onClick: () => void;
}) {
  return (
    <button className="game-card" onClick={onClick}>
      <GameArtwork game={game} hero loading="lazy" />
      <div className="game-card-content">
        <div className="game-card-title">
          <p>{game.title}</p>
          <span>{platformById(game.platformId)?.shortName}</span>
        </div>
        <div className="game-card-specifics">
          {game.year > 0 && (
            <span>
              <CalendarDays size={13} /> {game.year}
            </span>
          )}
          {item ? (
            <span>
              <Library size={13} /> Na biblioteca
            </span>
          ) : (
            downloadAvailable && (
              <span>
                <Download size={13} /> Download disponível
              </span>
            )
          )}
          {item?.favorite && (
            <span aria-label="Favorito">
              <Heart size={13} fill="currentColor" />
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
