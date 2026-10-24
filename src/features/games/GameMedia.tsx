import { useState } from "react";
import { ChevronLeft, ChevronRight, Expand, Play } from "lucide-react";
import type { GameMetadata } from "../../types";
import { CatalogScreenshot } from "../../components/CatalogScreenshot";
import { t } from "../../i18n";

export interface GalleryImage {
  src: string;
  caption: string;
  referrer?: React.HTMLAttributeReferrerPolicy;
}

/** One shared gallery: previews stay on the page; playback opens the viewer. */
export function GameMedia({
  game,
  images,
  onImage,
  onTrailer,
}: {
  game: GameMetadata;
  images: GalleryImage[];
  onImage: (index: number) => void;
  onTrailer: (id: string) => void;
}) {
  const [selected, setSelected] = useState(0);
  const media = [
    ...(game.trailers ?? []).map((video) => ({
      key: `video-${video.id}`,
      src: `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
      caption: video.name,
      video: true,
      open: () => onTrailer(video.id),
    })),
    ...images.map((image, index) => ({
      key: `image-${image.src}-${index}`,
      ...image,
      video: false,
      open: () => onImage(index),
    })),
  ];
  if (!media.length) return null;
  const index = Math.min(selected, media.length - 1);
  const current = media[index];
  const step = (direction: number) =>
    setSelected((index + direction + media.length) % media.length);

  return (
    <section className="game-media" aria-label={t("Imagens e vídeos")}>
      <div className="game-media-stage">
        <button
          className="game-media-open"
          onClick={current.open}
          aria-label={
            current.video
              ? t("Assistir trailer")
              : t("Ampliar {caption}", { caption: current.caption })
          }
        >
          <img
            src={current.src}
            alt={current.caption}
            referrerPolicy="no-referrer"
            decoding="async"
          />
          <span
            className={`game-media-open-icon ${current.video ? "is-video" : ""}`}
          >
            {current.video ? (
              <Play size={28} fill="currentColor" />
            ) : (
              <Expand size={19} />
            )}
          </span>
        </button>
        {media.length > 1 && (
          <>
            <button
              className="game-media-arrow previous"
              aria-label={t("Mídia anterior")}
              onClick={() => step(-1)}
            >
              <ChevronLeft size={20} />
            </button>
            <button
              className="game-media-arrow next"
              aria-label={t("Próxima mídia")}
              onClick={() => step(1)}
            >
              <ChevronRight size={20} />
            </button>
          </>
        )}
        <span className="game-media-count" aria-live="polite">
          {index + 1} / {media.length}
        </span>
      </div>
      <div className="game-media-thumbnails" aria-label={t("Selecionar mídia")}>
        {media.map((item, i) => (
          <button
            key={item.key}
            className={index === i ? "selected" : ""}
            aria-pressed={index === i}
            aria-label={item.caption}
            onClick={() => setSelected(i)}
          >
            <CatalogScreenshot
              src={item.src}
              alt=""
              referrerPolicy="no-referrer"
            />
            {item.video && <Play size={18} fill="currentColor" />}
          </button>
        ))}
      </div>
    </section>
  );
}
