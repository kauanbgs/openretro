import { useEffect, useState, type CSSProperties } from "react";
import { BrandMark } from "../../components/Brand";
import { GameArtwork } from "../../components/GameArtwork";
import type { GameMetadata } from "../../types";
import { locale, t } from "../../i18n";

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
      {now.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })}
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
      <p className="fx-launch-kicker">{t("Preparando o jogo")}</p>
      <h2>{game?.title ?? t("Iniciando")}</h2>
      <p>
        {t("Verificando o emulador e o core. O jogo abrirá automaticamente.")}
      </p>
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
