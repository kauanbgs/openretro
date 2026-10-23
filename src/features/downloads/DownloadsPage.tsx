import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Download,
  Pause,
  Play,
  FolderOpen,
  Trash2,
  CheckCircle2,
  LoaderCircle,
} from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { GameArtwork } from "../../components/GameArtwork";
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
import { t } from "../../i18n";
const active = (state: string) =>
  ["RESOLVING", "QUEUED", "DOWNLOADING", "VERIFYING"].includes(state);
const labels: Record<string, string> = {
  RESOLVING: t("Buscando conexões e metadados"),
  QUEUED: t("Na fila"),
  DOWNLOADING: t("Baixando"),
  VERIFYING: t("Verificando arquivos"),
  INSTALLING: t("Preparando para jogar"),
  PAUSED: t("Pausado"),
  COMPLETED: t("Concluído"),
  CANCELLED: t("Cancelado"),
  FAILED: t("Falhou"),
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
        title={t("Downloads")}
        description={t(
          "Acompanhe seus jogos, da transferência até a biblioteca.",
        )}
      />
      <div className="transfer-overview">
        <div>
          <strong>{summary.active}</strong>
          <span>{t("Em andamento")}</span>
        </div>
        <div>
          <strong>{bytes(summary.speed)}/s</strong>
          <span>{t("Velocidade total")}</span>
        </div>
        <div>
          <strong>{summary.completed}</strong>
          <span>{t("Concluídos")}</span>
        </div>
      </div>
      <div
        className="filter-tabs transfer-filters"
        aria-label={t("Filtrar downloads")}
      >
        {[
          ["all", t("Todos")],
          ["active", t("Em andamento")],
          ["PAUSED", t("Pausados")],
          ["COMPLETED", t("Concluídos")],
          ["FAILED", t("Com erro")],
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
          <h2>{t("Seus downloads")}</h2>
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
            {t(
              "As transferências de arquivos estão disponíveis no aplicativo OpenRetro.",
            )}
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
                {j.game ? (
                  <GameArtwork game={j.game} hero loading="lazy" />
                ) : (
                  <div className="artwork download-job-icon">
                    <Download size={28} />
                  </div>
                )}
                <div className="download-job-body">
                  <h3>{j.game?.title ?? j.name}</h3>
                  {j.game && (
                    <small className="download-job-file">{j.name}</small>
                  )}
                  <p>{j.sourceName}</p>
                  <span className="transfer-state" data-state={j.state}>
                    {j.state === "INSTALLING" && (
                      <LoaderCircle className="spin" size={13} />
                    )}
                    {j.state === "INSTALLING" && j.stage
                      ? j.stage
                      : (labels[j.state] ?? j.state)}
                  </span>
                  <progress
                    aria-label={t("Progresso de {name}", { name: j.name })}
                    value={j.progress}
                    max={100}
                  />
                  {j.state === "INSTALLING" ? (
                    <p>
                      {j.progress.toFixed(0)}
                      {t(
                        "% · o jogo já foi baixado, falta prepará-lo para a biblioteca",
                      )}
                    </p>
                  ) : (
                    <p>
                      {j.progress.toFixed(1)}%{" "}
                      {j.totalBytes
                        ? ` · ${bytes(j.downloadedBytes)} de ${bytes(j.totalBytes)}`
                        : ""}
                      {j.state === "DOWNLOADING"
                        ? ` · ${bytes(j.bytesPerSecond)}/s`
                        : ""}
                      {j.state === "DOWNLOADING" &&
                      j.remainingSeconds != null &&
                      j.bytesPerSecond > 0
                        ? ` · ${formatRemaining(j.remainingSeconds)}`
                        : ""}
                    </p>
                  )}
                  {j.state === "COMPLETED" && j.libraryStatus === "added" && (
                    <p className="library-status added">
                      <CheckCircle2 size={15} />{" "}
                      {j.libraryMessage ?? t("Adicionado à sua biblioteca.")}
                    </p>
                  )}
                  {j.state === "COMPLETED" &&
                    j.libraryStatus === "manual" &&
                    j.libraryMessage && (
                      <p className="library-status manual">
                        {j.libraryMessage}
                      </p>
                    )}
                  {j.error && <p className="error-message">{t(j.error)}</p>}
                  {j.directory && (
                    <details>
                      <summary>{t("Pasta de destino")}</summary>
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
                        <Pause size={15} /> {t("Pausar")}
                      </button>
                    ) : ["PAUSED", "FAILED", "CANCELLED"].includes(j.state) ? (
                      <button
                        disabled={busy}
                        className="button secondary"
                        onClick={() =>
                          void run(() => bridge.controlDownload(j.id, "resume"))
                        }
                      >
                        <Play size={15} /> {t("Retomar")}
                      </button>
                    ) : null}
                    {j.state === "COMPLETED" &&
                    j.libraryStatus === "added" ? null : j.state ===
                      "COMPLETED" ? (
                      <button
                        disabled={busy}
                        className="button primary"
                        onClick={() =>
                          void run(async () => {
                            // With game data the backend imports in the
                            // background and the job shows each step.
                            if (j.game && j.libraryStatus !== "manual") {
                              await bridge.addDownloadToLibrary(j.id);
                              return;
                            }
                            const downloaded = await bridge.downloadFiles(j.id);
                            if (downloaded.length === 1 && !j.game) {
                              onDownloaded(
                                await bridge.inspect(downloaded[0].path),
                                j.game,
                              );
                              notify(
                                t("Confirme os dados para adicionar o jogo."),
                              );
                              return;
                            }
                            setFiles({ job: j, files: downloaded });
                          })
                        }
                      >
                        {busy ? (
                          <LoaderCircle className="spin" size={15} />
                        ) : (
                          <FolderOpen size={15} />
                        )}{" "}
                        {busy
                          ? t("Verificando o arquivo…")
                          : t("Adicionar à biblioteca")}
                      </button>
                    ) : j.state !== "CANCELLED" && j.state !== "INSTALLING" ? (
                      <button
                        disabled={busy}
                        className="text-button"
                        onClick={() =>
                          void run(() => bridge.controlDownload(j.id, "cancel"))
                        }
                      >
                        {t("Cancelar")}
                      </button>
                    ) : null}
                    <button
                      disabled={busy}
                      className="icon-button"
                      aria-label={t("Remove {name} from downloads", {
                        name: j.name,
                      })}
                      title={t("Remover da lista de downloads")}
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
              ? t("Nenhum download nesta categoria.")
              : t(
                  "Nenhum download ainda. Escolha um jogo no catálogo para começar.",
                )}
          </p>
        )}
      </section>
      {files && (
        <Modal
          title={t("Escolher arquivo do jogo")}
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
                      if (files.job.game) {
                        await bridge.addDownloadToLibrary(files.job.id, f.path);
                        setFiles(undefined);
                        return;
                      }
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
                {t(
                  "Nenhum arquivo de console foi encontrado. Se o download está compactado, use a extração automática ao baixar ou importe o arquivo já extraído. Instaladores de PC não são executados automaticamente.",
                )}
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
              {t("Adicionar jogo local")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
