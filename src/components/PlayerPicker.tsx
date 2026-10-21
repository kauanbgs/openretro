import { useEffect, useRef, useState, type RefObject } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, UserRound } from "lucide-react";
import { bridge } from "../services/bridge";
import { Modal } from "./Modal";

export function PlayerPicker({
  onClose,
  input,
}: {
  onClose: () => void;
  input?: RefObject<((key: string) => boolean) | null>;
}) {
  const client = useQueryClient();
  const { data, error: queryError } = useQuery({
    queryKey: ["players"],
    queryFn: bridge.profiles,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const buttons = useRef<HTMLDivElement>(null);
  const index = useRef(0);
  async function select(id: string) {
    setBusy(true);
    setError("");
    try {
      await bridge.selectProfile(id);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["players"] }),
        client.invalidateQueries({ queryKey: ["library"] }),
      ]);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      await bridge.createProfile(`Jogador ${data.players.length + 1}`);
      await client.invalidateQueries({ queryKey: ["players"] });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const items = () =>
      Array.from(
        buttons.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      );
    index.current = Math.max(
      0,
      data?.players.findIndex((p) => p.id === data.activeId) ?? 0,
    );
    items()[index.current]?.focus();
    const handler = (key: string) => {
      if (busy) return true;
      const nodes = items();
      if (key === "b") onClose();
      if (["up", "down", "left", "right"].includes(key)) {
        index.current =
          (index.current +
            (["up", "left"].includes(key) ? -1 : 1) +
            nodes.length) %
          nodes.length;
        nodes[index.current]?.focus();
      }
      if (key === "a") nodes[index.current]?.click();
      return true;
    };
    if (input) input.current = handler;
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.key === "Enter" || event.key === " ") &&
        document.activeElement instanceof HTMLButtonElement
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        document.activeElement.click();
        return;
      }
      const key = (
        {
          ArrowUp: "up",
          ArrowDown: "down",
          ArrowLeft: "left",
          ArrowRight: "right",
          Enter: "a",
          Escape: "b",
        } as Record<string, string>
      )[event.key];
      if (key) {
        event.preventDefault();
        event.stopImmediatePropagation();
        handler(key);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      if (input?.current === handler) input.current = null;
      window.removeEventListener("keydown", onKey, true);
    };
  }, [data, busy, input, onClose]);
  return (
    <div className="tv-player-dialog">
      <Modal
        title="Quem vai jogar?"
        onClose={() => {
          if (!busy) onClose();
        }}
      >
        <p>
          Jogos compartilhados. Saves, favoritos e histórico de cada jogador
          ficam separados no runtime integrado. O Jogador 1 mantém seus saves
          existentes. Emuladores externos usam suas próprias configurações de
          saves.
        </p>
        <div className="player-picker" ref={buttons}>
          {data?.players.map((player, i) => (
            <button
              className="button secondary"
              key={player.id}
              disabled={busy}
              onFocus={() => {
                index.current = i;
              }}
              onClick={() => void select(player.id)}
            >
              <UserRound size={22} />
              {player.name}
              {data.activeId === player.id && <Check size={18} />}
            </button>
          ))}
          <button
            className="button secondary"
            disabled={busy || !data}
            onFocus={() => {
              index.current = data?.players.length ?? 0;
            }}
            onClick={() => void create()}
          >
            <Plus size={20} />
            Adicionar jogador
          </button>
        </div>
        <p>
          Durante o jogo, abra o menu do OpenRetro e encerre a sessão antes de
          trocar de jogador.
        </p>
        {(error || queryError) && (
          <p role="alert" className="error-text">
            {error || String(queryError)}
          </p>
        )}
      </Modal>
    </div>
  );
}
