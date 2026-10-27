import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Link2, LoaderCircle, X } from "lucide-react";
import { bridge } from "../../services/bridge";
import { Modal } from "../../components/Modal";
import { isTauri } from "../../services/transport";
import {
  closeGuestLink,
  createGuestLink,
  endParty,
  partyStore,
  removeGuest,
  startParty,
  setFriendsAllowed,
} from "./partySession";
import "./PartyDialog.css";
import { socialStore } from "../../services/social";
import { locale, t } from "../../i18n";
import { AccountAvatar } from "../social/accountAvatars";

export function PartyDialog({
  onClose,
  onSignIn,
  input,
}: {
  onClose: () => void;
  /** Opens the account panel: a Party needs an account. */
  onSignIn?: () => void;
  input?: RefObject<((key: string) => boolean) | null>;
}) {
  const room = useSyncExternalStore(partyStore.subscribe, partyStore.snapshot);
  const social = useSyncExternalStore(
    socialStore.subscribe,
    socialStore.snapshot,
  );
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [copied, setCopied] = useState(false);
  const link = room.guestLink;
  const linkGuest = room.guests.find((g) => g.anonymous);
  const seatsFull = [2, 3, 4].every((p) =>
    room.guests.some((g) => g.player === p),
  );
  useEffect(() => setCopied(false), [link?.url]);
  const active = room.phase === "open";
  const busy = room.phase === "connecting";
  const signedIn = social.session.hasSession;
  // An open room always has an invite ready: one press creates both.
  const autoLink = useRef(false);
  useEffect(() => {
    if (!active) {
      autoLink.current = false;
      return;
    }
    if (autoLink.current || link || room.guestLinkBusy || seatsFull) return;
    autoLink.current = true;
    createGuestLink();
  }, [active, link, room.guestLinkBusy, seatsFull]);
  const qr = useQuery({
    queryKey: ["invite-qr", link?.url],
    queryFn: () => bridge.inviteQr(link!.url),
    enabled: Boolean(link && isTauri),
    staleTime: Infinity,
    retry: false,
  });
  const copyLink = () =>
    link &&
    void navigator.clipboard.writeText(link.url).then(() => setCopied(true));
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
  return (
    <Modal title="Party" wide onClose={onClose}>
      <div className="party-room">
        <div className="party-heading">
          <h3>{t("Jogue com seus amigos.")}</h3>
          <p>
            {t(
              "O jogo roda no seu PC e seus amigos jogam pela internet, de onde estiverem.",
            )}
          </p>
        </div>
        <div className="party-seats" aria-label="Jogadores da sala">
          {[1, 2, 3, 4].map((player) => {
            const guest = room.guests.find((g) => g.player === player);
            const connected = guest && room.connected.includes(guest.id);
            const reserved = !guest && link?.player === player;
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
                {(player === 1 || guest) && (
                  <AccountAvatar
                    avatar={
                      player === 1 ? social.session.user?.avatar : guest?.avatar
                    }
                    size={42}
                    status={player === 1 || connected ? "online" : "idle"}
                  />
                )}
                <strong>
                  {player === 1
                    ? (social.session.user?.displayName ?? t("Você"))
                    : guest?.name ||
                      (reserved ? t("Lugar do link") : t("Lugar livre"))}
                </strong>
                <small>
                  {player === 1
                    ? t("Anfitrião")
                    : guest
                      ? (guest.anonymous ? t("Convidado pelo link · ") : "") +
                        (connected ? t("Conectado") : t("Conectando…"))
                      : reserved
                        ? t("Aguardando quem tem o link")
                        : t("Aguardando um amigo")}
                </small>
              </div>
            );
          })}
        </div>
        <section className="party-invite" aria-label={t("Convite")}>
          {active && signedIn && (
            <div className="party-friends-setting">
              <div>
                <strong>{t("Amigos podem entrar")}</strong>
                <p>
                  {t(
                    "Seus amigos veem o Party no painel e entram com um clique. Desligue para fechar a sala para novas entradas.",
                  )}
                </p>
              </div>
              <button
                className={"switch " + (room.friendsAllowed ? "on" : "")}
                role="switch"
                aria-label={t("Amigos podem entrar")}
                aria-checked={room.friendsAllowed}
                disabled={room.friendsBusy}
                onClick={() => setFriendsAllowed(!room.friendsAllowed)}
              >
                <span />
              </button>
              {room.friendsError && (
                <p className="party-friends-error" role="alert">
                  {t(room.friendsError)}
                </p>
              )}
              {room.friendsAllowed && !room.friendsError && (
                <p className="party-friends-status" role="status">
                  {room.friendsBusy
                    ? t("Atualizando acesso dos amigos…")
                    : room.friendsReady
                      ? t(
                          social.session.user?.appearOffline
                            ? "Seu Party fica oculto enquanto você aparece offline."
                            : "Seu Party está disponível para os amigos.",
                        )
                      : t("Reconectando aos amigos…")}
                </p>
              )}
            </div>
          )}
          {active && (
            <div className="party-link">
              <div>
                <strong>{t("Convide pelo link")}</strong>
                <p>
                  {t(
                    "Mande o link ou mostre o código. A pessoa joga pelo navegador do PC ou do celular, sem conta e sem instalar nada.",
                  )}
                </p>
              </div>
              {link ? (
                <>
                  <div className="party-link-share">
                    {qr.data && (
                      <div
                        className="party-link-qr"
                        role="img"
                        aria-label={t("QR code do convite")}
                        dangerouslySetInnerHTML={{ __html: qr.data }}
                      />
                    )}
                    <div className="party-link-copy">
                      <input
                        readOnly
                        value={link.url}
                        aria-label={t("Link do convite")}
                        onFocus={(event) => event.currentTarget.select()}
                      />
                      <button
                        className="button primary"
                        autoFocus
                        onClick={copyLink}
                      >
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                        {copied ? t("Link copiado") : t("Copiar link")}
                      </button>
                    </div>
                  </div>
                  <p className="party-link-status" role="status">
                    {linkGuest
                      ? t(
                          "O lugar J{player} é de {name}. Se a conexão cair, essa pessoa volta pelo mesmo link.",
                          { player: link.player, name: linkGuest.name },
                        )
                      : t(
                          "Lugar J{player}. Quem abrir primeiro fica com ele, então não mostre o link na live. Vale até {time} se ninguém entrar.",
                          {
                            player: link.player,
                            time: new Date(link.expires).toLocaleTimeString(
                              locale(),
                              { hour: "2-digit", minute: "2-digit" },
                            ),
                          },
                        )}
                  </p>
                  <div className="party-link-actions">
                    <button
                      className="button secondary"
                      disabled={room.guestLinkBusy}
                      onClick={createGuestLink}
                    >
                      <Link2 size={16} />
                      {t("Gerar novo link")}
                    </button>
                    <button
                      className="button secondary"
                      onClick={closeGuestLink}
                    >
                      {t("Fechar lugar")}
                    </button>
                  </div>
                </>
              ) : (
                <button
                  className="button secondary party-link-create"
                  disabled={room.guestLinkBusy || seatsFull}
                  onClick={createGuestLink}
                >
                  {room.guestLinkBusy ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <Link2 size={16} />
                  )}
                  {room.guestLinkBusy
                    ? t("Criando link…")
                    : t("Criar link de convite")}
                </button>
              )}
            </div>
          )}
          {active ? (
            <div className="party-invite-heading">
              <strong>{t("Sala aberta")}</strong>
              <span className="party-status">
                {t("Até três amigos podem entrar")}
              </span>
            </div>
          ) : signedIn ? (
            <>
              <strong>{t("Um clique e a sala está pronta.")}</strong>
              <p>
                {t(
                  "A sala já sai com um link de convite. Seus amigos do OpenRetro também a veem no painel de amigos.",
                )}
              </p>
              <button
                className="button primary party-create"
                autoFocus
                disabled={!isTauri || busy}
                onClick={() => void startParty()}
              >
                {busy && <LoaderCircle size={16} className="spin" />}
                {busy ? t("Criando sala…") : t("Criar sala e convidar")}
              </button>
            </>
          ) : (
            <>
              <strong>{t("Entre na sua conta para criar um Party.")}</strong>
              <p>
                {t(
                  "O Party é só para amigos: quem entra usa a própria conta do OpenRetro.",
                )}
              </p>
              {onSignIn && (
                <button
                  className="button primary party-create"
                  disabled={!isTauri}
                  onClick={onSignIn}
                >
                  {t("Entrar na conta")}
                </button>
              )}
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
                : "Abra um jogo para começar. No PS3, abra o jogo com a sala já criada para os convidados jogarem."}
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
