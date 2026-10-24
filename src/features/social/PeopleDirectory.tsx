import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronRight, RefreshCw, Users } from "lucide-react";
import {
  discoverPeople,
  socialStore,
  type PublicPerson,
} from "../../services/social";
import { accountApi, accountFailure } from "../../services/account";
import { AccountAvatar } from "./accountAvatars";
import { t } from "../../i18n";
import "./PeopleDirectory.css";

export function PeopleDirectory({
  onProfile,
}: {
  onProfile: (id: string) => void;
}) {
  const social = useSyncExternalStore(
    socialStore.subscribe,
    socialStore.snapshot,
  );
  const [people, setPeople] = useState<PublicPerson[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const pageVersion = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    setPeople([]);
    setLoaded(false);
    void load(null);
    return () => {
      mounted.current = false;
      ++pageVersion.current;
    };
  }, [social.session.user?.id]);
  async function load(after: string | null) {
    const version = ++pageVersion.current;
    setLoading(true);
    setError("");
    try {
      const page = await discoverPeople(after);
      if (!mounted.current || version !== pageVersion.current) return;
      setPeople((old) =>
        after
          ? [
              ...old,
              ...page.people.filter((p) => !old.some((f) => f.id === p.id)),
            ]
          : page.people,
      );
      setNext(page.next);
      setLoaded(true);
    } catch (cause) {
      if (mounted.current && version === pageVersion.current)
        setError(accountFailure(cause).message);
    } finally {
      if (mounted.current && version === pageVersion.current) setLoading(false);
    }
  }
  async function visibility() {
    setPrivacyBusy(true);
    setError("");
    try {
      await accountApi.profile({
        discoverable: social.session.user?.discoverable === false,
      });
    } catch (cause) {
      if (mounted.current) setError(accountFailure(cause).message);
    } finally {
      if (mounted.current) setPrivacyBusy(false);
    }
  }
  return (
    <div className="people-directory">
      {error && (
        <p className="social-banner is-error" role="alert">
          {t(error)}
        </p>
      )}
      <div className="people-heading">
        <div>
          <Users size={20} />
          <h3>{t("Conheça novas pessoas")}</h3>
        </div>
        <p>
          {t(
            "Jogadores do OpenRetro, em um só lugar. Veja um perfil e faça uma nova amizade.",
          )}
        </p>
      </div>
      <div className="people-visibility">
        <div>
          <strong>{t("Mostrar meu perfil aqui")}</strong>
          <small>
            {t(
              "Nome, ícone e código de amigo. Você pode se ocultar quando quiser.",
            )}
          </small>
        </div>
        <button
          className={`switch ${social.session.user?.discoverable !== false ? "on" : ""}`}
          role="switch"
          aria-label={t("Mostrar meu perfil aqui")}
          aria-checked={social.session.user?.discoverable !== false}
          disabled={privacyBusy || !social.session.online}
          onClick={() => void visibility()}
        >
          <span />
        </button>
      </div>
      <div className="people-list-tools">
        <span>{t("Todos os jogadores visíveis")}</span>
        <button
          className="icon-button"
          aria-label={t("Atualizar pessoas")}
          disabled={loading}
          onClick={() => void load(null)}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <ul className="people-list">
        {people.map((person) => (
          <li key={person.id}>
            <button
              data-person-id={person.id}
              onClick={() => onProfile(person.id)}
            >
              <AccountAvatar avatar={person.avatar} size={40} />
              <span>
                <strong>{person.displayName ?? person.friendCode}</strong>
                <small>{person.friendCode}</small>
              </span>
              <ChevronRight size={16} />
            </button>
          </li>
        ))}
      </ul>
      {loading && <p role="status">{t("Carregando pessoas…")}</p>}
      {loaded && !loading && !people.length && !error && (
        <p className="people-empty">
          {t(
            "Nenhum outro jogador está visível por aqui ainda. Volte mais tarde para conhecer novas pessoas.",
          )}
        </p>
      )}
      {next && !loading && (
        <button
          className="button secondary people-more"
          onClick={() => void load(next)}
        >
          {t("Ver mais pessoas")}
        </button>
      )}
    </div>
  );
}
