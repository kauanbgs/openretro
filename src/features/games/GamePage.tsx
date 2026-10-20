import { useEffect, useMemo, useState } from "react";
import { enrichGameMetadata } from "../../utils/metadata";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";
import type {
  Emulator,
  GameMetadata,
  GameResolution,
  LibraryGame,
} from "../../types";
import { GameArtwork } from "../../components/GameArtwork";
import { metadataProvider } from "../../providers/metadata/IgdbMetadataProvider";
import { Modal } from "../../components/Modal";
import { platformById } from "../../db/platforms";
import { GameResolver } from "../../services/GameResolver";
import { bridge, isDesktop } from "../../services/bridge";
export function GamePage({
  game: initialGame,
  entry,
  emulators,
  onBack,
  onImport,
  onDownload,
  onEmulators,
  refresh,
  notify,
}: {
  game: GameMetadata;
  entry?: LibraryGame;
  emulators: Emulator[];
  onBack: () => void;
  onImport: (game: GameMetadata) => void;
  onDownload: (game: GameMetadata) => void;
  onEmulators: () => void;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [tab, setTab] = useState("Overview");
  const details = useQuery({
    queryKey: ["game-detail", initialGame.externalId, initialGame.platformId],
    queryFn: () =>
      metadataProvider.getGame(
        `igdb-${initialGame.externalId}`,
        initialGame.platformId,
      ),
    enabled:
      initialGame.metadataProvider === "igdb" &&
      Boolean(initialGame.externalId),
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
  const [emulatorId, setEmulatorId] = useState(entry?.item.emulatorId ?? "");
  const [bios, setBios] = useState(entry?.item.biosPath ?? "");
  const [args, setArgs] = useState((entry?.item.runtimeArgs ?? []).join("\n"));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    new GameResolver(bridge.exists)
      .resolve(game, entry?.item, emulators)
      .then((r) => {
        if (active) setResolution(r);
      })
      .catch((e) => notify(String(e)));
    return () => {
      active = false;
    };
  }, [game, entry, emulators, notify]);
  const platform = platformById(game.platformId);
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
  async function play() {
    if (!entry) return;
    setRunning(true);
    try {
      const r = await new GameResolver(bridge.exists).resolve(
        game,
        entry.item,
        emulators,
      );
      setResolution(r);
      if (r.state !== "READY") {
        notify(r.message);
        return;
      }
      const seconds = await bridge.launch(entry.item.id);
      notify(
        `Session saved · ${Math.max(1, Math.round(seconds / 60))} min played`,
      );
    } catch (e) {
      notify(String(e));
    } finally {
      setRunning(false);
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
          </div>
        </div>
        <div className="detail-download-ribbon">
          <div className="download-ribbon-copy">
            <span>{entry ? "Available in your library" : "Ready to add"}</span>
            <strong>
              {entry
                ? "Your local copy is ready to launch"
                : "Choose a source to download this game"}
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
                  : onDownload(game)
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
                ? "Game running"
                : entry
                  ? resolution?.state === "MISSING_EMULATOR"
                    ? "Set up emulator"
                    : "Play game"
                  : "Find download"}
            </button>
            {!entry && (
              <button className="button glass" onClick={() => onImport(game)}>
                <FolderOpen size={17} /> Add local file
              </button>
            )}
            {entry && (
              <>
                <button
                  className={`button glass ${entry.item.favorite ? "favorited" : ""}`}
                  aria-label={
                    entry.item.favorite ? "Remove favorite" : "Favorite game"
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
                  <Settings2 size={18} /> Configure
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
                    : setConfig(true)
              }
            >
              {resolution.state === "MISSING_EMULATOR"
                ? "Configure emulator"
                : resolution.state === "MISSING_GAME"
                  ? "Locate file"
                  : "Configure"}
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
                      : game.metadataProvider === "igdb"
                        ? "IGDB"
                        : "Local metadata"}
                  </strong>
                </span>
              </div>
            </div>
            <nav className="tabs">
              {["Overview", "Screenshots", "Details"].map((t) => (
                <button
                  className={tab === t ? "selected" : ""}
                  key={t}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </nav>
            {tab === "Overview" ? (
              <div className="overview">
                <div>
                  <h2>About this game</h2>
                  <p>{game.description}</p>
                  {details.error && (
                    <p className="hint">
                      Additional metadata is unavailable. Showing the saved
                      catalog information.
                    </p>
                  )}
                  {game.sourceUrl && (
                    <a
                      className="metadata-source"
                      href={game.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View on IGDB <ExternalLink size={14} />
                    </a>
                  )}
                </div>
                <aside>
                  <h3>Game details</h3>
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
            ) : tab === "Screenshots" ? (
              details.isFetching ? (
                <div className="catalog-loading">
                  <LoaderCircle className="spin" size={22} />
                  <p>Loading screenshots…</p>
                </div>
              ) : game.screenshots?.length ? (
                <div className="screenshot-grid">
                  {game.screenshots.map((url, i) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer">
                      <img
                        src={url}
                        alt={`${game.title} gameplay screenshot ${i + 1}`}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    </a>
                  ))}
                </div>
              ) : (
                <div className="empty-inline">
                  <p>
                    {details.error
                      ? "Screenshots could not be loaded. Check your connection."
                      : "No gameplay screenshots are available for this game."}
                  </p>
                  <small>Artwork and metadata are provided by IGDB.</small>
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
                        <ShieldCheck size={16} /> Verify file
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
                        onClick={() => setRemove(true)}
                      >
                        <Trash2 size={16} /> Remove from library
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          <aside className="detail-aside">
            <section className="detail-aside-card">
              <h2>Game information</h2>
              <dl>
                <dt>Platform</dt>
                <dd>{platform?.name ?? game.platformId}</dd>
                <dt>Released</dt>
                <dd>{game.year || "Unknown"}</dd>
                <dt>Genre</dt>
                <dd>{game.genre || "Unknown"}</dd>
                <dt>Developer</dt>
                <dd>{game.developer || "Unknown"}</dd>
              </dl>
            </section>
            {!entry && (
              <section className="detail-aside-card source-note">
                <Download size={18} />
                <div>
                  <strong>Downloads from your sources</strong>
                  <p>
                    OpenRetro only shows magnet links from the JSON sources you
                    add.
                  </p>
                </div>
              </section>
            )}
            {game.screenshots?.length ? (
              <section className="detail-aside-card gallery-strip">
                <h2>Images</h2>
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
      </div>
      {config && entry && (
        <Modal title="Game configuration" onClose={() => setConfig(false)}>
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
                  placeholder="No BIOS selected"
                />
                <button
                  className="icon-button"
                  aria-label="Locate BIOS"
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
                  notify("Game configuration saved.");
                })
              }
            >
              Save configuration
            </button>
          </div>
        </Modal>
      )}
      {remove && entry && (
        <Modal title="Remove this game?" onClose={() => setRemove(false)}>
          <p className="muted">
            {game.title} and its play history will be removed from OpenRetro.
            The original game file stays on your computer.
          </p>
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
                  await bridge.removeGame(entry.item.id);
                  onBack();
                })
              }
            >
              Remove from library
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
