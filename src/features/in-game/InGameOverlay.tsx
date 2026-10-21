import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  Play,
  RotateCcw,
  Save,
  Square,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { bridge } from "../../services/bridge";
import type { SaveState } from "../../types";
import { formatRelative } from "../../utils/format";
import "./InGameOverlay.css";

interface Session {
  id: string;
  title: string;
  open: boolean;
  slot: number;
}
const actions = [
  { id: "resume", label: "Continuar jogando", icon: Play },
  { id: "save", label: "Salvar estado", icon: Save },
  { id: "load", label: "Carregar estado", icon: Upload },
  { id: "screenshot", label: "Tirar screenshot", icon: Camera },
  { id: "undo_load", label: "Desfazer carregamento", icon: Undo2 },
  { id: "reset", label: "Reiniciar jogo", icon: RotateCcw },
  { id: "quit", label: "Encerrar jogo", icon: Square },
];
export function InGameOverlay() {
  const [session, setSession] = useState<Session | null>(null);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<"load" | "reset" | "quit">();
  const [confirmed, setConfirmed] = useState(false);
  const [states, setStates] = useState<SaveState[]>([]);
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
      setSession(payload);
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
            save: "Solicitação de salvamento enviada ao jogo.",
            load: "Solicitação de carregamento enviada ao jogo.",
            screenshot:
              "Solicitação de captura enviada. Confira em Minhas capturas.",
            reset: "Reiniciando o jogo…",
            quit: "Encerrando o jogo…",
            undo_load: "Solicitação para desfazer carregamento enviada.",
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
    if (key === "left" && session.slot > 0) void run("slot_previous");
    if (key === "right" && session.slot < 99) void run("slot_next");
  };
  if (!session?.open) return null;
  return (
    <div className="game-menu-scene">
      <section
        className="game-menu-panel"
        aria-label="Menu do jogo"
        role="dialog"
        aria-modal="true"
      >
        <header>
          <span>
            <Gamepad2 size={22} /> OpenRetro
          </span>
          <button
            aria-label="Continuar jogando"
            onClick={() => void run("resume")}
          >
            <X size={22} />
          </button>
        </header>
        <h1>{session.title}</h1>
        <p className="game-menu-paused">Jogo pausado</p>
        <div className="game-menu-slot">
          <span>Slot do estado</span>
          <button
            disabled={busy || session.slot === 0}
            aria-label="Slot anterior"
            onClick={() => void run("slot_previous")}
          >
            <ChevronLeft size={19} />
          </button>
          <strong>{session.slot}</strong>
          <button
            disabled={busy || session.slot === 99}
            aria-label="Próximo slot"
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
              ? `Salvo ${formatRelative(new Date(slotState.modifiedAt))}`
              : "Slot vazio"}
          </p>
        </div>
        {confirmation ? (
          <div className="game-menu-confirm">
            <h2>
              {confirmation === "load"
                ? "Carregar este estado?"
                : confirmation === "reset"
                  ? "Reiniciar o jogo?"
                  : "Encerrar o jogo?"}
            </h2>
            <p>O progresso que não foi salvo pode ser perdido.</p>
            <button
              className={!confirmed ? "selected" : ""}
              onClick={() => setConfirmation(undefined)}
            >
              Cancelar
            </button>
            <button
              className={confirmed ? "selected" : ""}
              onClick={() => void run(confirmation)}
              disabled={busy}
            >
              Confirmar
            </button>
          </div>
        ) : (
          <nav>
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
        <p className="game-menu-message" role="status">
          {busy
            ? "Enviando comando…"
            : message ||
              "Estados dependem do suporte do core. Use ← / → para mudar o slot."}
        </p>
        <div className="game-menu-links">
          <button
            onClick={() =>
              void bridge
                .openGameScreenshots(session.id)
                .catch((error) => setMessage(String(error)))
            }
          >
            Minhas capturas
          </button>
          <button
            onClick={() =>
              void invoke("open_steam_controller_settings")
                .then(() =>
                  setMessage(
                    "Na Steam, desligue ‘Botão Guia coloca a Steam em foco’. Depois volte ao jogo.",
                  ),
                )
                .catch((error) => setMessage(String(error)))
            }
          >
            Conflito com Steam?
          </button>
        </div>
        <footer>
          A confirma · B continua · PS ou Share + Options abre/fecha
        </footer>
      </section>
    </div>
  );
}
