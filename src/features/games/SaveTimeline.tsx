import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History, ImageOff, LoaderCircle, Play, Trash2 } from "lucide-react";
import type { LibraryGame, SaveState } from "../../types";
import { bridge, isDesktop } from "../../services/bridge";
import { formatBytes, formatRelative } from "../../utils/format";

export const saveStatesKey = (id: string) => ["save-states", id];

function dayLabel(date: Date, now = new Date()) {
  const day = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(now) - day(date)) / 86400000);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Ontem";
  return date.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function slotLabel(slot: number) {
  return slot < 0 ? "Retomada automática" : `Slot ${slot}`;
}

/** Groups states by calendar day, keeping the newest-first order. */
export function groupByDay(states: SaveState[], now = new Date()) {
  const groups: { label: string; states: SaveState[] }[] = [];
  for (const state of states) {
    const label = dayLabel(new Date(state.modifiedAt), now);
    const last = groups.at(-1);
    if (last?.label === label) last.states.push(state);
    else groups.push({ label, states: [state] });
  }
  return groups;
}

export function SaveTimeline({
  entry,
  running,
  onPlay,
  notify,
}: {
  entry: LibraryGame;
  running: boolean;
  onPlay: (slot: number) => void;
  notify: (message: string) => void;
}) {
  const client = useQueryClient();
  const states = useQuery({
    queryKey: saveStatesKey(entry.item.id),
    queryFn: () => bridge.saveStates(entry.item.id),
    enabled: isDesktop,
  });
  const [confirmDelete, setConfirmDelete] = useState<number>();
  const [deleting, setDeleting] = useState(false);
  async function remove(slot: number) {
    setDeleting(true);
    try {
      await bridge.deleteSaveState(entry.item.id, slot);
      await client.invalidateQueries({
        queryKey: saveStatesKey(entry.item.id),
      });
      notify(`${slotLabel(slot)} apagado.`);
    } catch (e) {
      notify(String(e));
    } finally {
      setDeleting(false);
      setConfirmDelete(undefined);
    }
  }
  if (!isDesktop)
    return (
      <div className="empty-inline">
        <p>A linha do tempo de saves está disponível no aplicativo desktop.</p>
      </div>
    );
  if (states.isLoading)
    return (
      <div className="catalog-loading">
        <LoaderCircle className="spin" size={22} />
        <p>Procurando seus saves…</p>
      </div>
    );
  if (states.error)
    return (
      <div className="empty-inline">
        <p>{String(states.error)}</p>
      </div>
    );
  if (!states.data?.length)
    return (
      <div className="empty-inline save-timeline-empty">
        <History size={28} />
        <p>Nenhum estado salvo ainda.</p>
        <small>
          Durante o jogo, abra o menu do OpenRetro e escolha “Salvar estado” (ou
          pressione F2). Ao encerrar o jogo, a retomada automática também
          aparece aqui.
        </small>
      </div>
    );
  const newest = states.data[0];
  return (
    <div className="save-timeline">
      {groupByDay(states.data).map((group) => (
        <section key={group.label}>
          <h3>{group.label}</h3>
          <ol>
            {group.states.map((state) => {
              const date = new Date(state.modifiedAt);
              return (
                <li key={state.slot} className="save-state">
                  <div className="save-state-thumb">
                    {state.thumbnail ? (
                      <img src={state.thumbnail} alt="" />
                    ) : (
                      <ImageOff size={22} />
                    )}
                    {state === newest && <span>Mais recente</span>}
                  </div>
                  <div className="save-state-copy">
                    <strong>{slotLabel(state.slot)}</strong>
                    <span>
                      {formatRelative(date)} ·{" "}
                      {date.toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · {formatBytes(state.size)}
                    </span>
                  </div>
                  {confirmDelete === state.slot ? (
                    <div className="save-state-actions">
                      <button
                        className="button secondary"
                        disabled={deleting}
                        onClick={() => setConfirmDelete(undefined)}
                      >
                        Manter
                      </button>
                      <button
                        className="button danger"
                        disabled={deleting}
                        onClick={() => void remove(state.slot)}
                      >
                        Apagar de vez
                      </button>
                    </div>
                  ) : (
                    <div className="save-state-actions">
                      <button
                        className="button primary"
                        disabled={running}
                        onClick={() => onPlay(state.slot)}
                      >
                        <Play size={16} fill="currentColor" /> Jogar daqui
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Apagar ${slotLabel(state.slot)}`}
                        disabled={running}
                        onClick={() => setConfirmDelete(state.slot)}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
