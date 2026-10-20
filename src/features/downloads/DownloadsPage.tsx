import { Download, FolderOpen, ShieldCheck } from "lucide-react";
import type { DownloadJob } from "../../types";
export function DownloadsPage({
  onImport,
  jobs = [],
}: {
  onImport: () => void;
  jobs?: DownloadJob[];
}) {
  return (
    <div className="page-content">
      <div className="page-title">
        <div>
          <span className="eyebrow">ON THE WAY TO YOUR COLLECTION</span>
          <h1>
            Downloads<span className="accent">.</span>
          </h1>
          <p>A home for your games and components in transit.</p>
        </div>
        <span className="badge">
          <ShieldCheck size={14} /> Authorized sources only
        </span>
      </div>
      {jobs.length ? (
        <div className="download-list">
          {jobs.map((j) => (
            <article className="download-job" key={j.id}>
              <Download size={24} />
              <div>
                <h3>{j.name}</h3>
                <progress value={j.progress} max={100} />
                <p>
                  {j.state} · {j.progress}% ·{" "}
                  {(j.bytesPerSecond / 1048576).toFixed(1)} MB/s
                  {j.remainingSeconds !== null
                    ? ` · ${j.remainingSeconds}s remaining`
                    : ""}
                </p>
                {j.error && <p className="error-message">{j.error}</p>}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <div className="large-icon">
            <Download size={32} />
          </div>
          <h2>All quiet in the queue.</h2>
          <p>
            Download sources aren’t connected in this milestone.
            <br />
            You can start playing with a game file from your own collection.
          </p>
          <button className="button primary" onClick={onImport}>
            <FolderOpen size={17} /> Import a local game
          </button>
          <small>
            No games or emulator executables are bundled with OpenRetro.
          </small>
        </div>
      )}
    </div>
  );
}
