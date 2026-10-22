import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Home,
  Library,
  Compass,
  Download,
  Cpu,
  Settings,
  Search,
  Plus,
  X,
  Gamepad2,
  CircleHelp,
  CheckCircle2,
} from "lucide-react";
import { PageLoading } from "./components/PageLoading";
import {
  activeTransferStates,
  downloadPollInterval,
} from "./services/activity";
import { Modal } from "./components/Modal";
import { BrandMark } from "./components/Brand";
import { useEmulators, useLibrary, useRefresh } from "./hooks/useLibrary";
import { bridge, isDesktop } from "./services/bridge";
import { listen } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  defaultSettings,
  type GameMetadata,
  type ImportCandidate,
  type LibraryGame,
  type DownloadImported,
} from "./types";
import { platformById } from "./db/platforms";
const HomePage = lazy(() =>
  import("./features/home/HomePage").then((module) => ({
    default: module.HomePage,
  })),
);
const DiscoverPage = lazy(() =>
  import("./features/discover/DiscoverPage").then((module) => ({
    default: module.DiscoverPage,
  })),
);
const CollectionPage = lazy(() =>
  import("./features/library/CollectionPage").then((module) => ({
    default: module.CollectionPage,
  })),
);
const ImportDialog = lazy(() =>
  import("./features/library/ImportDialog").then((module) => ({
    default: module.ImportDialog,
  })),
);
const GamePage = lazy(() =>
  import("./features/games/GamePage").then((module) => ({
    default: module.GamePage,
  })),
);
const EmulatorsPage = lazy(() =>
  import("./features/emulators/EmulatorsPage").then((module) => ({
    default: module.EmulatorsPage,
  })),
);
const DownloadsPage = lazy(() =>
  import("./features/downloads/DownloadsPage").then((module) => ({
    default: module.DownloadsPage,
  })),
);
const SettingsPage = lazy(() =>
  import("./features/settings/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  })),
);
const BigPicture = lazy(() =>
  import("./features/big-picture/BigPicture").then((module) => ({
    default: module.BigPicture,
  })),
);
type Page =
  "Home" | "Library" | "Discover" | "Downloads" | "Emulators" | "Settings";
const pageLabels: Record<Page, string> = {
  Home: "Início",
  Library: "Biblioteca",
  Discover: "Catálogo",
  Downloads: "Downloads",
  Emulators: "Emuladores",
  Settings: "Configurações",
};
const navItems = [
  { page: "Home" as Page, icon: Home },
  { page: "Library" as Page, icon: Library },
  { page: "Discover" as Page, icon: Compass },
  { page: "Downloads" as Page, icon: Download },
  { page: "Emulators" as Page, icon: Cpu },
  { page: "Settings" as Page, icon: Settings },
];
export function App() {
  const [page, setPage] = useState<Page>("Home");
  const [selected, setSelected] = useState<GameMetadata>();
  const [importing, setImporting] = useState(false);
  const [importGame, setImportGame] = useState<GameMetadata>();
  const [importCandidate, setImportCandidate] = useState<ImportCandidate>();
  const [playing, setPlaying] = useState<LibraryGame>();
  const downloads = useQuery({
    queryKey: ["download-jobs"],
    queryFn: bridge.downloadJobs,
    refetchInterval: (query) =>
      downloadPollInterval(query.state.data, isDesktop, Boolean(playing)),
    refetchIntervalInBackground: false,
  });
  const jobs = downloads.data ?? [];
  const activeDownloads = jobs.filter((j) => activeTransferStates.has(j.state));
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("all");
  const [toast, setToast] = useState("");
  const [help, setHelp] = useState(false);
  const [bigPicture, setBigPicture] = useState(false);
  const [downloadArrival, setDownloadArrival] = useState<DownloadImported>();
  const [updateVersion, setUpdateVersion] = useState<string>();
  const [installingUpdate, setInstallingUpdate] = useState(false);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [page, selected?.id]);
  const { data: library = [], isPending, error } = useLibrary();
  const { data: emulators = [] } = useEmulators();
  const refresh = useRefresh();
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const notify = useCallback((s: string) => setToast(s), []);
  const { data: settings = defaultSettings } = useQuery({
    queryKey: ["settings"],
    queryFn: bridge.settings,
  });
  useEffect(() => {
    if (!isDesktop) return;
    const unlisten = listen<DownloadImported>(
      "download-imported",
      async ({ payload }) => {
        await refresh();
        setDownloadArrival(payload);
        setPage("Library");
        notify("Download finished and was added to your library.");
      },
    );
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [notify, refresh]);
  useEffect(() => {
    if (!isDesktop) return;
    const started = listen<string>("game-started", ({ payload }) => {
      setPlaying(libraryRef.current.find((entry) => entry.item.id === payload));
    });
    const finished = listen<string>("game-finished", ({ payload }) => {
      setPlaying((current) =>
        current?.item.id === payload ? undefined : current,
      );
      void refresh();
    });
    return () => {
      void started.then((unlisten) => unlisten());
      void finished.then((unlisten) => unlisten());
    };
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.animations = String(settings.animations);
  }, [settings]);
  useEffect(() => {
    if (!isDesktop) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      void check()
        .then((update) => {
          if (alive && update) setUpdateVersion(update.version);
        })
        .catch(() => undefined);
    }, 3500);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        document.getElementById("global-search")?.focus();
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);
  const navigate = (p: Page) => {
    setPage(p);
    setSelected(undefined);
    setQuery("");
    setPlatform("all");
  };
  const openImport = (g?: GameMetadata) => {
    setImportCandidate(undefined);
    setImportGame(g);
    setImporting(true);
  };
  const installUpdate = async () => {
    setInstallingUpdate(true);
    try {
      const update = await check();
      if (!update) {
        setUpdateVersion(undefined);
        setInstallingUpdate(false);
        notify("OpenRetro já está atualizado.");
        return;
      }
      await update.downloadAndInstall();
      await relaunch();
    } catch (error) {
      notify(`Could not install the update: ${String(error)}`);
      setInstallingUpdate(false);
    }
  };
  // Unmount desktop pages while the console owns the screen: no hidden catalog,
  // images, observers or page queries behind Big Picture.
  if (bigPicture)
    return (
      <Suspense
        fallback={
          <div className="console-loading" role="status">
            Abrindo modo console…
          </div>
        }
      >
        <BigPicture
          library={library}
          emulators={emulators}
          jobs={jobs}
          downloadArrival={downloadArrival}
          refresh={refresh}
          onClose={() => setBigPicture(false)}
          onUpdate={() => void installUpdate()}
          updateVersion={updateVersion}
          updating={installingUpdate}
          notify={notify}
        />
      </Suspense>
    );
  const activeEntry = library.find((x) => x.game.id === selected?.id);
  return (
    <div className={`app density-${settings.density}`}>
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => navigate("Home")}
          aria-label="OpenRetro home"
        >
          <BrandMark />
          <span>OpenRetro</span>
        </button>
        <div className="sidebar-label">Sua coleção</div>
        <nav className="main-nav">
          {navItems.map((n, i) => (
            <div key={n.page} className={i === 3 || i === 5 ? "nav-group" : ""}>
              <button
                aria-label={pageLabels[n.page]}
                title={pageLabels[n.page]}
                aria-current={page === n.page ? "page" : undefined}
                className={page === n.page ? "active" : ""}
                onClick={() => navigate(n.page)}
              >
                <n.icon size={19} strokeWidth={1.65} />
                <span>{pageLabels[n.page]}</span>
                {n.page === "Library" && library.length > 0 && (
                  <small>{library.length}</small>
                )}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-collection">
          {library.length > 0 && (
            <span className="sidebar-label">Seus consoles</span>
          )}
          {[...new Set(library.map((x) => x.game.platformId))]
            .slice(0, 4)
            .map((id) => (
              <button
                key={id}
                onClick={() => {
                  navigate("Library");
                  setPlatform(id);
                }}
              >
                <Gamepad2 size={15} />
                {platformById(id)?.shortName}
                <span>
                  {library.filter((x) => x.game.platformId === id).length}
                </span>
              </button>
            ))}
        </div>
        <div className="sidebar-bottom">
          <div className="download-status">
            <Download size={16} />
            <span>
              {activeDownloads.length
                ? `${activeDownloads.length} active download${activeDownloads.length === 1 ? "" : "s"}`
                : "No active downloads"}
            </span>
          </div>
          <div className="sidebar-version">
            <span>
              {isDesktop ? "Desktop" : "Browser preview"} <b>v0.3.0</b>
            </span>
            <button
              className="icon-button"
              aria-label="About OpenRetro"
              onClick={() => setHelp(true)}
            >
              <CircleHelp size={15} />
            </button>
          </div>
          {settings.developerMode && (
            <small className="runtime-label">
              {isDesktop ? "Tauri · SQLite" : "Browser · localStorage"}
            </small>
          )}
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="topbar-actions">
            {playing && (
              <button
                className="now-playing"
                onClick={() => {
                  setSelected(playing.game);
                  setPage("Library");
                }}
              >
                <span className="playing-indicator" />
                <span>
                  Jogando agora
                  <strong>{playing.game.title}</strong>
                </span>
              </button>
            )}
            <div className="global-search">
              <Search size={17} />
              <input
                id="global-search"
                aria-label="Buscar jogos"
                placeholder={
                  page === "Library" ? "Buscar na biblioteca" : "Buscar jogos"
                }
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (page !== "Library") setPage("Discover");
                  setSelected(undefined);
                }}
              />
              <kbd>Ctrl K</kbd>
              {query && (
                <button
                  className="icon-button"
                  aria-label="Limpar busca"
                  onClick={() => setQuery("")}
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <button
              className="button secondary big-picture-toggle"
              onClick={() => setBigPicture(true)}
            >
              <Gamepad2 size={18} /> Big Picture
            </button>
            {updateVersion && (
              <button
                className="button primary update-button"
                disabled={installingUpdate}
                onClick={() => void installUpdate()}
              >
                <Download size={18} />
                {installingUpdate ? "Updating…" : `Update ${updateVersion}`}
              </button>
            )}
            <button
              className="button primary add-game"
              onClick={() => openImport()}
            >
              <Plus size={18} /> Adicionar jogo
            </button>
            <button
              className="icon-button topbar-settings"
              aria-label="Abrir configurações"
              onClick={() => navigate("Settings")}
            >
              <Settings size={19} />
            </button>
          </div>
        </header>
        {error && (
          <div className="error-message" role="alert">
            Could not load your library: {String(error)}{" "}
            <button className="text-button" onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        )}
        <Suspense fallback={<PageLoading />}>
          {selected ? (
            <GamePage
              key={selected.id}
              game={selected}
              entry={activeEntry}
              emulators={emulators}
              onBack={() => setSelected(undefined)}
              onImport={(game) => openImport(game)}
              onEmulators={() => navigate("Emulators")}
              onSelect={(game) => {
                setSelected(game);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              refresh={refresh}
              notify={notify}
            />
          ) : page === "Home" ? (
            <HomePage
              library={library}
              onSelect={setSelected}
              onImport={() => openImport()}
              onLibrary={() => navigate("Library")}
              onDiscover={() => navigate("Discover")}
              onDownloads={() => {
                navigate("Downloads");
              }}
            />
          ) : page === "Discover" ? (
            <DiscoverPage
              query={query}
              setQuery={setQuery}
              platform={platform}
              setPlatform={setPlatform}
              onSelect={setSelected}
            />
          ) : page === "Library" ? (
            <CollectionPage
              key={page}
              library={library}
              isPending={isPending}
              query={query}
              setQuery={setQuery}
              platform={platform}
              setPlatform={setPlatform}
              onSelect={setSelected}
              onImport={() => openImport()}
            />
          ) : page === "Emulators" ? (
            <EmulatorsPage
              emulators={emulators}
              refresh={refresh}
              notify={notify}
            />
          ) : page === "Downloads" ? (
            <DownloadsPage
              jobs={jobs}
              onImport={() => openImport()}
              notify={notify}
              onDownloaded={(candidate, game) => {
                setImportCandidate(candidate);
                setImportGame(game);
                setImporting(true);
              }}
            />
          ) : (
            <SettingsPage
              onEmulators={() => navigate("Emulators")}
              notify={notify}
            />
          )}
        </Suspense>
      </main>
      {importing && (
        <Suspense
          fallback={
            <div className="toast" role="status">
              Abrindo…
            </div>
          }
        >
          <ImportDialog
            initial={importGame}
            initialCandidate={importCandidate}
            onClose={() => setImporting(false)}
            onImported={(game) => {
              void refresh();
              setImporting(false);
              setPage("Library");
              setSelected(game);
              notify("Game added to your library.");
            }}
          />
        </Suspense>
      )}
      {help && (
        <Modal title="Sobre o OpenRetro" onClose={() => setHelp(false)}>
          <p>
            Organize sua biblioteca, descubra jogos e gerencie seus emuladores.
            O runtime integrado configura os consoles compatíveis ao jogar.
            Jogos e BIOS não estão incluídos.
          </p>
          <p className="notice">
            {isDesktop
              ? "Aplicativo desktop · dados salvos neste dispositivo"
              : "Prévia no navegador · abra o aplicativo para jogar e baixar arquivos."}
          </p>
          <p className="hint">
            Adicione suas fontes em Configurações → Downloads. Use Ctrl K para
            buscar ou entre no Big Picture para navegar pelo controle.
            Informações e imagens dos jogos vêm do LaunchBox Games Database.
          </p>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
