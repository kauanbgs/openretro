import { useDownloadAvailability } from "../../hooks/useDownloadAvailability";
import { CatalogConnection } from "../discover/CatalogConnection";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Download,
  Play,
  RefreshCw,
  Search,
  X,
  Keyboard,
  SlidersHorizontal,
} from "lucide-react";
import {
  metadataProvider,
  catalogStatus,
  catalogRefresh,
} from "../../providers/metadata/LaunchboxMetadataProvider";
import type { CatalogRequest } from "../../providers/metadata/types";
import type { GameMetadata, LibraryGame } from "../../types";
import { bridge } from "../../services/bridge";
import { releasesFor } from "../../services/downloadPlatform";
import { platformById } from "../../db/platforms";
import { GameArtwork } from "../../components/GameArtwork";
import { useCatalogPagination } from "../../hooks/useCatalogPagination";
import { ControllerKeyboard } from "./ControllerKeyboard";
import { ControllerSelect } from "./ControllerSelect";
import { HeroArtwork } from "./HeroArtwork";
import { createPortal } from "react-dom";
import { t } from "../../i18n";
export interface CatalogViewState {
  query: string;
  platform: string;
  genre?: number;
  sort: NonNullable<CatalogRequest["sort"]>;
}

export function BigPictureCatalog({
  mode = "catalog",
  onLibrary,
  library,
  selected,
  setSelected,
  grid,
  input,
  modal,
  selectInput,
  onCount,
  onPlay,
  onDownloads,
  onManage,
  notify,
  memory,
}: {
  mode?: "catalog" | "home";
  onLibrary: () => void;
  library: LibraryGame[];
  selected: number;
  setSelected: (index: number) => void;
  grid: RefObject<HTMLDivElement | null>;
  input: RefObject<((key: string) => boolean) | null>;
  modal: RefObject<boolean>;
  selectInput: RefObject<((key: string) => boolean) | null>;
  onCount: (count: number) => void;
  onPlay: (entry: LibraryGame) => void;
  onDownloads: () => void;
  onManage: (game: GameMetadata) => void;
  notify: (message: string) => void;
  memory: RefObject<CatalogViewState | null>;
}) {
  const queryClient = useQueryClient();
  const libraryKeys = useMemo(
    () =>
      new Set(
        library.map((entry) => `${entry.game.id}:${entry.game.platformId}`),
      ),
    [library],
  );
  const [query, setQuery] = useState(memory.current?.query ?? "");
  const [debounced, setDebounced] = useState(memory.current?.query ?? "");
  const [platform, setPlatform] = useState(memory.current?.platform ?? "all");
  const [genre, setGenre] = useState<number | undefined>(memory.current?.genre);
  const [sort, setSort] = useState<NonNullable<CatalogRequest["sort"]>>(
    memory.current?.sort ?? "popular",
  );
  const filtersMounted = useRef(false);
  useEffect(() => {
    memory.current = { query, platform, genre, sort };
  }, [query, platform, genre, sort, memory]);
  const [opened, setOpened] = useState<GameMetadata>();
  const [releasesOpen, setReleasesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const keyboardInput = useRef<((key: string) => boolean) | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const dialogButton = useRef<HTMLButtonElement | null>(null);
  const focusButton = (button?: HTMLButtonElement) => {
    dialog.current
      ?.querySelectorAll("[data-controller-focused]")
      .forEach((element) => element.removeAttribute("data-controller-focused"));
    dialogButton.current = button ?? null;
    button?.setAttribute("data-controller-focused", "true");
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: "nearest" });
  };
  useLayoutEffect(() => {
    modal.current = Boolean(opened || keyboardOpen);
    return () => {
      modal.current = false;
    };
  }, [opened, keyboardOpen, modal]);
  const closeGame = () => {
    if (busy) return;
    setOpened(undefined);
    requestAnimationFrame(() => {
      grid.current
        ?.querySelectorAll<HTMLButtonElement>("button")
        [selected]?.focus({ preventScroll: true });
    });
  };
  useEffect(() => {
    if (!opened) return;
    focusButton(
      dialog.current?.querySelector<HTMLButtonElement>(".tv-catalog-primary") ??
        undefined,
    );
  }, [opened?.id]);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const status = useQuery({
    queryKey: ["catalog-status"],
    queryFn: catalogStatus,
    retry: false,
    refetchInterval: (query) =>
      ["building", "missing"].includes(query.state.data?.state ?? "")
        ? 1000
        : false,
  });
  const taxonomy = useQuery({
    queryKey: ["catalog-taxonomy"],
    queryFn: () => metadataProvider.getTaxonomy(),
    enabled: mode === "catalog" && status.data?.configured === true,
    staleTime: 86400000,
    retry: false,
  });
  const browse = useInfiniteQuery({
    queryKey: [
      "catalog",
      "artwork-v2",
      debounced,
      platform,
      genre ?? null,
      sort,
    ],
    queryFn: ({ pageParam }) =>
      metadataProvider.browse(debounced, platform, pageParam, genre, sort),
    enabled: status.data?.configured === true,
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasNext ? last.page + 1 : undefined),
    staleTime: 86400000,
    retry: false,
  });
  const games = useMemo(
    () =>
      [
        ...new Map(
          (mode === "home"
            ? (browse.data?.pages[0]?.games ?? [])
            : (browse.data?.pages.flatMap((page) => page.games) ?? [])
          ).map((game) => [game.id, game]),
        ).values(),
      ].slice(0, mode === "home" ? 12 : undefined),
    [browse.data, mode],
  );
  const sentinel = useCatalogPagination(
    Boolean(
      mode === "catalog" &&
      browse.hasNextPage &&
      !browse.isFetching &&
      !browse.error &&
      !opened &&
      !keyboardOpen,
    ),
    browse.fetchNextPage,
  );
  const downloads = useDownloadAvailability(games);
  const details = useQuery({
    queryKey: ["tv-catalog-detail", opened?.id, opened?.platformId],
    queryFn: () => metadataProvider.getGame(opened!.id, opened!.platformId),
    enabled: Boolean(opened),
    staleTime: 86400000,
    retry: false,
  });
  const game = details.data ?? opened;
  const entry = library.find(
    (item) =>
      item.game.id === game?.id && item.game.platformId === game?.platformId,
  );
  const releases = useQuery({
    queryKey: ["game-download-options", game?.id, releasesOpen],
    queryFn: async () =>
      releasesFor(await bridge.searchDownloadSources(game!.title), game!),
    enabled: Boolean(game && releasesOpen),
    retry: false,
  });
  useEffect(() => {
    onCount(games.length);
  }, [games.length, onCount]);
  useEffect(() => {
    if (!filtersMounted.current) {
      filtersMounted.current = true;
      return;
    }
    setSelected(0);
  }, [debounced, platform, genre, sort, setSelected]);
  useLayoutEffect(() => {
    input.current = (key) => {
      if (keyboardOpen) {
        keyboardInput.current?.(key);
        return true;
      }
      if (key === "open-search") {
        setFiltersOpen(true);
        setKeyboardOpen(true);
        return true;
      }
      if (key === "b" && opened) {
        if (releasesOpen) setReleasesOpen(false);
        else closeGame();
        return true;
      }
      if (opened) {
        const buttons = Array.from(
          dialog.current?.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ) ?? [],
        );
        if (["left", "right", "up", "down"].includes(key)) {
          const index = buttons.indexOf(
            dialogButton.current as HTMLButtonElement,
          );
          const step = key === "left" || key === "up" ? -1 : 1;
          focusButton(
            buttons[(index + step + buttons.length) % buttons.length],
          );
          return true;
        }
        if (key === "a") {
          (buttons.includes(dialogButton.current as HTMLButtonElement)
            ? dialogButton.current
            : (buttons.find((button) =>
                button.classList.contains("tv-catalog-primary"),
              ) ?? buttons[0])
          )?.click();
          return true;
        }
        return true;
      }
      if (key === "previous-control" || key === "next-control") {
        const controls = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".tv-catalog-toolbar input, .tv-catalog-toolbar button, .tv-catalog-toolbar select:not(:disabled), .tv-catalog-load:not(:disabled)",
          ),
        );
        const index = controls.indexOf(document.activeElement as HTMLElement);
        controls[
          (index + (key === "previous-control" ? -1 : 1) + controls.length) %
            controls.length
        ]?.focus();
        return true;
      }
      const control = document.activeElement;
      if (
        mode === "home" &&
        control instanceof HTMLButtonElement &&
        control.closest(".tv-home-recent")
      ) {
        if (key === "a") {
          control.click();
          return true;
        }
        if (key === "down") {
          setSelected(0);
          grid.current?.querySelector<HTMLButtonElement>("button")?.focus();
          return true;
        }
        if (key === "up") {
          document
            .querySelector<HTMLButtonElement>(".tv-home-feature .tv-play")
            ?.focus();
          return true;
        }
        if (key === "left" || key === "right") {
          const recent = Array.from(
            document.querySelectorAll<HTMLButtonElement>(
              ".tv-home-recent button",
            ),
          );
          recent[
            Math.max(
              0,
              Math.min(
                recent.length - 1,
                recent.indexOf(control) + (key === "left" ? -1 : 1),
              ),
            )
          ]?.focus();
          return true;
        }
      }
      if (mode === "home" && key === "up" && library.length) {
        const columns = grid.current
          ? getComputedStyle(grid.current).gridTemplateColumns.split(" ").length
          : 4;
        if (selected < columns && !control?.closest(".tv-home-feature")) {
          document
            .querySelector<HTMLButtonElement>(".tv-home-recent button")
            ?.focus();
          return true;
        }
      }
      if (
        mode === "home" &&
        control instanceof HTMLButtonElement &&
        control.closest(".tv-home-feature")
      ) {
        if (key === "a") {
          control.click();
          return true;
        }
        if (key === "down") {
          (
            document.querySelector<HTMLButtonElement>(
              ".tv-home-recent button",
            ) ?? grid.current?.querySelector<HTMLButtonElement>("button")
          )?.focus();
          return true;
        }
        if (key === "left" || key === "right") {
          const actions = Array.from(
            document.querySelectorAll<HTMLButtonElement>(
              ".tv-home-feature button",
            ),
          );
          actions[
            (actions.indexOf(control) +
              (key === "left" ? -1 : 1) +
              actions.length) %
              actions.length
          ]?.focus();
          return true;
        }
      }
      if (
        key === "a" &&
        control instanceof HTMLInputElement &&
        control.closest(".tv-catalog-toolbar")
      ) {
        setKeyboardOpen(true);
        return true;
      }
      if (
        key === "a" &&
        control instanceof HTMLButtonElement &&
        control.closest(".tv-catalog-toolbar")
      ) {
        control.click();
        return true;
      }
      if (
        control instanceof HTMLElement &&
        control.closest(".tv-catalog-toolbar") &&
        ["left", "right", "up", "down"].includes(key)
      ) {
        if (key === "down") {
          grid.current?.querySelector<HTMLButtonElement>("button")?.focus();
          return true;
        }
        const controls = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".tv-catalog-toolbar input, .tv-catalog-toolbar button:not(:disabled)",
          ),
        );
        const index = controls.indexOf(control);
        controls[
          Math.max(
            0,
            Math.min(
              controls.length - 1,
              index + (key === "left" || key === "up" ? -1 : 1),
            ),
          )
        ]?.focus();
        return true;
      }
      if (
        key === "a" &&
        control instanceof HTMLButtonElement &&
        control.classList.contains("tv-catalog-load")
      ) {
        control.click();
        return true;
      }
      if (key === "a" && games[selected]) {
        setOpened(games[selected]);
        setReleasesOpen(false);
        setDownloadError("");
        return true;
      }
      return false;
    };
    return () => {
      input.current = null;
    };
  }, [
    input,
    games,
    selected,
    opened,
    releasesOpen,
    sort,
    keyboardOpen,
    busy,
    mode,
    library,
  ]);
  const openGame = (next: GameMetadata, index: number) => {
    setSelected(index);
    setOpened(next);
    setReleasesOpen(false);
    setDownloadError("");
  };
  return (
    <section
      className={`tv-catalog ${mode === "home" ? "tv-home-discover" : ""}`}
    >
      {mode === "home" && games[0] && (
        <section className="tv-home-feature">
          <HeroArtwork game={games[0]} />
          <div className="tv-hero-shade" />
          <div className="tv-home-feature-copy">
            <p className="tv-kicker fx-feature-kicker">{t("Em destaque")}</p>
            <h1>{games[0].title}</h1>
            <p>{games[0].description || games[0].genre}</p>
            <div className="tv-hero-actions">
              <button className="tv-play" onClick={() => openGame(games[0], 0)}>
                {t("Ver detalhes")}
              </button>
              <button className="tv-secondary" onClick={onLibrary}>
                {t("Minha biblioteca (")}
                {library.length})
              </button>
            </div>
          </div>
        </section>
      )}
      {mode === "catalog" ? (
        <div className="tv-catalog-toolbar tv-compact-toolbar">
          <div className="tv-catalog-order-label">
            <strong>
              {debounced
                ? t("Resultados para “{query}”", { query: debounced })
                : t("Ordenado por: {order}", {
                    order: {
                      popular: t("Popularidade"),
                      rating: t("Melhor avaliação"),
                      title: t("Nome"),
                      newest: t("Mais recentes"),
                      oldest: t("Mais antigos"),
                    }[sort],
                  })}
            </strong>
            {(platform !== "all" || genre !== undefined) && (
              <small>
                {platformById(platform)?.name}{" "}
                {taxonomy.data?.genres.find((item) => item.id === genre)?.name}
              </small>
            )}
          </div>
          <div className="tv-catalog-actions">
            <button
              className="tv-filter-toggle"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((value) => !value)}
            >
              <SlidersHorizontal size={18} /> {t("Filtros")}
            </button>
            <label className="tv-filter-control">
              <span>{t("Ordenar")}</span>
              <ControllerSelect
                input={selectInput}
                label={t("Ordenar catálogo")}
                value={sort}
                disabled={Boolean(debounced)}
                onChange={(value) => setSort(value as typeof sort)}
                options={[
                  {
                    value: "popular",
                    label: debounced ? t("Relevância") : t("Popularidade"),
                  },
                  { value: "rating", label: t("Melhor avaliação") },
                  { value: "title", label: t("Nome") },
                  { value: "newest", label: t("Mais recentes") },
                  { value: "oldest", label: t("Mais antigos") },
                ]}
              />
            </label>
          </div>
          {filtersOpen && (
            <div className="tv-catalog-filter-panel">
              <label className="tv-search">
                <Search size={19} />
                <input
                  aria-label={t("Pesquisar catálogo")}
                  placeholder={t("Pesquisar jogos")}
                  maxLength={120}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <button
                  className="tv-open-keyboard"
                  aria-label={t("Buscar catálogo com controle")}
                  title={t("Teclado na tela")}
                  onClick={() => setKeyboardOpen(true)}
                >
                  <Keyboard size={20} />
                </button>
              </label>
              <label className="tv-filter-control">
                <span>{t("Console")}</span>
                <ControllerSelect
                  input={selectInput}
                  label={t("Console")}
                  value={platform}
                  onChange={setPlatform}
                  options={[
                    { value: "all", label: t("Todos os consoles") },
                    ...(taxonomy.data?.platforms ?? []).map((item) => ({
                      value: item.localId,
                      label: platformById(item.localId)?.name ?? item.name,
                    })),
                  ]}
                />
              </label>
              <label className="tv-filter-control">
                <span>{t("Gênero")}</span>
                <ControllerSelect
                  input={selectInput}
                  label={t("Gênero")}
                  value={genre === undefined ? "all" : String(genre)}
                  onChange={(value) =>
                    setGenre(value === "all" ? undefined : Number(value))
                  }
                  options={[
                    { value: "all", label: t("Todos os gêneros") },
                    ...(taxonomy.data?.genres ?? []).map((item) => ({
                      value: String(item.id),
                      label: item.name,
                    })),
                  ]}
                />
              </label>
              <div className="tv-filter-summary">
                <span>{t("Filtros por console e gênero")}</span>
                {(platform !== "all" || genre !== undefined || query) && (
                  <button
                    onClick={() => {
                      setPlatform("all");
                      setGenre(undefined);
                      setQuery("");
                    }}
                  >
                    {t("Limpar filtros")}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {library.length > 0 && (
            <section className="tv-home-recent">
              <h2>{t("Continue jogando")}</h2>
              <div>
                {[...library]
                  .sort((a, b) =>
                    (b.item.lastPlayedAt ?? "").localeCompare(
                      a.item.lastPlayedAt ?? "",
                    ),
                  )
                  .slice(0, 4)
                  .map((recent, index) => (
                    <button
                      key={recent.item.id}
                      style={{ "--i": index } as CSSProperties}
                      onClick={() => onPlay(recent)}
                    >
                      <GameArtwork game={recent.game} loading="lazy" />
                      <span>
                        <strong>{recent.game.title}</strong>
                        <small>
                          {platformById(recent.game.platformId)?.name}
                        </small>
                      </span>
                      <Play size={20} />
                    </button>
                  ))}
              </div>
            </section>
          )}
          <div className="tv-home-shelf-title">
            <h2>{t("Descubra seu próximo jogo")}</h2>
            <span>{t("Clássicos populares no LaunchBox")}</span>
          </div>
        </>
      )}
      {!status.isPending && !status.data?.configured ? (
        <CatalogConnection
          status={status.data}
          error={status.error ? String(status.error) : undefined}
          onRetry={() => {
            void catalogRefresh()
              .then(() =>
                queryClient.invalidateQueries({ queryKey: ["catalog-status"] }),
              )
              .catch((e) => notify(String(e)));
          }}
        />
      ) : browse.isPending ? (
        <div
          className="tv-catalog-skeleton"
          role="status"
          aria-label={t("Carregando catálogo")}
        >
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} aria-hidden="true">
              <i />
              <span />
              <small />
            </div>
          ))}
        </div>
      ) : browse.error && !games.length ? (
        <div className="tv-catalog-message" role="alert">
          <h2>{t("Não foi possível carregar o catálogo")}</h2>
          <p>{String(browse.error)}</p>
          <button onClick={() => void browse.refetch()}>
            <RefreshCw size={17} /> {t("Tentar novamente")}
          </button>
        </div>
      ) : (
        <>
          <div className="tv-catalog-grid" ref={grid}>
            {games.map((item, index) => (
              <button
                key={item.id}
                style={{ "--i": index % 20 } as CSSProperties}
                className={`${index === selected ? "focused" : ""} ${item.backgroundUrl || item.screenshots?.length ? "" : "portrait-source"}`}
                aria-label={t("Ver {title}", { title: item.title })}
                onFocus={() => setSelected(index)}
                onMouseEnter={() => setSelected(index)}
                onClick={() => openGame(item, index)}
              >
                <GameArtwork
                  loading="lazy"
                  game={{
                    ...item,
                    backgroundUrl: (
                      item.backgroundUrl ?? item.screenshots?.[0]
                    )?.replace("/t_1080p/", "/t_screenshot_med/"),
                  }}
                  hero={Boolean(item.backgroundUrl || item.screenshots?.length)}
                />
                <strong>{item.title}</strong>
                <span>{item.genre || platformById(item.platformId)?.name}</span>
                <div className="tv-catalog-badges">
                  <small>
                    {platformById(item.platformId)?.shortName ??
                      item.platformId}
                  </small>
                  {downloads.has(item.title) && (
                    <small className="available">
                      <Download size={12} /> {t("Download disponível")}
                    </small>
                  )}
                  {libraryKeys.has(`${item.id}:${item.platformId}`) && (
                    <small>{t("Na biblioteca")}</small>
                  )}
                </div>
              </button>
            ))}
          </div>
          {!games.length && (
            <div className="tv-catalog-message">
              <Search size={28} />
              <h2>{t("Nenhum jogo encontrado")}</h2>
              <p>{t("Tente outro nome, console ou gênero.")}</p>
              <button
                onClick={() => {
                  setQuery("");
                  setPlatform("all");
                  setGenre(undefined);
                }}
              >
                {t("Limpar filtros")}
              </button>
            </div>
          )}
          {mode === "catalog" && browse.hasNextPage && (
            <div ref={sentinel} className="tv-catalog-pagination">
              <button
                className="tv-catalog-load"
                disabled={browse.isFetchingNextPage}
                onClick={() => void browse.fetchNextPage()}
              >
                {browse.isFetchingNextPage
                  ? "Carregando…"
                  : t("Carregar mais jogos")}
              </button>
            </div>
          )}
          {browse.error && games.length > 0 && (
            <p role="alert">{String(browse.error)}</p>
          )}
          <p className="tv-catalog-credit">
            {t("Dados e imagens do LaunchBox Games Database")}
          </p>
        </>
      )}
      {game &&
        createPortal(
          <div
            className="tv-dialog-backdrop"
            onClick={() => {
              closeGame();
            }}
          >
            <section
              className="tv-catalog-dialog"
              ref={dialog}
              onFocusCapture={(event) => {
                if (
                  event.target instanceof HTMLButtonElement &&
                  dialogButton.current !== event.target
                )
                  focusButton(event.target);
              }}
              role="dialog"
              aria-modal="true"
              aria-label={game.title}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                className="tv-dialog-close"
                aria-label={t("Fechar detalhes")}
                disabled={busy}
                onClick={closeGame}
              >
                <X size={22} />
              </button>
              <div className="tv-catalog-detail-art">
                <GameArtwork
                  game={{
                    ...game,
                    backgroundUrl: game.backgroundUrl ?? game.screenshots?.[0],
                  }}
                  hero
                />
              </div>
              <div className="tv-catalog-detail-copy">
                <h1>{game.title}</h1>
                <p className="tv-catalog-detail-meta">
                  {platformById(game.platformId)?.name} ·{" "}
                  {game.year || t("Ano não informado")}
                </p>
                <p>{game.description}</p>
                <div className="tv-catalog-detail-actions">
                  <button onClick={() => onManage(game)}>
                    {t("Detalhes e gerenciamento")}
                  </button>
                  {entry && (
                    <button
                      className="tv-catalog-primary"
                      onClick={() => onPlay(entry)}
                    >
                      <Play size={18} fill="currentColor" /> {t("Jogar")}
                    </button>
                  )}
                  <button
                    className={entry ? "" : "tv-catalog-primary"}
                    onClick={() => setReleasesOpen((value) => !value)}
                  >
                    <Download size={18} />
                    {releasesOpen
                      ? t("Ocultar versões")
                      : t("Ver opções de download")}
                  </button>
                </div>
                {releasesOpen && (
                  <section className="tv-catalog-releases">
                    <h2>{t("Opções de download")}</h2>
                    {releases.isPending ? (
                      <p>{t("Buscando nas suas fontes…")}</p>
                    ) : releases.error ? (
                      <p role="alert">{String(releases.error)}</p>
                    ) : releases.data?.length ? (
                      releases.data.map((match) => (
                        <button
                          key={`${match.sourceId}-${match.id}`}
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            setDownloadError("");
                            try {
                              await bridge.startDownload(match, 0, game);
                              void queryClient.invalidateQueries({
                                queryKey: ["download-jobs"],
                              });
                              notify(t("Download iniciado."));
                              onDownloads();
                            } catch (error) {
                              setDownloadError(String(error));
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          <span>
                            <strong>{match.title}</strong>
                            <small>
                              {match.confirmed
                                ? platformById(game.platformId)?.shortName
                                : t("Console não informado")}{" "}
                              · {match.sourceName} ·{" "}
                              {match.fileSize || t("Tamanho não informado")}
                            </small>
                          </span>
                          <Download size={18} />
                        </button>
                      ))
                    ) : (
                      <p>
                        {t(
                          "Nenhuma versão encontrada nas fontes ativas. Adicione fontes nas configurações.",
                        )}
                      </p>
                    )}
                    {downloadError && <p role="alert">{downloadError}</p>}
                  </section>
                )}
              </div>
            </section>
          </div>,
          document.querySelector(".console-mode") ?? document.body,
        )}
      {keyboardOpen && (
        <ControllerKeyboard
          value={query}
          onChange={setQuery}
          onClose={() => setKeyboardOpen(false)}
          input={keyboardInput}
        />
      )}
    </section>
  );
}
