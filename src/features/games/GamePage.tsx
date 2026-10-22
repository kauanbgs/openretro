import { CatalogScreenshot } from "../../components/CatalogScreenshot";
import { useEffect, useMemo, useState } from "react";
import { enrichGameMetadata } from "../../utils/metadata";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Download,
  Play,
  Heart,
  Settings2,
  FolderOpen,
  ShieldCheck,
  Trash2,
  Clock3,
  CalendarDays,
  LoaderCircle,
  ExternalLink,
  Search,
  Star,
  Users,
  Clapperboard,
  ChevronLeft,
  ChevronRight,
  Camera,
} from "lucide-react";
import type {
  Emulator,
  GameMetadata,
  GameResolution,
  LibraryGame,
  NetplaySession,
  SourceMatch,
} from "../../types";
import { NETPLAY_PLATFORMS } from "../../types";
import { GameArtwork } from "../../components/GameArtwork";
import {
  catalogGameDetails,
  isCatalogGame,
} from "../../providers/metadata/LaunchboxMetadataProvider";
import { Modal } from "../../components/Modal";
import { platformById } from "../../db/platforms";
import { GameResolver, MANAGED_RUNTIME_ID } from "../../services/GameResolver";
import { bridge, isDesktop } from "../../services/bridge";
import { InGameMenuHelp } from "../../components/InGameMenuHelp";
import { GameCard } from "../../components/GameCard";
import { SaveTimeline, saveStatesKey } from "./SaveTimeline";
import { NetplayDialog } from "./NetplayDialog";
import { formatRelative } from "../../utils/format";

