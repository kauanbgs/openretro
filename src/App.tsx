import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Home,
  Library,
  Play,
  Compass,
  Download,
  Cpu,
  Settings,
  Search,
  Smartphone,
  Users,
  Plus,
  X,
  Gamepad2,
  CheckCircle2,
  LoaderCircle,
} from "lucide-react";
import { PageLoading } from "./components/PageLoading";
import {
  activeTransferStates,
  downloadPollInterval,
} from "./services/activity";
import { Modal } from "./components/Modal";
import { PlayerAvatar } from "./components/PlayerAvatar";
import { PlayerPicker } from "./components/PlayerPicker";
import { BrandMark } from "./components/Brand";
import { TitleBar } from "./components/TitleBar";
import { PhonePlayDialog } from "./components/PhonePlayDialog";
import { PartyDialog } from "./features/party/PartyDialog";
import { UserProfile } from "./features/social/UserProfile";
import { SocialPanel } from "./features/social/SocialPanel";
import {
  SocialNotice,
  SocialUnreadBadge,
} from "./features/social/SocialActivity";
import { usePlayTogether } from "./components/PlayTogether";
import { PartyGuestScreen } from "./features/party/PartyGuestScreen";
import { partyOwnsInput } from "./features/party/partyInput";
import type { Friend } from "./services/social";
import { AccountAvatar } from "./features/social/accountAvatars";
import { socialStore, startSocialClient } from "./services/social";
import { useEmulators, useLibrary, useRefresh } from "./hooks/useLibrary";
import { bridge, isDesktop, isRemote } from "./services/bridge";
import { invoke, isTauri } from "./services/transport";
import { listen } from "./services/transport";
import { useUpdates } from "./services/updates";
import { usePageInterest } from "./services/recommendations";
import { setPhoneFrameRate, startPhoneVideoHost } from "./services/phoneVideo";
import {
  defaultSettings,
  type GameMetadata,
  type ImportCandidate,
  type LibraryGame,
  type DownloadImported,
} from "./types";
import { t } from "./i18n";
import { version as appVersion } from "../package.json";
const HomePage = lazy(() =>
  import("./features/home/HomePage").then((module) => ({
    default: module.HomePage,
  })),
);
const MobileHome = lazy(() =>
  import("./features/home/MobileHome").then((module) => ({
    default: module.MobileHome,
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
  Home: t("Início"),
  Library: t("Biblioteca"),
  Discover: t("Catálogo"),
  Downloads: "Downloads",
  Emulators: t("Emuladores"),
  Settings: t("Configurações"),
};
// A phone browses, downloads and plays; emulators and settings stay on the PC.
const navItems = isRemote
  ? [
      { page: "Home" as Page, icon: Home },
      { page: "Discover" as Page, icon: Compass },
      { page: "Library" as Page, icon: Library },
      { page: "Downloads" as Page, icon: Download },
    ]
  : [
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
  // The desktop window has no system title bar; Big Picture covers the screen.
  // A paired phone has a backend but no Tauri window to drag or close.
  const titleBar = isTauri && !bigPicture;
  useEffect(() => {
    document.documentElement.classList.toggle("custom-titlebar", titleBar);
  }, [titleBar]);
  // Encodes phone play video while phone play runs, from any screen.
  useEffect(() => startPhoneVideoHost(), []);
  const [downloadArrival, setDownloadArrival] = useState<DownloadImported>();
  const [playersOpen, setPlayersOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [partyOpen, setPartyOpen] = useState(false);
  const [profileId, setProfileId] = useState<string>();
  const [socialOpen, setSocialOpen] = useState(false);
  const [socialView, setSocialView] = useState<
    "friends" | "activity" | "people"
  >("friends");
  const playTogether = usePlayTogether();
  const [guestFriend, setGuestFriend] = useState<Friend>();
  const social = useSyncExternalStore(
    socialStore.subscribe,
    socialStore.snapshot,
  );
  // With an account, the sidebar's profile button is the account's icon.
  const account = social.session.hasSession ? social.session.user : null;
  useEffect(() => {
    setProfileId(undefined);
  }, [page, selected?.id, social.session.user?.id]);
  const [searchOpen, setSearchOpen] = useState(false);
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
  useEffect(() => startSocialClient(notify), [notify]);
  const { data: settings = defaultSettings, isSuccess: settingsLoaded } =
    useQuery({
      queryKey: ["settings"],
      queryFn: bridge.settings,
    });
  useEffect(
    () => setPhoneFrameRate(settings.phoneFrameRate ?? 30),
    [settings.phoneFrameRate],
  );
  const updates = useUpdates({
    enabled: isTauri && settingsLoaded,
    automatic: settings.autoUpdate !== false,
    playing: Boolean(playing),
    notify,
  });
  const updateVersion = updates.phase === "idle" ? undefined : updates.version;
  const updating =
    updates.phase === "downloading" || updates.phase === "installing";
  useEffect(() => {
    if (!isDesktop) return;
    const unlisten = listen<DownloadImported>(
      "download-imported",
      async ({ payload }) => {
        await refresh();
        setDownloadArrival(payload);
        setPage("Library");
        notify(t("Download finished and was added to your library."));
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
    if (!isRemote) return;
    void invoke<{ id: string } | null>("in_game_status")
      .then((session) => {
        if (session)
          setPlaying(
            libraryRef.current.find((entry) => entry.item.id === session.id),
          );
      })
      .catch(() => undefined);
  }, [library.length]);
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
    // The game covers this window; its animations would only take CPU from it.
    document.documentElement.dataset.playing = String(Boolean(playing));
  }, [playing]);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (partyOwnsInput()) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        document.getElementById("global-search")?.focus();
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);
  const navigate = (p: Page) => {
    setProfileId(undefined);
    setSearchOpen(false);
    setPage(p);
    setSelected(undefined);
    setQuery("");
    setPlatform("all");
  };
  const openImport = (g?: GameMetadata) => {
    if (isRemote)
      return notify(
        t("Adicione arquivos pelo computador, ou baixe pelo catálogo daqui."),
      );
    setImportCandidate(undefined);
    setImportGame(g);
    setImporting(true);
  };
  useEffect(() => {
    if (!isDesktop) return;
    // The runtime registers itself in the background on first start.
    const unlisten = listen("emulators-changed", () => void refresh());
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [refresh]);
  const [ps3Setup, setPs3Setup] = useState("");
  useEffect(() => {
    if (!isDesktop) return;
    // The first PS3 game installs its emulator and the console's system.
    const unlisten = listen<string>("ps3-setup", ({ payload }) =>
      setPs3Setup(payload && t(payload)),
    );
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);
  const updateOverlay =
    updates.phase === "installing" ? (
      <div className="update-overlay" role="status">
        <Download size={28} />
        <strong>
          {updates.version
            ? t("Atualizando o OpenRetro para {version}", {
                version: updates.version,
              })
            : t("Atualizando o OpenRetro")}
        </strong>
        <span>{t("O app reabre sozinho em alguns segundos.")}</span>
      </div>
    ) : (
      ps3Setup && (
        <div className="update-overlay" role="status">
          <LoaderCircle className="spin" size={28} />
          <strong>{ps3Setup}</strong>
          <span>{t("Isso só acontece no primeiro jogo de PS3.")}</span>
        </div>
      )
    );
  // Time on a game's page feeds recommendations; playing or Big Picture pauses it.
  usePageInterest(selected, Boolean(playing) || bigPicture);
  // Unmount desktop pages while the console owns the screen: no hidden catalog,
  // images, observers or page queries behind Big Picture.
  if (bigPicture)
    return (
      <>
        {updateOverlay}
        <Suspense
          fallback={
            <div className="console-loading" role="status">
              {t("Abrindo modo console…")}
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
            onUpdate={() => void updates.install()}
            updateVersion={updateVersion}
            updating={updating}
            notify={notify}
          />
        </Suspense>
      </>
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
      {titleBar && <TitleBar />}
      <SocialNotice
        onOpen={(view) => {
          setSocialView(view);
          setSocialOpen(true);
        }}
      />
      {updateOverlay}
      <aside className="sidebar">
        <button
          className="sidebar-profile"
          aria-expanded={isRemote ? undefined : socialOpen}
          onClick={() =>
            isRemote ? setPlayersOpen(true) : setSocialOpen((open) => !open)
          }
          title={isRemote ? t("Trocar jogador") : t("Conta e amigos")}
        >
          {account ? (
            <AccountAvatar
              avatar={account.avatar}
              size={36}
              status={
                account.appearOffline
                  ? "offline"
                  : social.connected
                    ? playing
                      ? "playing"
                      : "online"
                    : "idle"
              }
            />
          ) : (
            <PlayerAvatar player={activePlayer} size={36} />
          )}
          {!isRemote && social.incoming.length > 0 && (
            <b className="sidebar-profile-badge">{social.incoming.length}</b>
          )}
          {!isRemote && <SocialUnreadBadge />}
          <span>
            <strong>
              {account?.displayName ?? activePlayer?.name ?? t("Jogador 1")}
            </strong>
            <small>
              {playing
                ? t("Jogando {title}", { title: playing.game.title })
                : isRemote
                  ? t("Trocar jogador")
                  : account
                    ? t("Amigos e conta")
                    : t("Entrar e ver amigos")}
            </small>
          </span>
        </button>
        <nav className="sidebar-nav" aria-label={t("Navegação")}>
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
        {!isRemote && (
          <nav className="sidebar-together" aria-label={t("Jogar junto")}>
            <h2>{t("Jogar junto")}</h2>
            <button
              onClick={() => setPhoneOpen(true)}
              title={t("Jogar no celular")}
              aria-label={t("Jogar no celular")}
            >
              <Smartphone size={18} />
              <span>{t("Jogar no celular")}</span>
              {playTogether.phoneActive && (
                <i aria-label={t("Conexão ativa")} />
              )}
            </button>
            <button
              onClick={() => setPartyOpen(true)}
              title={t("Jogar com amigos")}
              aria-label={t("Jogar com amigos")}
            >
              <Users size={18} />
              <span>{t("Jogar com amigos")}</span>
              {playTogether.partyActive && <i aria-label={t("Party aberto")} />}
            </button>
          </nav>
        )}
        <section className="sidebar-library" aria-label={t("Minha biblioteca")}>
          <div className="sidebar-library-heading">
            <button
              className={page === "Library" && !selected ? "active" : ""}
              onClick={() => navigate("Library")}
            >
              {t("Minha biblioteca")}
            </button>
            <button
              className="icon-button"
              aria-label={t("Adicionar jogo")}
              title={t("Adicionar jogo")}
              onClick={() => openImport()}
            >
              <Plus size={16} />
            </button>
          </div>
          {library.length > 0 && (
            <input
              className="sidebar-filter"
              aria-label={t("Filtrar biblioteca")}
              placeholder={t("Filtrar biblioteca")}
              value={libraryFilter}
              onChange={(e) => setLibraryFilter(e.target.value)}
            />
          )}
          <ul>
            {shownLibrary.map(({ game, item }) => (
              <li key={item.id}>
                <button
                  className={selected?.id === game.id ? "active" : ""}
                  onClick={() => {
                    setProfileId(undefined);
                    setSelected(game);
                  }}
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
                    <small className="sidebar-playing">{t("jogando")}</small>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {library.length === 0 && (
            <p className="sidebar-empty">
              {t("Os jogos que você adicionar aparecem aqui.")}
            </p>
          )}
        </section>
      </aside>
      <main>
        <header className="header">
          {selected && (
            <button
              className="icon-button header-back"
              aria-label={t("Voltar")}
              onClick={() => setSelected(undefined)}
            >
              <ArrowLeft size={18} />
            </button>
          )}
          {isRemote && searchOpen ? null : isRemote &&
            !selected &&
            page === "Home" ? (
            <span className="header-brand">
              <BrandMark /> {t("OpenRetro")}
            </span>
          ) : (
            <h1>
              {profileId
                ? t("Perfil")
                : selected
                  ? selected.title
                  : pageLabels[page]}
            </h1>
          )}
          <div className="header-actions">
            {updateVersion && (
              <button
                className="button primary"
                disabled={updating}
                onClick={() => void updates.install()}
              >
                <Download size={16} />
                {updates.phase === "downloading"
                  ? t("Baixando {version}…", { version: updateVersion })
                  : updates.phase === "installing"
                    ? "Atualizando…"
                    : updates.phase === "ready"
                      ? t("Reiniciar e atualizar para {version}", {
                          version: updateVersion,
                        })
                      : t("Atualizar para {version}", {
                          version: updateVersion,
                        })}
              </button>
            )}
            {isRemote ? (
              <>
                {playing && (
                  <a className="button primary" href="/play">
                    <Play size={15} fill="currentColor" /> {t("Voltar ao jogo")}
                  </a>
                )}
                <button
                  className="header-player"
                  aria-label={t("Trocar jogador")}
                  onClick={() => setPlayersOpen(true)}
                >
                  <PlayerAvatar player={activePlayer} size={32} />
                </button>
              </>
            ) : (
              <>
                <button
                  className="button big-picture-button"
                  onClick={() => setBigPicture(true)}
                  title={t("Abrir Big Picture")}
                  aria-label={t("Abrir Big Picture")}
                >
                  <Gamepad2 size={18} /> <span>{t("Big Picture")}</span>
                </button>
              </>
            )}
            {isRemote && !searchOpen && (
              <button
                className="icon-button header-search-open"
                aria-label={t("Buscar")}
                onClick={() => setSearchOpen(true)}
              >
                <Search size={20} />
              </button>
            )}
            <label
              className={`header-search ${isRemote && !searchOpen ? "collapsed" : ""}`}
            >
              <Search size={16} />
              <input
                id="global-search"
                autoFocus={isRemote && searchOpen}
                aria-label={t("Buscar jogos")}
                placeholder={
                  page === "Library"
                    ? t("Buscar na biblioteca")
                    : t("Buscar jogos")
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
                  aria-label={t("Limpar busca")}
                  onClick={() => setQuery("")}
                >
                  <X size={14} />
                </button>
              )}
            </label>
            {isRemote && searchOpen && (
              <button
                className="text-button"
                onClick={() => {
                  setSearchOpen(false);
                  setQuery("");
                }}
              >
                {t("Cancelar")}
              </button>
            )}
          </div>
        </header>
        {error && (
          <div className="error-message" role="alert">
            {t("Could not load your library:")} {String(error)}{" "}
            <button className="text-button" onClick={() => void refresh()}>
              {t("Retry")}
            </button>
          </div>
        )}
        <Suspense fallback={<PageLoading />}>
          {profileId ? (
            <UserProfile
              key={profileId}
              userId={profileId}
              notify={notify}
              onBack={() => {
                setProfileId(undefined);
                setSocialOpen(true);
              }}
              onJoinParty={setGuestFriend}
            />
          ) : selected ? (
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
          ) : page === "Home" && isRemote ? (
            <MobileHome
              library={library}
              onSelect={setSelected}
              onLibrary={() => navigate("Library")}
              onDiscover={() => navigate("Discover")}
            />
          ) : page === "Home" ? (
            <HomePage
              onFriends={() => {
                setSocialView("friends");
                setSocialOpen(true);
              }}
              onPhone={() => setPhoneOpen(true)}
              onParty={() => setPartyOpen(true)}
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
            ? t("Jogando {title}", { title: playing.game.title })
            : downloading
              ? t("Baixando {title} ({percent}%)", {
                  title: downloading.game?.title ?? downloading.name,
                  percent: downloading.progress.toFixed(0),
                })
              : t("Nenhum download em andamento")}
        </button>
        <button onClick={() => setHelp(true)}>
          OpenRetro v{appVersion}
          {isDesktop ? "" : t(" · prévia no navegador")}
        </button>
      </footer>
      {playersOpen && <PlayerPicker onClose={() => setPlayersOpen(false)} />}
      {partyOpen && (
        <PartyDialog
          onClose={() => setPartyOpen(false)}
          onSignIn={() => {
            setPartyOpen(false);
            setSocialOpen(true);
          }}
        />
      )}
      {socialOpen && (
        <>
          <div
            className="social-layer"
            aria-hidden="true"
            onClick={() => setSocialOpen(false)}
          />
          <SocialPanel
            onProfile={(id) => {
              setSocialOpen(false);
              setProfileId(id);
            }}
            initialView={socialView}
            onJoinParty={(friend) => {
              setSocialOpen(false);
              setGuestFriend(friend);
            }}
            notify={notify}
            player={activePlayer}
            onPlayers={() => {
              setSocialOpen(false);
              setPlayersOpen(true);
            }}
            onClose={() => setSocialOpen(false)}
          />
        </>
      )}
      {guestFriend && (
        <PartyGuestScreen
          friend={guestFriend}
          onClose={() => {
            setGuestFriend(undefined);
            setSocialOpen(true);
          }}
        />
      )}
      {phoneOpen && (
        <PhonePlayDialog onClose={() => setPhoneOpen(false)} notify={notify} />
      )}
      {importing && (
        <Suspense
          fallback={
            <div className="toast" role="status">
              {t("Abrindo…")}
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
              notify(t("Game added to your library."));
            }}
          />
        </Suspense>
      )}
      {help && (
        <Modal title={t("Sobre o OpenRetro")} onClose={() => setHelp(false)}>
          <p>
            {t(
              "Organize sua biblioteca, descubra jogos e gerencie seus emuladores. O runtime integrado configura os consoles compatíveis ao jogar. Jogos e BIOS não estão incluídos.",
            )}
          </p>
          <p className="notice">
            {isDesktop
              ? t("Aplicativo desktop · dados salvos neste dispositivo")
              : t(
                  "Prévia no navegador · abra o aplicativo para jogar e baixar arquivos.",
                )}
          </p>
          <p className="hint">
            {t(
              "Adicione suas fontes em Configurações → Downloads. Use Ctrl K para buscar ou entre no Big Picture para navegar pelo controle. Informações e imagens dos jogos vêm do LaunchBox Games Database.",
            )}
          </p>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label={t("Dismiss notification")}
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
