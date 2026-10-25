import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HardDrive, Library, Trash2 } from "lucide-react";
import { Modal } from "./Modal";
import { bridge } from "../services/bridge";
import { formatBytes } from "../utils/format";
import type { LibraryGame } from "../types";
import { t } from "../i18n";

/**
 * Removes a game in one decision: with its files (the whole download folder
 * when OpenRetro downloaded it) or only from the library. Saves stay.
 */
export function RemoveGameDialog({
  entry,
  onClose,
  onRemoved,
}: {
  entry: LibraryGame;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const client = useQueryClient();
  const removal = useQuery({
    queryKey: ["game-removal", entry.item.id],
    queryFn: () => bridge.gameRemoval(entry.item.id),
    staleTime: 0,
  });
  const info = removal.data;
  const [withFiles, setWithFiles] = useState<boolean>();
  // Downloads made by OpenRetro go with their files unless the player says otherwise.
  useEffect(() => {
    if (withFiles !== undefined) return;
    if (info) setWithFiles(info.downloaded);
    else if (removal.isError) setWithFiles(false);
  }, [info, removal.isError, withFiles]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const missing = info && !info.path;
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await bridge.removeGame(entry.item.id, Boolean(withFiles && !missing));
      await Promise.all([
        client.invalidateQueries({ queryKey: ["library"] }),
        client.invalidateQueries({ queryKey: ["download-jobs"] }),
      ]);
      onRemoved();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t("Remover {title}?", { title: entry.game.title })}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="remove-game">
        <div className="remove-options" role="radiogroup">
          <label className={withFiles && !missing ? "selected" : ""}>
            <input
              type="radio"
              name="remove-game"
              checked={Boolean(withFiles && !missing)}
              disabled={busy || !info || Boolean(missing)}
              onChange={() => setWithFiles(true)}
            />
            <HardDrive size={20} />
            <span>
              <strong>{t("Remover e apagar os arquivos")}</strong>
              <small>
                {missing
                  ? t("O arquivo do jogo não está mais neste computador.")
                  : !info
                    ? t("Calculando o espaço…")
                    : info.downloaded
                      ? t(
                          "Apaga a pasta do download e libera {size} no disco.",
                          { size: formatBytes(info.bytes) },
                        )
                      : t("Apaga o arquivo do jogo e libera {size} no disco.", {
                          size: formatBytes(info.bytes),
                        })}
              </small>
            </span>
          </label>
          <label className={!withFiles || missing ? "selected" : ""}>
            <input
              type="radio"
              name="remove-game"
              checked={!withFiles || Boolean(missing)}
              disabled={busy}
              onChange={() => setWithFiles(false)}
            />
            <Library size={20} />
            <span>
              <strong>{t("Só tirar da biblioteca")}</strong>
              <small>
                {info?.path
                  ? t("Os arquivos continuam em {path}.", { path: info.path })
                  : t("Nenhum arquivo é apagado.")}
              </small>
            </span>
          </label>
        </div>
        <p className="muted">
          {t(
            "Seus saves continuam neste computador e voltam se você adicionar o jogo de novo.",
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
            onClick={onClose}
          >
            {t("Cancelar")}
          </button>
          <button
            className="button danger"
            disabled={busy || withFiles === undefined}
            onClick={() => void remove()}
          >
            <Trash2 size={16} />{" "}
            {busy
              ? t("Removendo…")
              : withFiles && !missing
                ? t("Remover e apagar")
                : t("Remover da biblioteca")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
