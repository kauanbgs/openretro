import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
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
  Keyboard,
  Info,
  LoaderCircle,
  LayoutGrid,
  List,
} from "lucide-react";
import type {
  DownloadJob,
  Emulator,
  LibraryGame,
  GameMetadata,
  DownloadImported,
} from "../../types";
import { metadataProvider } from "../../providers/metadata/IgdbMetadataProvider";
import { bridge, isDesktop } from "../../services/bridge";
import { GameResolver } from "../../services/GameResolver";
import { platformById } from "../../db/platforms";
import { GameArtwork } from "../../components/GameArtwork";
import "./BigPicture.css";
import { BigPictureCatalog, type CatalogViewState } from "./BigPictureCatalog";
import { hasRuntimeMenu } from "../../components/InGameMenuHelp";
import { ControllerSelect } from "./ControllerSelect";
import { ControllerInput } from "./controllerInput";
import { ControllerKeyboard } from "./ControllerKeyboard";
import { HeroArtwork } from "./HeroArtwork";

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
  downloadArrival,
  refresh,
  onClose,
  onDesktop,
  notify,
}: {
  library: LibraryGame[];
  emulators: Emulator[];
  jobs: DownloadJob[];
  downloadArrival?: DownloadImported;
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
  const [librarySort, setLibrarySort] = useState("recent");
  const [libraryPlatform, setLibraryPlatform] = useState("all");
  const [libraryView, setLibraryView] = useState<"grid" | "list">("grid");
  const [powerOpen, setPowerOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const keyboardInput = useRef<((key: string) => boolean) | null>(null);
  const [removeTarget, setRemoveTarget] = useState<LibraryGame>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [notice, setNotice] = useState<{ text: string; id: number }>();
  const feedback = useCallback(
    (text: string) => {
      setNotice({ text, id: Date.now() });
      notify(text);
    },
    [notify],
  );
  const content = useRef<HTMLElement>(null);
  const positions = useRef<
    Partial<Record<Section, { selected: number; scroll: number }>>
  >({});
  const dispatchInput = useRef<(key: string) => void>(() => {});
  const catalogModal = useRef(false);
  const selectInput = useRef<((key: string) => boolean) | null>(null);
  const [connected, setConnected] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [details, setDetails] = useState<Record<string, GameMetadata>>({});
  const root = useRef<HTMLElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const catalogInput = useRef<((key: string) => boolean) | null>(null);
  const catalogMemory = useRef<CatalogViewState | null>(null);
  const homeMemory = useRef<CatalogViewState | null>(null);
  const [catalogCount, setCatalogCount] = useState(0);
  const [selected, setSelected] = useState(0);
  const [launching, setLaunching] = useState(false);
  // Existing notifications are ignored on entry; react to arrivals while this
  // console session is mounted, once the refreshed library contains the game.
  const handledImport = useRef(downloadArrival?.downloadId);
  useEffect(() => {
    if (
      !downloadArrival ||
      handledImport.current === downloadArrival.downloadId ||
      launching
    )
      return;
    const ordered = [...library].sort((a, b) =>
      (b.item.lastPlayedAt ?? "").localeCompare(a.item.lastPlayedAt ?? ""),
    );
    const platform = jobs.find((job) => job.id === downloadArrival.downloadId)
      ?.game?.platformId;
    const index = ordered.findIndex(
      (entry) =>
        entry.game.id === downloadArrival.gameId &&
        (!platform || entry.game.platformId === platform),
    );
    if (index < 0) return;
    handledImport.current = downloadArrival.downloadId;
    selectInput.current?.("b");
    setKeyboardOpen(false);
    setRemoveTarget(undefined);
    setPowerOpen(false);
    setFilter("all");
    setQuery("");
    setLibraryPlatform("all");
    setLibrarySort("recent");
    setSection("library");
    setNavIndex(sections.findIndex((item) => item.id === "library"));
    setNavFocused(false);
    setSelected(index);
    feedback(
      `${ordered[index].game.title} foi adicionado à biblioteca. Pronto para jogar.`,
    );
    requestAnimationFrame(() => {
      content.current?.scrollTo({ top: 0, behavior: "instant" });
      root.current
        ?.querySelector<HTMLButtonElement>(".tv-play")
        ?.focus({ preventScroll: true });
    });
  }, [downloadArrival, library, jobs, launching, feedback]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 4200);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!isDesktop) return;
    const listener = listen("game-started", () => setPreparing(false));
    return () => {
      void listener.then((stop) => stop());
    };
  }, []);
  useEffect(() => () => clearTimeout(previewTimer.current), []);
  useEffect(() => {
    const update = () =>
      setConnected(Boolean(navigator.getGamepads?.().find(Boolean)));
    update();
    window.addEventListener("gamepadconnected", update);
    window.addEventListener("gamepaddisconnected", update);
    return () => {
      window.removeEventListener("gamepadconnected", update);
      window.removeEventListener("gamepaddisconnected", update);
    };
  }, []);
  const games = useMemo(
    () =>
      [...library].sort((a, b) =>
        librarySort === "title"
          ? a.game.title.localeCompare(b.game.title)
          : librarySort === "playtime"
            ? b.item.playtime - a.item.playtime
            : (b.item.lastPlayedAt ?? "").localeCompare(
                a.item.lastPlayedAt ?? "",
              ),
      ),
    [library, librarySort],
  );
  const visibleGames = useMemo(
    () =>
      games.filter(
        (entry) =>
          (filter === "all" || entry.item.favorite) &&
          (libraryPlatform === "all" ||
            entry.game.platformId === libraryPlatform) &&
          entry.game.title
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()),
      ),
    [games, filter, query, libraryPlatform],
  );
  const selectedGame =
    visibleGames[Math.min(selected, Math.max(visibleGames.length - 1, 0))];
  const heroGame = selectedGame ?? games[0];
  const heroMetadata = heroGame && (details[heroGame.game.id] ?? heroGame.game);
  useEffect(() => {
    const game = heroGame?.game;
    if (
      section !== "library" ||
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
  }, [heroGame?.game.id, details, section]);
  const selectSection = (next: Section) => {
    positions.current[section] = {
      selected,
      scroll: content.current?.scrollTop ?? 0,
    };
    setSection(next);
    setNavIndex(sections.findIndex((item) => item.id === next));
    setSelected(positions.current[next]?.selected ?? 0);
    setNavFocused(false);
    requestAnimationFrame(() =>
      content.current?.scrollTo({
        top: positions.current[next]?.scroll ?? 0,
        behavior: "instant",
      }),
    );
  };
  const move = (amount: number, size: number) => {
    const next = Math.max(
      0,
      Math.min(Math.max(0, size - 1), selected + amount),
    );
    setSelected(next);
    requestAnimationFrame(() => {
      const card =
        grid.current?.querySelectorAll<HTMLButtonElement>("button")[next];
      card?.focus({ preventScroll: true });
      card?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "smooth",
      });
    });
  };
  const close = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    onClose();
  };
  const currentSize = () =>
    section === "catalog" || section === "home"
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
    setPreparing(true);
    try {
      const resolution = await new GameResolver(bridge.exists).resolve(
        entry.game,
        entry.item,
        emulators,
      );
      if (resolution.state !== "READY") throw new Error(resolution.message);
      await bridge.launch(entry.item.id);
    } catch (error) {
      feedback(String(error));
    } finally {
      setLaunching(false);
      setPreparing(false);
    }
  };
  const favorite = async () => {
    if (!selectedGame) return;
    try {
      await bridge.favorite(selectedGame.item.id, !selectedGame.item.favorite);
      await refresh();
      feedback(
        selectedGame.item.favorite
          ? "Removido dos favoritos."
          : "Adicionado aos favoritos.",
      );
    } catch (error) {
      feedback(String(error));
    }
  };
  const remove = async () => {
    if (!selectedGame) return;
    setRemoveTarget(selectedGame);
    setConfirmRemove(false);
  };
  const doRemove = async () => {
    if (!removeTarget || removing) return;
    setRemoving(true);
    try {
      await bridge.removeGame(removeTarget.item.id);
      await refresh();
      setSelected(0);
      setRemoveTarget(undefined);
      feedback("Jogo removido da biblioteca. O arquivo foi mantido.");
    } catch (error) {
      feedback(String(error));
    } finally {
      setRemoving(false);
    }
  };
  const activate = () => {
    if (powerOpen) return close();
    if (navFocused) {
      if (navIndex === sections.length) return selectSection("catalog");
      if (navIndex === sections.length + 1) return setPowerOpen(true);
      return selectSection(sections[navIndex].id);
    }
    if (section === "library") return void launch();
    if (section === "home") return;
    if (section === "downloads") {
      const job = jobs[selected];
      if (job)
        void bridge
          .controlDownload(
            job.id,
            activeDownload(job.state) ? "pause" : "resume",
          )
          .then(refresh)
          .catch((error) => feedback(String(error)));
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
      // The foreground emulator owns the controller for the entire game session.
      if (launching) return;
      if (selectInput.current?.(key)) return;
      if (keyboardOpen) {
        keyboardInput.current?.(key);
        return;
      }
      if (removeTarget) {
        if (removing) return;
        if (key === "b") setRemoveTarget(undefined);
        if (["left", "right", "up", "down"].includes(key))
          setConfirmRemove((value) => !value);
        if (key === "a") {
          if (confirmRemove) void doRemove();
          else setRemoveTarget(undefined);
        }
        return;
      }
      if (preparing) return;
      if (
        (section === "catalog" || section === "home") &&
        (!navFocused || catalogModal.current) &&
        !powerOpen &&
        catalogInput.current?.(key)
      )
        return;
      if (key === "b") {
        if (powerOpen) return setPowerOpen(false);
        return setNavFocused((value) => !value);
      }
      if (powerOpen) return key === "a" ? close() : undefined;
      if (key === "previous-control" || key === "next-control") return;
      if (
        (section === "catalog" || section === "home") &&
        (key === "lb" || key === "rb")
      ) {
        catalogInput.current?.(
          key === "lb" ? "previous-control" : "next-control",
        );
        return;
      }
      if (section === "library" && !navFocused) {
        if (key === "lb" || key === "rb") {
          setFilter((value) => (value === "all" ? "favorites" : "all"));
          setSelected(0);
          return;
        }
        const control = document.activeElement as HTMLElement | null;
        if (control?.closest(".tv-library-tools, .tv-hero-actions")) {
          if (key === "a") {
            if (control instanceof HTMLInputElement) setKeyboardOpen(true);
            else if (control instanceof HTMLButtonElement) control.click();
            else control.blur();
            return;
          }
          if (key === "down" || key === "b") {
            control.blur();
            grid.current?.querySelector<HTMLButtonElement>("button")?.focus();
            return;
          }
          if (key === "up" || key === "left" || key === "right") {
            const controls = Array.from(
              root.current?.querySelectorAll<HTMLElement>(
                ".tv-hero-actions button, .tv-library-tools input, .tv-library-tools button, .tv-library-tools select",
              ) ?? [],
            );
            const index = controls.indexOf(control);
            controls[
              (index + (key === "right" ? 1 : -1) + controls.length) %
                controls.length
            ]?.focus();
            return;
          }
        }
      }
      if (key === "a") return activate();
      if (key === "search") {
        if (section === "home") selectSection("catalog");
        else if (section === "library") setKeyboardOpen(true);
        else if (section === "catalog") catalogInput.current?.("open-search");
        return;
      }
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
      if (key === "up" && selected < columns) {
        if (section === "catalog") catalogInput.current?.("next-control");
        else if (section === "home")
          root.current
            ?.querySelector<HTMLButtonElement>(".tv-home-feature .tv-play")
            ?.focus();
        else if (section === "library") {
          content.current?.scrollTo({ top: 0, behavior: "smooth" });
          root.current
            ?.querySelector<HTMLInputElement>(".tv-library-tools input")
            ?.focus();
        }
        return;
      }
      if (key === "up") return move(-columns, currentSize());
      if (key === "down") return move(columns, currentSize());
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
    dispatchInput.current = handle;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const scope =
          root.current?.querySelector(
            ".tv-keyboard, .tv-confirm-dialog, .tv-power-dialog, .tv-catalog-dialog",
          ) ??
          (navFocused
            ? root.current?.querySelector(".tv-side-rail")
            : root.current);
        const elements = Array.from(
          scope?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), select:not(:disabled)",
          ) ?? [],
        ).filter((element) => element.getClientRects().length > 0);
        const first = elements[0],
          last = elements[elements.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !scope?.contains(document.activeElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !scope?.contains(document.activeElement))
        ) {
          event.preventDefault();
          first?.focus();
        }
        return;
      }
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
        "/": "search",
      };
      if (keys[event.key]) {
        event.preventDefault();
        if (
          event.key.startsWith("Arrow") &&
          !root.current?.querySelector(".tv-catalog-dialog") &&
          Boolean(
            document.activeElement?.closest(".tv-game-grid, .tv-catalog-grid"),
          ) &&
          document.activeElement instanceof HTMLButtonElement
        )
          document.activeElement.blur();
        dispatchInput.current(keys[event.key]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    const device = new ControllerInput();
    device.sample(navigator.getGamepads?.().find(Boolean), performance.now());
    let wasActive = false;
    // One persistent loop: opening a dialog or refreshing downloads must not
    // restart sampling or lose a held button. 30 Hz is enough for launcher UI.
    const timer = window.setInterval(() => {
      if (document.hidden || !document.hasFocus()) {
        wasActive = false;
        return;
      }
      const pad = navigator.getGamepads?.().find(Boolean);
      if (!wasActive) {
        device.sample(pad, performance.now());
        wasActive = true;
        return;
      }
      for (const key of device.sample(pad, performance.now())) {
        dispatchInput.current(key === "menu" ? "b" : key);
      }
    }, 33);
    return () => window.clearInterval(timer);
  }, []);
  const shelf = (title: string, entries: LibraryGame[]) => (
    <section className="tv-game-shelf">
      <div className="tv-section-title">
        <h2>{title}</h2>
        <span>{entries.length} jogos</span>
      </div>
      <div
        className={`tv-game-grid ${libraryView === "list" ? "tv-library-list" : ""}`}
        ref={grid}
      >
        {entries.map((entry, index) => (
          <button
            key={entry.item.id}
            className={index === selected && !navFocused ? "focused" : ""}
            onFocus={() => {
              setSelected(index);
              setNavFocused(false);
              requestAnimationFrame(() =>
                grid.current
                  ?.querySelectorAll<HTMLButtonElement>("button")
                  [index]?.scrollIntoView({
                    block: "nearest",
                    inline: "nearest",
                    behavior: "smooth",
                  }),
              );
            }}
            onMouseEnter={() => {
              clearTimeout(previewTimer.current);
              previewTimer.current = setTimeout(() => {
                setSelected(index);
                setNavFocused(false);
              }, 150);
            }}
            onMouseLeave={() => clearTimeout(previewTimer.current)}
            onClick={() => void launch(entry)}
            onContextMenu={(event) => {
              event.preventDefault();
              setSelected(index);
              setRemoveTarget(entry);
              setConfirmRemove(false);
            }}
            aria-label={`Jogar ${entry.game.title}`}
          >
            <GameArtwork game={entry.game} />
            <i className="tv-card-play">
              <Play size={20} fill="currentColor" /> Jogar
            </i>
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
          <span
            className="tv-nav-cursor"
            aria-hidden="true"
            style={{
              transform: `translateY(${(navFocused ? navIndex : sections.findIndex((item) => item.id === section)) * 52}px)`,
              opacity: navFocused && navIndex >= sections.length ? 0 : 1,
            }}
          />
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
          <span
            className="tv-controller-status"
            title={connected ? "Controle conectado" : "Teclado e mouse"}
          >
            <Gamepad2 size={17} />
            <i className={connected ? "connected" : ""} />
            {connected ? "Controle conectado" : "Teclado e mouse"}
          </span>
          <button
            aria-label="Pesquisar jogos"
            onClick={() =>
              section === "catalog"
                ? catalogInput.current?.("open-search")
                : selectSection("catalog")
            }
          >
            <Search size={22} />
          </button>
          <button className="tv-exit" onClick={close}>
            Sair do modo console
          </button>
        </div>
      </header>
      <main ref={content} className="tv-content" key={section}>
        {(section === "catalog" || section === "home") && (
          <BigPictureCatalog
            mode={section === "home" ? "home" : "catalog"}
            onLibrary={() => selectSection("library")}
            library={library}
            selected={selected}
            setSelected={setSelected}
            grid={grid}
            input={catalogInput}
            modal={catalogModal}
            selectInput={selectInput}
            onCount={setCatalogCount}
            onPlay={(entry) => void launch(entry)}
            onDownloads={() => selectSection("downloads")}
            notify={feedback}
            memory={section === "home" ? homeMemory : catalogMemory}
          />
        )}
        {section === "library" && (
          <>
            <section className="tv-hero">
              {heroMetadata && <HeroArtwork game={heroMetadata} />}
              <div className="tv-hero-shade" />
              <div className="tv-hero-copy" key={heroGame?.item.id ?? "empty"}>
                <h1>{heroGame?.game.title ?? "Sua coleção começa aqui"}</h1>
                <p className="tv-kicker">
                  {heroGame?.item.lastPlayedAt
                    ? "Continue jogando"
                    : "Pronto para jogar"}
                </p>
                <p className="tv-hero-meta">
                  {heroGame
                    ? `${heroPlatform}  ·  ${heroGame.game.genre || "Jogo"}`
                    : "Importe seus jogos no modo desktop para montar sua biblioteca."}
                </p>
                {heroGame ? (
                  <div className="tv-hero-actions">
                    <button
                      className="tv-play"
                      disabled={launching}
                      onClick={() => void launch()}
                    >
                      <Play size={19} fill="currentColor" />
                      {launching ? "Iniciando…" : "Jogar"}
                    </button>
                    <button
                      className="tv-secondary"
                      onClick={() => onDesktop("Emulators")}
                    >
                      <Settings size={18} /> Emulador
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
                <h2>Sua biblioteca</h2>
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
                  <button
                    className="tv-open-keyboard"
                    aria-label="Buscar biblioteca com controle"
                    title="Teclado na tela"
                    onClick={() => setKeyboardOpen(true)}
                  >
                    <Keyboard size={20} />
                  </button>
                </label>
                <ControllerSelect
                  input={selectInput}
                  label="Ordenar biblioteca"
                  value={librarySort}
                  onChange={(value) => {
                    setLibrarySort(value);
                    setSelected(0);
                  }}
                  options={[
                    { value: "recent", label: "Jogado recentemente" },
                    { value: "title", label: "Nome" },
                    { value: "playtime", label: "Tempo jogado" },
                  ]}
                />
                <ControllerSelect
                  input={selectInput}
                  label="Filtrar biblioteca por console"
                  value={libraryPlatform}
                  onChange={(value) => {
                    setLibraryPlatform(value);
                    setSelected(0);
                  }}
                  options={[
                    { value: "all", label: "Todos os consoles" },
                    ...[
                      ...new Set(library.map((entry) => entry.game.platformId)),
                    ].map((id) => ({
                      value: id,
                      label: platformById(id)?.name ?? id,
                    })),
                  ]}
                />
                <div className="tv-library-view">
                  <button
                    aria-label="Visualização em lista"
                    aria-pressed={libraryView === "list"}
                    onClick={() => setLibraryView("list")}
                  >
                    <List size={20} />
                  </button>
                  <button
                    aria-label="Visualização em grade"
                    aria-pressed={libraryView === "grid"}
                    onClick={() => setLibraryView("grid")}
                  >
                    <LayoutGrid size={20} />
                  </button>
                </div>
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
        ) : section === "home" ? (
          <span>
            <b>Share / View</b> Catálogo
          </span>
        ) : section === "library" ? (
          <>
            <span>
              <b>X</b> Favoritar
            </span>
            <span>
              <b>Y</b> Remover
            </span>
            <span>
              <b>Share / View</b> Buscar
            </span>
          </>
        ) : null}
        <span>
          <b>← ↑ ↓ →</b> Navegar
        </span>
      </footer>
      {notice && (
        <div key={notice.id} className="tv-notice" role="status">
          <Info size={19} />
          <span>{notice.text}</span>
          <button
            aria-label="Fechar aviso"
            onClick={() => setNotice(undefined)}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {preparing && (
        <div className="tv-launching" role="status" aria-live="polite">
          <LoaderCircle size={40} className="spin" />
          <h2>Preparando o jogo</h2>
          <p>Verificando o emulador e o core. O jogo abrirá automaticamente.</p>
        </div>
      )}
      {removeTarget && (
        <div
          className="tv-dialog-backdrop"
          onClick={() => {
            if (!removing) setRemoveTarget(undefined);
          }}
        >
          <section
            className="tv-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Remover jogo"
            onClick={(event) => event.stopPropagation()}
          >
            <Trash2 size={27} />
            <h2>Remover {removeTarget.game.title}?</h2>
            <p>
              O jogo sai da biblioteca. O arquivo no seu computador será
              mantido.
            </p>
            <div>
              <button
                autoFocus
                disabled={removing}
                className={!confirmRemove ? "focused" : ""}
                onClick={() => setRemoveTarget(undefined)}
              >
                Cancelar
              </button>
              <button
                disabled={removing}
                className={`danger ${confirmRemove ? "focused" : ""}`}
                onClick={() => void doRemove()}
              >
                {removing ? "Removendo…" : "Remover da biblioteca"}
              </button>
            </div>
            <small>A confirma a opção selecionada · B cancela</small>
          </section>
        </div>
      )}
      {keyboardOpen && (
        <ControllerKeyboard
          value={query}
          onChange={(value) => {
            setQuery(value);
            setSelected(0);
          }}
          onClose={() => setKeyboardOpen(false)}
          input={keyboardInput}
        />
      )}
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
