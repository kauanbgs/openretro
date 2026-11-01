import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { convertFileSrc } from "../services/transport";
import { appearanceStore } from "../services/appearance";
import "./AppBackdrop.css";

const isVideo = (path: string) => /\.(mp4|webm)$/i.test(path);

/**
 * The picture, video or gradient behind the whole interface. A video plays
 * muted and loops, and stops whenever it would only cost the player frames:
 * while a game runs, while the window is hidden, or when the system asks for
 * less motion.
 */
export function AppBackdrop({ paused }: { paused: boolean }) {
  const look = useSyncExternalStore(
    appearanceStore.subscribe,
    appearanceStore.snapshot,
  );
  const video = useRef<HTMLVideoElement>(null);
  const [hidden, setHidden] = useState(document.hidden);
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => setReduced(query.matches);
    document.addEventListener("visibilitychange", onVisibility);
    query.addEventListener("change", onMotion);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      query.removeEventListener("change", onMotion);
    };
  }, []);
  const { kind, gradient, media, dim, blur } = look.background;
  const stopped = paused || hidden || reduced;
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (stopped) element.pause();
    else void element.play().catch(() => undefined);
  }, [stopped, media, kind]);
  if (kind === "none") return null;
  const source = kind === "media" && media ? convertFileSrc(media) : null;
  return (
    <div
      className="app-backdrop"
      aria-hidden="true"
      style={
        kind === "gradient"
          ? {
              background: `linear-gradient(${gradient.angle}deg, ${gradient.from}, ${gradient.to})`,
            }
          : undefined
      }
    >
      {source &&
        (isVideo(media!) ? (
          <video
            ref={video}
            src={source}
            autoPlay={!stopped}
            loop
            muted
            playsInline
            disablePictureInPicture
            style={{ filter: blur ? `blur(${blur}px)` : undefined }}
          />
        ) : (
          <img
            src={source}
            alt=""
            style={{ filter: blur ? `blur(${blur}px)` : undefined }}
          />
        ))}
      <div className="app-backdrop-dim" style={{ opacity: dim }} />
    </div>
  );
}
