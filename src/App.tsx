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
  ArrowLeft,
  Home,
  Compass,
  Download,
  Cpu,
  Settings,
  Search,
  Smartphone,
  Plus,
  X,
  Gamepad2,
  CheckCircle2,
} from "lucide-react";
import { PageLoading } from "./components/PageLoading";
import {
  activeTransferStates,
  downloadPollInterval,
} from "./services/activity";
import { Modal } from "./components/Modal";
import { PlayerAvatar } from "./components/PlayerAvatar";
import { PlayerPicker } from "./components/PlayerPicker";
import { PhonePlayDialog } from "./components/PhonePlayDialog";
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
  const [playersOpen, setPlayersOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [libraryFilter, setLibraryFilter] = useState("");
  const players = useQuery({ queryKey: ["players"], queryFn: bridge.profiles });
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
  const activePlayer = players.data?.players.find(
    (p) => p.id === players.data?.activeId,
  );
  const shownLibrary = library.filter((x) =>
    x.game.title.toLowerCase().includes(libraryFilter.trim().toLowerCase()),
  );
  const downloading = activeDownloads[0];
  return (
    <div className={`app density-${settings.density}`}>
      <aside className="sidebar">
        <button
          className="sidebar-profile"
          onClick={() => setPlayersOpen(true)}
          title="Trocar jogador"
        >
          <PlayerAvatar player={activePlayer} size={36} />
          <span>
            <strong>{activePlayer?.name ?? "Jogador 1"}</strong>
            <small>
              {playing ? `Jogando ${playing.game.title}` : "Trocar jogador"}
            </small>
          </span>
        </button>
        <nav className="sidebar-nav" aria-label="Navegação">
          {navItems.map((n) => (
            <button
              key={n.page}
              aria-current={page === n.page && !selected ? "page" : undefined}
              className={page === n.page && !selected ? "active" : ""}
              onClick={() => navigate(n.page)}
            >
              <n.icon size={17} strokeWidth={1.8} />
              <span>{pageLabels[n.page]}</span>
              {n.page === "Downloads" && activeDownloads.length > 0 && (
                <small>{activeDownloads.length}</small>
              )}
            </button>
          ))}
        </nav>
        <section className="sidebar-library" aria-label="Minha biblioteca">
          <div className="sidebar-library-heading">
            <button
              className={page === "Library" && !selected ? "active" : ""}
              onClick={() => navigate("Library")}
            >
              Minha biblioteca
            </button>
            <button
              className="icon-button"
              aria-label="Adicionar jogo"
              title="Adicionar jogo"
              onClick={() => openImport()}
            >
              <Plus size={16} />
            </button>
          </div>
          {library.length > 0 && (
            <input
              className="sidebar-filter"
              aria-label="Filtrar biblioteca"
              placeholder="Filtrar biblioteca"
              value={libraryFilter}
              onChange={(e) => setLibraryFilter(e.target.value)}
            />
          )}
          <ul>
            {shownLibrary.map(({ game, item }) => (
              <li key={item.id}>
                <button
                  className={selected?.id === game.id ? "active" : ""}
                  onClick={() => setSelected(game)}
                  title={game.title}
                >
                  {game.coverUrl ? (
                    <img
                      src={game.coverUrl}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <Gamepad2 size={16} />
                  )}
                  <span>{game.title}</span>
                  {playing?.item.id === item.id && (
                    <small className="sidebar-playing">jogando</small>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {library.length === 0 && (
            <p className="sidebar-empty">
              Os jogos que você adicionar aparecem aqui.
            </p>
          )}
        </section>
      </aside>
      <main>
        <header className="header">
          {selected && (
            <button
              className="icon-button header-back"
              aria-label="Voltar"
              onClick={() => setSelected(undefined)}
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <h1>{selected ? selected.title : pageLabels[page]}</h1>
          <div className="header-actions">
            {updateVersion && (
              <button
                className="button primary"
                disabled={installingUpdate}
                onClick={() => void installUpdate()}
              >
                <Download size={16} />
                {installingUpdate
                  ? "Atualizando…"
                  : `Atualizar para ${updateVersion}`}
              </button>
            )}
            <button
              className="button secondary"
              onClick={() => setPhoneOpen(true)}
            >
              <Smartphone size={16} /> Celular
            </button>
            <button
              className="button secondary"
              onClick={() => setBigPicture(true)}
            >
              <Gamepad2 size={16} /> Big Picture
            </button>
            <label className="header-search">
              <Search size={16} />
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
              {query && (
                <button
                  className="icon-button"
                  aria-label="Limpar busca"
                  onClick={() => setQuery("")}
                >
                  <X size={14} />
                </button>
              )}
            </label>
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
      <footer className="bottom-panel">
        <button onClick={() => navigate("Downloads")}>
          {playing
            ? `Jogando ${playing.game.title}`
            : downloading
              ? `Baixando ${downloading.game?.title ?? downloading.name} (${downloading.progress.toFixed(0)}%)`
              : "Nenhum download em andamento"}
        </button>
        <button onClick={() => setHelp(true)}>
          OpenRetro v0.3.1{isDesktop ? "" : " · prévia no navegador"}
        </button>
      </footer>
      {playersOpen && <PlayerPicker onClose={() => setPlayersOpen(false)} />}
      {phoneOpen && (
        <PhonePlayDialog onClose={() => setPhoneOpen(false)} notify={notify} />
      )}
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
