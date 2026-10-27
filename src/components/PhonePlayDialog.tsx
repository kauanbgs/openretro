import { useEffect, useRef, useState, type RefObject } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  LoaderCircle,
  ShieldAlert,
  Smartphone,
} from "lucide-react";
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
  /** Big Picture's controller: A copies the address or turns it off, B closes. */
  input?: RefObject<((key: string) => boolean) | null>;
}) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
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
  // Opening this window is the request: the QR code shows without a second
  // step. Turning it off here stays off until the window opens again.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !status.data || running) return;
    started.current = true;
    void toggle(true);
  }, [status.data, running]);
  const copy = () =>
    void navigator.clipboard
      .writeText(status.data?.url ?? "")
      .then(() => setCopied(true));
  useEffect(() => {
    if (!input) return;
    const handler = (key: string) => {
      if (key === "b") onClose();
      if (key === "a" && !busy) running ? copy() : void toggle(true);
      if (key === "y" && running && !busy) void toggle(false);
      return true;
    };
    input.current = handler;
    return () => {
      if (input.current === handler) input.current = null;
    };
  });
  const devices = status.data?.devices ?? 0;
  const players = status.data?.players ?? [];
  return (
    <Modal title={t("Jogar no celular")} onClose={onClose}>
      <div className="phone-play">
        {running && status.data?.qr ? (
          <>
            {status.data.network?.public && (
              <div className="phone-play-blocked" role="alert">
                <strong>
                  <ShieldAlert size={16} />{" "}
                  {t("O Windows está bloqueando os celulares")}
                </strong>
                <p>
                  {t(
                    "A rede {name} deste computador está marcada como Pública, e o Windows não deixa celulares se conectarem ao OpenRetro nela. Na sua casa, mude o perfil de rede para Privada. Este aviso some sozinho quando a rede mudar.",
                    { name: status.data.network.name },
                  )}
                </p>
                <button
                  className="button outline"
                  onClick={() =>
                    void bridge
                      .remotePlayNetworkSettings()
                      .catch((error) => notify(String(error)))
                  }
                >
                  {t("Abrir configurações de rede")}
                </button>
              </div>
            )}
            <ol className="phone-play-steps">
              <li>{t("Conecte o celular no mesmo Wi-Fi deste PC.")}</li>
              <li>{t("Aponte a câmera para o código.")}</li>
              <li>{t("Escolha o jogador e jogue.")}</li>
            </ol>
            <div
              className="phone-play-qr"
              role="img"
              aria-label={t("QR code para abrir o OpenRetro no celular")}
              dangerouslySetInnerHTML={{ __html: status.data.qr }}
            />
            <p
              className={`phone-play-devices ${devices ? "connected" : ""}`}
              role="status"
            >
              {devices ? (
                <Check size={15} />
              ) : (
                <LoaderCircle className="spin" size={15} />
              )}
              {devices
                ? devices === 1
                  ? t("1 celular conectado")
                  : t("{count} celulares conectados", { count: devices })
                : t("Aguardando seu celular conectar.")}
              {players.length > 0 &&
                t(" · celular como {players}", {
                  players: players.map((p) => `J${p}`).join(", "),
                })}
            </p>
            <div className="input-action">
              <input
                readOnly
                aria-label={t("Endereço para o celular")}
                value={status.data.url ?? ""}
              />
              <button className="button secondary" onClick={copy}>
                <Copy size={16} /> {copied ? t("Copiado") : t("Copiar")}
              </button>
            </div>
            <details className="phone-play-help">
              <summary>{t("Precisa de ajuda?")}</summary>
              <p>
                {t(
                  "O J1 fica com o controle ou teclado deste computador, então dá para jogar um aqui e outro no celular. Até quatro pessoas jogam usando um único PC.",
                )}
              </p>
              <p>
                {t(
                  "Na primeira vez, o Windows pergunta se o OpenRetro pode usar a rede. Permita em redes privadas, e prefira o Wi-Fi de 5 GHz.",
                )}
              </p>
              <p>
                {t(
                  "Para amigos fora do Wi-Fi, use a Party, que funciona pela internet sem configurar nada.",
                )}
              </p>
            </details>
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
            <p role="status">
              {busy || status.isPending
                ? t("Preparando o código para o celular…")
                : t(
                    "Jogue no navegador do celular, com imagem, som e controle na tela, enquanto o jogo roda neste computador.",
                  )}
            </p>
            {!busy && !status.isPending && (
              <button
                className="button primary full"
                onClick={() => void toggle(true)}
              >
                {t("Ativar")}
              </button>
            )}
            {(busy || status.isPending) && (
              <LoaderCircle className="spin" size={22} />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
