import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ArrowLeft, MessageCircle, RotateCw, Send } from "lucide-react";
import {
  messagesStore,
  refreshConversations,
  watchThread,
  loadOlder,
  sendMessage,
  draftLength,
  draftProblem,
  startsGroup,
  unreadTotal,
  MAX_MESSAGE,
  type DirectMessage,
  type MessagePeer,
} from "../../services/messages";
import { socialStore, sortFriends } from "../../services/social";
import { AccountAvatar } from "./accountAvatars";
import { t, locale } from "../../i18n";
import "./Messages.css";

const nameOf = (peer: MessagePeer) => peer.displayName ?? peer.friendCode;
function when(time: number, now = Date.now()) {
  const date = new Date(time);
  const today = new Date(now).toDateString() === date.toDateString();
  return today
    ? date.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(locale(), { day: "2-digit", month: "short" });
}

/** Conversations with friends: the list, or one conversation when `peer` is set. */
export function Messages({
  peer,
  onPeer,
  onProfile,
}: {
  peer?: string;
  onPeer: (id: string | undefined) => void;
  onProfile: (id: string) => void;
}) {
  return peer ? (
    <ChatThread
      key={peer}
      peerId={peer}
      onBack={() => onPeer(undefined)}
      onProfile={onProfile}
    />
  ) : (
    <ConversationList onPeer={onPeer} />
  );
}

