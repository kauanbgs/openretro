import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { BrandMark } from "../../components/Brand";
import { GameArtwork } from "../../components/GameArtwork";
import type { GameMetadata } from "../../types";

/** Heavy decorative layers are skipped when motion is off. */
export const motionEnabled = () =>
  document.documentElement.dataset.animations !== "false" &&
  !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const cardSelector = ".tv-game-grid > button, .tv-catalog-grid > button";

/** Plays once when the console opens; any input or 2.2s dismisses it. */
export function BootSplash() {
  const [phase, setPhase] = useState<"on" | "out" | "done">(() =>
    motionEnabled() ? "on" : "done",
  );
  useEffect(() => {
    if (!motionEnabled()) return;
    const leave = () => setPhase((value) => (value === "on" ? "out" : value));
    const out = window.setTimeout(leave, 1700);
    const done = window.setTimeout(() => setPhase("done"), 2300);
    window.addEventListener("keydown", leave);
    window.addEventListener("pointerdown", leave);
    return () => {
      window.clearTimeout(out);
      window.clearTimeout(done);
      window.removeEventListener("keydown", leave);
      window.removeEventListener("pointerdown", leave);
    };
  }, []);
  useEffect(() => {
    if (phase !== "out") return;
    const timer = window.setTimeout(() => setPhase("done"), 600);
    return () => window.clearTimeout(timer);
  }, [phase]);
  if (phase === "done") return null;
  return (
    <div
      className={`fx-boot ${phase === "out" ? "leaving" : ""}`}
      aria-hidden="true"
    >
      <div className="fx-boot-rings">
        <i />
        <i />
        <i />
      </div>
      <div className="fx-boot-logo">
        <BrandMark />
      </div>
      <div className="fx-boot-word">
        {"OPENRETRO".split("").map((letter, index) => (
          <span key={index} style={{ "--i": index } as CSSProperties}>
            {letter}
          </span>
        ))}
      </div>
      <div className="fx-boot-bar">
        <i />
      </div>
    </div>
  );
}

/**
 * Living background: blurred art of whatever card has focus, drifting aurora,
 * a retro perspective grid and floating particles. Follows focus through DOM
 * events, so grids need no extra wiring.
 */
export function AmbientBackdrop({
  root,
  fallback,
  watch,
}: {
  root: React.RefObject<HTMLElement | null>;
  fallback?: string;
  /** Changing it (e.g. the section) re-reads the art from the page. */
  watch?: string;
}) {
  const [layers, setLayers] = useState<{ url: string; id: number }[]>(() =>
    fallback ? [{ url: fallback, id: 0 }] : [],
  );
  const current = useRef(fallback);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = (url?: string) => {
    if (!url || url === current.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      current.current = url;
      setLayers((value) => [...value.slice(-1), { url, id: Date.now() }]);
    }, 140);
  };
  useEffect(() => show(fallback), [fallback]);
  useEffect(() => {
    const read = window.setTimeout(
      () =>
        show(
          root.current?.querySelector<HTMLImageElement>(
            ".tv-hero-image.current img, .tv-game-grid > button.focused img, .tv-catalog-grid > button.focused img",
          )?.currentSrc || undefined,
        ),
      900,
    );
    return () => window.clearTimeout(read);
  }, [watch, root]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const pick = (event: Event) => {
      const card = (event.target as Element | null)?.closest?.(cardSelector);
      show(card?.querySelector("img")?.currentSrc || undefined);
    };
    element.addEventListener("focusin", pick);
    element.addEventListener("mouseover", pick);
    return () => {
      clearTimeout(timer.current);
      element.removeEventListener("focusin", pick);
      element.removeEventListener("mouseover", pick);
    };
  }, [root]);
  const particles = useMemo(
    () =>
      Array.from({ length: 26 }, (_, index) => ({
        "--x": `${(index * 37 + 11) % 100}%`,
        "--s": `${2 + (index % 4)}px`,
        "--d": `${14 + ((index * 7) % 16)}s`,
        "--delay": `${-((index * 13) % 24)}s`,
        "--drift": `${((index % 5) - 2) * 18}px`,
      })),
    [],
  );
  return (
    <div className="fx-ambient" aria-hidden="true">
      {layers.map((layer, index) => (
        <img
          key={layer.id}
          className={`fx-ambient-art ${index === layers.length - 1 ? "current" : "previous"}`}
          src={layer.url}
          alt=""
          referrerPolicy="no-referrer"
          draggable={false}
        />
      ))}
      <i className="fx-aurora a" />
      <i className="fx-aurora b" />
      <i className="fx-aurora c" />
      <div className="fx-grid-floor" />
      <div className="fx-particles">
        {particles.map((style, index) => (
          <i key={index} style={style as CSSProperties} />
        ))}
      </div>
      <div className="fx-vignette" />
      <div className="fx-scanlines" />
    </div>
  );
}

