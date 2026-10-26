import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CirclePlus,
  Copy,
  FileJson,
  Globe,
  Link,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
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
  const list = sources.data ?? [];
  const remote = list.filter((s) => s.url);
  const [editing, setEditing] = useState<DownloadSource | null | undefined>();
  const [removingAll, setRemovingAll] = useState(false);
  const [mode, setMode] = useState("url");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const file = useRef<HTMLInputElement>(null);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await fn();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      // Partial work (some sources synced, some removed) shows either way.
      await client.invalidateQueries({ queryKey: ["download-sources"] });
      await client.invalidateQueries({ queryKey: ["source-matches"] });
      await client.invalidateQueries({ queryKey: ["game-download-options"] });
      await client.invalidateQueries({
        queryKey: ["catalog-download-availability"],
      });
      setBusy(false);
    }
  }
  function edit(source: DownloadSource | null) {
    setEditing(source);
    setUrl(source?.url ?? "");
    setText("");
    setMode(source && !source.url ? "json" : "url");
    setError("");
  }
  async function syncAll() {
    setSyncing(true);
    const done = await run(async () => {
      for (const source of remote)
        await bridge.saveDownloadSource(null, source.url, source.id);
    });
    setSyncing(false);
    if (done) setStatus(t("Fontes sincronizadas."));
  }
  const active = list.filter((s) => s.enabled);
  const total = active.reduce((sum, s) => sum + s.gameCount, 0);
  function host(url: string) {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }
  function copy(url: string) {
    void navigator.clipboard.writeText(url).then(
      () => setStatus(t("URL copiada.")),
      () => setError(t("Não foi possível copiar a URL.")),
    );
  }
  return (
    <section className="source-manager">
      <header className="source-head">
        {list.length > 0 && (
          <dl className="source-stats">
            <div>
              <dt>{t("Fontes ativas")}</dt>
              <dd>
                {active.length}
                <small>/{list.length}</small>
              </dd>
            </div>
            <div>
              <dt>{t("Downloads disponíveis")}</dt>
              <dd>{total.toLocaleString(locale())}</dd>
            </div>
          </dl>
        )}
        <div className="source-head-actions">
          <button
            className="button outline"
            disabled={busy || !remote.length}
            onClick={() => void syncAll()}
          >
            <RefreshCw size={16} className={syncing ? "spin" : undefined} />{" "}
            {syncing ? t("Sincronizando…") : t("Sincronizar")}
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => edit(null)}
          >
            <CirclePlus size={16} /> {t("Adicionar fonte")}
          </button>
        </div>
      </header>
      {sources.error && (
        <p className="error-message" role="alert">
          {String(sources.error)}
        </p>
      )}
      {error && editing === undefined && !removingAll && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="source-status" role="status">
          {status}
        </p>
      )}
      {!sources.isPending && !list.length && (
        <div className="source-empty">
          <FileJson size={28} />
          <p>
            {t(
              "Nenhuma fonte adicionada. Adicione a URL de uma fonte para encontrar downloads dos jogos.",
            )}
          </p>
          <button className="button primary" onClick={() => edit(null)}>
            <CirclePlus size={16} /> {t("Adicionar fonte")}
          </button>
        </div>
      )}
      {list.length > 0 && (
        <ul className="source-list">
          {list.map((s) => (
            <li className={`source-row ${s.enabled ? "" : "off"}`} key={s.id}>
              <span className="source-mark" aria-hidden>
                {s.url ? <Globe size={18} /> : <FileJson size={18} />}
              </span>
              <div className="source-info">
                <div className="source-title">
                  <h3 title={s.name}>{s.name}</h3>
                  <span className="source-state">
                    {!s.enabled
                      ? t("Desativada")
                      : s.url
                        ? t("Sincronizada")
                        : t("Importada")}
                  </span>
                </div>
                <p className="source-meta">
                  <span title={s.url || undefined}>
                    {s.url
                      ? host(s.url)
                      : t("Arquivo JSON importado neste computador")}
                  </span>
                  <span>
                    {t("Atualizada em {date}", {
                      date: new Date(s.updatedAt).toLocaleDateString(locale()),
                    })}
                  </span>
                </p>
              </div>
              <div className="source-total">
                <strong>{s.gameCount.toLocaleString(locale())}</strong>
                <span>{t("downloads")}</span>
              </div>
              <div className="source-row-actions">
                {s.url ? (
                  <button
                    className="icon-button"
                    title={t("Copiar URL")}
                    aria-label={t("Copiar URL")}
                    onClick={() => copy(s.url!)}
                  >
                    <Copy size={16} />
                  </button>
                ) : (
                  <button
                    className="icon-button"
                    title={t("Substituir JSON")}
                    aria-label={t("Substituir JSON")}
                    disabled={busy}
                    onClick={() => edit(s)}
                  >
                    <Upload size={16} />
                  </button>
                )}
                <button
                  className="icon-button source-remove"
                  title={t("Remover")}
                  aria-label={t("Remove {name}", { name: s.name })}
                  disabled={busy}
                  onClick={() =>
                    void run(() => bridge.removeDownloadSource(s.id))
                  }
                >
                  <Trash2 size={16} />
                </button>
                <button
                  className={`switch ${s.enabled ? "on" : ""}`}
                  role="switch"
                  aria-label={t("Enable {name}", { name: s.name })}
                  aria-checked={s.enabled}
                  title={s.enabled ? t("Desativar fonte") : t("Ativar fonte")}
                  disabled={busy}
                  onClick={() =>
                    void run(() => bridge.setDownloadSource(s.id, !s.enabled))
                  }
                >
                  <span />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <footer className="source-foot">
        <p>
          {t(
            "O OpenRetro procura links de download em todas as fontes ativas. A URL da fonte deve ser um link direto para um arquivo .json com uma lista de links.",
          )}
        </p>
        {list.length > 0 && (
          <button
            className="text-button source-remove-all"
            disabled={busy}
            onClick={() => setRemovingAll(true)}
          >
            {t("Remover todas")}
          </button>
        )}
      </footer>
      {removingAll && (
        <Modal
          title={t("Remover todas as fontes?")}
          onClose={() => {
            if (!busy) setRemovingAll(false);
          }}
        >
          <p className="muted">
            {t(
              "Os jogos já baixados continuam na sua biblioteca. Você pode adicionar as fontes de novo depois.",
            )}
          </p>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <div className="modal-footer">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setRemovingAll(false)}
            >
              {t("Cancelar")}
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  for (const source of list)
                    await bridge.removeDownloadSource(source.id);
                }).then((done) => {
                  if (done) setRemovingAll(false);
                })
              }
            >
              {busy ? t("Removendo…") : t("Remover todas")}
            </button>
          </div>
        </Modal>
      )}
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
                  autoFocus
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
                ? t("Importando…")
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
