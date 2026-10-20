import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  Pause,
  Play,
  Search,
  FolderOpen,
  LoaderCircle,
} from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { Modal } from "../../components/Modal";
import { SourceManager } from "./SourceManager";
import { bridge, isDesktop } from "../../services/bridge";
import type {
  DownloadJob,
  DownloadedFile,
  GameMetadata,
  ImportCandidate,
  SourceMatch,
} from "../../types";
const active = (state: string) =>
  ["RESOLVING", "QUEUED", "DOWNLOADING", "VERIFYING"].includes(state);
const labels: Record<string, string> = {
  RESOLVING: "Finding peers and metadata",
  QUEUED: "Queued",
  DOWNLOADING: "Downloading",
  VERIFYING: "Checking torrent pieces",
  PAUSED: "Paused",
  COMPLETED: "Downloaded",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
};
const bytes = (n = 0) =>
  n >= 1073741824
    ? `${(n / 1073741824).toFixed(2)} GB`
    : `${(n / 1048576).toFixed(1)} MB`;
export function DownloadsPage({
  jobs,
  game,
  onClearGame,
  onImport,
  onDownloaded,
  notify,
}: {
  jobs: DownloadJob[];
  game?: GameMetadata;
  onClearGame: () => void;
  onImport: () => void;
  onDownloaded: (candidate: ImportCandidate, game?: GameMetadata) => void;
  notify: (s: string) => void;
}) {
  const client = useQueryClient();
  const [query, setQuery] = useState(game?.title ?? "");
  const [debounced, setDebounced] = useState(query);
  const [choice, setChoice] = useState<SourceMatch>();
  const [uri, setUri] = useState(0);
  const [downloadDirectory, setDownloadDirectory] = useState<string | null>(
    null,
  );
  const [autoExtract, setAutoExtract] = useState(true);
  const [autoAddToLibrary, setAutoAddToLibrary] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [files, setFiles] = useState<{
    job: DownloadJob;
    files: DownloadedFile[];
  }>();
  useEffect(() => {
    setQuery(game?.title ?? "");
  }, [game?.id]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);
  const sources = useQuery({
    queryKey: ["download-sources"],
    queryFn: bridge.downloadSources,
  });
  const matches = useQuery({
    queryKey: ["source-matches", debounced, sources.data],
    queryFn: () => bridge.searchDownloadSources(debounced),
    enabled: Boolean(sources.data?.some((s) => s.enabled)),
  });
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await client.invalidateQueries({ queryKey: ["download-jobs"] });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-content downloads-page">
      <PageHeader
        title="Downloads"
        description="Find games in your sources and manage torrent downloads."
      />
      <SourceManager />
      <section className="source-search">
        <div className="section-heading">
          <div>
            <h2>
              {game ? `Download options for ${game.title}` : "Find a download"}
            </h2>
            <p className="muted">
              Search the sources enabled above. Results are capped at 60.
            </p>
          </div>
          {game && (
            <button
              className="text-button"
              onClick={() => {
                onClearGame();
                setQuery("");
              }}
            >
              Clear game selection
            </button>
          )}
        </div>
        <label className="source-search-input">
          <Search size={18} />
          <input
            aria-label="Search source downloads"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles in your sources"
          />
        </label>
        {matches.error && (
          <p className="error-message" role="alert">
            {String(matches.error)}
          </p>
        )}
        {matches.isFetching ? (
          <p className="muted">Searching sources…</p>
        ) : matches.data?.length ? (
          <div className="source-results">
            {matches.data.map((m) => (
              <article className="source-result" key={`${m.sourceId}-${m.id}`}>
                <div>
                  <strong>{m.title}</strong>
                  <p>
                    {m.sourceName}{" "}
                    <span>/ {m.fileSize || "Size not provided"}</span>
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => {
                    setChoice(m);
                    setUri(0);
                    setDownloadDirectory(null);
                    setAutoExtract(true);
                    setAutoAddToLibrary(Boolean(game));
                    setError("");
                  }}
                >
                  <Download size={16} /> Download
                </button>
              </article>
            ))}
          </div>
        ) : sources.data?.some((s) => s.enabled) ? (
          <p className="notice">
            No downloads match this title. Try a shorter search or another
            source.
          </p>
        ) : null}
      </section>
      <section className="transfer-section">
        <div className="section-heading">
          <h2>Your downloads</h2>
          <span className="muted">
            {jobs.filter((j) => active(j.state)).length} active
          </span>
        </div>
        {error && !choice && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {!isDesktop && (
          <p className="notice">
            Manage and search sources here. Torrent downloads run in the
            OpenRetro desktop app.
          </p>
        )}
        {jobs.length ? (
          <div className="download-list">
            {jobs.map((j) => (
              <article className="download-job" key={j.id}>
                <Download size={24} />
                <div>
                  <h3>{j.name}</h3>
                  <p>{j.sourceName}</p>
                  <progress
                    aria-label={`${j.name} download progress`}
                    value={j.progress}
                    max={100}
                  />
                  <p>
                    {labels[j.state] ?? j.state} / {j.progress.toFixed(1)}%{" "}
                    {j.totalBytes
                      ? ` / ${bytes(j.downloadedBytes)} of ${bytes(j.totalBytes)}`
                      : ""}
                    {j.state === "DOWNLOADING"
                      ? ` / ${bytes(j.bytesPerSecond)}/s`
                      : ""}
                    {j.remainingSeconds != null && j.bytesPerSecond > 0
                      ? ` / ${Math.ceil(j.remainingSeconds / 60)} min remaining`
                      : ""}
                  </p>
                  {j.error && <p className="error-message">{j.error}</p>}
                  <small className="path-text">{j.directory}</small>
                  <div className="transfer-actions">
                    {active(j.state) ? (
                      <button
                        disabled={busy}
                        className="button secondary"
                        onClick={() =>
                          void run(() => bridge.controlDownload(j.id, "pause"))
                        }
                      >
                        <Pause size={15} /> Pause
                      </button>
                    ) : ["PAUSED", "FAILED", "CANCELLED"].includes(j.state) ? (
                      <button
                        disabled={busy}
                        className="button secondary"
                        onClick={() =>
                          void run(() => bridge.controlDownload(j.id, "resume"))
                        }
                      >
                        <Play size={15} /> Resume
                      </button>
                    ) : null}
                    {j.state === "COMPLETED" ? (
                      <button
                        disabled={busy}
                        className="button primary"
                        onClick={() =>
                          void run(async () => {
                            const downloaded = await bridge.downloadFiles(j.id);
                            if (downloaded.length === 1) {
                              onDownloaded(
                                await bridge.inspect(downloaded[0].path),
                                j.game,
                              );
                              notify("Game added to your library.");
                              return;
                            }
                            setFiles({ job: j, files: downloaded });
                          })
                        }
                      >
                        <FolderOpen size={15} /> Add to library
                      </button>
                    ) : j.state !== "CANCELLED" ? (
                      <button
                        disabled={busy}
                        className="text-button"
                        onClick={() =>
                          void run(() => bridge.controlDownload(j.id, "cancel"))
                        }
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="notice">
            No downloads yet. Add a source, choose a game above, and click
            Download.
          </p>
        )}
      </section>
      {choice && (
        <Modal
          title="Download game"
          onClose={() => {
            if (!busy) setChoice(undefined);
          }}
        >
          <div className="form-stack">
            <h3>{choice.title}</h3>
            <p className="muted">
              {choice.sourceName} / {choice.fileSize || "Size not provided"}
            </p>
            {game && (
              <p className="notice">
                Selected catalog game: {game.title} (
                {game.platformId.toUpperCase()}). Confirm that this download is
                the correct edition and console.
              </p>
            )}
            <label>
              Download link
              <select
                aria-label="Download link"
                value={uri}
                onChange={(e) => setUri(Number(e.target.value))}
              >
                {choice.uris.map((_, i) => (
                  <option value={i} key={i}>
                    Link {i + 1}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Download folder
              <div className="input-action">
                <input
                  value={downloadDirectory ?? ""}
                  readOnly
                  placeholder="Use the default download folder"
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Choose download folder"
                  onClick={() =>
                    void bridge
                      .pickDownloadDirectory()
                      .then(
                        (directory) =>
                          directory && setDownloadDirectory(directory),
                      )
                      .catch((e) => setError(String(e)))
                  }
                >
                  <FolderOpen size={17} />
                </button>
              </div>
            </label>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={autoExtract}
                onChange={(e) => setAutoExtract(e.target.checked)}
              />{" "}
              Extract ZIP files automatically when the download finishes
            </label>
            {game && (
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={autoAddToLibrary}
                  onChange={(e) => setAutoAddToLibrary(e.target.checked)}
                />{" "}
                Add the completed game directly to my library
              </label>
            )}
            <p className="hint">
              BitTorrent downloads depend on available peers. Files are checked
              against the torrent's piece hashes. Downloading shares pieces with
              other peers; sharing stops when the transfer completes. Cancelling
              keeps partial files.
            </p>
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await bridge.startDownload(
                    choice,
                    uri,
                    game,
                    downloadDirectory,
                    autoExtract,
                    autoAddToLibrary,
                  );
                  setChoice(undefined);
                  notify("Download started. Waiting for torrent metadata.");
                })
              }
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Download size={16} />
              )}{" "}
              Start download
            </button>
          </div>
        </Modal>
      )}
      {files && (
        <Modal
          title="Choose the downloaded game file"
          onClose={() => {
            setFiles(undefined);
            setError("");
          }}
        >
          <div className="form-stack">
            <p className="muted">{files.job.name}</p>
            {files.files.length ? (
              files.files.map((f) => (
                <button
                  className="button secondary downloaded-file"
                  key={f.path}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const candidate = await bridge.inspect(f.path);
                      onDownloaded(candidate, files.job.game);
                      setFiles(undefined);
                    })
                  }
                >
                  {f.filename}
                  <small>{f.platformIds.join(", ").toUpperCase()}</small>
                </button>
              ))
            ) : (
              <p className="notice">
                No playable console files were found. If this torrent contains
                an archive, extract it first, then use Add local game. PC
                installers are not launched automatically.
              </p>
            )}
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            <button
              className="button secondary"
              onClick={() => {
                setFiles(undefined);
                onImport();
              }}
            >
              Add local game
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
