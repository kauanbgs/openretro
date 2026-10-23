import { useEffect, useRef, useState, type RefObject } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus } from "lucide-react";
import { bridge } from "../services/bridge";
import type { PlayerProfile } from "../types";
import { Modal } from "./Modal";
import { PLAYER_AVATARS, PLAYER_COLORS, PlayerAvatar } from "./PlayerAvatar";
import { t } from "../i18n";

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
  const [editing, setEditing] = useState<PlayerProfile | null>(null);
  // Keyboard handlers are bound once per dialog state and read the live draft here.
  const draft = useRef(editing);
  draft.current = editing;
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
      await bridge.createProfile(
        t("Jogador {number}", { number: data.players.length + 1 }),
      );
      await client.invalidateQueries({ queryKey: ["players"] });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    const editing = draft.current;
    if (!editing?.name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await bridge.updateProfile(
        editing.id,
        editing.name,
        editing.avatar,
        editing.color,
      );
      await client.invalidateQueries({ queryKey: ["players"] });
      setEditing(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const editingId = editing?.id;
  useEffect(() => {
    const items = () =>
      Array.from(
        buttons.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      );
    index.current = editingId
      ? Math.max(
          0,
          items().findIndex((b) => b.getAttribute("aria-pressed") === "true"),
        )
      : Math.max(
          0,
          (data?.players.findIndex((p) => p.id === data.activeId) ?? 0) * 2,
        );
    items()[index.current]?.focus();
    const handler = (key: string) => {
      if (busy) return true;
      const nodes = items();
      if (key === "b") {
        if (editingId) setEditing(null);
        else onClose();
      }
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
      // The name field keeps normal text editing; only Escape and Enter leave it.
      if (event.target instanceof HTMLInputElement) {
        if (event.key === "Escape" || event.key === "Enter") {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (event.key === "Enter") void save();
          else setEditing(null);
        }
        return;
      }
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
  }, [data, busy, input, onClose, editingId]);
  return (
    <div className="tv-player-dialog">
      <Modal
        title={editing ? t("Personalizar jogador") : t("Quem vai jogar?")}
        onClose={() => {
          if (busy) return;
          if (editing) setEditing(null);
          else onClose();
        }}
      >
        {editing ? (
          <div className="player-editor" ref={buttons}>
            <div className="player-editor-preview">
              <PlayerAvatar player={editing} size={72} />
              <label>
                {t("Nome")}
                <input
                  value={editing.name}
                  maxLength={32}
                  onChange={(event) =>
                    setEditing({ ...editing, name: event.target.value })
                  }
                />
              </label>
            </div>
            <h3>{t("Avatar")}</h3>
            <div className="player-avatar-grid">
              {Object.entries(PLAYER_AVATARS).map(
                ([id, { icon: Icon, label }]) => (
                  <button
                    key={id}
                    aria-label={label}
                    aria-pressed={editing.avatar === id}
                    disabled={busy}
                    onClick={() => setEditing({ ...editing, avatar: id })}
                  >
                    <Icon size={22} />
                  </button>
                ),
              )}
            </div>
            <h3>{t("Cor")}</h3>
            <div className="player-color-grid">
              {PLAYER_COLORS.map((color) => (
                <button
                  key={color}
                  aria-label={t("Cor {color}", { color })}
                  aria-pressed={editing.color === color}
                  disabled={busy}
                  style={{ background: color }}
                  onClick={() => setEditing({ ...editing, color })}
                >
                  {editing.color === color && <Check size={18} />}
                </button>
              ))}
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                {t("Cancelar")}
              </button>
              <button
                className="button primary"
                disabled={busy || !editing.name.trim()}
                onClick={() => void save()}
              >
                {t("Salvar")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p>
              {t(
                "Jogos compartilhados. Saves, favoritos e histórico de cada jogador ficam separados no runtime integrado. O Jogador 1 mantém seus saves existentes. Emuladores externos usam suas próprias configurações de saves.",
              )}
            </p>
            <div className="player-picker" ref={buttons}>
              {data?.players.map((player, i) => (
                <div className="player-row" key={player.id}>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onFocus={() => {
                      index.current = i * 2;
                    }}
                    onClick={() => void select(player.id)}
                  >
                    <PlayerAvatar player={player} />
                    {player.name}
                    {data.activeId === player.id && <Check size={18} />}
                  </button>
                  <button
                    className="button secondary player-edit"
                    aria-label={t("Personalizar {name}", { name: player.name })}
                    disabled={busy}
                    onFocus={() => {
                      index.current = i * 2 + 1;
                    }}
                    onClick={() => {
                      setError("");
                      setEditing(player);
                    }}
                  >
                    <Pencil size={17} />
                  </button>
                </div>
              ))}
              <button
                className="button secondary"
                disabled={busy || !data}
                onFocus={() => {
                  index.current = (data?.players.length ?? 0) * 2;
                }}
                onClick={() => void create()}
              >
                <Plus size={20} />
                {t("Adicionar jogador")}
              </button>
            </div>
            <p>
              {t(
                "Durante o jogo, abra o menu do OpenRetro e encerre a sessão antes de trocar de jogador.",
              )}
            </p>
          </>
        )}
        {(error || queryError) && (
          <p role="alert" className="error-text">
            {error || String(queryError)}
          </p>
        )}
      </Modal>
    </div>
  );
}
