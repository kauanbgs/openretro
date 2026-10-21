import { useEffect, useRef, useState } from "react";
import { Camera, Download, LogOut, Pause, Play, Upload } from "lucide-react";
import {
  finishTizenSession,
  subscribeTizenSession,
  TizenRuntime,
  type TizenSession,
} from "./runtime";
import "./tizen-player.css";

export function TizenGameSurface() {
  const [session, setSession] = useState<TizenSession>();
  const [menu, setMenu] = useState(false);
  const [loading, setLoading] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const menuElement = useRef<HTMLDivElement>(null);
  const runtime = useRef<TizenRuntime | null>(null);

  useEffect(() => subscribeTizenSession(setSession), []);
  useEffect(() => {
    if (!session || !canvas.current) return;
    const player = new TizenRuntime();
    runtime.current = player;
    setLoading(true);
    let active = true;
    void player
      .start(session.entry, canvas.current, () => {
        if (active) {
          setLoading(false);
          canvas.current?.focus();
        }
      })
      .then(() => {
        if (active) finishTizenSession();
      })
      .catch((error) => {
        if (active) finishTizenSession(error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      runtime.current = null;
    };
  }, [session]);
  useEffect(() => {
    if (!session) return;
    let previous = new Set<number>();
    const timer = window.setInterval(() => {
      const pad = navigator.getGamepads?.().find(Boolean);
      if (!pad) return;
      const pressed = new Set(
        pad.buttons.flatMap((button, index) => (button.pressed ? [index] : [])),
      );
      const edge = (index: number) =>
        pressed.has(index) && !previous.has(index);
      const guide =
        edge(16) ||
        (pressed.has(8) &&
          pressed.has(9) &&
          (!previous.has(8) || !previous.has(9)));
      if (guide) {
        runtime.current?.pause();
        setMenu((value) => !value);
      } else if (menu) {
        const buttons = Array.from(
          menuElement.current?.querySelectorAll<HTMLButtonElement>("button") ??
            [],
        );
        const active = Math.max(
          0,
          buttons.indexOf(document.activeElement as HTMLButtonElement),
        );
        if (edge(12)) buttons[Math.max(0, active - 1)]?.focus();
        if (edge(13))
          buttons[Math.min(buttons.length - 1, active + 1)]?.focus();
        if (edge(0)) buttons[active]?.click();
        if (edge(1)) resume();
      }
      previous = pressed;
    }, 33);
    return () => window.clearInterval(timer);
  });
  useEffect(() => {
    if (!session) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.keyCode === 10009 || event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        runtime.current?.pause();
        setMenu((value) => !value);
        return;
      }
      if (!menu) return;
      const buttons = Array.from(
        menuElement.current?.querySelectorAll<HTMLButtonElement>("button") ??
          [],
      );
      const active = Math.max(
        0,
        buttons.indexOf(document.activeElement as HTMLButtonElement),
      );
      if (["ArrowUp", "ArrowDown", "Enter"].includes(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === "ArrowUp") buttons[Math.max(0, active - 1)]?.focus();
        if (event.key === "ArrowDown")
          buttons[Math.min(buttons.length - 1, active + 1)]?.focus();
        if (event.key === "Enter") buttons[active]?.click();
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [session, menu]);
  if (!session) return null;

  const resume = () => {
    runtime.current?.pause();
    setMenu(false);
    canvas.current?.focus();
  };
  const stop = async () => {
    const seconds = (await runtime.current?.stop()) ?? 0;
    finishTizenSession(undefined, seconds);
  };
  return (
    <section
      className="tizen-player"
      aria-label={`Jogando ${session.entry.game.title}`}
    >
      <canvas ref={canvas} tabIndex={-1} />
      {loading && (
        <div className="tizen-player-loading" role="status">
          <span />
          <strong>Preparando {session.entry.game.title}</strong>
          <small>Carregando o core otimizado para esta TV…</small>
        </div>
      )}
      {menu && (
        <div
          ref={menuElement}
          className="tizen-player-menu"
          role="dialog"
          aria-modal="true"
        >
          <header>
            <small>OpenRetro</small>
            <h2>{session.entry.game.title}</h2>
          </header>
          <div>
            <button autoFocus onClick={resume}>
              <Play /> Continuar
            </button>
            <button onClick={() => runtime.current?.save()}>
              <Download /> Salvar estado
            </button>
            <button onClick={() => runtime.current?.load()}>
              <Upload /> Carregar estado
            </button>
            <button onClick={() => runtime.current?.screenshot()}>
              <Camera /> Capturar tela
            </button>
            <button className="danger" onClick={() => void stop()}>
              <LogOut /> Encerrar jogo
            </button>
          </div>
          <footer>
            <Pause size={16} /> Return abre e fecha este menu
          </footer>
        </div>
      )}
    </section>
  );
}
