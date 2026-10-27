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
  Download,
  FolderPlus,
  Gamepad2,
  Heart,
  HeartOff,
  Image,
  Info,
  Keyboard,
  LayoutGrid,
  List,
  Play,
  Power,
  Search,
  Settings,
  Smartphone,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type {
  DownloadJob,
  Emulator,
  LibraryGame,
  GameMetadata,
  DownloadImported,
} from "../../types";
import { NETPLAY_PLATFORMS } from "../../types";
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
import "./ConsoleShell.css";
import { BigPictureCatalog, type CatalogViewState } from "./BigPictureCatalog";
import { ControllerSelect } from "./ControllerSelect";
import { ControllerInput } from "./controllerInput";
import { partyOwnsInput } from "../party/partyInput";
import { SocialNotice, SocialUnreadBadge } from "../social/SocialActivity";
import { playUiSound, setNavigationSounds, soundFor } from "./navigationSounds";
import { ControllerKeyboard } from "./ControllerKeyboard";
import { PhonePlayDialog } from "../../components/PhonePlayDialog";
import { PartyDialog } from "../party/PartyDialog";
import { AccountAvatar } from "../social/accountAvatars";
import { socialStore } from "../../services/social";
import { ConsoleWorkspace, type WorkspaceRoute } from "./ConsoleWorkspace";
import {
  BootSplash,
  ConsoleClock,
  LaunchSequence,
  pulseGlyph,
  useCardTilt,
} from "./ConsoleFx";
import { ParallaxBackdrop } from "./ParallaxBackdrop";
import { usePlayTogether } from "../../components/PlayTogether";
import { useConsoleTheme } from "./ConsoleThemes";
import { ConsoleHome, playtimeLabel, type HomeTile } from "./ConsoleHome";
import {
  ControlCenter,
  OptionsMenu,
  type ConsoleAction,
} from "./ControlCenter";
import { t } from "../../i18n";

type Section = "home" | "library" | "catalog";
const sections: { id: Section; label: string }[] = [
  { id: "home", label: t("Jogos") },
  { id: "library", label: t("Biblioteca") },
  { id: "catalog", label: t("Explorar") },
];
const activeDownload = (state: string) =>
  ["RESOLVING", "QUEUED", "DOWNLOADING", "VERIFYING", "INSTALLING"].includes(
    state,
  );
