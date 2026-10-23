import { useEffect, useState, type RefObject } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, LoaderCircle, Smartphone } from "lucide-react";
import { Modal } from "./Modal";
import { bridge } from "../services/bridge";
import { t } from "../i18n";

/** Pairs a phone on the same network to watch, hear and play the PC's game. */
export function PhonePlayDialog({
  onClose,
  notify,
  input,
}: {
  onClose: () => void;
  notify: (message: string) => void;
  /** Big Picture's controller: A turns phone play on or off, B closes. */
  input?: RefObject<((key: string) => boolean) | null>;
}) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const status = useQuery({
    queryKey: ["remote-play"],
    queryFn: bridge.remotePlayStatus,
    refetchInterval: 2000,
  });
  async function toggle(start: boolean) {
    setBusy(true);
    try {
      if (start) await bridge.remotePlayStart();
      else await bridge.remotePlayStop();
      await client.invalidateQueries({ queryKey: ["remote-play"] });
    } catch (error) {
      notify(String(error));
    } finally {
      setBusy(false);
    }
  }
  const running = status.data?.running;
  useEffect(() => {
    if (!input) return;
    const handler = (key: string) => {
      if (key === "b") onClose();
      if (key === "a" && !busy) void toggle(!running);
      return true;
    };
    input.current = handler;
    return () => {
      if (input.current === handler) input.current = null;
    };
  });
  return (
    <Modal title={t("Jogar no celular")} onClose={onClose}>
      <div className="phone-play">
        {running && status.data?.qr ? (
          <>
            <div
              className="phone-play-qr"
              role="img"
              aria-label={t("QR code para abrir o OpenRetro no celular")}
              dangerouslySetInnerHTML={{ __html: status.data.qr }}
            />
            <p>
              {t(
                "Aponte a câmera do celular para o código. O celular precisa estar na mesma rede Wi-Fi deste computador.",
              )}
            </p>
            <div className="input-action">
              <input readOnly value={status.data.url ?? ""} />
              <button
                className="icon-button"
                aria-label={t("Copiar endereço")}
                onClick={() =>
                  void navigator.clipboard
                    .writeText(status.data?.url ?? "")
                    .then(() => notify(t("Endereço copiado.")))
                }
              >
                <Copy size={16} />
              </button>
            </div>
            <p className="phone-play-devices">
              {status.data.devices
                ? status.data.devices === 1
                  ? t("1 celular conectado")
                  : t("{count} celulares conectados", {
                      count: status.data.devices,
                    })
                : t("Nenhum celular conectado ainda")}
              {status.data.players.length > 0 &&
                t(" · celular como {players}", {
                  players: status.data.players.map((p) => `J${p}`).join(", "),
                })}
              {status.data.players.length > 0 &&
                !status.data.players.includes(1) &&
                t(" · o computador joga como J1")}
            </p>
            <p className="hint">
              {t(
                "Ao abrir a página, cada celular escolhe o jogador. O J1 fica com o controle ou teclado deste computador, então dá para jogar um aqui e outro no celular. O jogo continua aparecendo neste computador, e até quatro pessoas podem jogar usando um único PC.",
              )}
            </p>
            <p className="hint">
              {t(
                "Para amigos fora do Wi-Fi, conectem o PC e os celulares na mesma VPN de jogos ou encaminhem a porta 47820 do roteador para este computador; depois compartilhe o endereço copiado. Para netplay entre PCs, abra o jogo no celular e use Jogar online.",
              )}
            </p>
            <button
              className="button outline full"
              disabled={busy}
              onClick={() => void toggle(false)}
            >
              {t("Desativar")}
            </button>
          </>
        ) : (
          <>
            <Smartphone size={36} />
            <p>
              {t(
                "Jogue no navegador do celular, com imagem, som e controle na tela, enquanto o jogo roda neste computador. Funciona na mesma rede Wi-Fi; prefira a rede de 5 GHz.",
              )}
            </p>
            <p className="hint">
              {t(
                "Na primeira vez, o Windows pergunta se o OpenRetro pode usar a rede. Permita em redes privadas.",
              )}
            </p>
            <p className="hint">
              {t(
                "Amigos podem entrar com seus próprios celulares e escolher J1 a J4. Todos assistem e controlam a mesma partida que roda neste PC.",
              )}
            </p>
            <button
              className="button primary full"
              disabled={busy || status.isPending}
              onClick={() => void toggle(true)}
            >
              {busy && <LoaderCircle className="spin" size={16} />}{" "}
              {t("Ativar")}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
