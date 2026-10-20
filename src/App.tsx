import { HomePage } from "./features/home/HomePage";
import { DiscoverPage } from "./features/discover/DiscoverPage";
import { CollectionPage } from "./features/library/CollectionPage";
import { useCallback, useEffect, useState } from "react";
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
import { ImportDialog } from "./features/library/ImportDialog";
import { GamePage } from "./features/games/GamePage";
import { EmulatorsPage } from "./features/emulators/EmulatorsPage";
import { DownloadsPage } from "./features/downloads/DownloadsPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { Modal } from "./components/Modal";
import { BrandMark } from "./components/Brand";
import { useEmulators, useLibrary, useRefresh } from "./hooks/useLibrary";
import { bridge, isDesktop } from "./services/bridge";
import { listen } from "@tauri-apps/api/event";
import {
  defaultSettings,
  type GameMetadata,
  type ImportCandidate,
} from "./types";
import { platformById } from "./db/platforms";
type Page =
  "Home" | "Library" | "Discover" | "Downloads" | "Emulators" | "Settings";
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
  const downloads = useQuery({
    queryKey: ["download-jobs"],
    queryFn: bridge.downloadJobs,
    refetchInterval: isDesktop ? 2000 : false,
  });
  const jobs = downloads.data ?? [];
  const activeDownloads = jobs.filter((j) =>
    ["QUEUED", "RESOLVING", "DOWNLOADING", "VERIFYING"].includes(j.state),
  );
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("all");
  const [toast, setToast] = useState("");
  const [help, setHelp] = useState(false);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [page, selected?.id]);
  const { data: library = [], isPending, error } = useLibrary();
  const { data: emulators = [] } = useEmulators();
  const refresh = useRefresh();
  const notify = useCallback((s: string) => setToast(s), []);
  const { data: settings = defaultSettings } = useQuery({
    queryKey: ["settings"],
    queryFn: bridge.settings,
  });
  useEffect(() => {
    if (!isDesktop) return;
    const unlisten = listen("download-imported", async () => {
      await refresh();
      setPage("Library");
      notify("Download finished and was added to your library.");
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [notify, refresh]);
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
        <div className="sidebar-label">Collection</div>
        <nav className="main-nav">
          {navItems.map((n, i) => (
            <div key={n.page} className={i === 3 || i === 5 ? "nav-group" : ""}>
              <button
                aria-label={n.page}
                title={n.page}
                aria-current={page === n.page ? "page" : undefined}
                className={page === n.page ? "active" : ""}
                onClick={() => navigate(n.page)}
              >
                <n.icon size={19} strokeWidth={1.65} />
                <span>{n.page}</span>
                {n.page === "Library" && library.length > 0 && (
                  <small>{library.length}</small>
                )}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-collection">
          {library.length > 0 && (
            <span className="sidebar-label">Your consoles</span>
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
              {isDesktop ? "Desktop" : "Browser preview"} <b>v0.1.0</b>
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
            <div className="global-search">
              <Search size={17} />
              <input
                id="global-search"
                aria-label="Search games"
                placeholder={
                  page === "Library" ? "Search your library" : "Search games"
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
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <button
              className="button primary add-game"
              onClick={() => openImport()}
            >
              <Plus size={18} /> Add game
            </button>
            <button
              className="icon-button topbar-settings"
              aria-label="Open settings"
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
        {selected ? (
          <GamePage
            game={selected}
            entry={activeEntry}
            emulators={emulators}
            onBack={() => setSelected(undefined)}
            onImport={(game) => openImport(game)}
            onEmulators={() => navigate("Emulators")}
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
      </main>
      {importing && (
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
      )}
      {help && (
        <Modal title="About OpenRetro" onClose={() => setHelp(false)}>
          <p className="muted">
            OpenRetro 0.1.0 brings your legally obtained game files and
            installed emulators together. Add JSON download sources in Downloads
            to acquire games through magnet links. No game files, BIOS files, or
            emulators are bundled.
          </p>
          <p className="notice">
            {isDesktop
              ? "Desktop mode · local SQLite database"
              : "Browser preview · localStorage. Use the Tauri desktop build to launch games."}
          </p>
          <p className="hint">
            Discover uses IGDB metadata and artwork. Add your Twitch application
            credentials to .env.local to connect the catalog. Press Ctrl K to
            search.
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
