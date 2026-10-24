import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Ellipsis,
  Search,
  Settings,
  UserPlus,
  X,
} from "lucide-react";
import {
  socialStore,
  refreshFriends,
  friendAction,
  checkPartyAvailable,
  sortFriends,
  elapsedMinutes,
  type Friend,
  type FriendAction,
} from "../../services/social";
import { accountApi, accountFailure } from "../../services/account";
import { AccountSettings } from "../account/AccountSettings";
import { PlayerAvatar } from "../../components/PlayerAvatar";
import { AccountAvatar, type PresenceStatus } from "./accountAvatars";
import type { PlayerProfile } from "../../types";
import { t } from "../../i18n";
import "./SocialPanel.css";
import { SocialActivity } from "./SocialActivity";
import { socialActivityStore } from "../../services/socialActivity";
import { UserProfile } from "./UserProfile";
import { PeopleDirectory } from "./PeopleDirectory";

type Kind = "friend" | "incoming" | "outgoing" | "blocked";

const nameOf = (friend: Friend) => friend.displayName ?? friend.friendCode;
const joinable = (friend: Friend) =>
  friend.presence?.status !== "offline" && !!friend.presence?.party?.joinable;
function statusOf(friend: Friend): PresenceStatus {
  const status = friend.presence?.status ?? "offline";
  return status !== "offline" && friend.presence?.playing ? "playing" : status;
}

/** The account and friends, opened from the account icon: a popover on the
 * desktop, a full page in Big Picture. Without an account it signs in. */
