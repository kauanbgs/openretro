import { useEffect, useState, useSyncExternalStore } from "react";
import { Bell, BellOff, CheckCheck, X } from "lucide-react";
import {
  socialActivityStore,
  readSocialActivity,
  clearSocialActivity,
  setSocialActivityPreference,
  type ActivityKind,
} from "../../services/socialActivity";
import { AccountAvatar } from "./accountAvatars";
import { partyOwnsInput } from "../party/partyInput";
import { t, locale } from "../../i18n";
import "./SocialActivity.css";

export function SocialActivity() {
  const state = useSyncExternalStore(
    socialActivityStore.subscribe,
    socialActivityStore.snapshot,
  );
  useEffect(() => {
    readSocialActivity();
  }, [state.entries[0]?.id]);
  return (
    <div className="social-activity">
      <div className="social-activity-tools">
        <strong>{t("Atividade recente")}</strong>
        <button
          className="icon-button"
          title={t("Limpar atividade")}
          aria-label={t("Limpar atividade")}
          disabled={!state.entries.length}
          onClick={clearSocialActivity}
        >
          <CheckCheck size={18} />
        </button>
      </div>
      <details className="social-notification-settings">
        <summary>
          <Bell size={15} />
          {t("Preferências de avisos")}
        </summary>
        <p>{t("Escolha quais atividades deseja receber neste dispositivo.")}</p>
        {(
          [
            ["game", "Amigos iniciando jogos"],
            ["party", "Amigos abrindo Party"],
            ["friendship", "Pedidos e novas amizades"],
            ["online", "Amigos ficando online"],
          ] as [ActivityKind, string][]
        ).map(([kind, label]) => (
          <label key={kind}>
            <span>{t(label)}</span>
            <input
              type="checkbox"
              checked={state.preferences[kind]}
              onChange={(e) =>
                setSocialActivityPreference(kind, e.target.checked)
              }
            />
          </label>
        ))}
      </details>
      {state.entries.length ? (
        <ol className="social-activity-list">
          {state.entries.map((entry) => (
            <li key={entry.id}>
              <AccountAvatar avatar={entry.avatar} size={36} />
              <div>
                <p>{entry.message}</p>
                <time dateTime={new Date(entry.createdAt).toISOString()}>
                  {new Date(entry.createdAt).toLocaleTimeString(locale(), {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="social-activity-empty">
          <BellOff size={28} />
          <strong>{t("Tudo em dia por aqui")}</strong>
          <p>
            {t(
              "Quando seus amigos começarem a jogar ou abrirem um Party, você verá aqui.",
            )}
          </p>
        </div>
      )}
    </div>
  );
}

export function SocialNotice({
  onOpen,
}: {
  onOpen: (view: "friends" | "activity") => void;
}) {
  const state = useSyncExternalStore(
    socialActivityStore.subscribe,
    socialActivityStore.snapshot,
  );
  const latest = state.entries[0];
  const [dismissed, setDismissed] = useState(0);
  const [expired, setExpired] = useState(0);
  useEffect(() => {
    if (!latest) return;
    const remaining = 7000 - (Date.now() - latest.createdAt);
    if (remaining <= 0) {
      setExpired(latest.id);
      return;
    }
    const timer = setTimeout(() => setExpired(latest.id), remaining);
    return () => clearTimeout(timer);
  }, [latest?.id]);
  if (
    !latest ||
    latest.id <= dismissed ||
    latest.id <= expired ||
    latest.read ||
    partyOwnsInput()
  )
    return null;
  return (
    <aside className="social-notice" aria-label={t("Nova atividade de amigos")}>
      <AccountAvatar avatar={latest.avatar} size={40} />
      <div role="status">
        <strong>{latest.name}</strong>
        <p>{latest.message}</p>
        <button
          onClick={() => {
            setDismissed(latest.id);
            onOpen(latest.kind === "party" ? "friends" : "activity");
          }}
        >
          {latest.kind === "party"
            ? t("Ver Party nos amigos")
            : t("Ver atividade")}
        </button>
      </div>
      <button
        className="icon-button"
        aria-label={t("Dispensar aviso")}
        onClick={() => setDismissed(latest.id)}
      >
        <X size={16} />
      </button>
    </aside>
  );
}
export function SocialUnreadBadge() {
  const state = useSyncExternalStore(
    socialActivityStore.subscribe,
    socialActivityStore.snapshot,
  );
  const count = state.entries.filter((e) => !e.read).length;
  return count ? (
    <b
      className="social-activity-badge"
      aria-label={t("{count} atividades não lidas", { count })}
    >
      {count}
    </b>
  ) : null;
}
