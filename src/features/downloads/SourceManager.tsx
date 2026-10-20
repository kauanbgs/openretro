import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Trash2, Upload, Link, FileJson } from "lucide-react";
import { Modal } from "../../components/Modal";
import { bridge } from "../../services/bridge";
import {
  MAX_SOURCE_BYTES,
  parseDownloadSource,
} from "../../services/downloadSources";
import type { DownloadSource } from "../../types";
export function SourceManager() {
  const client = useQueryClient();
  const sources = useQuery({
    queryKey: ["download-sources"],
    queryFn: bridge.downloadSources,
  });
  const [editing, setEditing] = useState<DownloadSource | null | undefined>();
  const [mode, setMode] = useState("url");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await client.invalidateQueries({ queryKey: ["download-sources"] });
      await client.invalidateQueries({ queryKey: ["source-matches"] });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  function edit(source: DownloadSource | null) {
    setEditing(source);
    setUrl(source?.url ?? "");
    setText("");
    setMode(source?.url ? "url" : "json");
    setError("");
  }
  return (
    <section className="source-manager">
      <div className="section-heading">
        <div>
          <h2>Download sources</h2>
          <p className="muted">
            Add a Hydra-compatible JSON file or URL containing magnet links.
          </p>
        </div>
        <button className="button secondary" onClick={() => edit(null)}>
          <Plus size={16} /> Add source
        </button>
      </div>
      {sources.error && (
        <p className="error-message" role="alert">
          {String(sources.error)}
        </p>
      )}
      {error && editing === undefined && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {!sources.isPending && !sources.data?.length && (
        <p className="notice">
          No sources added. Add your JSON to find downloadable games.
        </p>
      )}
      <div className="source-list">
        {sources.data?.map((s) => (
          <article className="source-row" key={s.id}>
            <FileJson size={23} />
            <div className="source-info">
              <strong>{s.name}</strong>
              <p>
                {s.gameCount.toLocaleString()} magnet downloads{" "}
                <span className="muted">
                  / {s.enabled ? "Enabled" : "Disabled"}
                </span>
              </p>
              <small>
                {s.url ? "Remote JSON" : "Imported JSON"} / Updated{" "}
                {new Date(s.updatedAt).toLocaleDateString()}
              </small>
            </div>
            <button
              className={`switch ${s.enabled ? "on" : ""}`}
              role="switch"
              aria-label={`Enable ${s.name}`}
              aria-checked={s.enabled}
              disabled={busy}
              onClick={() =>
                void run(() => bridge.setDownloadSource(s.id, !s.enabled))
              }
            >
              <span />
            </button>
            <button
              className="icon-button"
              title={s.url ? "Refresh source" : "Replace JSON"}
              aria-label={`Update ${s.name}`}
              disabled={busy}
              onClick={() =>
                s.url
                  ? void run(() => bridge.saveDownloadSource(null, s.url, s.id))
                  : edit(s)
              }
            >
              <RefreshCw size={17} />
            </button>
            <button
              className="icon-button"
              aria-label={`Remove ${s.name}`}
              disabled={busy}
              onClick={() => void run(() => bridge.removeDownloadSource(s.id))}
            >
              <Trash2 size={17} />
            </button>
          </article>
        ))}
      </div>
      {editing !== undefined && (
        <Modal
          title={editing ? "Update download source" : "Add download source"}
          onClose={() => {
            if (!busy) setEditing(undefined);
          }}
        >
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                if (mode === "json") parseDownloadSource(text);
                await bridge.saveDownloadSource(
                  mode === "json" ? text : null,
                  mode === "url" ? url.trim() : null,
                  editing?.id ?? null,
                );
                setEditing(undefined);
              });
            }}
          >
            <div className="tabs">
              <button
                type="button"
                className={mode === "url" ? "selected" : ""}
                onClick={() => setMode("url")}
              >
                <Link size={15} /> URL
              </button>
              <button
                type="button"
                className={mode === "json" ? "selected" : ""}
                onClick={() => setMode("json")}
              >
                <FileJson size={15} /> JSON file or text
              </button>
            </div>
            {mode === "url" ? (
              <label>
                Source URL
                <input
                  aria-label="Source URL"
                  type="url"
                  required
                  placeholder="https://example.com/source.json"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <small>
                  HTTPS. Refresh imports the latest version without losing the
                  saved source.
                </small>
              </label>
            ) : (
              <>
                <input
                  ref={file}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > MAX_SOURCE_BYTES) {
                      setError("Source exceeds the 16 MB limit.");
                      return;
                    }
                    void f
                      .text()
                      .then((t) => {
                        setText(t);
                        setError("");
                      })
                      .catch(() => setError("Could not read this JSON file."));
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => file.current?.click()}
                >
                  <Upload size={16} /> Choose JSON file
                </button>
                <label>
                  Source JSON
                  <textarea
                    aria-label="Source JSON"
                    rows={10}
                    value={text}
                    required
                    onChange={(e) => setText(e.target.value)}
                    placeholder={
                      '{\n  "name": "My source",\n  "downloads": [\n    { "title": "Game title", "uris": ["magnet:?xt=urn:btih:…"], "fileSize": "32 MB" }\n  ]\n}'
                    }
                  />
                </label>
              </>
            )}
            <p className="hint">
              Only magnet entries are imported. Sources are stored on this
              device; no account is required.
            </p>
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              {busy
                ? "Importing…"
                : editing
                  ? "Update source"
                  : "Import source"}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
