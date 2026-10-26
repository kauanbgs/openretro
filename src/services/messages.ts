// Direct messages between friends. The PC holds the session; the social
// socket only says which conversation changed, and this store fetches it.
import { invoke } from "./transport";
import { accountFailure } from "./account";
import { socialStore } from "./social";
import { t } from "../i18n";

export const MAX_MESSAGE = 400;
export interface MessagePeer {
  id: string;
  displayName: string | null;
  friendCode: string;
  avatar: number;
}
export interface DirectMessage {
  id: number;
  senderId: string;
  body: string;
  createdAt: number;
  /** Set while a message of ours waits for the server (negative id). */
  clientId?: string;
  failed?: boolean;
}
export interface Conversation {
  peer: MessagePeer;
  canSend: boolean;
  unread: number;
  last: DirectMessage;
}
export interface Thread {
  peer: MessagePeer;
  canSend: boolean;
  messages: DirectMessage[];
  more: boolean;
}
export interface ThreadState extends Partial<Thread> {
  loading: boolean;
  error: string;
}
export interface MessagesState {
  conversations: Conversation[];
  loaded: boolean;
  error: string;
  threads: Record<string, ThreadState>;
}

/** The text as the server stores it. */
export function cleanDraft(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
export const draftLength = (text: string) => [...cleanDraft(text)].length;
/** Why a draft cannot be sent, or "" when it can. */
export function draftProblem(text: string) {
  const clean = cleanDraft(text);
  if (!clean) return t("Escreva uma mensagem.");
  if ([...clean].length > MAX_MESSAGE)
    return t("A mensagem pode ter até {max} caracteres.", {
      max: MAX_MESSAGE,
    });
  if (clean.split("\n").length > 12) return t("Mensagem inválida.");
  return "";
}
/** Server messages in id order, then our pending ones in the order sent. */
export function mergeMessages(
  current: DirectMessage[],
  incoming: DirectMessage[],
) {
  const byId = new Map<number, DirectMessage>();
  for (const message of [...current, ...incoming])
    if (message.id > 0) byId.set(message.id, message);
  const pending = current.filter(
    (message) =>
      message.id < 0 &&
      !incoming.some((other) => other.clientId === message.clientId),
  );
  return [...[...byId.values()].sort((a, b) => a.id - b.id), ...pending];
}
export const unreadTotal = (conversations: Conversation[]) =>
  conversations.reduce((sum, row) => sum + row.unread, 0);
/** The newest message from the peer, the one a read receipt points to. */
export function newestFrom(messages: DirectMessage[], peer: string) {
  return messages.reduce(
    (newest, message) =>
      message.senderId === peer && message.id > newest ? message.id : newest,
    0,
  );
}
/** Puts a conversation's newest message on top of the list. */
export function withLatest(
  conversations: Conversation[],
  peer: MessagePeer,
  canSend: boolean,
  last: DirectMessage,
): Conversation[] {
  const old = conversations.find((row) => row.peer.id === peer.id);
  if (old && old.last.id > last.id) return conversations;
  return [
    { peer, canSend, unread: old?.unread ?? 0, last },
    ...conversations.filter((row) => row.peer.id !== peer.id),
  ];
}
/** Messages within five minutes from the same sender share one header. */
export function startsGroup(
  messages: DirectMessage[],
  index: number,
  gap = 300000,
) {
  const previous = messages[index - 1],
    message = messages[index];
  return (
    !previous ||
    previous.senderId !== message.senderId ||
    message.createdAt - previous.createdAt > gap
  );
}

const empty = (): MessagesState => ({
  conversations: [],
  loaded: false,
  error: "",
  threads: {},
});
let state = empty();
const listeners = new Set<() => void>();
function update(patch: Partial<MessagesState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}
function patchThread(peer: string, patch: Partial<ThreadState>) {
  const old = state.threads[peer] ?? { loading: false, error: "" };
  update({ threads: { ...state.threads, [peer]: { ...old, ...patch } } });
}
export const messagesStore = {
  snapshot: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

// Conversations on screen; only those are marked as read.
const visible = new Map<string, number>();
const marked = new Map<string, number>();
let generation = 0,
  listVersion = 0;
const signedIn = () => socialStore.snapshot().session.hasSession;
const me = () => socialStore.snapshot().session.user?.id ?? "";

let announce: ((message: string) => void) | undefined;

export async function refreshConversations() {
  if (!signedIn()) return;
  const current = generation,
    version = ++listVersion;
  try {
    const { conversations } = await invoke<{ conversations: Conversation[] }>(
      "social_conversations",
    );
    if (current !== generation || version !== listVersion) return;
    const arrived = state.loaded
      ? conversations.find(
          (row) =>
            !visible.has(row.peer.id) &&
            row.last.senderId === row.peer.id &&
            row.unread >
              (state.conversations.find((old) => old.peer.id === row.peer.id)
                ?.unread ?? 0),
        )
      : undefined;
    if (arrived)
      announce?.(
        t("Nova mensagem de {name}", {
          name: arrived.peer.displayName ?? arrived.peer.friendCode,
        }),
      );
    update({
      // An open conversation is read as soon as it arrives.
      conversations: conversations.map((row) =>
        visible.has(row.peer.id) ? { ...row, unread: 0 } : row,
      ),
      loaded: true,
      error: "",
    });
  } catch (cause) {
    if (current === generation)
      update({ loaded: true, error: accountFailure(cause).message });
  }
}
async function markRead(peer: string) {
  const messages = state.threads[peer]?.messages ?? [];
  const newest = newestFrom(messages, peer);
  if (!newest || newest <= (marked.get(peer) ?? 0)) return;
  marked.set(peer, newest);
  update({
    conversations: state.conversations.map((row) =>
      row.peer.id === peer ? { ...row, unread: 0 } : row,
    ),
  });
  await invoke("social_read", { peer, lastId: newest }).catch(() => {
    marked.delete(peer);
  });
}
/** Loads the newest page and merges it into what is on screen. */
export async function loadThread(peer: string) {
  if (!signedIn()) return;
  const current = generation;
  patchThread(peer, { loading: true, error: "" });
  try {
    const thread = await invoke<Thread>("social_messages", { peer });
    if (current !== generation) return;
    const old = state.threads[peer];
    patchThread(peer, {
      ...thread,
      // Older pages already loaded stay; "more" belongs to the oldest page.
      more: old?.messages?.length ? old.more : thread.more,
      messages: mergeMessages(old?.messages ?? [], thread.messages),
      loading: false,
    });
    if (visible.has(peer)) await markRead(peer);
  } catch (cause) {
    if (current === generation)
      patchThread(peer, {
        loading: false,
        error: accountFailure(cause).message,
      });
  }
}
export async function loadOlder(peer: string) {
  const thread = state.threads[peer];
  const oldest = thread?.messages?.find((message) => message.id > 0);
  if (!thread?.more || thread.loading || !oldest) return;
  const current = generation;
  patchThread(peer, { loading: true, error: "" });
  try {
    const page = await invoke<Thread>("social_messages", {
      peer,
      before: oldest.id,
    });
    if (current !== generation) return;
    patchThread(peer, {
      messages: mergeMessages(
        state.threads[peer]?.messages ?? [],
        page.messages,
      ),
      more: page.more,
      loading: false,
    });
  } catch (cause) {
    if (current === generation)
      patchThread(peer, {
        loading: false,
        error: accountFailure(cause).message,
      });
  }
}
/** Shows the message at once; a failed one can be sent again unchanged. */
export async function sendMessage(
  peer: MessagePeer,
  text: string,
  retry?: DirectMessage,
) {
  const body = retry?.body ?? cleanDraft(text);
  const problem = draftProblem(body);
  if (problem) throw new Error(problem);
  const clientId = retry?.clientId ?? crypto.randomUUID();
  const pending: DirectMessage = retry
    ? { ...retry, failed: false }
    : {
        id: -Date.now(),
        senderId: me(),
        body,
        createdAt: Date.now(),
        clientId,
      };
  const current = generation;
  const others = (state.threads[peer.id]?.messages ?? []).filter(
    (message) => message.clientId !== clientId,
  );
  patchThread(peer.id, { messages: [...others, pending] });
  try {
    const sent = await invoke<DirectMessage>("social_send", {
      peer: peer.id,
      body,
      clientId,
    });
    if (current !== generation) return;
    const messages = mergeMessages(
      (state.threads[peer.id]?.messages ?? []).filter(
        (message) => message.clientId !== clientId,
      ),
      [sent],
    );
    patchThread(peer.id, { messages });
    update({
      conversations: withLatest(state.conversations, peer, true, sent),
    });
  } catch (cause) {
    if (current !== generation) return;
    patchThread(peer.id, {
      messages: (state.threads[peer.id]?.messages ?? []).map((message) =>
        message.clientId === clientId ? { ...message, failed: true } : message,
      ),
    });
    throw new Error(accountFailure(cause).message);
  }
}
/** While a conversation is on screen, its new messages count as read. */
export function watchThread(peer: string) {
  visible.set(peer, (visible.get(peer) ?? 0) + 1);
  void loadThread(peer);
  return () => {
    const count = (visible.get(peer) ?? 1) - 1;
    if (count) visible.set(peer, count);
    else visible.delete(peer);
  };
}
/** A friend's message arrived or another device read one: fetch what changed. */
export function messageArrived(peer: string) {
  void refreshConversations();
  if (state.threads[peer]?.messages || visible.has(peer)) void loadThread(peer);
}
export function resetMessages() {
  ++generation;
  visible.clear();
  marked.clear();
  state = empty();
  listeners.forEach((fn) => fn());
}
/** Follows the signed-in account: resets on a switch, catches up after a
 * reconnect (nudges sent while offline are lost) and on new messages. */
export function startMessages(onNotify: (message: string) => void) {
  announce = onNotify;
  let user = socialStore.snapshot().session.user?.id,
    connected = socialStore.snapshot().connected;
  const unsubscribe = socialStore.subscribe(() => {
    const snapshot = socialStore.snapshot();
    const id = snapshot.session.hasSession
      ? snapshot.session.user?.id
      : undefined;
    if (id !== user) {
      user = id;
      resetMessages();
    }
    if (snapshot.connected && !connected) {
      void refreshConversations();
      for (const peer of Object.keys(state.threads)) void loadThread(peer);
    }
    connected = snapshot.connected;
  });
  const arrived = (event: Event) => {
    const peer = (event as CustomEvent<unknown>).detail;
    if (typeof peer === "string") messageArrived(peer);
  };
  window.addEventListener("openretro-message", arrived);
  return () => {
    if (announce === onNotify) announce = undefined;
    unsubscribe();
    window.removeEventListener("openretro-message", arrived);
    resetMessages();
  };
}
