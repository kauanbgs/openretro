import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  Download,
  Gamepad2,
  Grid2X2,
  Heart,
  Clock3,
  Power,
  Home,
  Library,
  MonitorCog,
  Pause,
  Play,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import type {
  DownloadJob,
  Emulator,
  LibraryGame,
  GameMetadata,
} from "../../types";
import { metadataProvider } from "../../providers/metadata/IgdbMetadataProvider";
import { bridge } from "../../services/bridge";
import { GameResolver } from "../../services/GameResolver";
import { platformById } from "../../db/platforms";
import { GameArtwork } from "../../components/GameArtwork";
import "./BigPicture.css";
import { BigPictureCatalog } from "./BigPictureCatalog";
import { hasRuntimeMenu } from "../../components/InGameMenuHelp";

type Section =
  "home" | "catalog" | "library" | "downloads" | "emulators" | "system";
const sections: { id: Section; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Início", icon: Home },
  { id: "catalog", label: "Catálogo", icon: Grid2X2 },
  { id: "library", label: "Biblioteca", icon: Library },
  { id: "downloads", label: "Downloads", icon: Download },
  { id: "emulators", label: "Emuladores", icon: MonitorCog },
  { id: "system", label: "Configurações", icon: Settings },
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
  const [navFocused, setNavFocused] = useState(false);
  const [navIndex, setNavIndex] = useState(0);
  const [filter, setFilter] = useState<"all" | "favorites">("all");
  const [query, setQuery] = useState("");
  const [powerOpen, setPowerOpen] = useState(false);
  const [details, setDetails] = useState<Record<string, GameMetadata>>({});
  const root = useRef<HTMLElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const catalogInput = useRef<((key: string) => boolean) | null>(null);
  const [catalogCount, setCatalogCount] = useState(0);
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
  const visibleGames = useMemo(
    () =>
      games.filter(
        (entry) =>
          (filter === "all" || entry.item.favorite) &&
          entry.game.title
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()),
      ),
    [games, filter, query],
  );
  const selectedGame =
    visibleGames[Math.min(selected, Math.max(visibleGames.length - 1, 0))];
  const heroGame = selectedGame ?? games[0];
  const heroMetadata = heroGame && (details[heroGame.game.id] ?? heroGame.game);
  const backdrop =
    heroMetadata?.backgroundUrl ?? heroMetadata?.screenshots?.[0];
  useEffect(() => {
    const game = heroGame?.game;
    if (
      !game ||
      game.metadataProvider !== "igdb" ||
      game.backgroundUrl ||
      details[game.id]
    )
      return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void metadataProvider
        .getGame(game.id, game.platformId)
        .then((metadata) => {
          if (!cancelled)
            setDetails((current) => ({ ...current, [game.id]: metadata }));
        })
        .catch(() => undefined);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [heroGame?.game.id, details]);
  const selectSection = (next: Section) => {
    setSection(next);
    setNavIndex(sections.findIndex((item) => item.id === next));
    setSelected(0);
    setNavFocused(false);
  };
  const move = (amount: number, size: number) =>
    setSelected((current) => (size ? (current + amount + size) % size : 0));
  const close = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    onClose();
  };
  const currentSize = () =>
    section === "catalog"
      ? catalogCount
      : section === "downloads"
        ? jobs.length
        : section === "emulators"
          ? emulators.length
          : section === "system"
            ? 4
            : visibleGames.length;
  const launch = async (entry = heroGame) => {
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
      !confirm(`Remover ${selectedGame.game.title} da biblioteca?`)
    )
      return;
    await bridge.removeGame(selectedGame.item.id);
    await refresh();
    setSelected(0);
  };
  const activate = () => {
    if (powerOpen) return close();
    if (navFocused) {
      if (navIndex === sections.length) return selectSection("catalog");
      if (navIndex === sections.length + 1) return setPowerOpen(true);
      return selectSection(sections[navIndex].id);
    }
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
      : page === "Discover"
        ? selectSection("catalog")
        : onDesktop(page as "Discover" | "Settings" | "Emulators");
  };
  useEffect(() => {
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, []);
  useEffect(() => {
    const handle = (key: string) => {
      if (
        section === "catalog" &&
        !navFocused &&
        !powerOpen &&
        catalogInput.current?.(key)
      )
        return;
      if (key === "b") {
        if (powerOpen) return setPowerOpen(false);
        return setNavFocused((value) => !value);
      }
      if (powerOpen) return key === "a" ? close() : undefined;
      if (key === "a") return activate();
      if (navFocused) {
        if (key === "up" || key === "down")
          setNavIndex(
            (value) =>
              (value + (key === "up" ? -1 : 1) + sections.length + 2) %
              (sections.length + 2),
          );
        if (key === "right") setNavFocused(false);
        return;
      }
      const columns = grid.current
        ? getComputedStyle(grid.current).gridTemplateColumns.split(" ").length
        : 1;
      if (key === "left")
        return selected % columns === 0
          ? setNavFocused(true)
          : move(-1, currentSize());
      if (key === "right") return move(1, currentSize());
      if (key === "up")
        return setSelected((value) => Math.max(0, value - columns));
      if (key === "down")
        return setSelected((value) =>
          Math.min(Math.max(0, currentSize() - 1), value + columns),
        );
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
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement
      ) {
        if (event.key === "Escape") event.target.blur();
        return;
      }
      if (
        event.key === "Enter" &&
        document.activeElement instanceof HTMLButtonElement &&
        root.current?.contains(document.activeElement)
      )
        return;
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
        if (
          event.key.startsWith("Arrow") &&
          !root.current?.querySelector(".tv-catalog-dialog") &&
          document.activeElement instanceof HTMLButtonElement
        )
          document.activeElement.blur();
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
        if (
          section === "catalog" &&
          edge("lb", Boolean(pad.buttons[4]?.pressed))
        )
          catalogInput.current?.("previous-control");
        if (
          section === "catalog" &&
          edge("rb", Boolean(pad.buttons[5]?.pressed))
        )
          catalogInput.current?.("next-control");
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
    const columns = grid.current
      ? getComputedStyle(grid.current).gridTemplateColumns.split(" ").length
      : 1;
    if (!navFocused && selected >= columns)
      grid.current?.querySelector(".focused")?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "smooth",
      });
  }, [selected, navFocused]);
  const shelf = (title: string, entries: LibraryGame[]) => (
    <section className="tv-game-shelf">
      <div className="tv-section-title">
        <h2>{title}</h2>
        <span>{entries.length} jogos</span>
      </div>
      <div className="tv-game-grid" ref={grid}>
        {entries.map((entry, index) => (
          <button
            key={entry.item.id}
            className={index === selected && !navFocused ? "focused" : ""}
            onFocus={() => {
              setSelected(index);
              setNavFocused(false);
            }}
            onClick={() => {
              setSelected(index);
              setNavFocused(false);
            }}
            onDoubleClick={() => void launch(entry)}
            aria-label={`Selecionar ${entry.game.title}`}
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
  const heroPlatform =
    heroGame &&
    (platformById(heroGame.game.platformId)?.name ?? heroGame.game.platformId);
  return (
    <section
      ref={root}
      className={`console-mode ${navFocused ? "menu-open" : ""}`}
      aria-label="Modo console do OpenRetro"
      role="dialog"
      aria-modal="true"
    >
      {navFocused && (
        <button
          className="tv-menu-scrim"
          aria-label="Fechar menu"
          onClick={() => setNavFocused(false)}
        />
      )}
      <div
        className="tv-side-rail"
        onMouseEnter={() => setNavFocused(true)}
        onMouseLeave={() => setNavFocused(false)}
      >
        <button
          className="tv-profile"
          title="Abrir menu"
          aria-label="Abrir menu"
          onClick={() => setNavFocused((value) => !value)}
        >
          <Gamepad2 size={25} />
          <i />
        </button>
        <nav
          className={`tv-nav ${navFocused ? "focused" : ""}`}
          aria-label="Navegação principal"
        >
          {sections.map((item, index) => (
            <button
              key={item.id}
              className={`${section === item.id ? "active" : ""} ${navFocused && navIndex === index ? "nav-focus" : ""}`}
              onClick={() => selectSection(item.id)}
              aria-label={item.label}
            >
              <item.icon size={21} />
              <span>{item.label}</span>
              {item.id === "downloads" && activeJobs > 0 && (
                <small>{activeJobs}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="tv-rail-games">
          {games.slice(0, 5).map((entry) => (
            <button
              key={entry.item.id}
              title={entry.game.title}
              onClick={() => {
                setFilter("all");
                setQuery("");
                setSelected(games.indexOf(entry));
                setSection("home");
                setNavFocused(false);
              }}
            >
              <GameArtwork game={entry.game} />
              <span>{entry.game.title}</span>
            </button>
          ))}
        </div>
        <div className="tv-rail-bottom">
          <button
            className={
              navFocused && navIndex === sections.length ? "nav-focus" : ""
            }
            onClick={() => selectSection("catalog")}
            aria-label="Catálogo"
          >
            <Search size={22} />
            <span>Catálogo</span>
          </button>
          <button
            className={
              navFocused && navIndex === sections.length + 1 ? "nav-focus" : ""
            }
            onClick={() => setPowerOpen(true)}
            aria-label="Energia"
          >
            <Power size={20} />
            <span>Energia</span>
          </button>
        </div>
      </div>
      <header className="tv-topbar">
        <span>
          <ChevronLeft size={20} />{" "}
          {section === "home"
            ? "Início"
            : sections.find((item) => item.id === section)?.label}
        </span>
        <div>
          <button
            aria-label="Pesquisar jogos"
            onClick={() => selectSection("catalog")}
          >
            <Search size={22} />
          </button>
          <button className="tv-exit" onClick={close}>
            Sair do modo console
          </button>
        </div>
      </header>
      <main className="tv-content" key={section}>
        {section === "catalog" && (
          <BigPictureCatalog
            library={library}
            selected={selected}
            setSelected={setSelected}
            grid={grid}
            input={catalogInput}
            onCount={setCatalogCount}
            onPlay={(entry) => void launch(entry)}
            onDownloads={() => selectSection("downloads")}
            notify={notify}
          />
        )}
        {(section === "home" || section === "library") && (
          <>
            <section className="tv-hero" key={heroGame?.item.id ?? "empty"}>
              <div
                className={`tv-hero-media ${backdrop ? "" : "cover-only"}`}
                aria-hidden="true"
              >
                {heroMetadata && (
                  <GameArtwork
                    key={heroMetadata.id}
                    game={{
                      ...heroMetadata,
                      backgroundUrl: backdrop,
                    }}
                    hero
                  />
                )}
              </div>
              <div className="tv-hero-shade" />
              <div className="tv-hero-copy">
                <p className="tv-kicker">
                  {heroGame?.item.lastPlayedAt
                    ? "Continue jogando"
                    : "Pronto para jogar"}
                </p>
                <h1>{heroGame?.game.title ?? "Sua coleção começa aqui"}</h1>
                <p className="tv-hero-meta">
                  {heroGame
                    ? `${heroPlatform}  ·  ${heroGame.game.genre || "Jogo"}`
                    : "Importe seus jogos no modo desktop para montar sua biblioteca."}
                </p>
                {heroGame?.game.description && (
                  <p className="tv-description">{heroGame.game.description}</p>
                )}
                {heroGame ? (
                  <div className="tv-hero-actions">
                    <button className="tv-play" onClick={() => void launch()}>
                      <Play size={19} fill="currentColor" />
                      {launching ? "Iniciando…" : "Jogar"}
                    </button>
                    <button
                      className="tv-secondary"
                      onClick={() => void favorite()}
                    >
                      <Heart
                        size={18}
                        fill={heroGame.item.favorite ? "currentColor" : "none"}
                      />
                      {heroGame.item.favorite ? "Favorito" : "Favoritar"}
                    </button>
                  </div>
                ) : (
                  <div className="tv-hero-actions">
                    <button
                      className="tv-play"
                      onClick={() => selectSection("catalog")}
                    >
                      <Search size={19} />
                      Encontrar jogos
                    </button>
                  </div>
                )}
                {hasRuntimeMenu(heroGame, emulators) && (
                  <p className="tv-runtime-hint">
                    Durante o jogo: PS abre o menu · Share + Options ou F1 como
                    alternativa
                  </p>
                )}
              </div>
              {heroGame && (
                <div className="tv-hero-stat">
                  <Clock3 size={24} />
                  <strong>
                    {heroGame.item.playtime
                      ? `${Math.floor(heroGame.item.playtime / 3600)}h ${Math.floor((heroGame.item.playtime % 3600) / 60)}m`
                      : "0h"}
                  </strong>
                  <span>Tempo jogado</span>
                </div>
              )}
            </section>
            <section className="tv-library">
              <div className="tv-library-tools">
                <h2>
                  {section === "home" ? "Continue jogando" : "Sua biblioteca"}
                </h2>
                <label className="tv-search">
                  <Search size={19} />
                  <input
                    aria-label="Pesquisar biblioteca"
                    placeholder="Pesquisar biblioteca"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setSelected(0);
                    }}
                  />
                </label>
                <span>{visibleGames.length} jogos</span>
              </div>
              <div className="tv-tabs">
                <button
                  className={filter === "all" ? "active" : ""}
                  onClick={() => {
                    setFilter("all");
                    setSelected(0);
                  }}
                >
                  Todos ({games.length})
                </button>
                <button
                  className={filter === "favorites" ? "active" : ""}
                  onClick={() => {
                    setFilter("favorites");
                    setSelected(0);
                  }}
                >
                  Favoritos (
                  {games.filter((entry) => entry.item.favorite).length})
                </button>
              </div>
              {shelf("", visibleGames)}
              {!visibleGames.length && (
                <p className="tv-empty">
                  {query
                    ? "Nenhum jogo encontrado. Tente outro nome."
                    : "Adicione jogos à sua biblioteca para jogar aqui."}
                </p>
              )}
            </section>
          </>
        )}
        {section === "downloads" && (
          <section className="tv-panel">
            <div className="tv-section-title">
              <div>
                <h1>Downloads</h1>
                <p>O que está acontecendo agora.</p>
              </div>
              <span>{activeJobs} ativos</span>
            </div>
            {jobs.length ? (
              <div className="tv-list">
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
                      title="Pausar ou retomar"
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
                      title="Remover download"
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
              <p className="tv-empty">Não há downloads em andamento.</p>
            )}
          </section>
        )}
        {section === "emulators" && (
          <section className="tv-panel">
            <div className="tv-section-title">
              <div>
                <h1>Emuladores</h1>
                <p>Configure uma vez. Jogue da biblioteca.</p>
              </div>
              <span>{emulators.length} configurados</span>
            </div>
            <div className="tv-emulator-grid">
              {emulators.map((emulator, index) => (
                <button
                  className={index === selected && !navFocused ? "focused" : ""}
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
              className="tv-wide-action"
              onClick={() => onDesktop("Emulators")}
            >
              Gerenciar emuladores
            </button>
          </section>
        )}
        {section === "system" && (
          <section className="tv-panel">
            <div className="tv-section-title">
              <div>
                <h1>Sistema</h1>
                <p>Ferramentas do OpenRetro.</p>
              </div>
            </div>
            <div className="tv-system-grid">
              {[
                ["Encontrar jogos", "Descubra títulos e fontes", "Discover"],
                ["Configurações", "Ajuste a experiência", "Settings"],
                [
                  "Gerenciar emuladores",
                  "Revise sistemas e cores",
                  "Emulators",
                ],
                ["Sair do modo console", "Voltar para o modo desktop", "exit"],
              ].map(([label, description, page], index) => (
                <button
                  key={label}
                  className={index === selected && !navFocused ? "focused" : ""}
                  onClick={() =>
                    page === "exit"
                      ? close()
                      : page === "Discover"
                        ? selectSection("catalog")
                        : onDesktop(
                            page as "Discover" | "Settings" | "Emulators",
                          )
                  }
                >
                  <Settings size={25} />
                  <strong>{label}</strong>
                  <span>{description}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
      <footer className="tv-controls">
        <span>
          <b>A</b> Selecionar
        </span>
        <span>
          <b>B</b> Menu
        </span>
        {section === "catalog" ? (
          <span>
            <b>LB / RB</b> Filtros
          </span>
        ) : (
          <>
            <span>
              <b>X</b> Favoritar
            </span>
            <span>
              <b>Y</b> Remover
            </span>
          </>
        )}
        <span>
          <b>← ↑ ↓ →</b> Navegar
        </span>
      </footer>
      {powerOpen && (
        <div className="tv-dialog-backdrop" onClick={() => setPowerOpen(false)}>
          <section
            className="tv-power-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Energia"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="tv-dialog-close"
              aria-label="Fechar energia"
              onClick={() => setPowerOpen(false)}
            >
              <X size={21} />
            </button>
            <h2>Energia</h2>
            <p>Escolha o que fazer com o OpenRetro.</p>
            <button className="tv-power-action" onClick={close}>
              <Power size={24} />
              <span>
                <strong>Sair do Big Picture</strong>
                <small>Voltar ao modo desktop</small>
              </span>
            </button>
          </section>
        </div>
      )}
    </section>
  );
}
