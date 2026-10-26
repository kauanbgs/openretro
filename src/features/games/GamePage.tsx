import { CatalogScreenshot } from "../../components/CatalogScreenshot";
import { useEffect, useMemo, useState } from "react";
import { enrichGameMetadata } from "../../utils/metadata";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  Play,
  Heart,
  FolderOpen,
  ShieldCheck,
  Trash2,
  LoaderCircle,
  ExternalLink,
  Search,
  Star,
  Users,
  Clapperboard,
  ChevronLeft,
  ChevronRight,
  Camera,
  ChevronDown,
  Clock3,
  Gamepad2,
} from "lucide-react";
import { GameMedia } from "./GameMedia";
import "./GamePage.css";
import type {
  Emulator,
  GameMetadata,
  GameResolution,
  LibraryGame,
  NetplaySession,
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
import { bridge, isDesktop, isRemote } from "../../services/bridge";
import { releasesFor } from "../../services/downloadPlatform";
import { InGameMenuHelp } from "../../components/InGameMenuHelp";
import { GameCard } from "../../components/GameCard";
import { SaveTimeline, saveStatesKey } from "./SaveTimeline";
import { NetplayDialog } from "./NetplayDialog";
import { ModsTab } from "./ModsTab";
import {
  AchievementsTab,
  achievementsProgress,
  useGameAchievements,
} from "../achievements/AchievementsTab";
import { RemoveGameDialog } from "../../components/RemoveGameDialog";
import { playedSha256 } from "../../services/mods";
import { formatRelative } from "../../utils/format";
import { locale, t } from "../../i18n";

const tabLabels: Record<string, string> = {
  Overview: t("Visão geral"),
  Saves: "Saves",
  Mods: t("Traduções e mods"),
  Achievements: t("Conquistas"),
  Screenshots: t("Imagens"),
  Details: t("Detalhes"),
};
const multiplayer = /co-?op|multiplayer|split/i;
export function GamePage({
  game: initialGame,
  entry,
  emulators,
  onBack,
  onImport,
  onSelect,
  refresh,
  notify,
  startOnline = false,
}: {
  game: GameMetadata;
  entry?: LibraryGame;
  emulators: Emulator[];
  onBack: () => void;
  onSelect: (game: GameMetadata) => void;
  onImport: (game: GameMetadata) => void;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  /** Open with the online-play dialog showing (Big Picture's "Jogar online"). */
  startOnline?: boolean;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("Overview");
  const achievementsAvailable = Boolean(entry) && isDesktop && !isRemote;
  const achievements = useGameAchievements(
    entry?.item.id,
    achievementsAvailable,
  );
  const achievementsCount = achievementsProgress(achievements.data);
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
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloadOptions, setDownloadOptions] = useState(false);
  const [netplay, setNetplay] = useState(startOnline);
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
      caption: t("Sua captura · {when}", {
        when: formatRelative(new Date(c.takenAt)),
      }),
      referrer: undefined,
    })),
    ...(game.screenshots ?? []).map((src, i) => ({
      src,
      caption: t("{title} · imagem {number}", {
        title: game.title,
        number: i + 1,
      }),
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
    queryFn: async () =>
      releasesFor(await bridge.searchDownloadSources(game.title), game),
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
          ? t("BIOS adicionada. Pronto para jogar.")
          : t("{count} BIOS adicionadas. Pronto para jogar.", {
              count: images,
            }),
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
      // On a phone the game runs on the PC; switch to its game screen.
      if (isRemote) return void window.location.assign("/play");
      notify(
        t("Session saved · {minutes} min played", {
          minutes: Math.max(1, Math.round(seconds / 60)),
        }),
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
      <div className="game-hero">
        <GameArtwork game={game} hero />
        <div className="game-hero-content">
          <h2>{game.title}</h2>
          <p>
            {[platform?.name, game.year || null, game.developer]
              .filter(Boolean)
              .join(", ")}
          </p>
          <div className="detail-badges">
            {entry?.item.activeVariant && (
              <button
                className="detail-badge accent"
                title={t("Esta versão é usada ao jogar")}
                onClick={() => setTab("Mods")}
              >
                {t("Versão:")} {entry.item.activeVariant.name}
              </button>
            )}
            {game.rating !== undefined && (
              <span
                className="detail-badge"
                title={t("{count} avaliações no LaunchBox", {
                  count: game.ratingCount ?? 0,
                })}
              >
                <Star size={13} fill="currentColor" /> {game.rating}
              </span>
            )}
            {game.gameModes?.map((mode) => (
              <span className="detail-badge" key={mode}>
                {multiplayer.test(mode) && <Users size={13} />} {mode}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="hero-panel">
        <div className="hero-panel-content">
          {entry ? (
            <>
              <p>
                {entry.item.lastPlayedAt
                  ? t("Jogou pela última vez {when}", {
                      when: formatRelative(new Date(entry.item.lastPlayedAt)),
                    })
                  : t("Você ainda não jogou")}
              </p>
              <p>
                {entry.item.playtime
                  ? t("{hours}h {minutes}min de jogo", {
                      hours: Math.floor(entry.item.playtime / 3600),
                      minutes: Math.floor((entry.item.playtime % 3600) / 60),
                    })
                  : t("Na sua biblioteca")}
              </p>
            </>
          ) : (
            <p>
              {isRemote
                ? t(
                    "Escolha uma versão nas suas fontes para baixar no computador.",
                  )
                : t("Adicione este jogo à sua biblioteca para começar.")}
            </p>
          )}
        </div>
        <div className="hero-panel-actions">
          <button
            className={`button primary ${entry ? "play-button" : ""}`}
            disabled={running || busy}
            onClick={() =>
              entry
                ? void play()
                : (setDownloadQuery(""),
                  setDownloadSource("all"),
                  setDownloadOptions(true))
            }
          >
            {running ? (
              <LoaderCircle className="spin" size={16} />
            ) : entry ? (
              <Play size={16} fill="currentColor" />
            ) : (
              <Download size={16} />
            )}
            {running
              ? t("Jogo em execução")
              : entry
                ? t("Jogar")
                : t("Opções de download")}
          </button>
          {!entry && !isRemote && (
            <button className="button outline" onClick={() => onImport(game)}>
              <FolderOpen size={16} /> {t("Adicionar à biblioteca")}
            </button>
          )}
          {entry &&
            resolution?.state === "READY" &&
            resolution.emulator?.id === MANAGED_RUNTIME_ID &&
            NETPLAY_PLATFORMS.includes(game.platformId) && (
              <button
                className="button outline"
                disabled={running || busy}
                onClick={() => setNetplay(true)}
              >
                <Users size={16} /> {t("Jogar online")}
              </button>
            )}
          {entry && !isRemote && (
            <button
              className="button outline"
              aria-label={t("Remover jogo")}
              title={t("Remover jogo")}
              disabled={running || busy}
              onClick={() => setRemove(true)}
            >
              <Trash2 size={16} />
            </button>
          )}
          {game.trailers?.length ? (
            <button
              className="button outline"
              aria-label={t("Assistir trailer")}
              title={t("Assistir trailer")}
              onClick={() => setTrailer(game.trailers![0].id)}
            >
              <Clapperboard size={16} />
            </button>
          ) : null}
          {entry && (
            <>
              <button
                className={`button outline ${entry.item.favorite ? "favorited" : ""}`}
                aria-label={
                  entry.item.favorite
                    ? t("Remover dos favoritos")
                    : t("Favoritar jogo")
                }
                title={
                  entry.item.favorite
                    ? t("Remover dos favoritos")
                    : t("Favoritar jogo")
                }
                onClick={() =>
                  void action(() =>
                    bridge.favorite(entry.item.id, !entry.item.favorite),
                  )
                }
              >
                <Heart
                  size={16}
                  fill={entry.item.favorite ? "currentColor" : "none"}
                />
              </button>
            </>
          )}
        </div>
      </div>
      <div className="detail-body">
        {entry && resolution && resolution.state !== "READY" && (
          <div className="resolver-notice">
            <div>
              <strong>
                {resolution.state === "MISSING_EMULATOR"
                  ? t("Console ainda não suportado")
                  : resolution.state === "MISSING_GAME"
                    ? t("Game file not found")
                    : needsRuntimeBios
                      ? t("BIOS necessária")
                      : t("Configuration required")}
              </strong>
              <p>
                {!isDesktop
                  ? t(
                      "Launch games in the desktop app. The browser preview cannot access installed emulators or original file paths.",
                    )
                  : resolution.message}
              </p>
            </div>
            {(resolution.state === "MISSING_GAME" || needsRuntimeBios) && (
              <button
                className="button secondary"
                onClick={() =>
                  resolution.state === "MISSING_GAME"
                    ? void action(async () => {
                        const c = await bridge.pickGame();
                        if (c) await bridge.relocate(entry.item.id, c);
                      })
                    : void addRuntimeBios()
                }
              >
                {resolution.state === "MISSING_GAME"
                  ? t("Locate file")
                  : t("Selecionar BIOS")}
              </button>
            )}
          </div>
        )}
        <div className="detail-layout">
          <div className="detail-main">
            <div className="game-release">
              <span>
                {game.year
                  ? t("Lançado em {year}", { year: game.year })
                  : t("Lançamento não informado")}
              </span>
              {(game.publisher || game.developer) && (
                <span>
                  {game.publisher
                    ? t("Publicado por {publisher}", {
                        publisher: game.publisher,
                      })
                    : game.developer}
                </span>
              )}
            </div>
            {tab === "Overview" && (
              <GameMedia
                game={game}
                images={gallery}
                onImage={setLightbox}
                onTrailer={setTrailer}
              />
            )}
            {entry && !isRemote && (
              <InGameMenuHelp
                entry={entry}
                emulators={emulators}
                notify={notify}
              />
            )}
            <nav className="tabs" aria-label={t("Seções do jogo")}>
              {[
                "Overview",
                ...(entry ? ["Saves"] : []),
                ...(isRemote ? [] : ["Mods"]),
                ...(achievementsAvailable ? ["Achievements"] : []),
                "Screenshots",
                "Details",
              ].map((t) => (
                <button
                  className={tab === t ? "selected" : ""}
                  aria-pressed={tab === t}
                  key={t}
                  onClick={() => setTab(t)}
                >
                  {tabLabels[t]}
                  {t === "Achievements" && achievementsCount && (
                    <small className="tab-count">{achievementsCount}</small>
                  )}
                </button>
              ))}
            </nav>
            {tab === "Overview" ? (
              <div className="overview">
                <div>
                  <h2>{t("Sobre o jogo")}</h2>
                  <p>{game.description}</p>
                  {game.storyline && (
                    <details className="detail-storyline">
                      <summary>{t("História")}</summary>
                      <p>{game.storyline}</p>
                    </details>
                  )}
                  {details.error && (
                    <p className="hint">
                      {t(
                        "Additional metadata is unavailable. Showing the saved catalog information.",
                      )}
                    </p>
                  )}
                  {game.metadataProvider === "launchbox" && game.sourceUrl && (
                    <a
                      className="metadata-source"
                      href={game.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("Ver no LaunchBox")} <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              </div>
            ) : tab === "Saves" && entry ? (
              <SaveTimeline
                entry={entry}
                running={running || busy}
                onPlay={(slot) => void play(slot)}
                notify={notify}
              />
            ) : tab === "Mods" ? (
              <ModsTab
                game={game}
                entry={entry}
                running={running || busy}
                notify={notify}
                refresh={refresh}
              />
            ) : tab === "Achievements" && entry ? (
              <AchievementsTab id={entry.item.id} />
            ) : tab === "Screenshots" ? (
              details.isFetching || captures.isLoading ? (
                <div className="catalog-loading">
                  <LoaderCircle className="spin" size={22} />
                  <p>{t("Loading screenshots…")}</p>
                </div>
              ) : gallery.length ? (
                <>
                  {entry && (
                    <div className="captures-heading">
                      <span>
                        <Camera size={16} />{" "}
                        {captures.data?.length
                          ? t("{count} capturas suas", {
                              count: captures.data.length,
                            })
                          : t("Capture momentos no menu do jogo (F8)")}
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
                          {t("Abrir pasta")}
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
                        aria-label={t("Ampliar {caption}", {
                          caption: image.caption,
                        })}
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
                      ? t(
                          "Screenshots could not be loaded. Check your connection.",
                        )
                      : t(
                          "No gameplay screenshots are available for this game.",
                        )}
                  </p>
                  <small>
                    {t(
                      "Imagens e metadados fornecidos pelo LaunchBox Games Database.",
                    )}
                  </small>
                </div>
              )
            ) : (
              <div className="form-stack details-info">
                <p>
                  <strong>{t("File")}</strong>
                  <br />
                  {entry?.item.sourcePath ?? t("No local file associated")}
                </p>
                {entry && !isRemote && (
                  <>
                    <p>
                      <strong>{t("SHA-256")}</strong>
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
                                ? t(
                                    "Checksum matches. Your game file is unchanged.",
                                  )
                                : t(
                                    "The checksum changed. Locate the file again if you replaced it intentionally.",
                                  ),
                            );
                          })
                        }
                      >
                        <ShieldCheck size={16} /> {t("Verificar arquivo")}
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
                        <FolderOpen size={16} /> {t("Locate file")}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          <aside className="detail-aside">
            <details className="game-statistics" open>
              <summary>
                <ChevronDown size={16} /> {t("Estatísticas")}
              </summary>
              <dl>
                {game.rating !== undefined && (
                  <div>
                    <dt>
                      <Star size={16} /> {t("Avaliação")}
                    </dt>
                    <dd>
                      <Star size={13} fill="currentColor" /> {game.rating}
                    </dd>
                  </div>
                )}
                {game.ratingCount !== undefined && (
                  <div>
                    <dt>
                      <Users size={16} /> {t("Avaliações no catálogo")}
                    </dt>
                    <dd>{game.ratingCount.toLocaleString(locale())}</dd>
                  </div>
                )}
                <div>
                  <dt>
                    <Gamepad2 size={16} /> {t("Jogadores")}
                  </dt>
                  <dd>{game.maxPlayers ?? t("Não informado")}</dd>
                </div>
                {entry && (
                  <div>
                    <dt>
                      <Clock3 size={16} /> {t("Tempo de jogo")}
                    </dt>
                    <dd>
                      {t("{hours}h {minutes}min de jogo", {
                        hours: Math.floor(entry.item.playtime / 3600),
                        minutes: Math.floor((entry.item.playtime % 3600) / 60),
                      })}
                    </dd>
                  </div>
                )}
              </dl>
            </details>
            <section className="detail-aside-card">
              <h2>{t("Informações do jogo")}</h2>
              <dl>
                <dt>{t("Plataforma")}</dt>
                <dd>{platform?.name ?? game.platformId}</dd>
                <dt>{t("Lançamento")}</dt>
                <dd>{game.year || t("Desconhecido")}</dd>
                <dt>{t("Gênero")}</dt>
                <dd>{game.genre || t("Desconhecido")}</dd>
                <dt>{t("Desenvolvedora")}</dt>
                <dd>{game.developer || t("Desconhecida")}</dd>
                {game.publisher && (
                  <>
                    <dt>{t("Publicadora")}</dt>
                    <dd>{game.publisher}</dd>
                  </>
                )}
                {game.franchise && (
                  <>
                    <dt>{t("Franquia")}</dt>
                    <dd>{game.franchise}</dd>
                  </>
                )}
                {game.perspectives?.length ? (
                  <>
                    <dt>{t("Perspectiva")}</dt>
                    <dd>{game.perspectives.join(", ")}</dd>
                  </>
                ) : null}
                {game.themes?.length ? (
                  <>
                    <dt>{t("Temas")}</dt>
                    <dd>{game.themes.join(", ")}</dd>
                  </>
                ) : null}
              </dl>
            </section>
            {!entry && (
              <section className="detail-aside-card source-note">
                <Download size={18} />
                <div>
                  <strong>{t("Downloads nas suas fontes")}</strong>
                  <p>
                    {t(
                      "OpenRetro shows HTTPS links and magnet links from the JSON sources you add.",
                    )}
                  </p>
                </div>
              </section>
            )}
          </aside>
        </div>
        {game.similar?.length ? (
          <section className="similar-games">
            <h2>{t("Se você gosta deste jogo")}</h2>
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
        <Modal title={t("Trailer")} wide onClose={() => setTrailer(undefined)}>
          <div className="trailer-frame">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${trailer}?autoplay=1&rel=0`}
              title={t("Trailer de {title}", { title: game.title })}
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
            {t("Não carregou? Abrir no YouTube")} <ExternalLink size={14} />
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
                aria-label={t("Imagem anterior")}
                onClick={(event) => {
                  event.stopPropagation();
                  step(-1);
                }}
              >
                <ChevronLeft size={28} />
              </button>
              <button
                className="lightbox-nav next"
                aria-label={t("Próxima imagem")}
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
          title={t("Opções de download")}
          onClose={() => {
            if (!busy) setDownloadOptions(false);
          }}
        >
          <div className="download-options-modal">
            <p>
              {t("Escolha uma versão de")} {game.title}
            </p>
            <div className="download-option-filters">
              <div className="download-option-search">
                <Search size={17} />
                <input
                  autoFocus
                  aria-label={t("Filter download releases")}
                  value={downloadQuery}
                  onChange={(event) => setDownloadQuery(event.target.value)}
                  placeholder={t("Filtrar versões")}
                />
              </div>
              <select
                aria-label={t("Filter download source")}
                value={downloadSource}
                onChange={(event) => setDownloadSource(event.target.value)}
              >
                <option value="all">{t("Todas as fontes")}</option>
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
              <p className="muted">{t("Buscando nas suas fontes…")}</p>
            ) : sourceMatches.error ? (
              <p className="error-message">{String(sourceMatches.error)}</p>
            ) : visibleMatches.length ? (
              <div className="download-option-list">
                {visibleMatches.map((match) => (
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
                          t("Download iniciado. Ele aparecerá em Downloads."),
                        );
                      })
                    }
                  >
                    <span>
                      <strong>{match.title}</strong>
                      <small>
                        {match.confirmed
                          ? platform?.shortName
                          : t("Console não informado")}{" "}
                        · {match.fileSize || t("Tamanho não informado")} ·{" "}
                        {match.sourceName}
                      </small>
                    </span>
                    <Download size={18} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="download-options-empty">
                {t(
                  "Nenhuma versão deste jogo foi encontrada nas fontes ativas.",
                )}
              </p>
            )}
          </div>
        </Modal>
      )}
      {netplay && entry && (
        <NetplayDialog
          title={game.title}
          platformId={entry.item.platformId}
          sha256={playedSha256(entry.item)}
          variant={entry.item.activeVariant?.name}
          notify={notify}
          onClose={() => setNetplay(false)}
          onStart={(session) => {
            setNetplay(false);
            void play(undefined, session);
          }}
        />
      )}
      {remove && entry && (
        <RemoveGameDialog
          entry={entry}
          onClose={() => setRemove(false)}
          onRemoved={() => {
            notify(t("{title} foi removido.", { title: game.title }));
            onBack();
          }}
        />
      )}
    </div>
  );
}
