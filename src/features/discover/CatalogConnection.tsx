import { Database, RefreshCw } from "lucide-react";
import type { CatalogStatus } from "../../providers/metadata/LaunchboxMetadataProvider";
export function CatalogConnection({
  status,
  error,
  onRetry,
}: {
  status?: CatalogStatus;
  error?: string;
  onRetry: () => void;
}) {
  const preparing = status?.state === "building" || status?.state === "missing";
  const unavailable = status?.state === "unavailable";
  return (
    <div className="catalog-connection">
      <div className="large-icon">
        <Database size={30} />
      </div>
      <h2>
        {unavailable
          ? "Catálogo disponível no app desktop"
          : preparing
            ? "Preparando o catálogo"
            : "Não foi possível preparar o catálogo"}
      </h2>
      <p>
        {unavailable
          ? "Abra o OpenRetro no desktop para explorar o LaunchBox Games Database."
          : preparing
            ? "Na primeira abertura, baixamos e organizamos a base de jogos. Isso pode levar alguns minutos."
            : "Verifique sua conexão e tente novamente."}
      </p>
      {preparing && (
        <>
          <progress
            aria-label="Progresso do catálogo"
            max={100}
            value={status?.progress ?? 0}
          />
          <p role="status">
            {status?.message ?? "Preparando…"}{" "}
            {Math.round(status?.progress ?? 0)}%
          </p>
        </>
      )}
      {!preparing && !unavailable && (
        <>
          {(error || status?.message) && (
            <p className="error-message" role="alert">
              {error || status?.message}
            </p>
          )}
          <button className="button primary" onClick={onRetry}>
            <RefreshCw size={16} /> Tentar de novo
          </button>
        </>
      )}
    </div>
  );
}
