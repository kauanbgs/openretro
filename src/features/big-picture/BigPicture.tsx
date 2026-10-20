import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Gamepad2,
  Home,
  Library,
  MonitorCog,
  Pause,
  Play,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import type { DownloadJob, Emulator, LibraryGame } from "../../types";
import { bridge } from "../../services/bridge";
import { GameResolver } from "../../services/GameResolver";
import { platformById } from "../../db/platforms";
import { GameArtwork } from "../../components/GameArtwork";

type Section = "home" | "library" | "downloads" | "emulators" | "system";
const sections: { id: Section; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "library", label: "Library", icon: Library },
  { id: "downloads", label: "Downloads", icon: Download },
  { id: "emulators", label: "Emulators", icon: MonitorCog },
  { id: "system", label: "System", icon: Settings },
];
const activeDownload = (state: string) =>
  ["RESOLVING", "QUEUED", "DOWNLOADING", "VERIFYING"].includes(state);

export function BigPicture({
  library,
  emulators,
  jobs,
  refresh,
  onClose,
  onDesktop,
  notify,
}: {
  library: LibraryGame[];
  emulators: Emulator[];
  jobs: DownloadJob[];
  refresh: () => Promise<void>;
  onClose: () => void;
  onDesktop: (page: "Discover" | "Settings" | "Emulators") => void;
  notify: (message: string) => void;
}) {
  const [section, setSection] = useState<Section>("home");
  const [navFocused, setNavFocused] = useState(true);
  const [selected, setSelected] = useState(0);
  const [launching, setLaunching] = useState(false);
  const held = useRef(new Set<string>());
  const games = useMemo(
    () =>
      [...library].sort((a, b) =>
        (b.item.lastPlayedAt ?? "").localeCompare(a.item.lastPlayedAt ?? ""),
      ),
    [library],
  );
  const selectedGame = games[selected];
  const selectSection = (next: Section) => {
    setSection(next);
    setSelected(0);
  };
  const move = (amount: number, size: number) =>
    setSelected((current) => (size ? (current + amount + size) % size : 0));
  const close = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    onClose();
  };
  const currentSize = () =>
    section === "downloads"
      ? jobs.length
      : section === "emulators"
        ? emulators.length
        : section === "system"
          ? 4
          : games.length;
  const launch = async (entry = selectedGame) => {
    if (!entry || launching) return;
    setLaunching(true);
    try {
      const resolution = await new GameResolver(bridge.exists).resolve(
        entry.game,
        entry.item,
        emulators,
      );
      if (resolution.state !== "READY") throw new Error(resolution.message);
      await bridge.launch(entry.item.id);
    } catch (error) {
      notify(String(error));
    } finally {
      setLaunching(false);
    }
  };
  const favorite = async () => {
    if (!selectedGame) return;
    await bridge.favorite(selectedGame.item.id, !selectedGame.item.favorite);
    await refresh();
  };
  const remove = async () => {
    if (
      !selectedGame ||
      !confirm(`Remove ${selectedGame.game.title} from your library?`)
    )
      return;
    await bridge.removeGame(selectedGame.item.id);
    await refresh();
    setSelected(0);
  };
  const activate = () => {
    if (navFocused) return setNavFocused(false);
    if (section === "home" || section === "library") return void launch();
    if (section === "downloads") {
      const job = jobs[selected];
      if (job)
        void bridge
          .controlDownload(
            job.id,
            activeDownload(job.state) ? "pause" : "resume",
          )
          .then(refresh)
          .catch((error) => notify(String(error)));
      return;
    }
    if (section === "emulators") return onDesktop("Emulators");
    const page = ["Discover", "Settings", "Emulators", "exit"][selected];
    page === "exit"
      ? close()
      : onDesktop(page as "Discover" | "Settings" | "Emulators");
  };
  useEffect(() => {
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    const handle = (key: string) => {
      if (key === "b") return navFocused ? close() : setNavFocused(true);
      if (key === "a") return activate();
      if (key === "left")
        return navFocused ? move(-1, sections.length) : setNavFocused(true);
      if (key === "right")
        return navFocused ? setNavFocused(false) : move(1, currentSize());
      if (key === "up")
        return move(-1, navFocused ? sections.length : currentSize());
      if (key === "down")
        return move(1, navFocused ? sections.length : currentSize());
      if (
        key === "x" &&
        !navFocused &&
        (section === "home" || section === "library")
      )
        void favorite();
      if (
        key === "y" &&
        !navFocused &&
        (section === "home" || section === "library")
      )
        void remove();
    };
    const onKey = (event: KeyboardEvent) => {
      const keys: Record<string, string> = {
        Escape: "b",
        Enter: "a",
        " ": "a",
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
        ArrowDown: "down",
        x: "x",
        X: "x",
        y: "y",
        Y: "y",
      };
      if (keys[event.key]) {
        event.preventDefault();
        handle(keys[event.key]);
      }
    };
    window.addEventListener("keydown", onKey);
    let frame = 0;
    const poll = () => {
      const pad = navigator.getGamepads?.().find(Boolean);
      if (pad) {
        const active = new Set<string>();
        const edge = (id: string, pressed: boolean) => {
          if (pressed) active.add(id);
          return pressed && !held.current.has(id);
        };
        if (
          edge("left", Boolean(pad.buttons[14]?.pressed || pad.axes[0] < -0.7))
        )
          handle("left");
        if (
          edge("right", Boolean(pad.buttons[15]?.pressed || pad.axes[0] > 0.7))
        )
          handle("right");
        if (edge("up", Boolean(pad.buttons[12]?.pressed || pad.axes[1] < -0.7)))
          handle("up");
        if (
          edge("down", Boolean(pad.buttons[13]?.pressed || pad.axes[1] > 0.7))
        )
          handle("down");
        if (edge("a", Boolean(pad.buttons[0]?.pressed))) handle("a");
        if (edge("b", Boolean(pad.buttons[1]?.pressed))) handle("b");
        if (edge("x", Boolean(pad.buttons[2]?.pressed))) handle("x");
        if (edge("y", Boolean(pad.buttons[3]?.pressed))) handle("y");
        held.current = active;
      }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
    };
  });
  useEffect(() => {
    if (navFocused && sections[selected]) selectSection(sections[selected].id);
  }, [selected, navFocused]);
  const shelf = (title: string, entries: LibraryGame[]) => (
    <section className="bp-game-shelf">
      <div className="bp-section-title">
        <h2>{title}</h2>
        <span>{entries.length} games</span>
      </div>
      <div className="bp-game-grid">
        {entries.map((entry, index) => (
          <button
            key={entry.item.id}
            className={index === selected && !navFocused ? "focused" : ""}
            onClick={() => {
              setSelected(index);
              setNavFocused(false);
            }}
            onDoubleClick={() => void launch(entry)}
          >
            <GameArtwork game={entry.game} />
            <span>{entry.game.title}</span>
            <small>
              {platformById(entry.game.platformId)?.shortName ??
                entry.game.platformId}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
  const activeJobs = jobs.filter((job) => activeDownload(job.state)).length;
  return (
    <section className="big-picture" aria-label="OpenRetro console mode">
      <div className="bp-noise" />
      <header className="bp-topbar">
        <div className="bp-logo">
          <Gamepad2 size={27} /> OPENRETRO <small>BIG PICTURE</small>
        </div>
        <div>
          <span className="bp-status">
            {activeJobs ? `${activeJobs} downloading` : "Ready to play"}
          </span>
          <button className="big-picture-exit" onClick={close}>
            <X size={18} /> Exit
          </button>
        </div>
      </header>
      <div className="bp-layout">
        <nav className={`bp-nav ${navFocused ? "focused" : ""}`}>
          {sections.map((item) => (
            <button
              key={item.id}
              className={section === item.id ? "active" : ""}
              onClick={() => {
                selectSection(item.id);
                setNavFocused(false);
              }}
            >
              <item.icon size={21} />
              <span>{item.label}</span>
              {item.id === "downloads" && jobs.length > 0 && (
                <small>{jobs.length}</small>
              )}
            </button>
          ))}
        </nav>
        <main className="bp-content">
          {section === "home" && (
            <>
              <section className="bp-hero">
                <div>
                  <span>WELCOME BACK</span>
                  <h1>{selectedGame?.game.title ?? "Your game room"}</h1>
                  <p>
                    {selectedGame
                      ? `${platformById(selectedGame.game.platformId)?.name ?? selectedGame.game.platformId} · ${selectedGame.game.genre || "Game"}`
                      : "Add games from desktop mode, then play them here."}
                  </p>
                  {selectedGame && (
                    <button className="bp-play" onClick={() => void launch()}>
                      <Play size={20} fill="currentColor" />
                      {launching ? "Launching…" : "Play now"}
                    </button>
                  )}
                </div>
                {selectedGame && (
                  <div className="bp-hero-art">
                    <GameArtwork game={selectedGame.game} />
                  </div>
                )}
              </section>
              {shelf("Recently played", games.slice(0, 12))}
            </>
          )}
          {section === "library" && shelf("Your library", games)}
          {section === "downloads" && (
            <section className="bp-panel">
              <div className="bp-section-title">
                <h1>Downloads</h1>
                <span>{activeJobs} active</span>
              </div>
              {jobs.length ? (
                <div className="bp-list">
                  {jobs.map((job, index) => (
                    <article
                      key={job.id}
                      className={
                        index === selected && !navFocused ? "focused" : ""
                      }
                      onClick={() => {
                        setSelected(index);
                        setNavFocused(false);
                      }}
                    >
                      <Download size={22} />
                      <div>
                        <strong>{job.name}</strong>
                        <span>
                          {job.state} · {job.progress.toFixed(0)}%
                        </span>
                        <progress value={job.progress} max="100" />
                      </div>
                      <button
                        onClick={() =>
                          void bridge
                            .controlDownload(
                              job.id,
                              activeDownload(job.state) ? "pause" : "resume",
                            )
                            .then(refresh)
                        }
                      >
                        {activeDownload(job.state) ? (
                          <Pause size={18} />
                        ) : (
                          <Play size={18} />
                        )}
                      </button>
                      <button
                        onClick={() =>
                          void bridge.removeDownload(job.id).then(refresh)
                        }
                      >
                        <Trash2 size={18} />
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="bp-empty">No downloads in progress.</p>
              )}
            </section>
          )}
          {section === "emulators" && (
            <section className="bp-panel">
              <div className="bp-section-title">
                <h1>Emulators</h1>
                <span>{emulators.length} configured</span>
              </div>
              <div className="bp-emulator-grid">
                {emulators.map((emulator, index) => (
                  <button
                    className={
                      index === selected && !navFocused ? "focused" : ""
                    }
                    key={emulator.id}
                    onClick={() => onDesktop("Emulators")}
                  >
                    <MonitorCog size={28} />
                    <strong>{emulator.name}</strong>
                    <span>
                      {emulator.supportedPlatforms
                        .map((id) => platformById(id)?.shortName ?? id)
                        .join(" · ")}
                    </span>
                  </button>
                ))}
              </div>
              <button
                className="bp-wide-action"
                onClick={() => onDesktop("Emulators")}
              >
                Manage emulators
              </button>
            </section>
          )}
          {section === "system" && (
            <section className="bp-panel">
              <div className="bp-section-title">
                <h1>System</h1>
                <span>OpenRetro desktop</span>
              </div>
              <div className="bp-system-grid">
                {[
                  ["Find games", "Discover"],
                  ["Settings", "Settings"],
                  ["Manage emulators", "Emulators"],
                  ["Exit Big Picture", "exit"],
                ].map(([label, page], index) => (
                  <button
                    key={label}
                    className={
                      index === selected && !navFocused ? "focused" : ""
                    }
                    onClick={() =>
                      page === "exit"
                        ? close()
                        : onDesktop(
                            page as "Discover" | "Settings" | "Emulators",
                          )
                    }
                  >
                    <Settings size={25} />
                    <strong>{label}</strong>
                    <span>
                      {page === "exit"
                        ? "Return to desktop"
                        : "Open in desktop mode"}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>
      <footer className="bp-controls">
        <span>
          <b>A</b> Select / play
        </span>
        <span>
          <b>B</b> Menu
        </span>
        <span>
          <b>X</b> Favorite
        </span>
        <span>
          <b>Y</b> Remove
        </span>
        <span>
          <b>← ↑ ↓ →</b> Navigate
        </span>
      </footer>
    </section>
  );
}