function ConversationList({ onPeer }: { onPeer: (id: string) => void }) {
  const state = useSyncExternalStore(
    messagesStore.subscribe,
    messagesStore.snapshot,
  );
  const social = useSyncExternalStore(
    socialStore.subscribe,
    socialStore.snapshot,
  );
  const me = social.session.user?.id;
  useEffect(() => {
    void refreshConversations();
  }, []);
  // Friends without a conversation yet, to start one.
  const others = sortFriends(social.friends).filter(
    (friend) => !state.conversations.some((row) => row.peer.id === friend.id),
  );
  return (
    <div className="chat-list">
      {state.error && (
        <p className="social-banner is-error" role="alert">
          {t(state.error)}
        </p>
      )}
      {state.conversations.length > 0 && (
        <section className="social-section">
          <h3>{t("Conversas")}</h3>
          <ul>
            {state.conversations.map((row) => (
              <li key={row.peer.id}>
                <button
                  className={`chat-row${row.unread ? " is-unread" : ""}`}
                  onClick={() => onPeer(row.peer.id)}
                >
                  <AccountAvatar avatar={row.peer.avatar} size={40} />
                  <span className="social-row-text">
                    <strong>{nameOf(row.peer)}</strong>
                    <span className="chat-preview">
                      {row.last.senderId === me && `${t("Você")}: `}
                      {row.last.body}
                    </span>
                  </span>
                  <span className="chat-row-meta">
                    <time dateTime={new Date(row.last.createdAt).toISOString()}>
                      {when(row.last.createdAt)}
                    </time>
                    {row.unread > 0 && (
                      <b
                        className="social-badge"
                        aria-label={t("{count} mensagens não lidas", {
                          count: row.unread,
                        })}
                      >
                        {row.unread > 99 ? "99+" : row.unread}
                      </b>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {others.length > 0 && (
        <section className="social-section">
          <h3>{t("Começar conversa")}</h3>
          <ul>
            {others.map((friend) => (
              <li key={friend.id}>
                <button className="chat-row" onClick={() => onPeer(friend.id)}>
                  <AccountAvatar avatar={friend.avatar} size={40} />
                  <span className="social-row-text">
                    <strong>{friend.displayName ?? friend.friendCode}</strong>
                    <span>{friend.friendCode}</span>
                  </span>
                  <MessageCircle size={17} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {state.loaded && !state.conversations.length && !others.length && (
        <div className="social-activity-empty">
          <MessageCircle size={28} />
          <strong>{t("Nenhuma conversa ainda")}</strong>
          <p>
            {t("Adicione amigos pelo código para conversar com eles por aqui.")}
          </p>
        </div>
      )}
    </div>
  );
}

function ChatThread({
  peerId,
  onBack,
  onProfile,
}: {
  peerId: string;
  onBack: () => void;
  onProfile: (id: string) => void;
}) {
  const state = useSyncExternalStore(
    messagesStore.subscribe,
    messagesStore.snapshot,
  );
  const social = useSyncExternalStore(
    socialStore.subscribe,
    socialStore.snapshot,
  );
  const thread = state.threads[peerId];
  const friend = social.friends.find((row) => row.id === peerId);
  const peer: MessagePeer | undefined =
    thread?.peer ??
    state.conversations.find((row) => row.peer.id === peerId)?.peer ??
    (friend && {
      id: friend.id,
      displayName: friend.displayName,
      friendCode: friend.friendCode,
      avatar: friend.avatar ?? 0,
    });
  const canSend = thread?.canSend ?? !!friend;
  const messages = thread?.messages ?? [];
  const me = social.session.user?.id;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const list = useRef<HTMLOListElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const pinned = useRef(true);
  const oldest = useRef<number | undefined>(undefined);
  useEffect(() => watchThread(peerId), [peerId]);
  useEffect(() => {
    input.current?.focus();
  }, []);
  // Stay at the newest message unless the player scrolled up to read.
  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    const first = messages[0]?.id;
    if (oldest.current !== undefined && first !== oldest.current) {
      oldest.current = first;
      return;
    }
    oldest.current = first;
    if (pinned.current) node.scrollTop = node.scrollHeight;
  }, [messages]);
  const length = draftLength(draft);
  async function send(retry?: DirectMessage) {
    if (!peer) return;
    const problem = retry ? "" : draftProblem(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    if (!retry) setDraft("");
    pinned.current = true;
    try {
      await sendMessage(peer, retry ? "" : draft, retry);
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : String(cause));
    }
  }
  const title = peer ? nameOf(peer) : t("Conversa");
  return (
    <div className="chat-thread">
      <div className="chat-head">
        <button
          className="icon-button"
          aria-label={t("Voltar às conversas")}
          onClick={onBack}
        >
          <ArrowLeft size={18} />
        </button>
        {peer && (
          <button
            className="chat-peer"
            aria-label={t("Perfil de {name}", { name: title })}
            onClick={() => onProfile(peer.id)}
          >
            <AccountAvatar avatar={peer.avatar} size={32} />
            <strong>{title}</strong>
          </button>
        )}
      </div>
      <ol
        className="chat-messages"
        ref={list}
        aria-label={t("Mensagens com {name}", { name: title })}
        aria-live="polite"
        aria-busy={thread?.loading}
        onScroll={(event) => {
          const node = event.currentTarget;
          pinned.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 48;
        }}
      >
        {thread?.more && (
          <li className="chat-older">
            <button
              className="button secondary"
              disabled={thread.loading}
              onClick={() => {
                pinned.current = false;
                void loadOlder(peerId);
              }}
            >
              {t("Carregar mensagens anteriores")}
            </button>
          </li>
        )}
        {!messages.length && !thread?.loading && !thread?.error && (
          <li className="chat-empty">
            {t("Diga oi para {name}!", { name: title })}
          </li>
        )}
        {messages.map((message, index) => {
          const mine = message.senderId !== peerId;
          return (
            <li
              key={message.clientId ?? message.id}
              className={`chat-message${mine ? " is-mine" : ""}${
                startsGroup(messages, index) ? " starts-group" : ""
              }${message.id < 0 ? " is-pending" : ""}${
                message.failed ? " is-failed" : ""
              }`}
            >
              <p>{message.body}</p>
              {message.failed ? (
                <button
                  className="chat-retry"
                  onClick={() => void send(message)}
                >
                  <RotateCw size={12} />
                  {t("Não enviada. Tentar de novo")}
                </button>
              ) : (
                <time dateTime={new Date(message.createdAt).toISOString()}>
                  {message.id < 0 ? t("Enviando…") : when(message.createdAt)}
                </time>
              )}
            </li>
          );
        })}
      </ol>
      {(error || thread?.error) && (
        <p className="social-banner is-error" role="alert">
          {t(error || thread?.error || "")}
        </p>
      )}
      {canSend && me ? (
        <form
          className="chat-compose"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={input}
            rows={1}
            value={draft}
            aria-label={t("Mensagem para {name}", { name: title })}
            placeholder={t("Escreva uma mensagem")}
            onChange={(event) => {
              setDraft(event.target.value);
              setError("");
            }}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter starts a new line.
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send();
              }
            }}
          />
          {length > MAX_MESSAGE - 50 && (
            <span
              className={`chat-count${length > MAX_MESSAGE ? " is-over" : ""}`}
              aria-live="polite"
            >
              {MAX_MESSAGE - length}
            </span>
          )}
          <button
            className="icon-button chat-send"
            aria-label={t("Enviar mensagem")}
            disabled={!length || length > MAX_MESSAGE}
          >
            <Send size={18} />
          </button>
        </form>
      ) : (
        thread &&
        !thread.loading && (
          <p className="chat-readonly">
            {t(
              "Vocês não são mais amigos. A conversa fica disponível só para leitura.",
            )}
          </p>
        )
      )}
    </div>
  );
}

/** Unread messages, beside the account button. */
export function ChatUnreadBadge() {
  const state = useSyncExternalStore(
    messagesStore.subscribe,
    messagesStore.snapshot,
  );
  const count = unreadTotal(state.conversations);
  return count ? (
    <b
      className="chat-unread-badge"
      aria-label={t("{count} mensagens não lidas", { count })}
      title={t("{count} mensagens não lidas", { count })}
    >
      <MessageCircle size={11} aria-hidden="true" />
      {count > 99 ? "99+" : count}
    </b>
  ) : null;
}
