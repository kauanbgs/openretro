import { useEffect, useRef, useState } from "react";
import type { Friend } from "../../services/social";
import {
  checkPartyAvailable,
  joinFriendParty,
  joinFriendRoom,
} from "../../services/social";
import { accountFailure } from "../../services/account";
import { AccountAvatar } from "../social/accountAvatars";
import { PartyGuest, type GuestState } from "./partyGuest";
import {
  acquirePartyInput,
  neutralPad,
  partyKeys,
  PartyExitGesture,
  readPartyPad,
} from "./partyInput";
import { loadMapping, pickPad, type PadMapping } from "./partyPadMapping";
import { PartyPadSetup } from "./PartyPadSetup";
import { PartyChat } from "./PartyChat";
import { PARTY_REACTIONS, type PartyReactionId } from "./partyLive";
import {
  PartyReactionFloat,
  PartyReactionTray,
  PartySpeakers,
} from "./PartyLiveParts";
import { microphoneFailure } from "./partyVoice";
import { t } from "../../i18n";
import "./PartyGuestScreen.css";

const labels = {
  joining: "Conectando à sala…",
  waiting: "Aguardando o anfitrião",
  accepted: "Conectando imagem e som…",
  connected: "Conectado ao Party",
  disconnected: "Tentando recuperar a conexão…",
  ended: "Partida encerrada",
  error: "Conexão encerrada",
  left: "Você saiu do Party.",
};
export function PartyGuestScreen({
  friend,
  onClose,
}: {
  friend: Friend;
  onClose: () => void;
}) {
  const name = friend.displayName ?? friend.friendCode;
  const video = useRef<HTMLVideoElement>(null);
  const root = useRef<HTMLElement>(null);
  const guest = useRef<PartyGuest | null>(null);
  const [state, setState] = useState<GuestState>({
    phase: "joining",
    connectedOnce: false,
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const [menu, setMenu] = useState(false);
  const [play, setPlay] = useState(false);
  // A connected controller the browser does not know, until it is set up.
  const [unmapped, setUnmapped] = useState<string | null>(null);
  const unmappedRef = useRef<string | null>(null);
  const [setup, setSetup] = useState(false);
  const setupRef = useRef(false);
  const mappings = useRef(new Map<string, PadMapping | null>());
  const paused = useRef(false);
  // Typing in the chat keeps playing but sends no press to the game.
  const [chat, setChat] = useState(false);
  const chatRef = useRef(false);
  const held = useRef(new Map<string, number>());
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const leave = () => {
    guest.current?.leave();
    closeRef.current();
  };
  const openMenu = () => {
    paused.current = true;
    held.current.clear();
    guest.current?.setInput(neutralPad());
    setMenu(true);
  };
  const resume = () => {
    paused.current = false;
    setMenu(false);
  };
  // Setting a controller up pauses play, like the menu, so no press reaches the game.
  const openSetup = () => {
    paused.current = true;
    setupRef.current = true;
    held.current.clear();
    guest.current?.setInput(neutralPad());
    setMenu(false);
    setSetup(true);
  };
  const closeSetup = () => {
    if (unmappedRef.current) mappings.current.delete(unmappedRef.current);
    setupRef.current = false;
    paused.current = false;
    setSetup(false);
  };
  const openChat = () => {
    if (!stateRef.current.player || chatRef.current) return;
    chatRef.current = true;
    held.current.clear();
    guest.current?.setInput(neutralPad());
    setChat(true);
  };
  const closeChat = () => {
    chatRef.current = false;
    setChat(false);
    (document.activeElement as HTMLElement | null)?.blur();
  };
  const [reacting, setReacting] = useState(false);
  const react = (id: PartyReactionId) => guest.current?.sendReaction(id);
  const toggleMic = () =>
    void guest.current
      ?.setMicrophone(!stateRef.current.mic)
      .catch((cause) =>
        setState((s) => ({ ...s, message: t(microphoneFailure(cause)) })),
      );
  const actions = useRef({
    openMenu,
    resume,
    leave,
    closeSetup,
    openChat,
    closeChat,
    react,
  });
  actions.current = {
    openMenu,
    resume,
    leave,
    closeSetup,
    openChat,
    closeChat,
    react,
  };
  // A controller unplugged mid-setup must not leave play paused.
  useEffect(() => {
    if (setup && !unmapped) actions.current.closeSetup();
  }, [setup, unmapped]);
  const activate = () => {
    void video.current
      ?.play()
      .then(() => setPlay(false))
      .catch(() => setPlay(true));
  };
  useEffect(() => {
    const release = acquirePartyInput();
    let cancelled = false;
    const session = new PartyGuest(setState, (stream) => {
      if (video.current) video.current.srcObject = stream;
      if (stream) activate();
    });
    guest.current = session;
    void joinFriendRoom(friend.id)
      .then((room) => {
        if (!cancelled) session.start(room);
      })
      .catch((cause) => {
        if (!cancelled)
          setState({
            phase: "error",
            connectedOnce: false,
            message: accountFailure(cause).message,
          });
      });
    return () => {
      cancelled = true;
      session.leave();
      guest.current = null;
      release();
    };
  }, [friend.id]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      // Keys typed into the chat box are text, not presses.
      // Capturing them here also keeps the input's own handlers out, so Esc is read here.
      if (chatRef.current) {
        event.stopImmediatePropagation();
        if (event.code === "Escape" && event.type === "keydown") {
          event.preventDefault();
          actions.current.closeChat();
        }
        return;
      }
      // Capture every shortcut, including launcher keys that are not game bindings.
      event.stopImmediatePropagation();
      if (event.code === "Escape") {
        event.preventDefault();
        if (event.type === "keydown" && !event.repeat) {
          if (setupRef.current) actions.current.closeSetup();
          else if (paused.current) actions.current.resume();
          else actions.current.openMenu();
        }
        return;
      }
      if (
        paused.current ||
        ["error", "ended", "left"].includes(stateRef.current.phase)
      ) {
        // Keep native keyboard focus and button activation inside the guest screen.
        if (event.code === "Tab" && event.type === "keydown") {
          event.preventDefault();
          const buttons = Array.from(
            root.current?.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ) ?? [],
          ).filter((b) => b.getClientRects().length && !b.closest("[inert]"));
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          buttons[
            (index + (event.shiftKey ? -1 : 1) + buttons.length) %
              buttons.length
          ]?.focus();
        } else if (event.code === "Enter" || event.code === "Space") {
          event.preventDefault();
          if (
            event.type === "keydown" &&
            !event.repeat &&
            document.activeElement instanceof HTMLButtonElement &&
            root.current?.contains(document.activeElement)
          )
            document.activeElement.click();
        }
        return;
      }
      event.preventDefault();
      if (event.type === "keydown" && event.code === "KeyT" && !event.repeat) {
        actions.current.openChat();
        return;
      }
      const digit = /^Digit([1-6])$/.exec(event.code);
      if (
        event.type === "keydown" &&
        digit &&
        !event.repeat &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        actions.current.react(PARTY_REACTIONS[Number(digit[1]) - 1].id);
        return;
      }
      if (event.type === "keydown" && partyKeys[event.code] !== undefined)
        held.current.set(event.code, partyKeys[event.code]);
      else if (event.type === "keyup") held.current.delete(event.code);
      sample();
    };
    const clear = () => {
      held.current.clear();
      guest.current?.setInput(neutralPad());
    };
    const exitGesture = new PartyExitGesture();
    let previousMenuButtons = false;
    function sample() {
      const active = !document.hidden && document.hasFocus();
      // Standard pads read directly; others once the player has mapped them.
      const found = pickPad(navigator.getGamepads?.() ?? [], (id) => {
        if (!mappings.current.has(id))
          mappings.current.set(id, loadMapping(id));
        return mappings.current.get(id) ?? null;
      });
      const pad = found.pad;
      const missing = found.unmapped?.id ?? null;
      if (missing !== unmappedRef.current) {
        unmappedRef.current = missing;
        setUnmapped(missing);
      }
      const combo =
        active && !!pad?.buttons[8]?.pressed && !!pad?.buttons[9]?.pressed;
      if (exitGesture.sample(combo, performance.now()))
        actions.current.openMenu();
      const dialog =
        paused.current ||
        ["error", "ended", "left"].includes(stateRef.current.phase);
      if (dialog && active && !combo) {
        const pressed = !!pad?.buttons.some(
          (b, i) => [0, 1, 12, 13, 14, 15].includes(i) && b.pressed,
        );
        if (pressed && !previousMenuButtons) {
          const buttons = Array.from(
            root.current?.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ) ?? [],
          ).filter((b) => b.getClientRects().length && !b.closest("[inert]"));
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          if (pad?.buttons[0]?.pressed) {
            if (index >= 0) buttons[index].click();
            else buttons[0]?.focus();
          } else if (pad?.buttons[1]?.pressed && paused.current)
            actions.current.resume();
          else
            buttons[
              (index +
                (pad?.buttons[12]?.pressed || pad?.buttons[14]?.pressed
                  ? -1
                  : 1) +
                buttons.length) %
                buttons.length
            ]?.focus();
        }
        previousMenuButtons = pressed;
      } else previousMenuButtons = true;
      guest.current?.setInput(
        readPartyPad(
          held.current.values(),
          pad,
          active && !dialog && !chatRef.current && !exitGesture.latched,
        ),
      );
    }
    let frame = 0;
    const poll = () => {
      sample();
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", key, true);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", key, true);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
      clear();
    };
  }, []);
  useEffect(() => {
    if (menu)
      root.current
        ?.querySelector<HTMLButtonElement>(".party-guest-menu button")
        ?.focus();
  }, [menu]);
  const failed = ["error", "ended", "left"].includes(state.phase);
  return (
    <section
      className="party-guest"
      ref={root}
      aria-label={t("Jogando no Party de {name}", { name })}
    >
      <video ref={video} autoPlay playsInline className="party-guest-video" />
      <header className="party-guest-bar" inert={menu}>
        <AccountAvatar avatar={friend.avatar} size={36} />
        <div>
          <strong>{t("Jogando no Party de {name}", { name })}</strong>
          <span role="status">
            {state.player ? `J${state.player} · ` : ""}
            {t(labels[state.phase])}
          </span>
        </div>
        <small>
          {t("Esc ou segure Start + Select por 1 s para abrir o menu")}
        </small>
        {unmapped && !setup && (
          <button
            className="button"
            onClick={openSetup}
            title={t(
              "Este controle não foi reconhecido. Configure os botões uma vez.",
            )}
          >
            {t("Configurar controle")}
          </button>
        )}
        <button
          className="button secondary"
          onClick={() =>
            void (
              document.fullscreenElement
                ? document.exitFullscreen()
                : root.current!.requestFullscreen()
            ).catch(() =>
              setState((s) => ({
                ...s,
                message: t("Tela cheia indisponível neste aplicativo."),
              })),
            )
          }
        >
          {t("Tela cheia")}
        </button>
        {state.player && (
          <button className="button secondary" onClick={openChat}>
            {t("Chat (T)")}
          </button>
        )}
        {state.player && state.live && (
          <button
            className="button secondary"
            aria-pressed={reacting}
            onClick={() => setReacting((value) => !value)}
          >
            {t("Reagir")}
          </button>
        )}
        {state.player && state.voice && (
          <button
            className="button secondary"
            aria-pressed={Boolean(state.mic)}
            onClick={toggleMic}
          >
            {state.mic ? t("Microfone ligado") : t("Ligar microfone")}
          </button>
        )}
        <button className="button secondary" onClick={openMenu}>
          {t("Sair")}
        </button>
      </header>
      {state.player && !failed && (
        <>
          <PartySpeakers speakers={state.speakers ?? []} />
          <PartyReactionFloat items={state.reactions ?? []} />
          {reacting && !menu && (
            <div className="party-guest-reactions">
              <PartyReactionTray onPick={react} shortcuts />
            </div>
          )}
        </>
      )}
      {state.player && !failed && (
        <PartyChat
          lines={state.chat ?? []}
          open={chat && !menu}
          onSend={(text) => guest.current?.sendChat(text)}
          onClose={closeChat}
        />
      )}
      {play && !failed && (
        <button
          className="button party-guest-play"
          inert={menu}
          onClick={activate}
        >
          {t("Ativar imagem e som")}
        </button>
      )}
      {(!state.connectedOnce || failed || state.phase === "disconnected") && (
        <div className="party-guest-status" inert={menu}>
          <p>{state.message ?? t(labels[state.phase])}</p>
          {failed && (
            <button className="button" onClick={leave}>
              {t("Voltar aos amigos")}
            </button>
          )}
          {failed && !state.connectedOnce && (
            <button
              className="button secondary"
              onClick={() =>
                void checkPartyAvailable(friend)
                  .then(() => joinFriendParty(friend.id))
                  .then(leave)
                  .catch((cause) =>
                    setState((s) => ({
                      ...s,
                      message: accountFailure(cause).message,
                    })),
                  )
              }
            >
              {t("Abrir no navegador")}
            </button>
          )}
        </div>
      )}
      {state.message && state.connectedOnce && !failed && (
        <p className="party-guest-notice">{state.message}</p>
      )}
      {setup && unmapped && (
        <PartyPadSetup
          padId={unmapped}
          onDone={closeSetup}
          onCancel={closeSetup}
        />
      )}
      {menu && (
        <div className="party-guest-shade">
          <div
            className="party-guest-menu"
            role="dialog"
            aria-modal="true"
            aria-label={t("Menu do Party")}
          >
            <h2>{t("Menu do Party")}</h2>
            <button className="button" onClick={resume}>
              {t("Continuar")}
            </button>
            <button className="button secondary" onClick={leave}>
              {t("Sair do Party")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
