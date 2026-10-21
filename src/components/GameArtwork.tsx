import { useState } from "react";
import type { GameMetadata } from "../types";
import { Artwork } from "./Artwork";
import { ImageOff } from "lucide-react";
export function GameArtwork({
  game,
  hero = false,
  loading,
}: {
  game: GameMetadata;
  hero?: boolean;
  loading?: "lazy" | "eager";
}) {
  const [failed, setFailed] = useState(false);
  const url = hero ? (game.backgroundUrl ?? game.coverUrl) : game.coverUrl;
  if (url && !failed)
    return (
      <div className={`artwork remote-artwork ${hero ? "remote-hero" : ""}`}>
        <img
          src={url}
          alt={hero ? "" : `${game.title} cover`}
          loading={loading ?? (hero ? "eager" : "lazy")}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      </div>
    );
  if (game.metadataProvider !== "igdb" && game.artwork !== "neutral")
    return <Artwork kind={game.artwork} title={!hero} />;
  return (
    <div className="artwork missing-artwork">
      <ImageOff size={hero ? 54 : 32} />
      <span>{hero ? "" : game.title}</span>
      <small>Artwork unavailable</small>
    </div>
  );
}
