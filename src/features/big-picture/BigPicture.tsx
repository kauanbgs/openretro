import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "../../services/transport";
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
  Play,
  Search,
  Smartphone,
  Users,
  Settings,
  Trash2,
  X,
  Keyboard,
  Info,
  LayoutGrid,
  List,
  FolderPlus,
} from "lucide-react";
import type {
  DownloadJob,
  Emulator,
  LibraryGame,
  GameMetadata,
  DownloadImported,
} from "../../types";
import {
  catalogGameDetails,
  isCatalogGame,
} from "../../providers/metadata/LaunchboxMetadataProvider";
import { bridge, isDesktop } from "../../services/bridge";
import { GameResolver } from "../../services/GameResolver";
import { platformById } from "../../db/platforms";
import { GameArtwork } from "../../components/GameArtwork";
import "./BigPicture.css";
import "./BigPictureFx.css";
import { BigPictureCatalog, type CatalogViewState } from "./BigPictureCatalog";
import { hasRuntimeMenu } from "../../components/InGameMenuHelp";
import { ControllerSelect } from "./ControllerSelect";
import { ControllerInput } from "./controllerInput";
import { partyOwnsInput } from "../party/partyInput";
import { SocialNotice, SocialUnreadBadge } from "../social/SocialActivity";
import { playUiSound, setNavigationSounds, soundFor } from "./navigationSounds";
import { ControllerKeyboard } from "./ControllerKeyboard";
import { PhonePlayDialog } from "../../components/PhonePlayDialog";
import { PartyDialog } from "../party/PartyDialog";
import { NETPLAY_PLATFORMS } from "../../types";
import { AccountAvatar } from "../social/accountAvatars";
import { socialStore } from "../../services/social";
import { ConsoleWorkspace, type WorkspaceRoute } from "./ConsoleWorkspace";
import { HeroArtwork } from "./HeroArtwork";
import {
  AmbientBackdrop,
  BootSplash,
  ConsoleClock,
  LaunchSequence,
  pulseGlyph,
  useCardTilt,
} from "./ConsoleFx";
import { t } from "../../i18n";

type Section =
  "home" | "catalog" | "library" | "downloads" | "system" | "friends";
const sections: { id: Section; label: string; icon: typeof Home }[] = [
  { id: "home", label: t("Início"), icon: Home },
  { id: "catalog", label: t("Catálogo"), icon: Grid2X2 },
  { id: "library", label: t("Biblioteca"), icon: Library },
  { id: "downloads", label: "Downloads", icon: Download },
  { id: "system", label: t("Configurações"), icon: Settings },
  { id: "friends", label: t("Amigos"), icon: Users },
];
const activeDownload = (state: string) =>
  ["RESOLVING", "QUEUED", "DOWNLOADING", "VERIFYING", "INSTALLING"].includes(
    state,
  );

