import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Pause, Play, FolderOpen, Trash2 } from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { Modal } from "../../components/Modal";
import { bridge, isDesktop } from "../../services/bridge";
import type {
  DownloadJob,
  DownloadedFile,
  GameMetadata,
  ImportCandidate,
} from "../../types";
const active = (state: string) =>
  ["RESOLVING", "QUEUED", "DOWNLOADING", "VERIFYING"].includes(state);
const labels: Record<string, string> = {
  RESOLVING: "Looking for peers and metadata (up to 90 seconds)",
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
  onImport,
  onDownloaded,
  notify,
}: {
  jobs: DownloadJob[];
  onImport: () => void;
  onDownloaded: (candidate: ImportCandidate, game?: GameMetadata) => void;
  notify: (s: string) => void;
}) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [files, setFiles] = useState<{
    job: DownloadJob;
    files: DownloadedFile[];
  }>();
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
        description="Track downloads, imports, and transfer progress."
      />
      <section className="transfer-section">
        <div className="section-heading">
          <h2>Your downloads</h2>
          <span className="muted">
            {jobs.filter((j) => active(j.state)).length} active
          </span>
        </div>
        {error && (
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
                    <button
                      disabled={busy}
                      className="icon-button"
                      aria-label={`Remove ${j.name} from downloads`}
                      title="Remove from downloads"
                      onClick={() =>
                        void run(() => bridge.removeDownload(j.id))
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="notice">
            No downloads are running or have finished yet.
          </p>
        )}
      </section>
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
