import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Pause, Play, FolderOpen, Trash2 } from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { Modal } from "../../components/Modal";
import { bridge, isDesktop } from "../../services/bridge";
import { activeTransferStates } from "../../services/activity";
import { formatBytes as bytes, formatRemaining } from "../../utils/format";
import type {
  DownloadJob,
  DownloadedFile,
  GameMetadata,
  ImportCandidate,
} from "../../types";
const active = (state: string) =>
  ["RESOLVING", "QUEUED", "DOWNLOADING", "VERIFYING"].includes(state);
const labels: Record<string, string> = {
  RESOLVING: "Buscando conexões e metadados",
  QUEUED: "Na fila",
  DOWNLOADING: "Baixando",
  VERIFYING: "Verificando arquivos",
  INSTALLING: "Preparando para jogar",
  PAUSED: "Pausado",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
  FAILED: "Falhou",
};
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
  const [filter, setFilter] = useState("all");
  const summary = useMemo(
    () => ({
      active: jobs.filter((job) => activeTransferStates.has(job.state)).length,
      completed: jobs.filter((job) => job.state === "COMPLETED").length,
      speed: jobs.reduce(
        (speed, job) =>
          speed + (job.state === "DOWNLOADING" ? job.bytesPerSecond : 0),
        0,
      ),
    }),
    [jobs],
  );
  const visible = useMemo(
    () =>
      jobs.filter(
        (job) =>
          filter === "all" ||
          (filter === "active"
            ? activeTransferStates.has(job.state)
            : job.state === filter),
      ),
    [jobs, filter],
  );
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
        description="Acompanhe seus jogos, da transferência até a biblioteca."
      />
      <div className="transfer-overview">
        <div>
          <strong>{summary.active}</strong>
          <span>Em andamento</span>
        </div>
        <div>
          <strong>{bytes(summary.speed)}/s</strong>
          <span>Velocidade total</span>
        </div>
        <div>
          <strong>{summary.completed}</strong>
          <span>Concluídos</span>
        </div>
      </div>
      <div
        className="filter-tabs transfer-filters"
        aria-label="Filtrar downloads"
      >
        {[
          ["all", "Todos"],
          ["active", "Em andamento"],
          ["PAUSED", "Pausados"],
          ["COMPLETED", "Concluídos"],
          ["FAILED", "Com erro"],
        ].map(([value, label]) => (
          <button
            key={value}
            className={filter === value ? "selected" : ""}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <section className="transfer-section">
        <div className="section-heading">
          <h2>Seus downloads</h2>
          <span className="muted">
            {visible.length} {visible.length === 1 ? "item" : "itens"}
          </span>
        </div>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {!isDesktop && (
          <p className="notice">
            As transferências de arquivos estão disponíveis no aplicativo
            OpenRetro.
          </p>
        )}
        {visible.length ? (
          <div className="download-list">
            {visible.map((j) => (
              <article
                className="download-job"
                key={j.id}
                aria-busy={activeTransferStates.has(j.state)}
              >
                <Download size={24} />
                <div>
                  <h3>{j.name}</h3>
                  <p>{j.sourceName}</p>
                  <span className="transfer-state" data-state={j.state}>
                    {labels[j.state] ?? j.state}
                  </span>
                  <progress
                    aria-label={`Progresso de ${j.name}`}
                    value={j.progress}
                    max={100}
                  />
                  <p>
                    {j.progress.toFixed(1)}%{" "}
                    {j.totalBytes
                      ? ` · ${bytes(j.downloadedBytes)} de ${bytes(j.totalBytes)}`
                      : ""}
                    {j.state === "DOWNLOADING"
                      ? ` · ${bytes(j.bytesPerSecond)}/s`
                      : ""}
                    {j.remainingSeconds != null && j.bytesPerSecond > 0
                      ? ` · ${formatRemaining(j.remainingSeconds)}`
                      : ""}
                  </p>
                  {j.error && <p className="error-message">{j.error}</p>}
                  {j.directory && (
                    <details>
                      <summary>Pasta de destino</summary>
                      <small className="path-text">{j.directory}</small>
                    </details>
                  )}
                  <div className="transfer-actions">
                    {active(j.state) ? (
                      <button
                        disabled={busy}
                        className="button secondary"
                        onClick={() =>
                          void run(() => bridge.controlDownload(j.id, "pause"))
                        }
                      >
                        <Pause size={15} /> Pausar
                      </button>
                    ) : ["PAUSED", "FAILED", "CANCELLED"].includes(j.state) ? (
                      <button
                        disabled={busy}
                        className="button secondary"
                        onClick={() =>
                          void run(() => bridge.controlDownload(j.id, "resume"))
                        }
                      >
                        <Play size={15} /> Retomar
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
                              notify(
                                "Confirme os dados para adicionar o jogo.",
                              );
                              return;
                            }
                            setFiles({ job: j, files: downloaded });
                          })
                        }
                      >
                        <FolderOpen size={15} /> Adicionar à biblioteca
                      </button>
                    ) : j.state !== "CANCELLED" ? (
                      <button
                        disabled={busy}
                        className="text-button"
                        onClick={() =>
                          void run(() => bridge.controlDownload(j.id, "cancel"))
                        }
                      >
                        Cancelar
                      </button>
                    ) : null}
                    <button
                      disabled={busy}
                      className="icon-button"
                      aria-label={`Remove ${j.name} from downloads`}
                      title="Remover da lista de downloads"
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
            {jobs.length
              ? "Nenhum download nesta categoria."
              : "Nenhum download ainda. Escolha um jogo no catálogo para começar."}
          </p>
        )}
      </section>
      {files && (
        <Modal
          title="Escolher arquivo do jogo"
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
                Nenhum arquivo de console foi encontrado. Se o download está
                compactado, use a extração automática ao baixar ou importe o
                arquivo já extraído. Instaladores de PC não são executados
                automaticamente.
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
              Adicionar jogo local
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
