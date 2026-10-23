import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Trash2, Upload, Link, FileJson } from "lucide-react";
import { Modal } from "../../components/Modal";
import { bridge, isDesktop } from "../../services/bridge";
import {
  MAX_SOURCE_BYTES,
  parseDownloadSource,
} from "../../services/downloadSources";
import type { DownloadSource } from "../../types";
import { locale, t } from "../../i18n";

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
      await client.invalidateQueries({ queryKey: ["game-download-options"] });
      await client.invalidateQueries({
        queryKey: ["catalog-download-availability"],
      });
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
          <h2>{t("Fontes de download")}</h2>
          <p className="muted">
            {t(
              "Add a Hydra-compatible JSON file or URL containing HTTPS links and magnet links.",
            )}
          </p>
        </div>
        <button className="button secondary" onClick={() => edit(null)}>
          <Plus size={16} /> {t("Add source")}
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
          {t(
            "Nenhuma fonte adicionada. Importe um JSON ou uma URL para encontrar jogos.",
          )}
        </p>
      )}
      <div className="source-list">
        {sources.data?.map((s) => (
          <article className="source-row" key={s.id}>
            <FileJson size={23} />
            <div className="source-info">
              <strong>{s.name}</strong>
              <p>
                {s.gameCount.toLocaleString(locale())} {t("downloads")}{" "}
                <span className="muted">
                  / {s.enabled ? t("Enabled") : t("Disabled")}
                </span>
              </p>
              <small>
                {s.url ? t("Remote JSON") : t("Imported JSON")} {t("/ Updated")}{" "}
                {new Date(s.updatedAt).toLocaleDateString(locale())}
              </small>
            </div>
            <button
              className={`switch ${s.enabled ? "on" : ""}`}
              role="switch"
              aria-label={t("Enable {name}", { name: s.name })}
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
              title={s.url ? t("Refresh source") : t("Replace JSON")}
              aria-label={t("Update {name}", { name: s.name })}
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
              aria-label={t("Remove {name}", { name: s.name })}
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
          title={editing ? t("Atualizar fonte") : t("Adicionar fonte")}
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
                <Link size={15} /> {t("URL")}
              </button>
              <button
                type="button"
                className={mode === "json" ? "selected" : ""}
                onClick={() => setMode("json")}
              >
                <FileJson size={15} /> {t("Arquivo ou texto JSON")}
              </button>
            </div>
            {mode === "url" ? (
              <label>
                {t("URL da fonte")}
                <input
                  aria-label={t("URL da fonte")}
                  type="url"
                  required
                  placeholder={t("https://example.com/source.json")}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <small>
                  {t(
                    "HTTPS. Refresh imports the latest version without losing the saved source.",
                  )}
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
                      setError(t("Source exceeds the 16 MB limit."));
                      return;
                    }
                    void f
                      .text()
                      .then((t) => {
                        setText(t);
                        setError("");
                      })
                      .catch(() =>
                        setError(t("Could not read this JSON file.")),
                      );
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    if (!isDesktop) return file.current?.click();
                    void run(async () => {
                      const json = await bridge.pickSourceJson();
                      if (json !== null) setText(json);
                    });
                  }}
                >
                  <Upload size={16} /> {t("Escolher arquivo JSON")}
                </button>
                <label>
                  {t("Conteúdo JSON")}
                  <textarea
                    aria-label={t("Conteúdo JSON")}
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
              {t(
                "HTTPS links and magnet entries are imported. Sources are stored on this device; no account is required.",
              )}
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
                  ? t("Update source")
                  : t("Importar fonte")}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
