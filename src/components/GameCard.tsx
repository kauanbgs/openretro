import { ArrowUpRight, Download, Heart } from "lucide-react";
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
      <div className="cover">
        <GameArtwork game={game} />
        <span className="platform-label">
          {platformById(game.platformId)?.shortName}
        </span>
        {item?.favorite && (
          <Heart className="card-heart" size={15} fill="currentColor" />
        )}
        {downloadAvailable && !item && (
          <span className="card-download" title="Download available">
            <Download size={13} /> Download
          </span>
        )}
        <span className="card-open">
          <ArrowUpRight size={20} />
        </span>
      </div>
      <div className="card-title">{game.title}</div>
      <div className="card-meta">
        {platformById(game.platformId)?.name}
        <span className="card-year">{game.year || "Year unknown"}</span>
      </div>
      <div className="card-status">
        <i className={item ? "installed" : ""} />
        {item ? "Local file" : game.genre}
      </div>
    </button>
  );
}
