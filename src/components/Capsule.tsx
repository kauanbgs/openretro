import type { GameMetadata } from "../types";
import { platformById } from "../db/platforms";
import { GameArtwork } from "./GameArtwork";

/** A store tile in the phone layout: the art, then the title and a detail
 * line below it. `cover` shows the box art, the default a wide screenshot. */
export function Capsule({
  game,
  detail,
  cover = false,
  onClick,
}: {
  game: GameMetadata;
  detail?: string;
  cover?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`capsule ${cover ? "capsule-cover" : ""}`}
      onClick={onClick}
    >
      <GameArtwork game={game} hero={!cover} loading="lazy" />
      <strong>{game.title}</strong>
      <small>
        {detail ??
          [platformById(game.platformId)?.shortName, game.year || null]
            .filter(Boolean)
            .join(", ")}
      </small>
    </button>
  );
}