export function BigPicture({
  library,
  emulators,
  jobs,
  downloadArrival,
  refresh,
  onClose,
  onUpdate,
  updateVersion,
  updating,
  notify,
}: {
  library: LibraryGame[];
  emulators: Emulator[];
  jobs: DownloadJob[];
  downloadArrival?: DownloadImported;
  refresh: () => Promise<void>;
  onClose: () => void;
  onUpdate?: () => void;
  updateVersion?: string;
  updating?: boolean;
  notify: (message: string) => void;
}) {
  const [section, setSection] = useState<Section>("home");
  const queryClient = useQueryClient();
  const [navFocused, setNavFocused] = useState(false);
  const [navIndex, setNavIndex] = useState(0);
  const [filter, setFilter] = useState<"all" | "favorites">("all");
  const [query, setQuery] = useState("");
  const [librarySort, setLibrarySort] = useState("recent");
  const [libraryPlatform, setLibraryPlatform] = useState("all");
  const [libraryView, setLibraryView] = useState<"grid" | "list">("grid");
  const social = useSyncExternalStore(
    socialStore.subscribe,
    socialStore.snapshot,
  );
  const account = social.session.hasSession ? social.session.user : null;
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [partyOpen, setPartyOpen] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceRoute>();
  const workspaceInput = useRef<((key: string) => boolean) | null>(null);
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: bridge.settings,
  });
  setNavigationSounds(settings?.navigationSounds !== false);
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
  const [launchTarget, setLaunchTarget] = useState<GameMetadata>();
  useCardTilt(root);
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
    setWorkspace(undefined);
    setFilter("all");
    setQuery("");
    setLibraryPlatform("all");
    setLibrarySort("recent");
    setSection("library");
    setNavIndex(sections.findIndex((item) => item.id === "library"));
    setNavFocused(false);
    setSelected(index);
    feedback(
      t("{title} foi adicionado à biblioteca. Pronto para jogar.", {
        title: ordered[index].game.title,
      }),
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
      !isCatalogGame(game) ||
      game.backgroundUrl ||
      details[game.id]
    )
      return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void catalogGameDetails(game)
        .then((metadata) => {
          if (!cancelled && metadata)
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
    setWorkspace(
      next === "downloads" || next === "friends" ? { page: next } : undefined,
    );
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
      const card = (
        grid.current ?? root.current?.querySelector(".tv-system-grid")
      )?.querySelectorAll<HTMLButtonElement>("button")[next];
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
        : section === "system"
          ? 7
          : visibleGames.length;
  const launch = async (entry = heroGame) => {
    if (!entry || launching) return;
    setLaunching(true);
    setLaunchTarget(details[entry.game.id] ?? entry.game);
    setPreparing(true);
    try {
      const resolution = await new GameResolver(
        bridge.exists,
        bridge.runtimeBiosStatus,
      ).resolve(entry.game, entry.item, emulators);
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
          ? t("Removido dos favoritos.")
          : t("Adicionado aos favoritos."),
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
      feedback(t("Jogo removido da biblioteca. O arquivo foi mantido."));
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
      return setWorkspace({ page: "downloads" });
    }
    if (section === "friends") return setWorkspace({ page: "friends" });
    const page = [
      "phone",
      "party",
      "Discover",
      "Settings",
      "import",
      "sources",
      "exit",
    ][selected];
    if (page === "phone") return setPhoneOpen(true);
    if (page === "party") return setPartyOpen(true);
    page === "exit"
      ? close()
      : page === "Discover"
        ? selectSection("catalog")
        : setWorkspace({
            page:
              page === "import"
                ? "import"
                : page === "sources"
                  ? "sources"
                  : "settings",
          });
  };
  useEffect(() => {
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, []);
  useEffect(() => {
    const handle = (key: string) => {
      window.dispatchEvent(new Event("openretro-user-activity"));
      pulseGlyph(root.current, key);
      // The foreground emulator owns the controller for the entire game session.
      if (launching) return;
      if (selectInput.current?.(key)) return;
      if (workspace && !navFocused && !powerOpen && !phoneOpen && !partyOpen) {
        workspaceInput.current?.(key);
        return;
      }
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
        if (key === "right") {
          setNavFocused(false);
          if (section === "home" && !grid.current?.querySelector("button"))
            root.current
              ?.querySelector<HTMLButtonElement>(".play-together button")
              ?.focus();
        }
        return;
      }
      const currentGrid =
        grid.current ?? root.current?.querySelector(".tv-system-grid");
      const columns = currentGrid
        ? getComputedStyle(currentGrid).gridTemplateColumns.split(" ").length
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
      if (partyOwnsInput()) return;
      if (event.key === "Tab") {
        const scope =
          root.current?.querySelector(
            ".tv-player-dialog, .tv-keyboard, .tv-confirm-dialog, .tv-power-dialog, .tv-catalog-dialog",
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
      const key = event.keyCode === 10009 ? "Escape" : event.key;
      if (keys[key]) {
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
        playUiSound(soundFor(keys[key]));
        dispatchInput.current(keys[key]);
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
        const input = key === "menu" ? "b" : key;
        playUiSound(soundFor(input));
        dispatchInput.current(input);
      }
    }, 33);
    return () => window.clearInterval(timer);
  }, []);
  const shelf = (title: string, entries: LibraryGame[]) => (
    <section className="tv-game-shelf">
      <div className="tv-section-title">
        <h2>{title}</h2>
        <span>
          {entries.length} {t("jogos")}
        </span>
      </div>
      <div
        className={`tv-game-grid ${libraryView === "list" ? "tv-library-list" : ""}`}
        ref={grid}
      >
        {entries.map((entry, index) => (
          <button
            key={entry.item.id}
            style={{ "--i": Math.min(index, 14) } as CSSProperties}
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
            aria-label={t("Jogar {title}", { title: entry.game.title })}
          >
            <GameArtwork game={entry.game} />
            <i className="tv-card-play">
              <Play size={20} fill="currentColor" /> {t("Jogar")}
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
      data-section={workspace ? workspace.page : section}
      aria-label={t("Modo console do OpenRetro")}
      onClickCapture={(event) => {
        if ((event.target as Element).closest("button:not(:disabled)"))
          playUiSound("select");
      }}
      role="dialog"
      aria-modal="true"
    >
      <AmbientBackdrop
        root={root}
        watch={`${section}-${workspace?.page ?? ""}`}
        fallback={
          section === "library" && heroMetadata
            ? (heroMetadata.backgroundUrl ??
              heroMetadata.screenshots?.[0] ??
              heroMetadata.coverUrl)
            : undefined
        }
      />
      <BootSplash />
      <SocialNotice
        onOpen={(view) => {
          selectSection("friends");
          setWorkspace({ page: "friends", activity: view === "activity" });
        }}
      />
      {navFocused && (
        <button
          className="tv-menu-scrim"
          aria-label={t("Fechar menu")}
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
          title={t("Abrir menu")}
          aria-label={t("Abrir menu")}
          onClick={() => setNavFocused((value) => !value)}
        >
          <Gamepad2 size={25} />
          <i />
        </button>
        <nav
          className={`tv-nav ${navFocused ? "focused" : ""}`}
          aria-label={t("Navegação principal")}
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
              style={{ "--i": index } as CSSProperties}
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
            aria-label={t("Catálogo")}
          >
            <Search size={22} />
            <span>{t("Catálogo")}</span>
          </button>
          <button
            className={
              navFocused && navIndex === sections.length + 1 ? "nav-focus" : ""
            }
            onClick={() => setPowerOpen(true)}
            aria-label={t("Energia")}
          >
            <Power size={20} />
            <span>{t("Energia")}</span>
          </button>
        </div>
      </div>
      {phoneOpen && (
        <PhonePlayDialog
          input={selectInput}
          notify={notify}
          onClose={() => setPhoneOpen(false)}
        />
      )}
      {partyOpen && (
        <PartyDialog
          input={selectInput}
          onClose={() => setPartyOpen(false)}
          onSignIn={() => {
            setPartyOpen(false);
            selectSection("friends");
          }}
        />
      )}
      {!workspace && (
        <header className="tv-topbar">
          <span>
            <ChevronLeft size={20} />{" "}
            {section === "home"
              ? t("Início")
              : sections.find((item) => item.id === section)?.label}
          </span>
          <div>
            <button
              aria-label={t("Conta e amigos")}
              onClick={() => selectSection("friends")}
            >
              <AccountAvatar
                avatar={account?.avatar}
                size={26}
                status={
                  !account
                    ? undefined
                    : account.appearOffline
                      ? "offline"
                      : social.connected
                        ? "online"
                        : "idle"
                }
              />
              {account?.displayName ?? t("Entrar")}
              <SocialUnreadBadge />
              {social.incoming.length > 0 && (
                <b className="tv-topbar-badge">{social.incoming.length}</b>
              )}
            </button>
            <ConsoleClock />
            <span
              className="tv-controller-status"
              title={connected ? t("Controle conectado") : t("Teclado e mouse")}
            >
              <Gamepad2 size={17} />
              <i className={connected ? "connected" : ""} />
              {connected ? t("Controle conectado") : t("Teclado e mouse")}
            </span>
            <button
              aria-label={t("Pesquisar jogos")}
              onClick={() =>
                section === "catalog"
                  ? catalogInput.current?.("open-search")
                  : selectSection("catalog")
              }
            >
              <Search size={22} />
            </button>
            <button className="tv-exit" onClick={close}>
              {t("Sair do modo console")}
            </button>
          </div>
        </header>
      )}
      {workspace && (
        <ConsoleWorkspace
          key={section}
          route={workspace}
          input={workspaceInput}
          active={!navFocused && !powerOpen}
          onContentFocus={() => setNavFocused(false)}
          library={library}
          emulators={emulators}
          jobs={jobs}
          refresh={refresh}
          notify={feedback}
          onRoute={setWorkspace}
          onMenu={() => setNavFocused(true)}
          onClose={() => {
            setWorkspace(undefined);
            if (section === "downloads" || section === "friends")
              selectSection("home");
          }}
          onImported={(game) => {
            setWorkspace(undefined);
            setQuery("");
            setFilter("all");
            setLibraryPlatform("all");
            setLibrarySort("recent");
            selectSection("library");
            const ordered = [
              ...(queryClient.getQueryData<LibraryGame[]>(["library"]) ??
                library),
            ].sort((a, b) =>
              (b.item.lastPlayedAt ?? b.item.addedAt).localeCompare(
                a.item.lastPlayedAt ?? a.item.addedAt,
              ),
            );
            setSelected(
              Math.max(
                0,
                ordered.findIndex((entry) => entry.game.id === game.id),
              ),
            );
          }}
          updateVersion={updateVersion}
          updating={updating}
          onUpdate={onUpdate}
        />
      )}
      {!workspace && (
        <main ref={content} className="tv-content" key={section}>
          {(section === "catalog" || section === "home") && (
            <BigPictureCatalog
              onFriends={() => selectSection("friends")}
              onPhone={() => setPhoneOpen(true)}
              onParty={() => setPartyOpen(true)}
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
              onManage={(game) => setWorkspace({ page: "game", game })}
              notify={feedback}
              memory={section === "home" ? homeMemory : catalogMemory}
            />
          )}
          {section === "library" && (
            <>
              <section className="tv-hero">
                {heroMetadata && <HeroArtwork game={heroMetadata} />}
                <div className="tv-hero-shade" />
                <div
                  className="tv-hero-copy"
                  key={heroGame?.item.id ?? "empty"}
                >
                  <h1>
                    {heroGame?.game.title ?? t("Sua coleção começa aqui")}
                  </h1>
                  <p className="tv-kicker">
                    {heroGame?.item.lastPlayedAt
                      ? t("Continue jogando")
                      : t("Pronto para jogar")}
                  </p>
                  <p className="tv-hero-meta">
                    {heroGame
                      ? `${heroPlatform}  ·  ${heroGame.game.genre || t("Jogo")}`
                      : t(
                          "Adicione seus arquivos ou encontre jogos no catálogo.",
                        )}
                  </p>
                  {heroGame ? (
                    <div className="tv-hero-actions">
                      <button
                        className="tv-play"
                        disabled={launching}
                        onClick={() => void launch()}
                      >
                        <Play size={19} fill="currentColor" />
                        {launching ? "Iniciando…" : t("Jogar")}
                      </button>
                      {NETPLAY_PLATFORMS.includes(heroGame.game.platformId) && (
                        <button
                          className="tv-secondary"
                          onClick={() =>
                            setWorkspace({
                              page: "game",
                              game: heroGame.game,
                              online: true,
                            })
                          }
                        >
                          <Users size={18} /> {t("Jogar online")}
                        </button>
                      )}
                      <button
                        className="tv-secondary"
                        onClick={() =>
                          heroGame &&
                          setWorkspace({ page: "game", game: heroGame.game })
                        }
                      >
                        <Settings size={18} /> {t("Gerenciar")}
                      </button>
                      <button
                        className="tv-secondary"
                        onClick={() => void favorite()}
                      >
                        <Heart
                          size={18}
                          fill={
                            heroGame.item.favorite ? "currentColor" : "none"
                          }
                        />
                        {heroGame.item.favorite
                          ? t("Favorito")
                          : t("Favoritar")}
                      </button>
                    </div>
                  ) : (
                    <div className="tv-hero-actions">
                      <button
                        className="tv-secondary"
                        onClick={() => setWorkspace({ page: "import" })}
                      >
                        {t("Adicionar jogos")}
                      </button>
                      <button
                        className="tv-play"
                        onClick={() => selectSection("catalog")}
                      >
                        <Search size={19} />
                        {t("Encontrar jogos")}
                      </button>
                    </div>
                  )}
                  {hasRuntimeMenu(heroGame, emulators) && (
                    <p className="tv-runtime-hint">
                      {t(
                        "Durante o jogo: PS abre o menu · Share + Options ou F1 como alternativa",
                      )}
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
                    <span>{t("Tempo jogado")}</span>
                  </div>
                )}
              </section>
              <section className="tv-library">
                <div className="tv-library-tools">
                  <h2>{t("Sua biblioteca")}</h2>
                  <label className="tv-search">
                    <Search size={19} />
                    <input
                      aria-label={t("Pesquisar biblioteca")}
                      placeholder={t("Pesquisar biblioteca")}
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setSelected(0);
                      }}
                    />
                    <button
                      className="tv-open-keyboard"
                      aria-label={t("Buscar biblioteca com controle")}
                      title={t("Teclado na tela")}
                      onClick={() => setKeyboardOpen(true)}
                    >
                      <Keyboard size={20} />
                    </button>
                  </label>
                  <ControllerSelect
                    input={selectInput}
                    label={t("Ordenar biblioteca")}
                    value={librarySort}
                    onChange={(value) => {
                      setLibrarySort(value);
                      setSelected(0);
                    }}
                    options={[
                      { value: "recent", label: t("Jogado recentemente") },
                      { value: "title", label: t("Nome") },
                      { value: "playtime", label: t("Tempo jogado") },
                    ]}
                  />
                  <ControllerSelect
                    input={selectInput}
                    label={t("Filtrar biblioteca por console")}
                    value={libraryPlatform}
                    onChange={(value) => {
                      setLibraryPlatform(value);
                      setSelected(0);
                    }}
                    options={[
                      { value: "all", label: t("Todos os consoles") },
                      ...[
                        ...new Set(
                          library.map((entry) => entry.game.platformId),
                        ),
                      ].map((id) => ({
                        value: id,
                        label: platformById(id)?.name ?? id,
                      })),
                    ]}
                  />
                  <div className="tv-library-view">
                    <button
                      aria-label={t("Visualização em lista")}
                      aria-pressed={libraryView === "list"}
                      onClick={() => setLibraryView("list")}
                    >
                      <List size={20} />
                    </button>
                    <button
                      aria-label={t("Visualização em grade")}
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
                    {t("Todos (")}
                    {games.length})
                  </button>
                  <button
                    className={filter === "favorites" ? "active" : ""}
                    onClick={() => {
                      setFilter("favorites");
                      setSelected(0);
                    }}
                  >
                    {t("Favoritos (")}
                    {games.filter((entry) => entry.item.favorite).length})
                  </button>
                </div>
                {shelf("", visibleGames)}
                {!visibleGames.length && (
                  <p className="tv-empty">
                    {query
                      ? t("Nenhum jogo encontrado. Tente outro nome.")
                      : t("Adicione jogos à sua biblioteca para jogar aqui.")}
                  </p>
                )}
              </section>
            </>
          )}
          {section === "system" && (
            <section className="tv-panel">
              <div className="tv-section-title">
                <div>
                  <h1>{t("Sistema")}</h1>
                  <p>{t("Ferramentas do OpenRetro.")}</p>
                </div>
              </div>
              <div className="tv-system-grid">
                {[
                  [
                    t("Jogar no celular"),
                    t("Jogue pelo navegador do celular na mesma rede"),
                    "phone",
                    Smartphone,
                  ] as const,
                  [
                    "OpenRetro Party",
                    t("Abra uma partida e convide seus amigos."),
                    "party",
                    Users,
                  ] as const,
                  [
                    t("Encontrar jogos"),
                    t("Descubra títulos e fontes"),
                    "Discover",
                    Search,
                  ] as const,
                  [
                    t("Configurações"),
                    t("Ajuste a experiência"),
                    "Settings",
                    Settings,
                  ] as const,
                  [
                    t("Adicionar jogos"),
                    t("Importe arquivos ou uma pasta"),
                    "import",
                    FolderPlus,
                  ] as const,
                  [
                    t("Fontes de download"),
                    t("Adicione e gerencie suas fontes"),
                    "sources",
                    Download,
                  ] as const,
                  [
                    t("Sair do modo console"),
                    t("Voltar para o modo desktop"),
                    "exit",
                    Power,
                  ] as const,
                ].map(([label, description, page, Icon], index) => (
                  <button
                    key={label}
                    style={{ "--i": index } as CSSProperties}
                    className={
                      index === selected && !navFocused ? "focused" : ""
                    }
                    onClick={() =>
                      page === "phone"
                        ? setPhoneOpen(true)
                        : page === "party"
                          ? setPartyOpen(true)
                          : page === "exit"
                            ? close()
                            : page === "Discover"
                              ? selectSection("catalog")
                              : setWorkspace({
                                  page:
                                    page === "sources"
                                      ? "sources"
                                      : page === "import"
                                        ? "import"
                                        : "settings",
                                })
                    }
                  >
                    <Icon size={25} />
                    <strong>{label}</strong>
                    <span>{description}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </main>
      )}
      <footer className="tv-controls">
        <span>
          <b data-glyph="a">A</b> {t("Selecionar")}
        </span>
        <span>
          <b data-glyph="b">B</b> {workspace ? t("Voltar / Menu") : t("Menu")}
        </span>
        {workspace ? (
          <span>
            <b data-glyph="lb rb">{t("LB / RB")}</b> {t("Campos")}
          </span>
        ) : section === "catalog" ? (
          <span>
            <b data-glyph="lb rb">{t("LB / RB")}</b> {t("Filtros")}
          </span>
        ) : section === "home" ? (
          <span>
            <b data-glyph="search">{t("Share / View")}</b> {t("Catálogo")}
          </span>
        ) : section === "library" ? (
          <>
            <span>
              <b data-glyph="x">X</b> {t("Favoritar")}
            </span>
            <span>
              <b data-glyph="y">Y</b> {t("Remover")}
            </span>
            <span>
              <b data-glyph="search">{t("Share / View")}</b> {t("Buscar")}
            </span>
          </>
        ) : null}
        <span>
          <b data-glyph="left right up down">← ↑ ↓ →</b> {t("Navegar")}
        </span>
      </footer>
      {notice && (
        <div key={notice.id} className="tv-notice" role="status">
          <Info size={19} />
          <span>{notice.text}</span>
          <button
            aria-label={t("Fechar aviso")}
            onClick={() => setNotice(undefined)}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {preparing && <LaunchSequence game={launchTarget} />}
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
            aria-label={t("Remover jogo")}
            onClick={(event) => event.stopPropagation()}
          >
            <Trash2 size={27} />
            <h2>
              {t("Remover")} {removeTarget.game.title}?
            </h2>
            <p>
              {t(
                "O jogo sai da biblioteca. O arquivo no seu computador será mantido.",
              )}
            </p>
            <div>
              <button
                autoFocus
                disabled={removing}
                className={!confirmRemove ? "focused" : ""}
                onClick={() => setRemoveTarget(undefined)}
              >
                {t("Cancelar")}
              </button>
              <button
                disabled={removing}
                className={`danger ${confirmRemove ? "focused" : ""}`}
                onClick={() => void doRemove()}
              >
                {removing ? "Removendo…" : t("Remover da biblioteca")}
              </button>
            </div>
            <small>{t("A confirma a opção selecionada · B cancela")}</small>
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
            aria-label={t("Energia")}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="tv-dialog-close"
              aria-label={t("Fechar energia")}
              onClick={() => setPowerOpen(false)}
            >
              <X size={21} />
            </button>
            <h2>{t("Energia")}</h2>
            <p>{t("Escolha o que fazer com o OpenRetro.")}</p>
            <button className="tv-power-action" onClick={close}>
              <Power size={24} />
              <span>
                <strong>{t("Sair do Big Picture")}</strong>
                <small>{t("Voltar ao modo desktop")}</small>
              </span>
            </button>
          </section>
        </div>
      )}
    </section>
  );
}
