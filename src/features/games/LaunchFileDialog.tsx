import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, Play, X } from "lucide-react";
import { Modal } from "../../components/Modal";
import { bridge } from "../../services/bridge";
import { t } from "../../i18n";
import { failed } from "../../utils/notice";

const filesKey = (itemId: string) => ["launch-files", itemId];
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
/** A game installed inside an emulator is a hash-named NCA: the title says more. */
const installedInEmulator = (path: string) =>
  /nand[\\/]user[\\/]contents[\\/]registered[\\/][^\\/]+\.nca$/i.test(path);

/** Pressing Play on a game with several files asks which one to run. */
export function LaunchFileDialog({
  itemId,
  title,
  onPlay,
  onClose,
  notify,
}: {
  itemId: string;
  title: string;
  onPlay: (file: string) => void;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const files = useQuery({
    queryKey: filesKey(itemId),
    queryFn: () => bridge.launchFiles(itemId),
  });
  const [picked, setPicked] = useState<string>();
  const list = files.data ?? [];
  const selected = picked ?? list.find((file) => file.exists)?.path;
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: filesKey(itemId) });
  async function add() {
    try {
      const path = await bridge.pickLaunchFile();
      if (!path) return;
      await bridge.addLaunchFile(itemId, path);
      setPicked(path);
      await refresh();
    } catch (error) {
      notify(failed(error));
    }
  }
  async function remove(path: string) {
    try {
      await bridge.removeLaunchFile(itemId, path);
      if (picked === path) setPicked(undefined);
      await refresh();
    } catch (error) {
      notify(failed(error));
    }
  }
  return (
    <Modal
      title={t("Qual arquivo executar?")}
      subtitle={title}
      onClose={onClose}
    >
      <div className="launch-files">
        {list.map((file) => (
          <label
            key={file.path}
            className={`launch-file ${file.path === selected ? "selected" : ""}`}
            title={file.path}
          >
            <input
              type="radio"
              name="launch-file"
              checked={file.path === selected}
              disabled={!file.exists}
              onChange={() => setPicked(file.path)}
            />
            <span className="launch-file-name">
              {installedInEmulator(file.path) ? title : fileName(file.path)}
              {installedInEmulator(file.path) ? (
                <small> · {t("jogo instalado no emulador")}</small>
              ) : (
                file.original && <small> · {t("arquivo do jogo")}</small>
              )}
              {!file.exists && <small> · {t("não encontrado")}</small>}
            </span>
            {!file.original && (
              <button
                type="button"
                className="icon-button"
                aria-label={t("Remover da lista")}
                onClick={() => void remove(file.path)}
              >
                <X size={14} />
              </button>
            )}
          </label>
        ))}
      </div>
      <p className="launch-files-hint">
        {t(
          "Adicione a atualização, o DLC ou outra cópia do jogo e escolha qual abrir. O emulador recebe o arquivo selecionado.",
        )}
      </p>
      <div className="modal-footer">
        <button className="button outline" onClick={() => void add()}>
          <FilePlus2 size={16} /> {t("Adicionar arquivo")}
        </button>
        <button
          className="button primary"
          disabled={!selected}
          onClick={() => selected && onPlay(selected)}
        >
          <Play size={16} fill="currentColor" /> {t("Jogar")}
        </button>
      </div>
    </Modal>
  );
}
