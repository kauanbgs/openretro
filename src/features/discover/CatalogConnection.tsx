import { Database, RefreshCw } from "lucide-react";
import type { CatalogStatus } from "../../providers/metadata/LaunchboxMetadataProvider";
import { t } from "../../i18n";
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
          ? t("Catálogo disponível no app desktop")
          : preparing
            ? t("Preparando o catálogo")
            : t("Não foi possível preparar o catálogo")}
      </h2>
      <p>
        {unavailable
          ? t(
              "Abra o OpenRetro no desktop para explorar o LaunchBox Games Database.",
            )
          : preparing
            ? t(
                "Na primeira abertura, baixamos e organizamos a base de jogos. Isso pode levar alguns minutos.",
              )
            : t("Verifique sua conexão e tente novamente.")}
      </p>
      {preparing && (
        <>
          <progress
            aria-label={t("Progresso do catálogo")}
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
            <RefreshCw size={16} /> {t("Tentar de novo")}
          </button>
        </>
      )}
    </div>
  );
}
