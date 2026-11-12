// Runs a game in the browser with EmulatorJS (libretro cores in WebAssembly),
// over the whole app. EmulatorJS can't be torn down cleanly, so leaving the
// game reloads the page back on the game's page.
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LibraryGame } from "../../types";
import { platformById } from "../../db/platforms";
import { t } from "../../i18n";
import {
  webLaunchTarget,
  webSessionPlayed,
  webSessionStarted,
} from "./library";
import "./WebPlay.css";

const DATA_PATH = "https://cdn.emulatorjs.org/stable/data/";

type EjsWindow = Window & Record<`EJS_${string}`, unknown>;

export function WebPlayer({ entry }: { entry: LibraryGame }) {
  const [error, setError] = useState("");
  const started = useRef(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const id = entry.item.id;
    webLaunchTarget(id)
      .then((target) => {
        if (!target) throw new Error(t("Esse jogo não está mais disponível."));
        webSessionStarted(id);
        startedAt.current = Date.now();
        // Friends see what's playing; the profile keeps it in its history.
        void import("./webSocial").then((m) =>
          m.webPlaying({
            title: entry.game.title,
            console:
              platformById(entry.game.platformId)?.name ??
              entry.game.platformId,
          }),
        );
        const w = window as unknown as EjsWindow;
        w.EJS_player = "#web-player-screen";
        w.EJS_core = target.core;
        w.EJS_gameUrl = target.rom;
        w.EJS_gameName = entry.game.title;
        w.EJS_pathtodata = DATA_PATH;
        w.EJS_startOnLoaded = true;
        w.EJS_color =
          getComputedStyle(document.documentElement)
            .getPropertyValue("--accent")
            .trim() || "#12ace2";
        w.EJS_backgroundColor = "#000000";
        const script = document.createElement("script");
        script.src = `${DATA_PATH}loader.js`;
        script.onerror = () =>
          setError(
            t("Não foi possível carregar o emulador. Confira sua conexão."),
          );
        document.body.appendChild(script);
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)));
  }, [entry]);

  // Leaving reloads the page, and closing the tab counts as well: both end
  // the session with a pagehide.
  useEffect(() => {
    const saveTime = () => {
      webSessionPlayed(entry.item.id, (Date.now() - startedAt.current) / 1000);
      // Ends the game for friends and records its time on the profile.
      void import("./webSocial").then((m) => m.webPlaying(null));
    };
    window.addEventListener("pagehide", saveTime);
    return () => window.removeEventListener("pagehide", saveTime);
  }, [entry]);

  // EmulatorJS only listens for keys on its own element, so a click on the
  // bar or the black margins, or a trip to another tab, left the keyboard
  // dead. Keys pressed anywhere else are sent to the game, which also takes
  // the focus back. Browser shortcuts (Ctrl, Alt, the F keys) stay the
  // browser's.
  useEffect(() => {
    const forward = (event: KeyboardEvent) => {
      const screen = document.getElementById("web-player-screen");
      if (!screen || screen.contains(event.target as Node)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.isComposing || /^F\d+$/.test(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      screen.focus({ preventScroll: true });
      const copy = new KeyboardEvent(event.type, {
        key: event.key,
        code: event.code,
        location: event.location,
        repeat: event.repeat,
        shiftKey: event.shiftKey,
        bubbles: true,
        cancelable: true,
      });
      // EmulatorJS reads the legacy keyCode, which the constructor can't set.
      for (const name of ["keyCode", "which"] as const)
        Object.defineProperty(copy, name, { get: () => event.keyCode });
      screen.dispatchEvent(copy);
    };
    window.addEventListener("keydown", forward, true);
    window.addEventListener("keyup", forward, true);
    return () => {
      window.removeEventListener("keydown", forward, true);
      window.removeEventListener("keyup", forward, true);
    };
  }, []);

  const leave = () => {
    location.hash = new URLSearchParams({ game: entry.item.id }).toString();
    location.reload();
  };

  return (
    <div className="web-player" role="dialog" aria-label={entry.game.title}>
      <header className="web-player-bar">
        <button className="button outline" onClick={leave}>
          <ArrowLeft size={16} /> {t("Sair do jogo")}
        </button>
        <strong>{entry.game.title}</strong>
        <span />
      </header>
      <div className="web-player-stage">
        {error ? (
          <div className="web-player-message" role="alert">
            <p>{error}</p>
            <button className="button primary" onClick={leave}>
              {t("Voltar")}
            </button>
          </div>
        ) : (
          <div id="web-player-screen" tabIndex={-1}>
            <div className="web-player-message">
              <LoaderCircle className="spin" size={24} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
