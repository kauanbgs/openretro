import {
  useEffect,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { Check, Copy, LoaderCircle, X } from "lucide-react";
import { Modal } from "../../components/Modal";
import { isTauri } from "../../services/transport";
import {
  acceptGuest,
  endParty,
  partyStore,
  removeGuest,
  startParty,
} from "./partySession";
import "./PartyDialog.css";

export function PartyDialog({
  onClose,
  input,
}: {
  onClose: () => void;
  input?: RefObject<((key: string) => boolean) | null>;
}) {
  const room = useSyncExternalStore(partyStore.subscribe, partyStore.snapshot);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [copyError, setCopyError] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const active = room.phase === "open";
  const busy = room.phase === "connecting";
  useEffect(() => {
    if (!input) return;
    const handler = (button: string) => {
      if (button === "b") {
        onClose();
        return true;
      }
      const controls = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".party-room button:not(:disabled), .party-room input:not(:disabled)",
        ),
      ).filter((node) => node.getClientRects().length > 0);
      const index = controls.indexOf(document.activeElement as HTMLElement);
      if (["up", "left", "lb", "down", "right", "rb"].includes(button))
        controls[
          (index +
            (["up", "left", "lb"].includes(button) ? -1 : 1) +
            controls.length) %
            controls.length
        ]?.focus();
      if (button === "a") (document.activeElement as HTMLElement)?.click();
      return true;
    };
    input.current = handler;
    return () => {
      if (input.current === handler) input.current = null;
    };
  }, [input, onClose]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copy(kind: "code" | "link") {
    try {
      await navigator.clipboard.writeText(
        kind === "code" ? room.code : room.url,
      );
      setCopied(kind);
      setCopyError("");
    } catch {
      setCopyError("Selecione e copie o convite abaixo.");
    }
  }
  return (
    <Modal title="Party" wide onClose={onClose}>
      <div className="party-room">
        <div className="party-heading">
          <h3>Jogue com seus amigos.</h3>
          <p>
            O jogo roda no seu PC. Seus amigos entram pelo navegador, sem
            instalar nada.
          </p>
        </div>
        <div className="party-seats" aria-label="Jogadores da sala">
          {[1, 2, 3, 4].map((player) => {
            const guest = room.guests.find((g) => g.player === player);
            const connected = guest && room.connected.includes(guest.id);
            return (
              <div
                className={`party-seat ${player === 1 || guest ? "occupied" : ""}`}
                key={player}
              >
                <div className="party-seat-top">
                  <span>J{player}</span>
                  {guest && (
                    <button
                      className="icon-button"
                      aria-label={`Remover ${guest.name}`}
                      onClick={() => removeGuest(guest.id)}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <strong>
                  {player === 1 ? "Você" : guest?.name || "Lugar livre"}
                </strong>
                <small>
                  {player === 1
                    ? "Anfitrião"
                    : guest
                      ? connected
                        ? "Conectado"
                        : "Conectando…"
                      : "Aguardando um amigo"}
                </small>
              </div>
            );
          })}
        </div>
        {room.guests.some((g) => g.player === null) && (
          <div className="party-requests" aria-label="Pedidos de entrada">
            {room.guests
              .filter((g) => g.player === null)
              .map((g) => (
                <div key={g.id}>
                  <span>
                    <strong>{g.name}</strong>
                    <small>Quer entrar na partida</small>
                  </span>
                  <button
                    className="button secondary"
                    onClick={() => removeGuest(g.id)}
                  >
                    Recusar
                  </button>
                  <button
                    className="button primary"
                    disabled={
                      room.guests.filter((g) => g.player !== null).length >= 3
                    }
                    onClick={() => acceptGuest(g.id)}
                  >
                    Aceitar
                  </button>
                </div>
              ))}
          </div>
        )}
        <section className="party-invite" aria-label="Convite">
          {active ? (
            <>
              <div className="party-invite-heading">
                <strong>Convide seus amigos</strong>
                <span className="party-status">Sala aberta</span>
              </div>
              <div className="party-link">
                <input
                  aria-label="Código da sala"
                  className="party-code"
                  readOnly
                  value={room.code}
                  onFocus={(event) => event.target.select()}
                />
                <button
                  className="button primary"
                  onClick={() => void copy("code")}
                >
                  {copied === "code" ? <Check size={16} /> : <Copy size={16} />}
                  {copied === "code" ? "Copiado" : "Copiar código"}
                </button>
                <button
                  className="button secondary"
                  onClick={() => void copy("link")}
                >
                  {copied === "link" ? "Copiado" : "Copiar link"}
                </button>
              </div>
              <p>
                {copyError ||
                  "Você decide quem entra. Até três amigos podem participar."}
              </p>
            </>
          ) : (
            <>
              <strong>Crie uma sala e envie o código.</strong>
              <p>
                Você aprova cada entrada e seus amigos recebem um lugar na
                partida.
              </p>
              <button
                className="button primary party-create"
                disabled={!isTauri || busy}
                onClick={() => void startParty()}
              >
                {busy && <LoaderCircle size={16} className="spin" />}
                {busy ? "Criando sala…" : "Criar sala"}
              </button>
            </>
          )}
        </section>
        {room.error && (
          <p className="party-error" role="alert">
            {room.error}
          </p>
        )}
        {!isTauri && (
          <p className="party-note">
            Abra o aplicativo desktop para criar uma sala e transmitir o jogo.
          </p>
        )}
        {active && (
          <div className="party-now">
            <strong>{room.game || "Aguardando um jogo"}</strong>
            <p>
              {room.game
                ? "O áudio do PC também é compartilhado."
                : "Abra um jogo no runtime integrado para começar."}
            </p>
          </div>
        )}
        {active && !room.relay && (
          <p className="party-note">
            Conexão em modo de teste. Algumas redes podem não conectar.
          </p>
        )}
        <footer className="party-footer">
          <span>
            {active
              ? "A sala continua aberta ao fechar esta janela."
              : "Você joga no PC. Seus amigos jogam de onde estiverem."}
          </span>
          {active &&
            (confirmEnd ? (
              <div>
                <button
                  className="button secondary"
                  onClick={() => setConfirmEnd(false)}
                >
                  Voltar
                </button>
                <button
                  className="button danger"
                  onClick={() => {
                    endParty();
                    setConfirmEnd(false);
                  }}
                >
                  Encerrar
                </button>
              </div>
            ) : (
              <button
                className="button secondary"
                onClick={() => setConfirmEnd(true)}
              >
                Encerrar sala
              </button>
            ))}
          {busy && (
            <button className="button secondary" onClick={endParty}>
              Cancelar
            </button>
          )}
        </footer>
      </div>
    </Modal>
  );
}