const tabLabels: Record<string, string> = {
  Overview: "Visão geral",
  Saves: "Saves",
  Screenshots: "Imagens",
  Details: "Detalhes",
};
const multiplayer = /co-?op|multiplayer|split/i;
export function GamePage({
  game: initialGame,
  entry,
  emulators,
  onBack,
  onImport,
  onEmulators,
  onSelect,
  refresh,
  notify,
}: {
  game: GameMetadata;
  entry?: LibraryGame;
  emulators: Emulator[];
  onBack: () => void;
  onSelect: (game: GameMetadata) => void;
  onImport: (game: GameMetadata) => void;
  onEmulators: () => void;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("Overview");
  const details = useQuery({
    queryKey: [
      "game-detail",
      initialGame.metadataProvider,
      initialGame.id,
      initialGame.platformId,
    ],
    queryFn: () => catalogGameDetails(initialGame),
    enabled: isCatalogGame(initialGame),
    retry: false,
    staleTime: 86400000,
  });
  const game = useMemo(
    () => enrichGameMetadata(initialGame, details.data),
    [initialGame, details.data],
  );
  const [resolution, setResolution] = useState<GameResolution>();
  const [running, setRunning] = useState(false);
  const [config, setConfig] = useState(false);
  const [remove, setRemove] = useState(false);
  const [deleteFile, setDeleteFile] = useState(false);
  const [emulatorId, setEmulatorId] = useState(entry?.item.emulatorId ?? "");
  const [bios, setBios] = useState(entry?.item.biosPath ?? "");
  const [args, setArgs] = useState((entry?.item.runtimeArgs ?? []).join("\n"));
  const [busy, setBusy] = useState(false);
  const [downloadOptions, setDownloadOptions] = useState(false);
  const [netplay, setNetplay] = useState(false);
  const [downloadQuery, setDownloadQuery] = useState("");
  const [downloadSource, setDownloadSource] = useState("all");
  const [trailer, setTrailer] = useState<string>();
  const [lightbox, setLightbox] = useState<number>();
  const captures = useQuery({
    queryKey: ["game-captures", entry?.item.id],
    queryFn: () => bridge.gameCaptures(entry!.item.id),
    enabled: isDesktop && Boolean(entry),
  });
  // Your own captures first, then the catalog's gameplay images.
  const gallery = [
    ...(captures.data ?? []).map((c) => ({
      src: c.data,
      caption: `Sua captura · ${formatRelative(new Date(c.takenAt))}`,
      referrer: undefined,
    })),
    ...(game.screenshots ?? []).map((src, i) => ({
      src,
      caption: `${game.title} · imagem ${i + 1}`,
      referrer: "no-referrer" as const,
    })),
  ];
  const step = (delta: number) =>
    setLightbox((index) =>
      index === undefined
        ? index
        : (index + delta + gallery.length) % gallery.length,
    );
  const sourceMatches = useQuery({
    queryKey: ["game-download-options", game.id, downloadOptions],
    queryFn: () => bridge.searchDownloadSources(game.title),
    enabled: downloadOptions,
  });
  const visibleMatches = (sourceMatches.data ?? []).filter(
    (match) =>
      match.title.toLowerCase().includes(downloadQuery.trim().toLowerCase()) &&
      (downloadSource === "all" || match.sourceId === downloadSource),
  );
  // Bumped after a BIOS is added so the resolver runs again.
  const [biosVersion, setBiosVersion] = useState(0);
  useEffect(() => {
    let active = true;
    new GameResolver(bridge.exists, bridge.runtimeBiosStatus)
      .resolve(game, entry?.item, emulators)
      .then((r) => {
        if (active) setResolution(r);
      })
      .catch((e) => notify(String(e)));
    return () => {
      active = false;
    };
  }, [game, entry, emulators, notify, biosVersion]);
  const platform = platformById(game.platformId);
  const needsRuntimeBios =
    resolution?.state === "MISSING_BIOS" &&
    resolution.emulator?.id === MANAGED_RUNTIME_ID;
  async function addRuntimeBios() {
    await action(async () => {
      const images = await bridge.installRuntimeBios(game.platformId);
      if (images === null) return;
      notify(
        images === 1
          ? "BIOS adicionada. Pronto para jogar."
          : `${images} BIOS adicionadas. Pronto para jogar.`,
      );
      setBiosVersion((value) => value + 1);
    });
  }
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      notify(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function play(slot?: number, session?: NetplaySession) {
    if (!entry) return;
    setRunning(true);
    try {
      const r = await new GameResolver(
        bridge.exists,
        bridge.runtimeBiosStatus,
      ).resolve(game, entry.item, emulators);
      setResolution(r);
      if (r.state !== "READY") {
        notify(r.message);
        return;
      }
      const seconds = await bridge.launch(entry.item.id, slot, session);
      notify(
        `Session saved · ${Math.max(1, Math.round(seconds / 60))} min played`,
      );
    } catch (e) {
      notify(String(e));
    } finally {
      setRunning(false);
      void queryClient.invalidateQueries({
        queryKey: saveStatesKey(entry.item.id),
      });
      void queryClient.invalidateQueries({
        queryKey: ["game-captures", entry.item.id],
      });
      await refresh();
    }
  }
  return (
    <div className="game-page">
      <div className="detail-hero">
        <GameArtwork game={game} hero />
        <div className="detail-shade" />
        <button className="back-button" onClick={onBack}>
          <ArrowLeft size={17} /> Back
        </button>
        <div className="detail-heading">
          <div className="detail-cover">
            <GameArtwork game={game} />
          </div>
          <div className="detail-titleblock">
            <span className="detail-console">{platform?.name}</span>
            <h1>{game.title}</h1>
            <div className="game-facts">
              <span>{game.year || "Year unknown"}</span>
              <span>{game.developer}</span>
            </div>
            <div className="detail-badges">
              {game.rating !== undefined && (
                <span
                  className="detail-rating"
                  title={`${game.ratingCount ?? 0} avaliações no LaunchBox`}
                >
                  <Star size={14} fill="currentColor" /> {game.rating}
                </span>
              )}
              {game.gameModes?.map((mode) =>
                multiplayer.test(mode) ? (
                  <span className="detail-badge accent" key={mode}>
                    <Users size={14} /> {mode}
                  </span>
                ) : (
                  <span className="detail-badge" key={mode}>
                    {mode}
                  </span>
                ),
              )}
            </div>
          </div>
        </div>
        <div className="detail-download-ribbon">
          <div className="download-ribbon-copy">
            <span>
              {entry ? "Disponível na biblioteca" : "Adicionar à coleção"}
            </span>
            <strong>
              {entry
                ? "Seu jogo está pronto para iniciar"
                : "Escolha uma versão para baixar"}
            </strong>
          </div>
          <div className="hero-actions">
            <button
              className="button primary"
              disabled={running || busy}
              onClick={() =>
                entry
                  ? resolution?.state === "MISSING_EMULATOR"
                    ? onEmulators()
                    : void play()
                  : (setDownloadQuery(""),
                    setDownloadSource("all"),
                    setDownloadOptions(true))
              }
            >
              {running ? (
                <LoaderCircle className="spin" size={19} />
              ) : entry ? (
                <Play size={18} fill="currentColor" />
              ) : (
                <Download size={18} />
              )}{" "}
              {running
                ? "Jogo em execução"
                : entry
                  ? resolution?.state === "MISSING_EMULATOR"
                    ? "Configurar emulador"
                    : "Jogar"
                  : "Opções de download"}
            </button>
            {entry &&
              resolution?.state === "READY" &&
              resolution.emulator?.id === MANAGED_RUNTIME_ID &&
              NETPLAY_PLATFORMS.includes(game.platformId) && (
                <button
                  className="button glass"
                  disabled={running || busy}
                  aria-label="Jogar online"
                  title="Jogar online"
                  onClick={() => setNetplay(true)}
                >
                  <Users size={18} />
                </button>
              )}
            {game.trailers?.length ? (
              <button
                className="button glass"
                aria-label="Assistir trailer"
                title="Assistir trailer"
                onClick={() => setTrailer(game.trailers![0].id)}
              >
                <Clapperboard size={18} />
              </button>
            ) : null}
            {!entry && (
              <button className="button glass" onClick={() => onImport(game)}>
                <FolderOpen size={17} /> Adicionar arquivo local
              </button>
            )}
            {entry && (
              <>
                <button
                  className={`button glass ${entry.item.favorite ? "favorited" : ""}`}
                  aria-label={
                    entry.item.favorite
                      ? "Remover dos favoritos"
                      : "Favoritar jogo"
                  }
                  onClick={() =>
                    void action(() =>
                      bridge.favorite(entry.item.id, !entry.item.favorite),
                    )
                  }
                >
                  <Heart
                    size={19}
                    fill={entry.item.favorite ? "currentColor" : "none"}
                  />
                </button>
                <button
                  className="button glass"
                  onClick={() => setConfig(true)}
                >
                  <Settings2 size={18} /> Configurar
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="detail-body">
        {entry && resolution && resolution.state !== "READY" && (
          <div className="resolver-notice">
            <div>
              <strong>
                {resolution.state === "MISSING_EMULATOR"
                  ? "Emulator required"
                  : resolution.state === "MISSING_GAME"
                    ? "Game file not found"
                    : needsRuntimeBios
                      ? "BIOS necessária"
                      : "Configuration required"}
              </strong>
              <p>
                {!isDesktop
                  ? "Launch games in the desktop app. The browser preview cannot access installed emulators or original file paths."
                  : resolution.message}
              </p>
            </div>
            <button
              className="button secondary"
              onClick={() =>
                resolution.state === "MISSING_EMULATOR"
                  ? onEmulators()
                  : resolution.state === "MISSING_GAME"
                    ? void action(async () => {
                        const c = await bridge.pickGame();
                        if (c) await bridge.relocate(entry.item.id, c);
                      })
                    : needsRuntimeBios
                      ? void addRuntimeBios()
                      : setConfig(true)
              }
            >
              {resolution.state === "MISSING_EMULATOR"
                ? "Configurar emulador"
                : resolution.state === "MISSING_GAME"
                  ? "Locate file"
                  : needsRuntimeBios
                    ? "Selecionar BIOS"
                    : "Configurar"}
            </button>
          </div>
        )}
        <div className="detail-layout">
          <div className="detail-main">
            <div className="detail-stats">
              <div>
                <Clock3 size={19} />
                <span>
                  Playtime
                  <strong>
                    {entry
                      ? `${Math.floor(entry.item.playtime / 3600)}h ${Math.floor((entry.item.playtime % 3600) / 60)}m`
                      : "Not played yet"}
                  </strong>
                </span>
              </div>
              <div>
                <CalendarDays size={19} />
                <span>
                  Last played
                  <strong>
                    {entry?.item.lastPlayedAt
                      ? new Date(entry.item.lastPlayedAt).toLocaleDateString()
                      : "Never"}
                  </strong>
                </span>
              </div>
              <div>
                <ShieldCheck size={19} />
                <span>
                  Source
                  <strong>
                    {entry
                      ? "Your local file"
                      : game.metadataProvider === "launchbox"
                        ? "LaunchBox"
                        : "Local metadata"}
                  </strong>
                </span>
              </div>
            </div>
            {entry && (
              <InGameMenuHelp
                entry={entry}
                emulators={emulators}
                notify={notify}
              />
            )}
            <nav className="tabs">
              {[
                "Overview",
                ...(entry ? ["Saves"] : []),
                "Screenshots",
                "Details",
              ].map((t) => (
                <button
                  className={tab === t ? "selected" : ""}
                  key={t}
                  onClick={() => setTab(t)}
                >
                  {tabLabels[t]}
                </button>
              ))}
            </nav>
            {tab === "Overview" ? (
              <div className="overview">
                <div>
                  <h2>Sobre o jogo</h2>
                  <p>{game.description}</p>
                  {game.storyline && (
                    <details className="detail-storyline">
                      <summary>História</summary>
                      <p>{game.storyline}</p>
                    </details>
                  )}
                  {details.error && (
                    <p className="hint">
                      Additional metadata is unavailable. Showing the saved
                      catalog information.
                    </p>
                  )}
                  {game.metadataProvider === "launchbox" && game.sourceUrl && (
                    <a
                      className="metadata-source"
                      href={game.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Ver no LaunchBox <ExternalLink size={14} />
                    </a>
                  )}
                </div>
                <aside>
                  <h3>Detalhes do jogo</h3>
                  <dl>
                    <dt>Platform</dt>
                    <dd>{platform?.name}</dd>
                    <dt>Release year</dt>
                    <dd>{game.year}</dd>
                    <dt>Genre</dt>
                    <dd>{game.genre}</dd>
                    <dt>Developer</dt>
                    <dd>{game.developer}</dd>
                  </dl>
                </aside>
              </div>
            ) : tab === "Saves" && entry ? (
              <SaveTimeline
                entry={entry}
                running={running || busy}
                onPlay={(slot) => void play(slot)}
                notify={notify}
              />
            ) : tab === "Screenshots" ? (
              details.isFetching || captures.isLoading ? (
                <div className="catalog-loading">
                  <LoaderCircle className="spin" size={22} />
                  <p>Loading screenshots…</p>
                </div>
              ) : gallery.length ? (
                <>
                  {entry && (
                    <div className="captures-heading">
                      <span>
                        <Camera size={16} />{" "}
                        {captures.data?.length
                          ? `${captures.data.length} capturas suas`
                          : "Capture momentos no menu do jogo (F8)"}
                      </span>
                      {isDesktop && (
                        <button
                          className="text-button"
                          onClick={() =>
                            void bridge
                              .openGameScreenshots(entry.item.id)
                              .catch((e) => notify(String(e)))
                          }
                        >
                          Abrir pasta
                        </button>
                      )}
                    </div>
                  )}
                  <div className="screenshot-grid">
                    {gallery.map((image, i) => (
                      <button
                        key={image.src}
                        className={
                          i < (captures.data?.length ?? 0) ? "own-capture" : ""
                        }
                        onClick={() => setLightbox(i)}
                        aria-label={`Ampliar ${image.caption}`}
                      >
                        <CatalogScreenshot
                          src={image.src}
                          alt=""
                          referrerPolicy={image.referrer}
                        />
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="empty-inline">
                  <p>
                    {details.error
                      ? "Screenshots could not be loaded. Check your connection."
                      : "No gameplay screenshots are available for this game."}
                  </p>
                  <small>
                    Imagens e metadados fornecidos pelo LaunchBox Games
                    Database.
                  </small>
                </div>
              )
            ) : (
              <div className="form-stack details-info">
                <p>
                  <strong>File</strong>
                  <br />
                  {entry?.item.sourcePath ?? "No local file associated"}
                </p>
                {entry && (
                  <>
                    <p>
                      <strong>SHA-256</strong>
                      <code className="hash">{entry.item.sha256}</code>
                    </p>
                    <div className="hero-actions">
                      <button
                        disabled={busy}
                        className="button secondary"
                        onClick={() =>
                          void action(async () => {
                            const valid = await bridge.verify(entry.item.id);
                            notify(
                              valid
                                ? "Checksum matches. Your game file is unchanged."
                                : "The checksum changed. Locate the file again if you replaced it intentionally.",
                            );
                          })
                        }
                      >
                        <ShieldCheck size={16} /> Verificar arquivo
                      </button>
                      <button
                        disabled={busy}
                        className="button secondary"
                        onClick={() =>
                          void action(async () => {
                            const c = await bridge.pickGame();
                            if (c) await bridge.relocate(entry.item.id, c);
                          })
                        }
                      >
                        <FolderOpen size={16} /> Locate file
                      </button>
                      <button
                        className="button danger"
                        onClick={() => {
                          setDeleteFile(false);
                          setRemove(true);
                        }}
                      >
                        <Trash2 size={16} /> Remover da biblioteca
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          <aside className="detail-aside">
            <section className="detail-aside-card">
              <h2>Informações do jogo</h2>
              <dl>
                <dt>Platform</dt>
                <dd>{platform?.name ?? game.platformId}</dd>
                <dt>Released</dt>
                <dd>{game.year || "Unknown"}</dd>
                <dt>Genre</dt>
                <dd>{game.genre || "Unknown"}</dd>
                <dt>Developer</dt>
                <dd>{game.developer || "Unknown"}</dd>
                {game.publisher && (
                  <>
                    <dt>Publicadora</dt>
                    <dd>{game.publisher}</dd>
                  </>
                )}
                {game.franchise && (
                  <>
                    <dt>Franquia</dt>
                    <dd>{game.franchise}</dd>
                  </>
                )}
                {game.perspectives?.length ? (
                  <>
                    <dt>Perspectiva</dt>
                    <dd>{game.perspectives.join(", ")}</dd>
                  </>
                ) : null}
                {game.themes?.length ? (
                  <>
                    <dt>Temas</dt>
                    <dd>{game.themes.join(", ")}</dd>
                  </>
                ) : null}
              </dl>
            </section>
            {game.trailers?.length ? (
              <section className="detail-aside-card trailer-list">
                <h2>Vídeos</h2>
                {game.trailers.map((video) => (
                  <button key={video.id} onClick={() => setTrailer(video.id)}>
                    <img
                      src={`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                    <span>
                      <Play size={14} fill="currentColor" /> {video.name}
                    </span>
                  </button>
                ))}
              </section>
            ) : null}
            {!entry && (
              <section className="detail-aside-card source-note">
                <Download size={18} />
                <div>
                  <strong>Downloads nas suas fontes</strong>
                  <p>
                    OpenRetro shows HTTPS links and magnet links from the JSON
                    sources you add.
                  </p>
                </div>
              </section>
            )}
            {game.screenshots?.length ? (
              <section className="detail-aside-card gallery-strip">
                <h2>Imagens</h2>
                {game.screenshots.slice(0, 3).map((url, i) => (
                  <button
                    key={url}
                    onClick={() => setTab("Screenshots")}
                    aria-label={`View screenshot ${i + 1}`}
                  >
                    <img
                      src={url}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  </button>
                ))}
              </section>
            ) : null}
          </aside>
        </div>
        {game.similar?.length ? (
          <section className="similar-games">
            <h2>Se você gosta deste jogo</h2>
            <div className="similar-row">
              {game.similar.map((similar) => (
                <GameCard
                  key={similar.id}
                  game={similar}
                  onClick={() => onSelect(similar)}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>
      {trailer && (
        <Modal title="Trailer" wide onClose={() => setTrailer(undefined)}>
          <div className="trailer-frame">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${trailer}?autoplay=1&rel=0`}
              title={`Trailer de ${game.title}`}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
          <a
            className="metadata-source"
            href={`https://www.youtube.com/watch?v=${trailer}`}
            target="_blank"
            rel="noreferrer"
          >
            Não carregou? Abrir no YouTube <ExternalLink size={14} />
          </a>
        </Modal>
      )}
      {lightbox !== undefined && gallery[lightbox] && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={gallery[lightbox].caption}
          tabIndex={-1}
          ref={(node) => node?.focus()}
          onClick={() => setLightbox(undefined)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setLightbox(undefined);
            if (event.key === "ArrowLeft") step(-1);
            if (event.key === "ArrowRight") step(1);
          }}
        >
          <img
            src={gallery[lightbox].src}
            alt={gallery[lightbox].caption}
            referrerPolicy={gallery[lightbox].referrer}
            onClick={(event) => event.stopPropagation()}
          />
          <p>
            {gallery[lightbox].caption} · {lightbox + 1}/{gallery.length}
          </p>
          {gallery.length > 1 && (
            <>
              <button
                className="lightbox-nav previous"
                aria-label="Imagem anterior"
                onClick={(event) => {
                  event.stopPropagation();
                  step(-1);
                }}
              >
                <ChevronLeft size={28} />
              </button>
              <button
                className="lightbox-nav next"
                aria-label="Próxima imagem"
                onClick={(event) => {
                  event.stopPropagation();
                  step(1);
                }}
              >
                <ChevronRight size={28} />
              </button>
            </>
          )}
        </div>
      )}
      {downloadOptions && (
        <Modal
          title="Opções de download"
          onClose={() => {
            if (!busy) setDownloadOptions(false);
          }}
        >
          <div className="download-options-modal">
            <p>Escolha uma versão de {game.title}</p>
            <div className="download-option-filters">
              <div className="download-option-search">
                <Search size={17} />
                <input
                  autoFocus
                  aria-label="Filter download releases"
                  value={downloadQuery}
                  onChange={(event) => setDownloadQuery(event.target.value)}
                  placeholder="Filtrar versões"
                />
              </div>
              <select
                aria-label="Filter download source"
                value={downloadSource}
                onChange={(event) => setDownloadSource(event.target.value)}
              >
                <option value="all">Todas as fontes</option>
                {[
                  ...new Map(
                    (sourceMatches.data ?? []).map((match) => [
                      match.sourceId,
                      match,
                    ]),
                  ).values(),
                ].map((match) => (
                  <option value={match.sourceId} key={match.sourceId}>
                    {match.sourceName}
                  </option>
                ))}
              </select>
            </div>
            {sourceMatches.isFetching ? (
              <p className="muted">Buscando nas suas fontes…</p>
            ) : sourceMatches.error ? (
              <p className="error-message">{String(sourceMatches.error)}</p>
            ) : visibleMatches.length ? (
              <div className="download-option-list">
                {visibleMatches.map((match: SourceMatch) => (
                  <button
                    className="download-option"
                    disabled={busy}
                    key={`${match.sourceId}-${match.id}`}
                    onClick={() =>
                      void action(async () => {
                        await bridge.startDownload(match, 0, game);
                        void queryClient.invalidateQueries({
                          queryKey: ["download-jobs"],
                        });
                        setDownloadOptions(false);
                        notify(
                          "Download iniciado. Ele aparecerá em Downloads.",
                        );
                      })
                    }
                  >
                    <span>
                      <strong>{match.title}</strong>
                      <small>
                        {match.fileSize || "Tamanho não informado"} ·{" "}
                        {match.sourceName}
                      </small>
                    </span>
                    <Download size={18} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="download-options-empty">
                Nenhuma versão deste jogo foi encontrada nas fontes ativas.
              </p>
            )}
          </div>
        </Modal>
      )}
      {config && entry && (
        <Modal title="Configurar jogo" onClose={() => setConfig(false)}>
          <div className="form-stack">
            <label>
              Emulator
              <select
                value={emulatorId}
                onChange={(e) => setEmulatorId(e.target.value)}
              >
                <option value="">Use platform default</option>
                {emulators
                  .filter((e) => e.supportedPlatforms.includes(game.platformId))
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              BIOS path (if required)
              <div className="input-action">
                <input
                  value={bios}
                  onChange={(e) => setBios(e.target.value)}
                  placeholder="Nenhuma BIOS selecionada"
                />
                <button
                  className="icon-button"
                  aria-label="Selecionar BIOS"
                  onClick={() =>
                    void action(async () => {
                      const p = await bridge.pickBios();
                      if (p) setBios(p);
                    })
                  }
                >
                  <FolderOpen size={18} />
                </button>
              </div>
            </label>
            <label>
              Arguments · one argument per line
              <textarea
                rows={4}
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder={"--bios\n{bios}\n{game}"}
              />
            </label>
            <p className="hint">
              Use {"{game}"} and {"{bios}"} for file paths. Each line is passed
              as one argument, without shell evaluation. If omitted, the game
              path is appended. Use the flags documented by your emulator.
            </p>
            <button
              disabled={busy}
              className="button primary full"
              onClick={() =>
                void action(async () => {
                  await bridge.configureGame(
                    entry.item.id,
                    emulatorId || null,
                    bios || null,
                    args.split("\n").filter(Boolean),
                  );
                  setConfig(false);
                  notify("Configurar jogo saved.");
                })
              }
            >
              Salvar configuração
            </button>
          </div>
        </Modal>
      )}
      {netplay && entry && (
        <NetplayDialog
          title={game.title}
          notify={notify}
          onClose={() => setNetplay(false)}
          onStart={(session) => {
            setNetplay(false);
            void play(undefined, session);
          }}
        />
      )}
      {remove && entry && (
        <Modal title="Remover este jogo?" onClose={() => setRemove(false)}>
          <p className="muted">
            {game.title} and its play history will be removed from OpenRetro.
          </p>
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={deleteFile}
              onChange={(e) => setDeleteFile(e.target.checked)}
            />{" "}
            Also delete the downloaded game file from this computer
          </label>
          <div className="modal-footer">
            <button
              className="button secondary"
              onClick={() => setRemove(false)}
            >
              Keep game
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await bridge.removeGame(entry.item.id, deleteFile);
                  onBack();
                })
              }
            >
              Remover da biblioteca
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