/** Pointer-driven 3D tilt and glare for grid cards. */
export function useCardTilt(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = root.current;
    if (!element || !motionEnabled()) return;
    let frame = 0;
    let active: HTMLElement | null = null;
    const reset = (card: HTMLElement | null) => {
      card?.style.removeProperty("--rx");
      card?.style.removeProperty("--ry");
      card?.style.removeProperty("--mx");
      card?.style.removeProperty("--my");
      card?.removeAttribute("data-tilting");
    };
    const move = (event: PointerEvent) => {
      const card = (event.target as Element | null)?.closest?.(
        cardSelector,
      ) as HTMLElement | null;
      if (card !== active) {
        reset(active);
        active = card;
      }
      if (!card) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = card.getBoundingClientRect();
        const x = (event.clientX - box.left) / box.width;
        const y = (event.clientY - box.top) / box.height;
        card.style.setProperty("--ry", `${(x - 0.5) * 14}deg`);
        card.style.setProperty("--rx", `${(0.5 - y) * 12}deg`);
        card.style.setProperty("--mx", `${x * 100}%`);
        card.style.setProperty("--my", `${y * 100}%`);
        card.setAttribute("data-tilting", "");
      });
    };
    const leave = () => {
      reset(active);
      active = null;
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerleave", leave);
    };
  }, [root]);
}

export function ConsoleClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <time className="fx-clock" dateTime={now.toISOString()}>
      {now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
    </time>
  );
}

/** Full-screen warp shown while the resolver and emulator start. */
export function LaunchSequence({ game }: { game?: GameMetadata }) {
  return (
    <div className="tv-launching fx-launch" role="status" aria-live="polite">
      {game && (
        <div className="fx-launch-art" aria-hidden="true">
          <GameArtwork
            game={{
              ...game,
              backgroundUrl: game.backgroundUrl ?? game.screenshots?.[0],
            }}
            hero
          />
        </div>
      )}
      <div className="fx-launch-warp" aria-hidden="true">
        {Array.from({ length: 24 }, (_, index) => (
          <i key={index} style={{ "--i": index } as CSSProperties} />
        ))}
      </div>
      <div className="fx-launch-core" aria-hidden="true">
        <i />
        <i />
        <i />
        <span>
          <BrandMark />
        </span>
      </div>
      <p className="fx-launch-kicker">Preparando o jogo</p>
      <h2>{game?.title ?? "Iniciando"}</h2>
      <p>Verificando o emulador e o core. O jogo abrirá automaticamente.</p>
      <div className="fx-launch-progress" aria-hidden="true">
        <i />
      </div>
    </div>
  );
}

/** Briefly lights the matching footer glyph when a control is pressed. */
export function pulseGlyph(root: HTMLElement | null, key: string) {
  if (!root || !motionEnabled()) return;
  const glyph = root.querySelector<HTMLElement>(
    `.tv-controls [data-glyph~="${key}"]`,
  );
  glyph?.animate?.(
    [
      { transform: "scale(1)", filter: "brightness(1)" },
      { transform: "scale(1.35)", filter: "brightness(1.8)" },
      { transform: "scale(1)", filter: "brightness(1)" },
    ],
    { duration: 260, easing: "cubic-bezier(.34,1.56,.64,1)" },
  );
}
