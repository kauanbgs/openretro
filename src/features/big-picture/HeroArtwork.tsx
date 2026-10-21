import { useEffect, useRef, useState } from "react";
import type { GameMetadata } from "../../types";
import { GameArtwork } from "../../components/GameArtwork";

const imageUrl = (game: GameMetadata) =>
  game.backgroundUrl ?? game.screenshots?.[0] ?? game.coverUrl;

/** Keep the previous image visible until the next image is actually decoded. */
export function HeroArtwork({ game }: { game: GameMetadata }) {
  const [current, setCurrent] = useState(game);
  const [previous, setPrevious] = useState<GameMetadata>();
  const displayed = useRef(game);
  const url = imageUrl(game);
  useEffect(() => {
    if (url === imageUrl(displayed.current)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const reveal = () => {
      if (cancelled) return;
      setPrevious(displayed.current);
      displayed.current = game;
      setCurrent(game);
      timer = setTimeout(() => setPrevious(undefined), 440);
    };
    const image = new Image();
    if (url) {
      image.onload = reveal;
      image.onerror = reveal;
      image.src = url;
    } else reveal();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
    };
  }, [game.id, url]);
  const layer = (entry: GameMetadata, old = false) => (
    <div
      key={`${old ? "previous" : "current"}-${imageUrl(entry) ?? entry.id}`}
      className={`tv-hero-image ${old ? "previous" : "current"} ${entry.backgroundUrl || entry.screenshots?.length ? "" : "cover-only"}`}
    >
      <GameArtwork
        game={{
          ...entry,
          backgroundUrl: entry.backgroundUrl ?? entry.screenshots?.[0],
        }}
        hero
      />
    </div>
  );
  return (
    <div className="tv-hero-media" aria-hidden="true">
      {previous && layer(previous, true)}
      {layer(current)}
    </div>
  );
}
