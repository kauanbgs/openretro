import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeft,
  Check,
  Clock3,
  Copy,
  Gamepad2,
  LockKeyhole,
  RefreshCw,
  Settings,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";
import {
  publicProfile,
  socialStore,
  friendAction,
  checkPartyAvailable,
  type Friend,
  type FriendAction,
  type UserProfileData,
} from "../../services/social";
import { accountApi, accountFailure } from "../../services/account";
import { AccountAvatar } from "./accountAvatars";
import { AccountSettings } from "../account/AccountSettings";
import { PartyDialog } from "../party/PartyDialog";
import { t } from "../../i18n";
import "./UserProfile.css";

export function UserProfile({
  userId,
  onBack,
  onJoinParty,
  notify,
}: {
  userId: string;
  onBack: () => void;
  onJoinParty: (friend: Friend) => void;
  notify: (message: string) => void;
}) {
  const social = useSyncExternalStore(
    socialStore.subscribe,
    socialStore.snapshot,
  );
  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [party, setParty] = useState(false);
  const [confirm, setConfirm] = useState<"remove" | "block" | null>(null);
  const [reload, setReload] = useState(0);
  const version = useRef(0);
  const back = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const self = social.session.user?.id === userId;
  const friend = social.friends.find((f) => f.id === userId);
  const relationship = friend
    ? "friend"
    : social.incoming.some((f) => f.id === userId)
      ? "incoming"
      : social.outgoing.some((f) => f.id === userId)
        ? "outgoing"
        : "none";
  const blocked = social.blocked.some((f) => f.id === userId);
  useEffect(() => {
    back.current?.focus();
    setEditing(false);
    setParty(false);
    setConfirm(null);
  }, [userId]);
  useEffect(() => {
    if (confirm) cancel.current?.focus();
  }, [confirm]);
  useEffect(() => {
    const revision = ++version.current;
    setProfile(null);
    setError("");
    setLoading(true);
    if (!social.session.hasSession) {
      setLoading(false);
      return;
    }
    void publicProfile(userId)
      .then((data) => {
        if (revision === version.current) setProfile(data);
      })
      .catch((cause) => {
        if (revision === version.current)
          setError(accountFailure(cause).message);
      })
      .finally(() => {
        if (revision === version.current) setLoading(false);
      });
    return () => {
      ++version.current;
    };
  }, [
    userId,
    social.session.user?.id,
    social.session.hasSession,
    social.session.user?.shareHistory,
    relationship,
    blocked,
    reload,
  ]);
  useEffect(() => {
    const refresh = () => setReload((n) => n + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  async function run(work: () => Promise<void>) {
    if (busy) return;
    const revision = version.current;
    setBusy(true);
    setError("");
    try {
      await work();
      if (revision === version.current) {
        setConfirm(null);
        setReload((n) => n + 1);
      }
    } catch (cause) {
      if (revision === version.current) setError(accountFailure(cause).message);
    } finally {
      setBusy(false);
    }
  }
  const act = (action: FriendAction) =>
    run(async () => {
      // Recheck the current code and access before requesting a new friendship.
      const revision = version.current;
      const target =
        action === "request"
          ? (await publicProfile(userId)).friendCode
          : userId;
      if (revision !== version.current) return;
      await friendAction(action, target);
      setConfirm(null);
    });
  const name = profile?.displayName ?? profile?.friendCode ?? "";
  const presence = self
    ? {
        status:
          social.session.user?.appearOffline || !social.connected
            ? "offline"
            : "online",
        playing: profile?.presence.playing ?? null,
        party: profile?.presence.party ?? null,
      }
    : (friend?.presence ?? (friend ? profile?.presence : undefined));
  const playing = presence?.status !== "offline" ? presence?.playing : null;
  const joinable =
    !!friend && presence?.status !== "offline" && !!presence?.party?.joinable;
  const canSeeHistory =
    self || (relationship === "friend" && profile?.historyVisible);
  const date = (value: number) =>
    new Date(value).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  const shelf = canSeeHistory ? (profile?.recentGames ?? []) : [];
  const featured = shelf.reduce<(typeof shelf)[number] | undefined>(
    (best, game) =>
      !best || game.playSeconds > best.playSeconds ? game : best,
    undefined,
  );
  const totalSeconds = shelf.reduce((sum, game) => sum + game.playSeconds, 0);
  const consoles = new Set(shelf.map((game) => game.console)).size;
  const duration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    return minutes >= 60
      ? t("{hours} h {minutes} min", {
          hours: Math.floor(minutes / 60),
          minutes: minutes % 60,
        })
      : t("{minutes} min", { minutes });
  };
  return (
    <section
      className="user-profile"
      aria-label={self ? t("Meu perfil") : t("Perfil de {name}", { name })}
    >
      <div className="profile-toolbar">
        <button
          ref={back}
          className="icon-button profile-back"
          aria-label={t("Voltar")}
          onClick={onBack}
        >
          <ArrowLeft size={16} />
        </button>
        <strong>{name || t("Perfil")}</strong>
        <button
          className="icon-button"
          aria-label={t("Atualizar perfil")}
          disabled={loading || busy}
          onClick={() => setReload((n) => n + 1)}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      {error && (
        <p className="social-banner is-error" role="alert">
          {t(error)}
        </p>
      )}
      {!social.session.hasSession && <AccountSettings notify={notify} />}
      {loading && <p role="status">{t("Carregando perfil…")}</p>}
      {profile && (
        <>
          <header className="profile-hero">
            {featured?.cover && (
              <img
                className="profile-backdrop"
                src={featured.cover}
                alt=""
                aria-hidden="true"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            )}
            <div className="profile-identity">
              <AccountAvatar
                avatar={self ? social.session.user?.avatar : profile.avatar}
                size={96}
              />
              <div>
                <h2>
                  {self ? (social.session.user?.displayName ?? name) : name}
                </h2>
                <button
                  className="profile-code"
                  onClick={() =>
                    void run(async () => {
                      await navigator.clipboard.writeText(profile.friendCode);
                      notify(t("Código de amigo copiado."));
                    })
                  }
                  aria-label={t("Copiar código de amigo")}
                >
                  {profile.friendCode}
                  <Copy size={14} />
                </button>
                <p className="profile-member">
                  {t("No OpenRetro desde {date}", {
                    date: date(profile.createdAt),
                  })}
                </p>
              </div>
            </div>
            <div className="profile-actions">
              {joinable && (
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const revision = version.current;
                      await checkPartyAvailable(friend!);
                      if (revision === version.current) onJoinParty(friend!);
                    })
                  }
                >
                  <Users size={17} />
                  {t("Entrar no Party")}
                </button>
              )}

              {self ? (
                <>
                  <button
                    className="button primary"
                    onClick={() => setParty(true)}
                  >
                    <Users size={17} />
                    {t("Meu Party")}
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => setEditing((value) => !value)}
                    aria-expanded={editing}
                  >
                    <Settings size={16} />
                    {t("Editar perfil")}
                  </button>
                </>
              ) : (
                <>
                  {relationship === "none" && (
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() => void act("request")}
                    >
                      <UserPlus size={17} />
                      {t("Enviar pedido de amizade")}
                    </button>
                  )}
                  {relationship === "outgoing" && (
                    <>
                      <span className="profile-relationship">
                        <Check size={16} />
                        {t("Pedido de amizade enviado")}
                      </span>
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => void act("cancel")}
                      >
                        {t("Cancelar pedido")}
                      </button>
                    </>
                  )}
                  {relationship === "incoming" && (
                    <>
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={() => void act("accept")}
                      >
                        <Check size={17} />
                        {t("Aceitar pedido")}
                      </button>
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => void act("decline")}
                      >
                        {t("Recusar pedido")}
                      </button>
                    </>
                  )}
                  {relationship === "friend" && (
                    <>
                      <span className="profile-relationship">
                        <Check size={16} />
                        {t("Vocês são amigos")}
                      </span>
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => setConfirm("remove")}
                      >
                        {t("Desfazer amizade")}
                      </button>
                    </>
                  )}
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setConfirm("block")}
                  >
                    {t("Bloquear")}
                  </button>
                </>
              )}
            </div>
            {confirm && (
              <div
                className="profile-confirm"
                role="group"
                aria-label={t("Confirmar ação")}
              >
                <p>
                  {confirm === "block"
                    ? t("Bloquear {name}?", { name })
                    : t("Desfazer amizade com {name}?", { name })}
                </p>
                <button
                  ref={cancel}
                  className="button secondary"
                  onClick={() => setConfirm(null)}
                >
                  {t("Cancelar")}
                </button>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void act(confirm)}
                >
                  {t("Confirmar")}
                </button>
              </div>
            )}
          </header>
          {editing && self && (
            <div className="profile-settings">
              <AccountSettings notify={notify} />
            </div>
          )}
          <div className="profile-body">
            <section className="profile-now">
              <div className="profile-section-title">
                <Gamepad2 size={20} />
                <h3>{t("Atividade")}</h3>
              </div>
              <span
                className={`profile-status ${presence?.status !== "offline" && (self || relationship === "friend") ? "is-online" : ""}`}
              >
                {self || relationship === "friend"
                  ? presence?.status === "offline"
                    ? t("Offline")
                    : presence?.status === "idle"
                      ? t("Ausente")
                      : t("Online")
                  : t("Status disponível para amigos")}
              </span>
              {playing && (
                <>
                  <h4>{playing.title}</h4>
                  <p>{playing.console}</p>
                </>
              )}
              <p>
                {self
                  ? t("Abra seu Party para jogar junto com amigos.")
                  : joinable
                    ? t("Tem um lugar para você no Party.")
                    : relationship === "friend"
                      ? t("Nenhum Party disponível no momento.")
                      : t(
                          "Adicione este jogador para acompanhar seu status e jogar junto.",
                        )}
              </p>
              {self && (
                <div className="profile-history-privacy">
                  <div>
                    <strong>{t("Compartilhar histórico com amigos")}</strong>
                    <p>
                      {t(
                        "Só você e seus amigos podem ver estes jogos. Você pode ocultá-los.",
                      )}
                    </p>
                  </div>
                  <button
                    className={`switch ${social.session.user?.shareHistory !== false ? "on" : ""}`}
                    role="switch"
                    aria-label={t("Compartilhar histórico com amigos")}
                    aria-checked={social.session.user?.shareHistory !== false}
                    disabled={busy || !social.session.online}
                    onClick={() =>
                      void run(async () => {
                        await accountApi.profile({
                          shareHistory:
                            social.session.user?.shareHistory === false,
                        });
                      })
                    }
                  >
                    <span />
                  </button>
                </div>
              )}
            </section>
            <section className="profile-history">
              <div className="profile-section-title">
                <h3>{t("Últimos jogos jogados")}</h3>
                <span className="profile-game-count">
                  {canSeeHistory ? (
                    profile.recentGames.length
                  ) : (
                    <LockKeyhole size={14} />
                  )}
                </span>
              </div>
              {!canSeeHistory ? (
                <div className="profile-empty">
                  <LockKeyhole size={25} />
                  <p>
                    {t(
                      "Este histórico é privado ou está disponível apenas para amigos.",
                    )}
                  </p>
                </div>
              ) : profile.recentGames.length ? (
                <>
                  <dl className="profile-stats">
                    <div>
                      <dt>{t("Tempo de jogo")}</dt>
                      <dd>{duration(totalSeconds)}</dd>
                    </div>
                    <div>
                      <dt>{t("Jogos")}</dt>
                      <dd>{profile.recentGames.length}</dd>
                    </div>
                    <div>
                      <dt>{t("Consoles")}</dt>
                      <dd>{consoles}</dd>
                    </div>
                  </dl>
                  <ol className="profile-games">
                    {profile.recentGames.map((game) => (
                      <li
                        key={JSON.stringify([game.title, game.console])}
                        className={game === featured ? "is-featured" : ""}
                      >
                        <div className="profile-game-cover">
                          <span
                            className="profile-game-fallback"
                            aria-hidden="true"
                          >
                            <Gamepad2 size={36} />
                            <span>{game.title}</span>
                          </span>
                          {game.cover ? (
                            <img
                              src={game.cover}
                              alt={game.title}
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          ) : null}
                        </div>
                        <div className="profile-game-info">
                          {game === featured && (
                            <span className="profile-game-badge">
                              <Trophy size={13} />
                              {t("Mais jogado")}
                            </span>
                          )}
                          <h4>{game.title}</h4>
                          <p>{game.console}</p>
                          <small>
                            {game.playSeconds >= 60 && (
                              <>
                                <Clock3 size={11} />
                                {duration(game.playSeconds)}
                                {" · "}
                              </>
                            )}
                            {date(game.lastPlayedAt)}
                          </small>
                        </div>
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <div className="profile-empty">
                  <Gamepad2 size={28} />
                  <p>
                    {self
                      ? t(
                          "Seus próximos jogos aparecerão aqui. Hora de começar uma partida!",
                        )
                      : t("Este jogador ainda não tem jogos recentes.")}
                  </p>
                </div>
              )}
            </section>
          </div>
        </>
      )}
      {party && (
        <PartyDialog
          onClose={() => setParty(false)}
          onSignIn={() => setParty(false)}
        />
      )}
    </section>
  );
}
