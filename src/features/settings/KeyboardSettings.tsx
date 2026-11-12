import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { t } from "../../i18n";
import type { AppSettings } from "../../types";
import {
  KEY_ACTIONS,
  KEY_GROUPS,
  assignKey,
  keyFromCode,
  keyLabel,
  partyClash,
  reservedReason,
  resolveLayout,
  type KeyActionId,
  type KeyboardBindings,
  type KeyGroup,
} from "./keyboardBindings";

const groupOf = (id: KeyActionId) =>
  KEY_GROUPS.find(
    (group) => group.id === KEY_ACTIONS.find((a) => a.id === id)?.group,
  )!;

/** "Analógico esquerdo › Cima", or just "A" for a button. */
function actionName(id: KeyActionId): string {
  const action = KEY_ACTIONS.find((a) => a.id === id)!;
  const group = groupOf(id);
  return group.id === "face" || group.id === "shoulder"
    ? action.label
    : `${group.label} › ${action.label}`;
}

/** Configurações › Teclado: player 1's keys in the integrated runtime. A
 * button listens for the next key; a key another action had is swapped, so
 * the layout never binds one key twice. */
export function KeyboardSettings({
  settings,
  save,
}: {
  settings: AppSettings;
  save: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  const saved = settings.keyboardBindings as KeyboardBindings | undefined;
  const layout = resolveLayout(saved);
  const changed = Object.keys(saved ?? {}).length > 0;
  const [listening, setListening] = useState<KeyActionId>();
  // Shown under the group that changed, or by the restore button.
  const [message, setMessage] = useState<{ group?: KeyGroup; text: string }>({
    text: "",
  });
  const say = (text: string, action?: KeyActionId) =>
    setMessage({ group: action && groupOf(action).id, text });

  useEffect(() => {
    if (!listening) return;
    const onKey = (event: KeyboardEvent) => {
      // The key is the game's now: no shortcut, focus move or scroll.
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (event.code === "Escape") {
        setListening(undefined);
        say("");
        return;
      }
      const key = keyFromCode(event.code);
      if (!key) {
        say(t("O runtime não reconhece essa tecla. Escolha outra."), listening);
        return;
      }
      const reserved = reservedReason(key);
      if (reserved) {
        say(reserved, listening);
        return;
      }
      const action = listening;
      const holder = KEY_ACTIONS.find(
        (other) => other.id !== action && layout[other.id] === key,
      );
      setListening(undefined);
      const notes: string[] = [];
      if (holder)
        notes.push(
          t("{other} ficou com {key}, que era de {action}.", {
            other: actionName(holder.id),
            key: keyLabel(layout[action]),
            action: actionName(action),
          }),
        );
      if (partyClash(key))
        notes.push(
          key === "t"
            ? t("Durante a Party, T também abre o chat.")
            : t("Durante a Party, M também liga e desliga o microfone."),
        );
      say(notes.join(" "), action);
      void save({ keyboardBindings: assignKey(saved, action, key) });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening, layout, saved, save]);

  return (
    <>
      <p className="settings-group-note key-bindings-note">
        {t(
          "As teclas do jogador 1 nos jogos do runtime integrado, do NES ao PS2. Clique em um botão e aperte a tecla nova; Esc cancela. Vale a partir do próximo jogo aberto. PS3 e Switch usam os controles do próprio emulador.",
        )}
      </p>
      {KEY_GROUPS.map((group) => (
        <section className="settings-group" key={group.id}>
          <h3>{group.label}</h3>
          <div className="key-bindings">
            {KEY_ACTIONS.filter((action) => action.group === group.id).map(
              (action) => {
                const active = listening === action.id;
                return (
                  <div className="key-binding" key={action.id}>
                    <span>{action.label}</span>
                    <button
                      className={`key-binding-key${active ? " listening" : ""}`}
                      aria-label={t("{action}: {key}. Clique para trocar.", {
                        action: actionName(action.id),
                        key: keyLabel(layout[action.id]),
                      })}
                      aria-pressed={active}
                      onClick={() => {
                        say("");
                        setListening(active ? undefined : action.id);
                      }}
                      onBlur={() => {
                        if (active) setListening(undefined);
                      }}
                    >
                      {active ? (
                        t("Aperte uma tecla…")
                      ) : (
                        <kbd>{keyLabel(layout[action.id])}</kbd>
                      )}
                    </button>
                  </div>
                );
              },
            )}
          </div>
          {message.group === group.id && message.text && (
            <p className="key-bindings-message" role="status">
              {message.text}
            </p>
          )}
        </section>
      ))}
      <section className="settings-group">
        <h3>{t("Atalhos fixos")}</h3>
        <p className="settings-group-note">
          {t(
            "F1 abre o menu do jogo, F2 e F4 salvam e carregam o estado, F6 e F7 trocam o slot e F8 tira uma captura. Essas teclas não podem ir para o jogo.",
          )}
        </p>
        <div className="key-bindings-actions">
          <button
            className="button secondary"
            disabled={!changed}
            onClick={() => {
              setListening(undefined);
              say(t("As teclas voltaram ao padrão."));
              void save({ keyboardBindings: {} });
            }}
          >
            <RotateCcw size={15} /> {t("Restaurar teclas padrão")}
          </button>
          {!message.group && message.text && (
            <span className="key-bindings-message" role="status">
              {message.text}
            </span>
          )}
        </div>
      </section>
    </>
  );
}
