import { isCatalogGame } from "../providers/metadata/LaunchboxMetadataProvider";
import { memo, useState } from "react";
import type { GameMetadata } from "../types";
import { Artwork } from "./Artwork";
import { ImageOff } from "lucide-react";
import { t } from "../i18n";
export const GameArtwork = memo(
  function GameArtwork({
    game,
    hero = false,
    loading,
  }: {
    game: GameMetadata;
    hero?: boolean;
    loading?: "lazy" | "eager";
  }) {
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    const url = hero ? (game.backgroundUrl ?? game.coverUrl) : game.coverUrl;
    if (url && failedUrl !== url)
      return (
        <div className={`artwork remote-artwork ${hero ? "remote-hero" : ""}`}>
          <img
            src={url}
            alt={hero ? "" : t("Capa de {title}", { title: game.title })}
            loading={loading ?? (hero ? "eager" : "lazy")}
            decoding="async"
            referrerPolicy="no-referrer"
            fetchPriority={hero && loading !== "lazy" ? "high" : "auto"}
            draggable={false}
            onError={() => setFailedUrl(url)}
          />
        </div>
      );
    if (!isCatalogGame(game) && game.artwork !== "neutral")
      return <Artwork kind={game.artwork} title={!hero} />;
    return (
      <div className="artwork missing-artwork">
        <ImageOff size={hero ? 54 : 32} />
        <span>{hero ? "" : game.title}</span>
        <small>{t("Imagem indisponível")}</small>
      </div>
    );
  },
  (a, b) =>
    a.hero === b.hero &&
    a.loading === b.loading &&
    a.game.title === b.game.title &&
    a.game.artwork === b.game.artwork &&
    a.game.metadataProvider === b.game.metadataProvider &&
    (a.hero ? (a.game.backgroundUrl ?? a.game.coverUrl) : a.game.coverUrl) ===
      (b.hero ? (b.game.backgroundUrl ?? b.game.coverUrl) : b.game.coverUrl),
);
