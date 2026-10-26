import { useEffect, useRef, useState } from "react";
import { invoke } from "../../services/transport";
import { listen } from "@tauri-apps/api/event";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  Monitor,
  Play,
  RotateCcw,
  Save,
  Square,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { bridge } from "../../services/bridge";
import { KeyboardMap } from "../../components/KeyboardMap";
import type { SaveState } from "../../types";
import { formatRelative } from "../../utils/format";
import "./InGameOverlay.css";
import { t } from "../../i18n";

interface Session {
  id: string;
  title: string;
  open: boolean;
  slot: number;
  viewAvailable: boolean;
  /** RetroAchievements hardcore: states save but never load. */
  hardcore: boolean;
  screenView: {
    layout: "full" | "sideBySide" | "stacked" | "grid";
    region: number;
    full: boolean;
  };
}
const baseActions = [
  { id: "resume", label: t("Continuar jogando"), icon: Play },
  { id: "save", label: t("Salvar estado"), icon: Save },
  { id: "load", label: t("Carregar estado"), icon: Upload },
  { id: "screenshot", label: t("Tirar screenshot"), icon: Camera },
  { id: "undo_load", label: t("Desfazer carregamento"), icon: Undo2 },
  { id: "reset", label: t("Reiniciar jogo"), icon: RotateCcw },
  { id: "quit", label: t("Encerrar jogo"), icon: Square },
];
export function InGameOverlay() {
  const [session, setSession] = useState<Session | null>(null);
  const latestSession = useRef(session);
  latestSession.current = session;
  const nav = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<"load" | "reset" | "quit">();
  const [confirmed, setConfirmed] = useState(false);
  const [states, setStates] = useState<SaveState[]>([]);
  const view = session?.screenView;
  const layoutLabels = {
    full: t("Tela inteira"),
    sideBySide: t("Esquerda / direita"),
    stacked: t("Cima / baixo"),
    grid: t("4 quadrantes"),
  };
  const regionLabels =
    view?.layout === "stacked"
      ? [t("Cima"), t("Baixo")]
      : view?.layout === "sideBySide"
        ? [t("Esquerda"), t("Direita")]
        : [
            t("Superior esquerda"),
            t("Superior direita"),
            t("Inferior esquerda"),
            t("Inferior direita"),
          ];
  const actions = session?.hardcore
    ? baseActions.filter(({ id }) => id !== "load" && id !== "undo_load")
    : [...baseActions];
  if (session?.viewAvailable && view) {
    actions.splice(
      1,
      0,
      {
        id: "view_layout",
        label: t("Tela dividida: {layout}", {
          layout: layoutLabels[view.layout],
        }),
        icon: Monitor,
      },
      ...(view.layout !== "full"
        ? [
            {
              id: "view_region",
              label: t("Minha região: {region}", {
                region: regionLabels[view.region - 1],
              }),
              icon: Monitor,
            },
            {
              id: "view_toggle",
              label: view.full ? t("Ver minha tela") : t("Ver tela inteira"),
              icon: Monitor,
            },
          ]
        : []),
    );
  }
  useEffect(() => {
    nav.current
      ?.querySelector(".selected")
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, session?.open, view?.layout]);
  const sessionId = session?.open ? session.id : undefined;
  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    const load = () =>
      bridge
        .saveStates(sessionId)
        .then((next) => active && setStates(next))
        .catch(() => {});
    void load();
    // The runtime writes the state file shortly after the save command.
    const timer = message.startsWith("Solicitação de salvamento")
      ? window.setTimeout(load, 900)
      : undefined;
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [sessionId, message]);
  const slotState = states.find((state) => state.slot === session?.slot);
  const handler = useRef<(key: string) => void>(() => {});
  useEffect(() => {
    document.documentElement.classList.add("in-game-overlay");
    void invoke<Session | null>("in_game_status").then(setSession);
    const state = listen<Session | null>("in-game-state", ({ payload }) => {
      const previous = latestSession.current;
      setSession(payload);
      if (!payload?.open || !previous?.open || previous.id !== payload.id)
        setSelected(0);
      setMessage("");
      setConfirmation(undefined);
    });
    const input = listen<string>("in-game-input", ({ payload }) =>
      handler.current(payload),
    );
    const onKey = (event: KeyboardEvent) => {
      const keys: Record<string, string> = {
        Escape: "b",
        Enter: "a",
        " ": "a",
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      if (keys[event.key]) {
        event.preventDefault();
        handler.current(keys[event.key]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      void state.then((stop) => stop());
      void input.then((stop) => stop());
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  async function run(action: string) {
    if (busy) return;
    if (["load", "reset", "quit"].includes(action) && !confirmation) {
      setConfirmation(action as "load" | "reset" | "quit");
      setConfirmed(false);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const next = await invoke<Session>("in_game_action", { action });
      setSession(next);
      setConfirmation(undefined);
      setMessage(
        (
          {
            save: t("Solicitação de salvamento enviada ao jogo."),
            load: t("Solicitação de carregamento enviada ao jogo."),
            screenshot: t(
              "Solicitação de captura enviada. Confira em Minhas capturas.",
            ),
            reset: t("Reiniciando o jogo…"),
            quit: t("Encerrando o jogo…"),
            undo_load: t("Solicitação para desfazer carregamento enviada."),
          } as Record<string, string>
        )[action] ?? "",
      );
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  handler.current = (key) => {
    if (busy || !session?.open) return;
    if (confirmation) {
      if (key === "b") setConfirmation(undefined);
      else if (["up", "down", "left", "right"].includes(key))
        setConfirmed((value) => !value);
      else if (key === "a") {
        if (confirmed) void run(confirmation);
        else setConfirmation(undefined);
      }
      return;
    }
    if (key === "b") void run("resume");
    if (key === "up") setSelected((value) => Math.max(0, value - 1));
    if (key === "down")
      setSelected((value) => Math.min(actions.length - 1, value + 1));
    if (key === "a") void run(actions[selected].id);
    const action = actions[selected]?.id;
    if (["left", "right"].includes(key) && action?.startsWith("view_"))
      void run(action);
    else {
      if (key === "left" && session.slot > 0) void run("slot_previous");
      if (key === "right" && session.slot < 99) void run("slot_next");
    }
  };
  if (!session?.open) return null;
  return (
    <div className="game-menu-scene">
      <section
        className="game-menu-panel"
        aria-label={t("Menu do jogo")}
        role="dialog"
        aria-modal="true"
      >
        <header>
          <span>
            <Gamepad2 size={22} /> {t("OpenRetro")}
          </span>
          <button
            aria-label={t("Continuar jogando")}
            onClick={() => void run("resume")}
          >
            <X size={22} />
          </button>
        </header>
        <h1>{session.title}</h1>
        <p className="game-menu-paused">
          {session.hardcore
            ? t("Jogo pausado · RetroAchievements hardcore")
            : t("Jogo pausado")}
        </p>
        <div className="game-menu-slot">
          <span>{t("Slot do estado")}</span>
          <button
            disabled={busy || session.slot === 0}
            aria-label={t("Slot anterior")}
            onClick={() => void run("slot_previous")}
          >
            <ChevronLeft size={19} />
          </button>
          <strong>{session.slot}</strong>
          <button
            disabled={busy || session.slot === 99}
            aria-label={t("Próximo slot")}
            onClick={() => void run("slot_next")}
          >
            <ChevronRight size={19} />
          </button>
        </div>
        <div className="game-menu-slot-preview">
          {slotState?.thumbnail ? (
            <img src={slotState.thumbnail} alt="" />
          ) : (
            <span aria-hidden="true" />
          )}
          <p>
            {slotState
              ? t("Salvo {when}", {
                  when: formatRelative(new Date(slotState.modifiedAt)),
                })
              : t("Slot vazio")}
          </p>
        </div>
        {confirmation ? (
          <div className="game-menu-confirm">
            <h2>
              {confirmation === "load"
                ? t("Carregar este estado?")
                : confirmation === "reset"
                  ? t("Reiniciar o jogo?")
                  : t("Encerrar o jogo?")}
            </h2>
            <p>{t("O progresso que não foi salvo pode ser perdido.")}</p>
            <button
              className={!confirmed ? "selected" : ""}
              onClick={() => setConfirmation(undefined)}
            >
              {t("Cancelar")}
            </button>
            <button
              className={confirmed ? "selected" : ""}
              onClick={() => void run(confirmation)}
              disabled={busy}
            >
              {t("Confirmar")}
            </button>
          </div>
        ) : (
          <nav ref={nav}>
            {actions.map((action, index) => (
              <button
                key={action.id}
                disabled={busy}
                className={`${selected === index ? "selected" : ""} ${action.id === "quit" ? "danger" : ""}`}
                onMouseEnter={() => setSelected(index)}
                onClick={() => void run(action.id)}
              >
                <action.icon size={20} />
                <span>{action.label}</span>
                {selected === index && <kbd>A</kbd>}
              </button>
            ))}
          </nav>
        )}
        {session.viewAvailable && (
          <p className="game-menu-view-hint">
            {t(
              "Tela dividida alterna entre esquerda/direita, cima/baixo e quadrantes. Escolha sua região e volte à tela inteira para ver menus e resultados. O recorte muda apenas a imagem neste PC e não troca seu jogador.",
            )}
          </p>
        )}
        <p className="game-menu-message" role="status">
          {busy
            ? t("Enviando comando…")
            : message ||
              t(
                "Estados dependem do suporte do core. Use ← / → para mudar o slot.",
              )}
        </p>
        {keyboard && <KeyboardMap />}
        <div className="game-menu-links">
          <button onClick={() => setKeyboard((value) => !value)}>
            {keyboard ? t("Esconder teclado") : t("Controles no teclado")}
          </button>
          <button
            onClick={() =>
              void bridge
                .openGameScreenshots(session.id)
                .catch((error) => setMessage(String(error)))
            }
          >
            {t("Minhas capturas")}
          </button>
          <button
            onClick={() =>
              void invoke("open_steam_controller_settings")
                .then(() =>
                  setMessage(
                    t(
                      "Na Steam, desligue ‘Botão Guia coloca a Steam em foco’. Depois volte ao jogo.",
                    ),
                  ),
                )
                .catch((error) => setMessage(String(error)))
            }
          >
            {t("Conflito com Steam?")}
          </button>
        </div>
        <footer>
          {t("A confirma · B continua · PS, Share + Options ou F1 abre/fecha")}
        </footer>
      </section>
    </div>
  );
}
