import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { File, Folder, FolderUp, HardDrive, X } from "lucide-react";
import { bridge, type FilePickerRequest } from "../../services/bridge";
import { t } from "../../i18n";

export function ConsoleFilePicker({
  request,
  onClose,
}: {
  request: FilePickerRequest;
  onClose: (path: string | null) => void;
}) {
  const [path, setPath] = useState("");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const listing = useQuery({
    queryKey: ["console-files", path, debounced, request.directory],
    queryFn: () => bridge.browseFiles(path, debounced, request.directory),
    staleTime: 0,
    gcTime: 30000,
    retry: false,
  });
  const navigate = (next: string) => {
    setPath(next);
    setQuery("");
    setDebounced("");
  };
  return (
    <div className="modal-backdrop tv-file-backdrop">
      <section
        className="modal tv-file-picker"
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
      >
        <header>
          <h2>{request.title}</h2>
          <button aria-label={t("Close dialog")} onClick={() => onClose(null)}>
            <X size={22} />
          </button>
        </header>
        <div className="tv-file-actions">
          <button className="button secondary" onClick={() => navigate("")}>
            <HardDrive size={18} />
            {t("Locais")}
          </button>
          <button
            className="button secondary"
            disabled={!path}
            onClick={() => navigate(listing.data?.parent ?? "")}
          >
            <FolderUp size={18} />
            {t("Pasta acima")}
          </button>
          {request.directory && (
            <button
              className="button primary"
              disabled={!listing.data?.path || listing.isFetching}
              onClick={() => onClose(listing.data!.path)}
            >
              {t("Escolher esta pasta")}
            </button>
          )}
        </div>
        <p className="path-text">
          {listing.data?.path || t("Selecione um local")}
        </p>
        {path && (
          <input
            aria-label={t("Filtrar arquivos nesta pasta")}
            placeholder={t("Filtrar pelo nome")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        )}
        {listing.isFetching && <p role="status">{t("Carregando arquivos…")}</p>}
        {listing.error && (
          <p role="alert" className="error-message">
            {String(listing.error)}
          </p>
        )}
        <div className="tv-file-list">
          {!listing.isFetching &&
            listing.data?.entries.map((entry) => (
              <button
                className="button secondary"
                key={entry.path}
                onClick={() =>
                  entry.isDirectory ? navigate(entry.path) : onClose(entry.path)
                }
              >
                {entry.isDirectory ? <Folder size={22} /> : <File size={22} />}
                <span>{entry.name}</span>
              </button>
            ))}
        </div>
        {!listing.isFetching &&
          listing.data &&
          !listing.data.entries.length && (
            <p>{t("Nenhum arquivo encontrado.")}</p>
          )}
        {listing.data?.truncated && (
          <p>
            {t(
              "Mostrando até 500 itens. Filtre pelo nome para encontrar os demais.",
            )}
          </p>
        )}
      </section>
    </div>
  );
}