const artOf = (game?: GameMetadata) =>
  game && (game.backgroundUrl ?? game.screenshots?.[0] ?? game.coverUrl);

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
  // The top bar (tabs and shortcuts) or the screen's content has the focus.
  const [zone, setZone] = useState<"top" | "content">("content");
  const [topIndex, setTopIndex] = useState(0);
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
  const [centerOpen, setCenterOpen] = useState(false);
  const [optionsFor, setOptionsFor] = useState<LibraryGame>();
  const [workspace, setWorkspace] = useState<WorkspaceRoute>();
  const workspaceInput = useRef<((key: string) => boolean) | null>(null);
  const overlayInput = useRef<((key: string) => boolean) | null>(null);
  const homeInput = useRef<((key: string) => boolean) | null>(null);
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: bridge.settings,
  });
  setNavigationSounds(settings?.navigationSounds !== false);
  const { theme, picture } = useConsoleTheme();
  const together = usePlayTogether();
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
  const top = useRef<HTMLElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const catalogInput = useRef<((key: string) => boolean) | null>(null);
  const catalogMemory = useRef<CatalogViewState | null>(null);
  const [catalogCount, setCatalogCount] = useState(0);
  const [selected, setSelected] = useState(0);
  const [launching, setLaunching] = useState(false);
  const [launchTarget, setLaunchTarget] = useState<GameMetadata>();
  const [homeTile, setHomeTile] = useState<{
    tile: HomeTile;
    position: number;
  }>();
  const [pendingSearch, setPendingSearch] = useState(false);
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
    setCenterOpen(false);
    setOptionsFor(undefined);
    setWorkspace(undefined);
    setFilter("all");
    setQuery("");
    setLibraryPlatform("all");
    setLibrarySort("recent");
    setSection("library");
    setZone("content");
    setSelected(index);
    feedback(
      t("{title} foi adicionado à biblioteca. Pronto para jogar.", {
        title: ordered[index].game.title,
      }),
    );
    requestAnimationFrame(() => {
      content.current?.scrollTo({ top: 0, behavior: "instant" });
      grid.current
        ?.querySelectorAll<HTMLButtonElement>("button")
        [index]?.focus({ preventScroll: true });
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
  // The game the screen is about: the focused home tile or library card.
  const featured =
    section === "home"
      ? homeTile?.tile.kind === "game"
        ? homeTile.tile.entry
        : undefined
      : section === "library"
        ? selectedGame
        : undefined;
  const featuredMetadata =
    featured && (details[featured.game.id] ?? featured.game);
  useEffect(() => {
    const game = featured?.game;
    if (!game || !isCatalogGame(game) || game.backgroundUrl || details[game.id])
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
  }, [featured?.game.id, details]);
  const focusContent = (next = section) => {
    setZone("content");
    requestAnimationFrame(() => {
      const target =
        next === "home"
          ? root.current?.querySelector<HTMLElement>(".ps-tile.focused")
          : (grid.current?.querySelectorAll<HTMLButtonElement>("button")[
              Math.max(0, selected)
            ] ?? grid.current?.querySelector<HTMLButtonElement>("button"));
      target?.focus({ preventScroll: true });
    });
  };
  const selectSection = (next: Section) => {
    positions.current[section] = {
      selected,
      scroll: content.current?.scrollTop ?? 0,
    };
    setWorkspace(undefined);
    setSection(next);
    setSelected(positions.current[next]?.selected ?? 0);
    setZone("content");
    requestAnimationFrame(() =>
      content.current?.scrollTo({
        top: positions.current[next]?.scroll ?? 0,
        behavior: "instant",
      }),
    );
  };
  const openWorkspace = (route: WorkspaceRoute) => {
    setCenterOpen(false);
    setOptionsFor(undefined);
    setWorkspace(route);
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
  const launch = async (entry?: LibraryGame) => {
    if (!entry || launching) return;
    setOptionsFor(undefined);
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
  const favorite = async (entry?: LibraryGame) => {
    if (!entry) return;
    try {
      await bridge.favorite(entry.item.id, !entry.item.favorite);
      await refresh();
      feedback(
        entry.item.favorite
          ? t("Removido dos favoritos.")
          : t("Adicionado aos favoritos."),
      );
    } catch (error) {
      feedback(String(error));
    }
  };
  const askRemove = (entry: LibraryGame) => {
    setOptionsFor(undefined);
    setRemoveTarget(entry);
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
  const openSearch = () => {
    if (section === "library") return setKeyboardOpen(true);
    if (section !== "catalog") selectSection("catalog");
    setPendingSearch(true);
  };
  useEffect(() => {
    if (!pendingSearch || section !== "catalog") return;
    const frame = requestAnimationFrame(() => {
      catalogInput.current?.("open-search");
      setPendingSearch(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingSearch, section]);
  const activeJobs = jobs.filter((job) => activeDownload(job.state)).length;
  const centerActions: ConsoleAction[] = [
    {
      id: "downloads",
      label: "Downloads",
      detail: activeJobs
        ? t("{count} em andamento", { count: activeJobs })
        : t("Nada baixando"),
      icon: Download,
      badge: activeJobs,
      run: () => openWorkspace({ page: "downloads" }),
    },
    {
      id: "friends",
      label: t("Amigos"),
      detail: account?.displayName ?? t("Entrar"),
      icon: Users,
      badge: social.incoming.length,
      run: () => openWorkspace({ page: "friends" }),
    },
    {
      id: "party",
      label: "OpenRetro Party",
      detail: t("Jogue online com amigos"),
      icon: Gamepad2,
      run: () => {
        setCenterOpen(false);
        setPartyOpen(true);
      },
    },
    {
      id: "phone",
      label: t("Jogar no celular"),
      detail: t("Use o celular como tela"),
      icon: Smartphone,
      run: () => {
        setCenterOpen(false);
        setPhoneOpen(true);
      },
    },
    {
      id: "themes",
      label: t("Tema do fundo"),
      detail: t("Cenas e suas imagens"),
      icon: Image,
      run: () => openWorkspace({ page: "themes" }),
    },
    {
      id: "import",
      label: t("Adicionar jogos"),
      detail: t("Arquivos ou pasta"),
      icon: FolderPlus,
      run: () => openWorkspace({ page: "import" }),
    },
    {
      id: "sources",
      label: t("Fontes de download"),
      detail: t("Adicione e gerencie"),
      icon: Download,
      run: () => openWorkspace({ page: "sources" }),
    },
    {
      id: "settings",
      label: t("Configurações"),
      detail: updateVersion
        ? t("Atualização {version}", { version: updateVersion })
        : t("Ajuste a experiência"),
      icon: Settings,
      badge: updateVersion ? 1 : 0,
      run: () => openWorkspace({ page: "settings" }),
    },
    {
      id: "power",
      label: t("Energia"),
      detail: t("Sair do Big Picture"),
      icon: Power,
      danger: true,
      run: () => {
        setCenterOpen(false);
        setPowerOpen(true);
      },
    },
  ];
  const optionActions = (entry: LibraryGame): ConsoleAction[] => [
    {
      id: "play",
      label: t("Jogar"),
      icon: Play,
      run: () => void launch(entry),
    },
    ...(NETPLAY_PLATFORMS.includes(entry.game.platformId)
      ? [
          {
            id: "online",
            label: t("Jogar online"),
            icon: Users,
            run: () =>
              openWorkspace({ page: "game", game: entry.game, online: true }),
          },
        ]
      : []),
    {
      id: "manage",
      label: t("Gerenciar jogo"),
      icon: Settings,
      run: () => openWorkspace({ page: "game", game: entry.game }),
    },
    {
      id: "favorite",
      label: entry.item.favorite
        ? t("Remover dos favoritos")
        : t("Adicionar aos favoritos"),
      icon: entry.item.favorite ? HeartOff : Heart,
      run: () => {
        setOptionsFor(undefined);
        void favorite(entry);
      },
    },
    {
      id: "remove",
      label: t("Remover da biblioteca"),
      icon: Trash2,
      danger: true,
      run: () => askRemove(entry),
    },
  ];
  // The top bar: the tabs, then shortcuts on the right.
  const topActions: { id: string; run: () => void }[] = [
    ...sections.map((item) => ({
      id: item.id,
      run: () => {
        selectSection(item.id);
        focusContent(item.id);
      },
    })),
    { id: "party", run: () => setPartyOpen(true) },
    { id: "phone", run: () => setPhoneOpen(true) },
    { id: "search", run: openSearch },
    { id: "downloads", run: () => openWorkspace({ page: "downloads" }) },
    { id: "friends", run: () => openWorkspace({ page: "friends" }) },
    { id: "settings", run: () => openWorkspace({ page: "settings" }) },
  ];
  const topFocused = (id: string) =>
    zone === "top" && topActions[topIndex]?.id === id ? "focused" : "";
  const enterTop = () => {
    const index = sections.findIndex((item) => item.id === section);
    setZone("top");
    setTopIndex(index);
    top.current
      ?.querySelectorAll<HTMLButtonElement>("[data-top]")
      [index]?.focus({ preventScroll: true });
  };
  const switchTab = (step: number) => {
    const index = sections.findIndex((item) => item.id === section);
    const next = sections[(index + step + sections.length) % sections.length];
    selectSection(next.id);
    focusContent(next.id);
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
      if (overlayInput.current?.(key)) return;
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
      if (powerOpen) {
        if (key === "b" || key === "menu") setPowerOpen(false);
        if (key === "a") close();
        return;
      }
      if (key === "menu" || key === "home") {
        setCenterOpen(true);
        return;
      }
      if (workspace) {
        workspaceInput.current?.(key);
        return;
      }
      if (preparing) return;
      if (zone === "top") {
        const items =
          top.current?.querySelectorAll<HTMLButtonElement>("[data-top]");
        if (key === "left" || key === "right") {
          const next = Math.max(
            0,
            Math.min(
              topActions.length - 1,
              topIndex + (key === "left" ? -1 : 1),
            ),
          );
          setTopIndex(next);
          items?.[next]?.focus({ preventScroll: true });
        } else if (key === "a") topActions[topIndex]?.run();
        else if (key === "down" || key === "b") focusContent();
        else if (key === "lb" || key === "rb") switchTab(key === "lb" ? -1 : 1);
        return;
      }
      if (key === "lb" || key === "rb") {
        if (!catalogModal.current) switchTab(key === "lb" ? -1 : 1);
        return;
      }
      if (key === "search") return openSearch();
      if (section === "home") {
        if (homeInput.current?.(key)) return;
        if (key === "up") enterTop();
        return;
      }
      if (section === "catalog") {
        if (
          key === "up" &&
          !catalogModal.current &&
          document.activeElement?.closest(".tv-catalog-toolbar")
        )
          return enterTop();
        if (catalogInput.current?.(key)) return;
        if (key === "b") {
          selectSection("home");
          return focusContent("home");
        }
      }
      if (section === "library") {
        const control = document.activeElement as HTMLElement | null;
        if (control?.closest(".tv-library-tools, .tv-tabs")) {
          if (key === "a") {
            if (control instanceof HTMLInputElement) setKeyboardOpen(true);
            else if (control instanceof HTMLButtonElement) control.click();
            return;
          }
          if (key === "up") return enterTop();
          if (key === "down" || key === "b") {
            control.blur();
            move(0, visibleGames.length);
            return;
          }
          if (key === "left" || key === "right") {
            const controls = Array.from(
              root.current?.querySelectorAll<HTMLElement>(
                ".tv-library-tools input, .tv-library-tools button, .tv-tabs button",
              ) ?? [],
            );
            const index = controls.indexOf(control);
            controls[
              (index + (key === "right" ? 1 : -1) + controls.length) %
                controls.length
            ]?.focus();
            return;
          }
          return;
        }
        if (key === "b") {
          selectSection("home");
          return focusContent("home");
        }
        if (key === "a") return void launch(selectedGame);
        if (key === "x") return void favorite(selectedGame);
        if (key === "y") return selectedGame && setOptionsFor(selectedGame);
      }
      const size = section === "catalog" ? catalogCount : visibleGames.length;
      const columns = grid.current
        ? getComputedStyle(grid.current).gridTemplateColumns.split(" ").length
        : 1;
      if (key === "left") return move(-1, size);
      if (key === "right") return move(1, size);
      if (key === "up" && selected < columns) {
        if (section === "catalog") catalogInput.current?.("next-control");
        else {
          content.current?.scrollTo({ top: 0, behavior: "smooth" });
          root.current
            ?.querySelector<HTMLInputElement>(".tv-library-tools input")
            ?.focus();
        }
        return;
      }
      if (key === "up") return move(-columns, size);
      if (key === "down") return move(columns, size);
    };
    dispatchInput.current = handle;
    const onKey = (event: KeyboardEvent) => {
      if (partyOwnsInput()) return;
      if (event.key === "Tab") {
        const scope =
          root.current?.querySelector(
            ".tv-player-dialog, .tv-keyboard, .tv-confirm-dialog, .tv-power-dialog, .tv-catalog-dialog, .ps-center, .ps-options",
          ) ?? root.current;
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
        root.current?.contains(document.activeElement) &&
        !overlayInput.current
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
        m: "menu",
        M: "menu",
        PageUp: "lb",
        PageDown: "rb",
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
        playUiSound(soundFor(key));
        dispatchInput.current(key);
      }
    }, 33);
    return () => window.clearInterval(timer);
  }, []);
  const onHomeTile = useCallback(
    (tile: HomeTile, position: number) => setHomeTile({ tile, position }),
    [],
  );
  const accountButton = (
    <button
      data-top
      className={`ps-top-account ${topFocused("friends")}`}
      aria-label={t("Conta e amigos")}
      onClick={() => openWorkspace({ page: "friends" })}
    >
      <AccountAvatar
        avatar={account?.avatar}
        size={34}
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
      <SocialUnreadBadge />
      {social.incoming.length > 0 && (
        <b className="tv-topbar-badge">{social.incoming.length}</b>
      )}
    </button>
  );
  const backdropArt =
    section === "catalog" ? undefined : artOf(featuredMetadata);
  return (
    <section
      ref={root}
      className={`console-mode ps-console ${zone === "top" ? "top-focused" : ""}`}
      data-section={workspace ? workspace.page : section}
      data-console-theme={theme}
      aria-label={t("Modo console do OpenRetro")}
      onClickCapture={(event) => {
        if ((event.target as Element).closest("button:not(:disabled)"))
          playUiSound("select");
      }}
      role="dialog"
      aria-modal="true"
    >
      <ParallaxBackdrop
        theme={theme}
        picture={picture}
        root={root}
        art={backdropArt}
        focus={section === "home" ? homeTile?.position : undefined}
        watch={`${section}-${workspace?.page ?? ""}`}
      />
      <BootSplash />
      <SocialNotice
        onOpen={(view) =>
          openWorkspace({ page: "friends", activity: view === "activity" })
        }
      />
      {!workspace && (
        <header className="ps-topbar" ref={top}>
          <nav className="ps-tabs" aria-label={t("Navegação principal")}>
            {sections.map((item, index) => (
              <button
                key={item.id}
                data-top
                className={`${section === item.id ? "active" : ""} ${zone === "top" && topIndex === index ? "focused" : ""}`}
                aria-current={section === item.id ? "page" : undefined}
                onClick={() => selectSection(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="ps-top-tools">
            <button
              data-top
              className={`ps-top-together ${together.partyActive ? "live" : ""} ${topFocused("party")}`}
              aria-label={
                together.partyActive
                  ? t("Party aberta · {count}/4 jogadores", {
                      count: 1 + together.party.connected.length,
                    })
                  : t("Jogar com amigos")
              }
              title={t("Jogar com amigos")}
              onClick={() => setPartyOpen(true)}
            >
              <Users size={21} />
              <span>
                {together.partyActive
                  ? `${1 + together.party.connected.length}/4`
                  : "Party"}
              </span>
            </button>
            <button
              data-top
              className={`ps-top-together ${together.phoneDevices ? "live" : ""} ${topFocused("phone")}`}
              aria-label={
                together.phoneDevices
                  ? t("{count} celulares conectados", {
                      count: together.phoneDevices,
                    })
                  : t("Jogar no celular")
              }
              title={t("Jogar no celular")}
              onClick={() => setPhoneOpen(true)}
            >
              <Smartphone size={21} />
              <span>
                {together.phoneDevices
                  ? String(together.phoneDevices)
                  : t("Celular")}
              </span>
            </button>
            <button
              data-top
              className={topFocused("search")}
              aria-label={t("Pesquisar jogos")}
              onClick={openSearch}
            >
              <Search size={22} />
            </button>
            <button
              data-top
              className={topFocused("downloads")}
              aria-label="Downloads"
              onClick={() => openWorkspace({ page: "downloads" })}
            >
              <Download size={22} />
              {activeJobs > 0 && (
                <b className="tv-topbar-badge">{activeJobs}</b>
              )}
            </button>
            {accountButton}
            <button
              data-top
              className={topFocused("settings")}
              aria-label={t("Configurações")}
              onClick={() => openWorkspace({ page: "settings" })}
            >
              <Settings size={22} />
            </button>
            <span
              className={`ps-pad ${connected ? "connected" : ""}`}
              title={connected ? t("Controle conectado") : t("Teclado e mouse")}
            >
              <Gamepad2 size={20} />
            </span>
            <ConsoleClock />
          </div>
        </header>
      )}
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
            openWorkspace({ page: "friends" });
          }}
        />
      )}
      {workspace && (
        <ConsoleWorkspace
          key={workspace.page === "themes" ? "themes" : section}
          route={workspace}
          input={workspaceInput}
          active={!powerOpen && !centerOpen}
          onContentFocus={() => setZone("content")}
          library={library}
          emulators={emulators}
          jobs={jobs}
          refresh={refresh}
          notify={feedback}
          onRoute={setWorkspace}
          onMenu={() => setWorkspace(undefined)}
          onClose={() => setWorkspace(undefined)}
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
        <main
          ref={content}
          className="tv-content ps-content"
          key={section}
          onFocusCapture={() => setZone("content")}
        >
          {section === "home" && (
            <ConsoleHome
              library={library}
              emulators={emulators}
              details={details}
              input={homeInput}
              launching={launching}
              onTile={onHomeTile}
              onPlay={(entry) => void launch(entry)}
              onOptions={setOptionsFor}
              onOnline={(entry) =>
                openWorkspace({ page: "game", game: entry.game, online: true })
              }
              onFavorite={(entry) => void favorite(entry)}
              onLibrary={() => {
                selectSection("library");
                focusContent("library");
              }}
              onExplore={() => {
                selectSection("catalog");
                focusContent("catalog");
              }}
              onSearch={openSearch}
              onImport={() => openWorkspace({ page: "import" })}
              onSources={() => openWorkspace({ page: "sources" })}
              onPhone={() => setPhoneOpen(true)}
              onParty={() => setPartyOpen(true)}
              onFriends={() => openWorkspace({ page: "friends" })}
            />
          )}
          {section === "catalog" && (
            <BigPictureCatalog
              library={library}
              selected={selected}
              setSelected={setSelected}
              grid={grid}
              input={catalogInput}
              modal={catalogModal}
              selectInput={selectInput}
              onCount={setCatalogCount}
              onPlay={(entry) => void launch(entry)}
              onDownloads={() => openWorkspace({ page: "downloads" })}
              onManage={(game) => openWorkspace({ page: "game", game })}
              notify={feedback}
              memory={catalogMemory}
            />
          )}
          {section === "library" && (
            <section className="tv-library ps-library">
              <div className="ps-library-head">
                <h1>{t("Biblioteca de jogos")}</h1>
                {selectedGame && (
                  <p>
                    <strong>{selectedGame.game.title}</strong>
                    {"  ·  "}
                    {platformById(selectedGame.game.platformId)?.name ??
                      selectedGame.game.platformId}
                    {"  ·  "}
                    {playtimeLabel(selectedGame.item.playtime)}
                  </p>
                )}
              </div>
              <div className="tv-library-tools">
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
                      ...new Set(library.map((entry) => entry.game.platformId)),
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
              <div
                className={`tv-game-grid ps-library-grid ${libraryView === "list" ? "tv-library-list" : ""}`}
                ref={grid}
              >
                {visibleGames.map((entry, index) => (
                  <button
                    key={entry.item.id}
                    style={{ "--i": Math.min(index, 14) } as CSSProperties}
                    className={index === selected ? "focused" : ""}
                    onFocus={() => setSelected(index)}
                    onMouseEnter={() => {
                      clearTimeout(previewTimer.current);
                      previewTimer.current = setTimeout(
                        () => setSelected(index),
                        150,
                      );
                    }}
                    onMouseLeave={() => clearTimeout(previewTimer.current)}
                    onClick={() => void launch(entry)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setSelected(index);
                      setOptionsFor(entry);
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
              {!visibleGames.length && (
                <p className="tv-empty">
                  {query
                    ? t("Nenhum jogo encontrado. Tente outro nome.")
                    : t("Adicione jogos à sua biblioteca para jogar aqui.")}
                </p>
              )}
            </section>
          )}
        </main>
      )}
      <footer className="tv-controls ps-controls">
        <span>
          <b data-glyph="a">A</b> {t("Selecionar")}
        </span>
        <span>
          <b data-glyph="b">B</b> {t("Voltar")}
        </span>
        {!workspace && section !== "catalog" && (
          <>
            <span>
              <b data-glyph="x">X</b> {t("Favoritar")}
            </span>
            <span>
              <b data-glyph="y">Y</b> {t("Opções")}
            </span>
          </>
        )}
        {!workspace && (
          <span>
            <b data-glyph="search">{t("Share / View")}</b> {t("Buscar")}
          </span>
        )}
        <span>
          <b data-glyph="lb rb">{t("LB / RB")}</b>{" "}
          {workspace ? t("Campos") : t("Abas")}
        </span>
        <span>
          <b data-glyph="menu home">{t("Options")}</b> {t("Central")}
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
      {centerOpen && (
        <ControlCenter
          actions={centerActions}
          input={overlayInput}
          onClose={() => setCenterOpen(false)}
          account={
            <span className="ps-center-account">
              <AccountAvatar avatar={account?.avatar} size={30} />
              {account?.displayName ?? t("Sem conta")}
            </span>
          }
        />
      )}
      {optionsFor && (
        <OptionsMenu
          title={optionsFor.game.title}
          actions={optionActions(optionsFor)}
          input={overlayInput}
          onClose={() => setOptionsFor(undefined)}
        />
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
                {removing ? t("Removendo…") : t("Remover da biblioteca")}
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
            <button className="tv-power-action" autoFocus onClick={close}>
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
