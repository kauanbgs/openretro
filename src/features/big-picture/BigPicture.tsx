import { useEffect, useRef, useState } from "react";
import { Gamepad2, Home, Library, Play, Star, X } from "lucide-react";
import type { Emulator, LibraryGame } from "../../types";
import { bridge } from "../../services/bridge";
import { GameResolver } from "../../services/GameResolver";
import { platformById } from "../../db/platforms";
import { GameArtwork } from "../../components/GameArtwork";

export function BigPicture({
  library,
  emulators,
  onClose,
  notify,
}: {
  library: LibraryGame[];
  emulators: Emulator[];
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const [selected, setSelected] = useState(0);
  const [lane, setLane] = useState(0);
  const [launching, setLaunching] = useState(false);
  const held = useRef(new Set<number>());
  const lanes = [
    { label: "All games", icon: Library, games: library },
    {
      label: "Recently played",
      icon: Home,
      games: [...library].sort((a, b) =>
        (b.item.lastPlayedAt ?? "").localeCompare(a.item.lastPlayedAt ?? ""),
      ),
    },
    {
      label: "Favorites",
      icon: Star,
      games: library.filter((entry) => entry.item.favorite),
    },
  ];
  const visibleGames = lanes[lane].games;
  const game = visibleGames[selected];
  const move = (amount: number) =>
    setSelected((current) =>
      visibleGames.length
        ? (current + amount + visibleGames.length) % visibleGames.length
        : 0,
    );
  const moveLane = (amount: number) => {
    setLane((current) => (current + amount + lanes.length) % lanes.length);
    setSelected(0);
  };
  const close = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    onClose();
  };
  const launch = async () => {
    if (!game || launching) return;
    setLaunching(true);
    try {
      const resolution = await new GameResolver(bridge.exists).resolve(
        game.game,
        game.item,
        emulators,
      );
      if (resolution.state !== "READY") throw new Error(resolution.message);
      await bridge.launch(game.item.id);
    } catch (error) {
      notify(String(error));
    } finally {
      setLaunching(false);
    }
  };
  useEffect(() => {
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
      if (event.key === "ArrowUp") moveLane(-1);
      if (event.key === "ArrowDown") moveLane(1);
      if (event.key === "Enter" || event.key === " ") void launch();
    };
    window.addEventListener("keydown", onKey);
    let frame = 0;
    const poll = () => {
      const pad = navigator.getGamepads?.().find(Boolean);
      if (pad) {
        const pressed = new Set<number>();
        pad.buttons.forEach(
          (button, index) => button.pressed && pressed.add(index),
        );
        const edge = (button: number) =>
          pressed.has(button) && !held.current.has(button);
        if (edge(14) || pad.axes[0] < -0.7) move(-1);
        if (edge(15) || pad.axes[0] > 0.7) move(1);
        if (edge(12)) moveLane(-1);
        if (edge(13)) moveLane(1);
        if (edge(0)) void launch();
        if (edge(1)) close();
        held.current = pressed;
      }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
    };
  });
  return (
    <section className="big-picture" aria-label="Big Picture mode">
      <div
        className="big-picture-backdrop"
        style={{
          backgroundImage: game?.game.backgroundUrl
            ? `url(${game.game.backgroundUrl})`
            : undefined,
        }}
      />
      <header className="big-picture-header">
        <div className="big-picture-brand">
          <Gamepad2 size={28} /> OPENRETRO <small>CONSOLE</small>
        </div>
        <button className="big-picture-exit" onClick={close}>
          <X size={20} /> Exit
        </button>
      </header>
      <div className="console-shell">
        <nav className="console-rail" aria-label="Library sections">
          {lanes.map((item, index) => (
            <button
              key={item.label}
              className={lane === index ? "selected" : ""}
              onClick={() => {
                setLane(index);
                setSelected(0);
              }}
            >
              <item.icon size={20} />
              <span>{item.label}</span>
              <small>{item.games.length}</small>
            </button>
          ))}
        </nav>
        {game ? (
          <main className="big-picture-main">
            <div className="big-picture-copy">
              <span className="console-now-playing">NOW SELECTED</span>
              <span>
                {platformById(game.game.platformId)?.name ??
                  game.game.platformId}
              </span>
              <h1>{game.game.title}</h1>
              <p>{game.game.description}</p>
              <button
                className="big-picture-play"
                disabled={launching}
                onClick={() => void launch()}
              >
                <Play fill="currentColor" size={23} />{" "}
                {launching ? "Launching…" : "Play"}
              </button>
            </div>
            <div className="big-picture-cover">
              <GameArtwork game={game.game} />
            </div>
          </main>
        ) : (
          <main className="big-picture-empty">
            <Gamepad2 size={48} />
            <h1>Your library is empty</h1>
            <p>Add a game to start Big Picture.</p>
          </main>
        )}
      </div>
      <div className="big-picture-carousel" aria-label="Selected game shelf">
        {visibleGames.map((entry, index) => (
          <button
            key={entry.item.id}
            className={index === selected ? "selected" : ""}
            onClick={() => setSelected(index)}
          >
            <GameArtwork game={entry.game} />
            <span>{entry.game.title}</span>
          </button>
        ))}
      </div>
      <footer className="big-picture-controls">
        <span>
          <b>A</b> Play
        </span>
        <span>
          <b>← →</b> Browse
        </span>
        <span>
          <b>↑ ↓</b> Sections
        </span>
        <span>
          <b>B</b> Exit
        </span>
      </footer>
    </section>
  );
}
