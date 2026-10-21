import { useEffect, useMemo, useState, type RefObject } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  Download,
  LoaderCircle,
  Play,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { metadataProvider } from "../../providers/metadata/IgdbMetadataProvider";
import type { CatalogRequest } from "../../providers/metadata/types";
import type { GameMetadata, LibraryGame } from "../../types";
import { bridge } from "../../services/bridge";
import { platformById } from "../../db/platforms";
import { GameArtwork } from "../../components/GameArtwork";

export function BigPictureCatalog({
  library,
  selected,
  setSelected,
  grid,
  input,
  onCount,
  onPlay,
  onDownloads,
  notify,
}: {
  library: LibraryGame[];
  selected: number;
  setSelected: (index: number) => void;
  grid: RefObject<HTMLDivElement | null>;
  input: RefObject<((key: string) => boolean) | null>;
  onCount: (count: number) => void;
  onPlay: (entry: LibraryGame) => void;
  onDownloads: () => void;
  notify: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [platform, setPlatform] = useState("all");
  const [genre, setGenre] = useState<number>();
  const [sort, setSort] =
    useState<NonNullable<CatalogRequest["sort"]>>("popular");
  const [opened, setOpened] = useState<GameMetadata>();
  const [releasesOpen, setReleasesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const taxonomy = useQuery({
    queryKey: ["catalog-taxonomy"],
    queryFn: () => metadataProvider.getTaxonomy(),
    staleTime: 86400000,
    retry: false,
  });
  const browse = useInfiniteQuery({
    queryKey: ["catalog", debounced, platform, genre ?? null, sort],
    queryFn: ({ pageParam }) =>
      metadataProvider.browse(debounced, platform, pageParam, genre, sort),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasNext ? last.page + 1 : undefined),
    staleTime: 86400000,
    retry: false,
  });
  const games = useMemo(
    () => [
      ...new Map(
        (browse.data?.pages.flatMap((page) => page.games) ?? []).map((game) => [
          game.id,
          game,
        ]),
      ).values(),
    ],
    [browse.data],
  );
  const availability = useQuery({
    queryKey: [
      "catalog-download-availability",
      games.map((game) => game.title),
    ],
    queryFn: () =>
      bridge.availableDownloadTitles(games.map((game) => game.title)),
    enabled: games.length > 0,
    staleTime: 30000,
  });
  const downloads = new Set(availability.data ?? []);
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
    queryFn: () => bridge.searchDownloadSources(game!.title),
    enabled: Boolean(game && releasesOpen),
    retry: false,
  });
  useEffect(() => {
    onCount(games.length);
  }, [games.length, onCount]);
  useEffect(() => {
    setSelected(0);
  }, [debounced, platform, genre, sort, setSelected]);
  useEffect(() => {
    input.current = (key) => {
      if (key === "b" && opened) {
        if (releasesOpen) setReleasesOpen(false);
        else setOpened(undefined);
        return true;
      }
      if (opened) {
        const dialog = document.querySelector(".tv-catalog-dialog");
        const buttons = Array.from(
          dialog?.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ) ?? [],
        );
        if (["left", "right", "up", "down"].includes(key)) {
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const step = key === "left" || key === "up" ? -1 : 1;
          buttons[(index + step + buttons.length) % buttons.length]?.focus();
          return true;
        }
        if (key === "a") {
          (buttons.includes(document.activeElement as HTMLButtonElement)
            ? (document.activeElement as HTMLButtonElement)
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
            ".tv-catalog-toolbar input, .tv-catalog-toolbar select:not(:disabled), .tv-catalog-load:not(:disabled)",
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
        control instanceof HTMLSelectElement &&
        control.closest(".tv-catalog-toolbar")
      ) {
        if (["left", "right", "up", "down"].includes(key)) {
          const index =
            (control.selectedIndex +
              (key === "left" || key === "up" ? -1 : 1) +
              control.options.length) %
            control.options.length;
          const value = control.options[index].value;
          if (control.getAttribute("aria-label") === "Console")
            setPlatform(value);
          else if (control.getAttribute("aria-label") === "Gênero")
            setGenre(value === "all" ? undefined : Number(value));
          else setSort(value as typeof sort);
          return true;
        }
        if (key === "a" || key === "b") {
          control.blur();
          return true;
        }
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
  }, [input, games, selected, opened, releasesOpen, sort]);
  const openGame = (next: GameMetadata, index: number) => {
    setSelected(index);
    setOpened(next);
    setReleasesOpen(false);
    setDownloadError("");
  };
  return (
    <section className="tv-catalog">
      <div className="tv-catalog-toolbar">
        <label className="tv-search">
          <Search size={19} />
          <input
            aria-label="Pesquisar catálogo"
            placeholder="Pesquisar jogos"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="tv-catalog-filters">
          <select
            aria-label="Console"
            value={platform}
            onChange={(event) => setPlatform(event.target.value)}
          >
            <option value="all">Todos os consoles</option>
            {taxonomy.data?.platforms.map((item) => (
              <option key={item.id} value={item.localId}>
                {platformById(item.localId)?.name ?? item.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Gênero"
            value={genre ?? "all"}
            onChange={(event) =>
              setGenre(
                event.target.value === "all"
                  ? undefined
                  : Number(event.target.value),
              )
            }
          >
            <option value="all">Todos os gêneros</option>
            {taxonomy.data?.genres.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Ordenar catálogo"
            value={sort}
            disabled={Boolean(debounced)}
            onChange={(event) => setSort(event.target.value as typeof sort)}
          >
            <option value="popular">
              {debounced ? "Relevância" : "Popularidade"}
            </option>
            <option value="rating">Melhor avaliação</option>
            <option value="title">Nome</option>
            <option value="newest">Mais recentes</option>
            <option value="oldest">Mais antigos</option>
          </select>
        </div>
      </div>
      {browse.isPending ? (
        <div className="tv-catalog-message" role="status">
          <LoaderCircle className="spin" size={28} />
          <p>Carregando catálogo…</p>
        </div>
      ) : browse.error && !games.length ? (
        <div className="tv-catalog-message" role="alert">
          <h2>Não foi possível carregar o catálogo</h2>
          <p>{String(browse.error)}</p>
          <button onClick={() => void browse.refetch()}>
            <RefreshCw size={17} /> Tentar novamente
          </button>
        </div>
      ) : (
        <>
          <div className="tv-catalog-context">
            <span>
              {debounced
                ? `Resultados para “${debounced}”`
                : `Ordenado por: ${{ popular: "Popularidade", rating: "Melhor avaliação", title: "Nome", newest: "Mais recentes", oldest: "Mais antigos" }[sort]}`}
            </span>
            <small>{games.length} jogos carregados</small>
          </div>
          <div className="tv-catalog-grid" ref={grid}>
            {games.map((item, index) => (
              <button
                key={item.id}
                className={index === selected ? "focused" : ""}
                aria-label={`Ver ${item.title}`}
                onFocus={() => setSelected(index)}
                onClick={() => openGame(item, index)}
              >
                <GameArtwork game={item} />
                <strong>{item.title}</strong>
                <span>{item.genre || platformById(item.platformId)?.name}</span>
                <div className="tv-catalog-badges">
                  <small>
                    {platformById(item.platformId)?.shortName ??
                      item.platformId}
                  </small>
                  {downloads.has(item.title) && (
                    <small className="available">
                      <Download size={12} /> Download disponível
                    </small>
                  )}
                  {library.some(
                    (entry) =>
                      entry.game.id === item.id &&
                      entry.game.platformId === item.platformId,
                  ) && <small>Na biblioteca</small>}
                </div>
              </button>
            ))}
          </div>
          {!games.length && (
            <div className="tv-catalog-message">
              <Search size={28} />
              <h2>Nenhum jogo encontrado</h2>
              <p>Tente outro nome, console ou gênero.</p>
              <button
                onClick={() => {
                  setQuery("");
                  setPlatform("all");
                  setGenre(undefined);
                }}
              >
                Limpar filtros
              </button>
            </div>
          )}
          {browse.hasNextPage && (
            <button
              className="tv-catalog-load"
              disabled={browse.isFetchingNextPage}
              onClick={() => void browse.fetchNextPage()}
            >
              {browse.isFetchingNextPage
                ? "Carregando…"
                : "Carregar mais jogos"}
            </button>
          )}
          {browse.error && games.length > 0 && (
            <p role="alert">{String(browse.error)}</p>
          )}
          <p className="tv-catalog-credit">Dados e imagens da IGDB</p>
        </>
      )}
      {game && (
        <div
          className="tv-dialog-backdrop"
          onClick={() => {
            if (!busy) setOpened(undefined);
          }}
        >
          <section
            className="tv-catalog-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={game.title}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="tv-dialog-close"
              aria-label="Fechar detalhes"
              disabled={busy}
              onClick={() => setOpened(undefined)}
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
                {game.year || "Ano não informado"}
              </p>
              <p>{game.description}</p>
              <div className="tv-catalog-detail-actions">
                {entry && (
                  <button
                    className="tv-catalog-primary"
                    onClick={() => onPlay(entry)}
                  >
                    <Play size={18} fill="currentColor" /> Jogar
                  </button>
                )}
                <button
                  className={entry ? "" : "tv-catalog-primary"}
                  onClick={() => setReleasesOpen((value) => !value)}
                >
                  <Download size={18} />
                  {releasesOpen ? "Ocultar versões" : "Ver opções de download"}
                </button>
              </div>
              {releasesOpen && (
                <section className="tv-catalog-releases">
                  <h2>Opções de download</h2>
                  {releases.isPending ? (
                    <p>Buscando nas suas fontes…</p>
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
                            notify("Download iniciado.");
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
                            {match.sourceName} ·{" "}
                            {match.fileSize || "Tamanho não informado"}
                          </small>
                        </span>
                        <Download size={18} />
                      </button>
                    ))
                  ) : (
                    <p>
                      Nenhuma versão encontrada nas fontes ativas. Adicione
                      fontes nas configurações.
                    </p>
                  )}
                  {downloadError && <p role="alert">{downloadError}</p>}
                </section>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