export function SocialPanel({
  notify,
  layout = "popover",
  player,
  onPlayers,
  onClose,
  onJoinParty,
  initialView = "friends",
  onProfile,
}: {
  notify: (message: string) => void;
  layout?: "popover" | "page";
  /** The local player on this PC, switched separately from the account. */
  player?: PlayerProfile | null;
  onPlayers?: () => void;
  onClose?: () => void;
  onJoinParty: (friend: Friend) => void;
  initialView?: "friends" | "activity" | "people";
  onProfile?: (id: string) => void;
}) {
  const state = useSyncExternalStore(
    socialStore.subscribe,
    socialStore.snapshot,
  );
  const [profileId, setProfileId] = useState<string>();
  const openProfile = onProfile ?? setProfileId;
  const user = state.session.user;
  const [view, setView] = useState<
    "friends" | "account" | "activity" | "people"
  >(initialView);
  useEffect(() => setView(initialView), [initialView]);
  const activity = useSyncExternalStore(
    socialActivityStore.subscribe,
    socialActivityStore.snapshot,
  );
  const unread = activity.entries.filter((e) => !e.read).length;
  const needsProfile = state.session.hasSession && !!user && !user.displayName;
  const accountView =
    !state.session.hasSession || needsProfile || view === "account";
  useEffect(() => {
    if (layout !== "popover" || !onClose) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [layout, onClose]);
  const title = !state.session.hasSession
    ? t("Jogue com seus amigos")
    : needsProfile
      ? t("Crie seu perfil")
      : view === "account"
        ? t("Sua conta")
        : t("Amigos");
  if (profileId && !accountView)
    return (
      <UserProfile
        userId={profileId}
        onBack={() => setProfileId(undefined)}
        onJoinParty={onJoinParty}
        notify={notify}
      />
    );
  return (
    <section
      className={`social-panel layout-${layout}`}
      role={layout === "popover" ? "dialog" : undefined}
      aria-label={title}
    >
      <header className="social-head">
        {view === "account" && !needsProfile && state.session.hasSession && (
          <button
            className="icon-button"
            aria-label={t("Voltar aos amigos")}
            onClick={() => setView("friends")}
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <h2>{title}</h2>
        {onClose && layout === "popover" && (
          <button
            className="icon-button"
            aria-label={t("Fechar")}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        )}
      </header>
      {!accountView && (
        <nav className="social-tabs" aria-label={t("Área social")}>
          <button
            aria-pressed={view === "friends"}
            onClick={() => setView("friends")}
          >
            {t("Amigos")}
          </button>
          <button
            aria-pressed={view === "activity"}
            onClick={() => setView("activity")}
          >
            {t("Atividade")}
            {unread > 0 && <b>{unread}</b>}
          </button>
          <button
            aria-pressed={view === "people"}
            onClick={() => setView("people")}
          >
            {t("Conhecer")}
          </button>
        </nav>
      )}
      <div className="social-body">
        {accountView ? (
          <div className="social-account">
            {!state.session.hasSession && (
              <div className="social-welcome" aria-hidden="true">
                <AccountAvatar avatar={3} size={46} />
                <AccountAvatar avatar={0} size={58} />
                <AccountAvatar avatar={7} size={46} />
              </div>
            )}
            {!state.session.hasSession && (
              <p className="social-welcome-text">
                {t(
                  "Veja o que seus amigos estão jogando e entre no Party deles com um clique.",
                )}
              </p>
            )}
            <AccountSettings notify={notify} />
          </div>
        ) : view === "activity" ? (
          <SocialActivity />
        ) : view === "people" ? (
          <PeopleDirectory onProfile={openProfile} />
        ) : (
          <Friends
            notify={notify}
            onProfile={openProfile}
            onAccount={() => setView("account")}
            onJoinParty={onJoinParty}
          />
        )}
      </div>
      {onPlayers && (
        <footer className="social-local">
          <PlayerAvatar player={player} size={30} />
          <span>
            <small>{t("Jogador neste PC")}</small>
            <strong>{player?.name ?? t("Jogador 1")}</strong>
          </span>
          <button className="button secondary" onClick={onPlayers}>
            {t("Trocar")}
          </button>
        </footer>
      )}
    </section>
  );
}

function Friends({
  notify,
  onProfile,
  onAccount,
  onJoinParty,
}: {
  notify: (message: string) => void;
  onProfile: (id: string) => void;
  onAccount: () => void;
  onJoinParty: (friend: Friend) => void;
}) {
  const state = useSyncExternalStore(
    socialStore.subscribe,
    socialStore.snapshot,
  );
  const user = state.session.user;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [adding, setAdding] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({
    requests: false,
    offline: false,
    blocked: false,
  });
  const [confirm, setConfirm] = useState<{
    action: FriendAction;
    friend: Friend;
  }>();
  const addInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [, setClock] = useState(0);
  useEffect(() => {
    void refreshFriends();
    const timer = setInterval(() => setClock((value) => value + 1), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (adding) addInput.current?.focus();
  }, [adding]);
  useEffect(() => {
    if (searching) searchInput.current?.focus();
  }, [searching]);
  useEffect(() => {
    if (confirm) cancelRef.current?.focus();
  }, [confirm]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(accountFailure(cause).message);
    } finally {
      setBusy(false);
    }
  }
  const act = (action: FriendAction, target: string) =>
    run(async () => {
      await friendAction(action, target);
      setConfirm(undefined);
      setMenu(undefined);
      if (action === "request") {
        setCode("");
        setAdding(false);
        notify(t("Pedido de amizade enviado."));
      }
    });
  const join = (friend: Friend) =>
    run(async () => {
      await checkPartyAvailable(friend);
      onJoinParty(friend);
    });
  const appearOffline = (value: boolean) =>
    run(async () => {
      await accountApi.profile({ appearOffline: value });
    });
  async function copy() {
    try {
      await navigator.clipboard.writeText(user?.friendCode ?? "");
      setCopied(true);
    } catch {
      setError(t("Selecione e copie seu código de amigo."));
    }
  }
  const normalize = (text: string) =>
    text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase();
  const matches = (friend: Friend) =>
    normalize(
      [nameOf(friend), friend.friendCode, friend.presence?.playing?.title].join(
        " ",
      ),
    ).includes(normalize(query.trim()));
  const sorted = sortFriends(state.friends).filter(matches);
  const parties = sorted.filter(joinable);
  const online = sorted.filter(
    (friend) => friend.presence && friend.presence.status !== "offline",
  );
  const offline = sorted.filter(
    (friend) => !friend.presence || friend.presence.status === "offline",
  );
  const toggle = (key: string) =>
    setOpen((previous) => ({ ...previous, [key]: !previous[key] }));
  const myStatus: PresenceStatus = user?.appearOffline
    ? "offline"
    : state.connected
      ? "online"
      : "idle";

  function detail(friend: Friend, kind: Kind) {
    if (kind !== "friend") return friend.friendCode;
    const presence = friend.presence;
    const status = presence?.status ?? "offline";
    if (status === "offline") return t("Offline");
    const game = presence?.playing;
    const playing = game
      ? `${game.title} — ${game.console} · ${t("há {minutes} min", {
          minutes: elapsedMinutes(game.startedAt),
        })}`
      : status === "idle"
        ? t("Ausente")
        : t("Online");
    return joinable(friend) ? (
      <>
        <b className="social-available">{t("Disponível")}</b> · {playing}
      </>
    ) : (
      playing
    );
  }

  function row(friend: Friend, kind: Kind) {
    const name = nameOf(friend);
    const menuId = `social-menu-${kind}-${friend.id}`;
    const game =
      kind === "friend" && friend.presence?.status !== "offline"
        ? friend.presence?.playing
        : null;
    return (
      <li
        key={friend.id}
        className={`social-row${
          kind === "blocked" ||
          (kind === "friend" &&
            (friend.presence?.status ?? "offline") === "offline")
            ? " is-dim"
            : ""
        }`}
      >
        <button
          className="social-profile-avatar"
          disabled={kind === "blocked"}
          aria-label={t("Perfil de {name}", { name })}
          onClick={() => onProfile(friend.id)}
        >
          <AccountAvatar
            avatar={friend.avatar}
            size={38}
            status={kind === "friend" ? statusOf(friend) : undefined}
          />
        </button>
        <span className="social-row-text">
          <button
            className="social-profile-name"
            disabled={kind === "blocked"}
            onClick={() => onProfile(friend.id)}
          >
            {name}
          </button>
          <span>{detail(friend, kind)}</span>
        </span>
        {game?.cover && (
          <img
            className="social-cover"
            src={game.cover}
            alt={t("Capa de {title}", { title: game.title })}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(event) => {
              event.currentTarget.hidden = true;
            }}
          />
        )}
        <span className="social-row-actions">
          {kind === "friend" && joinable(friend) && (
            <button
              className="button primary social-join"
              disabled={busy}
              onClick={() => void join(friend)}
            >
              {t("Entrar")}
            </button>
          )}
          {kind === "incoming" && (
            <>
              <button
                className="icon-button social-accept"
                aria-label={t("Aceitar pedido de {name}", { name })}
                disabled={busy}
                onClick={() => void act("accept", friend.id)}
              >
                <Check size={17} />
              </button>
              <button
                className="icon-button"
                aria-label={t("Recusar pedido de {name}", { name })}
                disabled={busy}
                onClick={() => void act("decline", friend.id)}
              >
                <X size={17} />
              </button>
            </>
          )}
          <button
            className="icon-button social-more"
            aria-label={t("Opções de {name}", { name })}
            aria-expanded={menu === menuId}
            aria-controls={menuId}
            onClick={() => setMenu(menu === menuId ? undefined : menuId)}
          >
            <Ellipsis size={18} />
          </button>
        </span>
        {menu === menuId && (
          <div className="social-menu" id={menuId}>
            {kind === "outgoing" && (
              <button
                disabled={busy}
                onClick={() => void act("cancel", friend.id)}
              >
                {t("Cancelar pedido")}
              </button>
            )}
            {kind === "blocked" && (
              <button
                disabled={busy}
                onClick={() => void act("unblock", friend.id)}
              >
                {t("Desbloquear")}
              </button>
            )}
            {kind === "friend" && (
              <button
                disabled={busy}
                onClick={() => setConfirm({ action: "remove", friend })}
              >
                {t("Desfazer amizade")}
              </button>
            )}
            {kind !== "blocked" && (
              <button
                className="danger"
                disabled={busy}
                onClick={() => setConfirm({ action: "block", friend })}
              >
                {t("Bloquear")}
              </button>
            )}
          </div>
        )}
      </li>
    );
  }

  return (
    <div className="social-friends" aria-busy={busy}>
      <div className="social-me">
        <button
          className="social-profile-avatar"
          aria-label={t("Meu perfil")}
          onClick={() => user && onProfile(user.id)}
        >
          <AccountAvatar avatar={user?.avatar} size={48} status={myStatus} />
        </button>
        <span className="social-me-text">
          <button
            className="social-profile-name"
            onClick={() => user && onProfile(user.id)}
          >
            {user?.displayName}
            <span className="social-own-profile-label">
              {t("Ver meu perfil")}
            </span>
          </button>
          <button
            className="social-code"
            title={t("Copiar código de amigo")}
            onClick={() => void copy()}
          >
            {user?.friendCode}
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </span>
        <select
          className="social-status"
          aria-label={t("Seu status")}
          value={user?.appearOffline ? "offline" : "online"}
          disabled={busy || !state.session.online}
          onChange={(event) =>
            void appearOffline(event.target.value === "offline")
          }
        >
          <option value="online">{t("Online")}</option>
          <option value="offline">{t("Aparecer offline")}</option>
        </select>
        <button
          className="icon-button"
          aria-label={t("Sua conta")}
          onClick={onAccount}
        >
          <Settings size={18} />
        </button>
      </div>
      {!state.connected && (
        <p className="social-banner" role="status">
          {t("Reconectando aos amigos… Seus jogos continuam disponíveis.")}
        </p>
      )}
      {(error || state.error) && (
        <p className="social-banner is-error" role="alert">
          {t(error || state.error)}
        </p>
      )}
      {confirm && (
        <div
          className="social-confirm"
          role="group"
          aria-label={t("Confirmar ação")}
        >
          <strong>
            {confirm.action === "block"
              ? t("Bloquear {name}", { name: nameOf(confirm.friend) })
              : t("Desfazer amizade com {name}", {
                  name: nameOf(confirm.friend),
                })}
          </strong>
          <p>
            {confirm.action === "block"
              ? t(
                  "A amizade, os pedidos e a presença serão removidos entre vocês.",
                )
              : t("Vocês deixarão de ver a presença um do outro.")}
          </p>
          <div>
            <button
              className="button secondary"
              ref={cancelRef}
              disabled={busy}
              onClick={() => setConfirm(undefined)}
            >
              {t("Cancelar")}
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() => void act(confirm.action, confirm.friend.id)}
            >
              {t("Confirmar")}
            </button>
          </div>
        </div>
      )}
      {parties.length > 0 && (
        <section className="social-section">
          <h3>
            {t("Partys abertos")}
            <span className="social-count">{parties.length}</span>
          </h3>
          <ul>{parties.map((friend) => row(friend, "friend"))}</ul>
        </section>
      )}
      <section className="social-section">
        <h3>
          {t("Amizades")}
          <span className="social-tools">
            <button
              className="icon-button"
              aria-label={t("Adicionar amigo")}
              aria-expanded={adding}
              onClick={() => setAdding((value) => !value)}
            >
              <UserPlus size={17} />
            </button>
            <button
              className="icon-button"
              aria-label={t("Buscar amigos")}
              aria-expanded={searching}
              onClick={() => {
                setSearching((value) => !value);
                setQuery("");
              }}
            >
              <Search size={17} />
            </button>
          </span>
        </h3>
        {adding && (
          <form
            className="social-add"
            onSubmit={(event) => {
              event.preventDefault();
              void act("request", code.trim());
            }}
          >
            <input
              ref={addInput}
              aria-label={t("Código do amigo")}
              value={code}
              maxLength={40}
              autoComplete="off"
              spellCheck={false}
              placeholder={t("nome#ab12")}
              onChange={(event) => setCode(event.target.value)}
            />
            <button className="button primary" disabled={busy || !code.trim()}>
              {t("Enviar pedido")}
            </button>
          </form>
        )}
        {searching && (
          <label className="social-search">
            <Search size={15} />
            <input
              ref={searchInput}
              aria-label={t("Buscar amigos")}
              placeholder={t("Buscar amigos")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        )}
        {state.incoming.length + state.outgoing.length > 0 && !query.trim() && (
          <>
            <button
              className="social-requests"
              aria-expanded={open.requests}
              onClick={() => toggle("requests")}
            >
              <span className="social-stack" aria-hidden="true">
                {[...state.incoming, ...state.outgoing]
                  .slice(0, 2)
                  .map((friend) => (
                    <AccountAvatar
                      key={friend.id}
                      avatar={friend.avatar}
                      size={26}
                    />
                  ))}
              </span>
              <span className="social-row-text">
                <strong>{t("Solicitações de amizade")}</strong>
                <span>
                  {[...state.incoming, ...state.outgoing]
                    .slice(0, 3)
                    .map(nameOf)
                    .join(", ")}
                </span>
              </span>
              {state.incoming.length > 0 && (
                <span className="social-badge">{state.incoming.length}</span>
              )}
              {open.requests ? (
                <ChevronDown size={17} />
              ) : (
                <ChevronRight size={17} />
              )}
            </button>
            {open.requests && (
              <div className="social-nested">
                {state.incoming.length > 0 && (
                  <>
                    <h4>{t("Recebidas")}</h4>
                    <ul>
                      {state.incoming.map((friend) => row(friend, "incoming"))}
                    </ul>
                  </>
                )}
                {state.outgoing.length > 0 && (
                  <>
                    <h4>{t("Enviadas")}</h4>
                    <ul>
                      {state.outgoing.map((friend) => row(friend, "outgoing"))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </>
        )}
        {online.length > 0 ? (
          <ul>{online.map((friend) => row(friend, "friend"))}</ul>
        ) : (
          <p className="social-empty">
            {query.trim()
              ? t("Nenhum amigo encontrado.")
              : state.friends.length
                ? t("Nenhum amigo online agora.")
                : t(
                    "Adicione amigos pelo código para ver o que estão jogando.",
                  )}
          </p>
        )}
      </section>
      {offline.length > 0 && (
        <section className="social-section">
          <button
            className="social-group-toggle"
            aria-expanded={open.offline}
            onClick={() => toggle("offline")}
          >
            {open.offline ? (
              <ChevronDown size={16} />
            ) : (
              <ChevronRight size={16} />
            )}
            {t("Offline")}
            <span className="social-count">{offline.length}</span>
          </button>
          {open.offline && (
            <ul>{offline.map((friend) => row(friend, "friend"))}</ul>
          )}
        </section>
      )}
      {state.blocked.length > 0 && !query.trim() && (
        <section className="social-section">
          <button
            className="social-group-toggle"
            aria-expanded={open.blocked}
            onClick={() => toggle("blocked")}
          >
            {open.blocked ? (
              <ChevronDown size={16} />
            ) : (
              <ChevronRight size={16} />
            )}
            {t("Bloqueados")}
            <span className="social-count">{state.blocked.length}</span>
          </button>
          {open.blocked && (
            <ul>{state.blocked.map((friend) => row(friend, "blocked"))}</ul>
          )}
        </section>
      )}
    </div>
  );
}
