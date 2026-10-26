import { invoke, isTauri, isRemote, listen } from "./transport";
import {
  accountApi,
  accountFailure,
  signedOut,
  type AccountSession,
} from "./account";
import { t } from "../i18n";
import type { GuestRoom } from "../features/party/partyGuest";
import {
  SocialActivityTracker,
  recordSocialActivity,
  clearSocialActivity,
  pruneSocialActivity,
} from "./socialActivity";
const activityTracker = new SocialActivityTracker();
let presenceReady = false;

export interface Playing {
  title: string;
  console: string;
  cover: string | null;
  startedAt: number;
}
export interface Presence {
  status: "online" | "idle" | "offline";
  playing: Playing | null;
  party: { code: string; joinable: boolean } | null;
}
export interface Friend {
  id: string;
  displayName: string | null;
  friendCode: string;
  avatar?: number;
  presence?: Presence;
}
export interface FriendList {
  friends: Friend[];
  incoming: Friend[];
  outgoing: Friend[];
  blocked: Friend[];
}
export interface PublicPerson {
  id: string;
  displayName: string | null;
  friendCode: string;
  avatar: number;
  relationship: "none" | "friend" | "incoming" | "outgoing";
}
export interface UserProfileData extends PublicPerson {
  isSelf: boolean;
  createdAt: number;
  historyVisible: boolean;
  recentGames: {
    title: string;
    console: string;
    cover: string | null;
    lastPlayedAt: number;
    playSeconds: number;
  }[];
  presence: Presence;
}
export interface PeoplePage {
  people: PublicPerson[];
  next: string | null;
}
export async function discoverPeople(after: string | null = null) {
  if (!enabled) throw new Error("unsupported");
  return invoke<PeoplePage>("social_people", { after });
}
export async function publicProfile(userId: string) {
  if (!enabled) throw new Error("unsupported");
  return invoke<UserProfileData>("social_person", { userId });
}
export type FriendAction =
  "request" | "accept" | "decline" | "cancel" | "remove" | "block" | "unblock";
export interface SocialState extends FriendList {
  session: AccountSession;
  connected: boolean;
  loading: boolean;
  error: string;
}
export const emptyFriends = (): FriendList => ({
  friends: [],
  incoming: [],
  outgoing: [],
  blocked: [],
});
export const offlinePresence = (): Presence => ({
  status: "offline",
  playing: null,
  party: null,
});
export function sortFriends(friends: Friend[]) {
  const rank = (friend: Friend) =>
    friend.presence?.status === "offline" || !friend.presence
      ? 3
      : friend.presence.playing
        ? 0
        : friend.presence.status === "online"
          ? 1
          : 2;
  return [...friends].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.displayName ?? a.friendCode).localeCompare(
        b.displayName ?? b.friendCode,
      ),
  );
}
export function presenceDelta(
  state: SocialState,
  id: string,
  presence: Presence,
): SocialState {
  // Delayed packets cannot recreate an unfriended or blocked player.
  return {
    ...state,
    friends: state.friends.map((friend) =>
      friend.id === id ? { ...friend, presence } : friend,
    ),
  };
}
export function elapsedMinutes(startedAt: number, now = Date.now()) {
  return Math.max(0, Math.floor((now - startedAt) / 60000));
}
let state: SocialState = {
  ...emptyFriends(),
  session: signedOut,
  connected: false,
  loading: false,
  error: "",
};
const subscribers = new Set<() => void>();
function update(patch: Partial<SocialState>) {
  state = { ...state, ...patch };
  subscribers.forEach((fn) => fn());
}
export const socialStore = {
  snapshot: () => state,
  subscribe: (fn: () => void) => {
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  },
};
let generation = 0,
  requestVersion = 0,
  enabled = false;
export async function refreshFriends(announce = false) {
  if (!enabled || !state.session.hasSession) return;
  const current = generation,
    version = ++requestVersion;
  update({ loading: true });
  try {
    const rows = await invoke<FriendList>("social_friends");
    if (current !== generation || version !== requestVersion) return;
    if (announce) {
      const incoming = rows.incoming.find(
        (row) => !state.incoming.some((old) => old.id === row.id),
      );
      const accepted = rows.friends.find(
        (row) =>
          !state.friends.some((old) => old.id === row.id) &&
          state.outgoing.some((old) => old.id === row.id),
      );
      if (incoming)
        recordSocialActivity(
          "friendship",
          incoming,
          t("{name} enviou um pedido de amizade.", {
            name: incoming.displayName ?? incoming.friendCode,
          }),
        );
      if (accepted)
        recordSocialActivity(
          "friendship",
          accepted,
          t("{name} aceitou seu pedido de amizade.", {
            name: accepted.displayName ?? accepted.friendCode,
          }),
        );
    }
    activityTracker.seed(rows.friends);
    presenceReady = state.connected;
    pruneSocialActivity(
      new Set(
        [...rows.friends, ...rows.incoming, ...rows.outgoing].map((f) => f.id),
      ),
    );
    update({ ...rows, loading: false, error: "" });
  } catch (cause) {
    if (current !== generation || version !== requestVersion) return;
    const failure = accountFailure(cause);
    if (failure.kind === "unauthorized") {
      await syncAccount();
      return;
    }
    update({ loading: false, error: failure.message });
  }
}
export async function friendAction(action: FriendAction, target: string) {
  if (!enabled) throw new Error("unsupported");
  await invoke("social_action", { action, target });
  await refreshFriends();
}
export async function joinFriendParty(friendId: string) {
  if (!enabled) throw new Error("unsupported");
  await invoke("social_join", { friendId });
}
export async function joinFriendRoom(friendId: string) {
  if (!enabled) throw new Error("unsupported");
  return invoke<GuestRoom>("social_join_room", { friendId });
}
export async function checkPartyAvailable(friend: Friend) {
  if (await invoke<boolean>("social_game_busy"))
    throw new Error(
      t("Feche o jogo para entrar no Party de {name}.", {
        name: friend.displayName ?? friend.friendCode,
      }),
    );
}
async function syncAccount() {
  presenceReady = false;
  activityTracker.clear();
  clearSocialActivity();
  const current = ++generation;
  ++requestVersion;
  update({ ...emptyFriends(), connected: false, loading: true, error: "" });
  await invoke("social_stop").catch(() => {});
  try {
    const session = await accountApi.session();
    if (current !== generation || !enabled) return;
    update({ session, loading: false });
    if (!session.hasSession) return;
    await invoke("social_start");
    if (current === generation)
      window.dispatchEvent(new Event("openretro-social-ready"));
    if (current === generation) await refreshFriends();
  } catch (cause) {
    if (current === generation)
      update({ loading: false, error: accountFailure(cause).message });
  }
}
interface SocialEventPayload {
  type: string;
  id?: string;
  presence?: Presence;
  /** A conversation with this player changed. */
  peer?: string;
}
export function startSocialClient(onNotify: (message: string) => void) {
  if (!isTauri || isRemote || enabled) return () => {};
  enabled = true;
  const unlisten = listen<SocialEventPayload>(
    "social-event",
    ({ payload: event }) => {
      if (!enabled) return;
      if (event.type === "connected") {
        update({ connected: true, error: "" });
        void refreshFriends();
      } else if (event.type === "disconnected") {
        presenceReady = false;
        ++requestVersion;
        update({
          connected: false,
          friends: state.friends.map((friend) => ({
            ...friend,
            presence: offlinePresence(),
          })),
        });
      } else if (event.type === "expired") void syncAccount();
      else if (event.type === "changed") void refreshFriends(true);
      else if (event.type === "message" && event.peer)
        window.dispatchEvent(
          new CustomEvent("openretro-message", { detail: event.peer }),
        );
      else if (event.type === "presence" && event.id && event.presence) {
        const old = state.friends.find((friend) => friend.id === event.id);
        if (old && presenceReady)
          for (const activity of activityTracker.changes(old, event.presence))
            recordSocialActivity(activity.kind, old, activity.message);
        state = presenceDelta(state, event.id, event.presence);
        subscribers.forEach((fn) => fn());
      }
    },
  );
  // Listen before connecting so ready/changed events cannot race subscription setup.
  void unlisten
    .then(() => {
      if (enabled) void syncAccount();
    })
    .catch(() => {
      update({ error: t("Não foi possível conectar aos amigos.") });
      onNotify(t("Não foi possível conectar aos amigos."));
    });
  const changed = () => {
    void syncAccount();
  };
  window.addEventListener("openretro-account-changed", changed);
  let lastActivity = Date.now(),
    idle = false;
  const activity = () => {
    lastActivity = Date.now();
    if (idle) {
      idle = false;
      void invoke("social_idle", { idle: false }).catch(() => {});
    }
  };
  const activityEvents = [
    "pointerdown",
    "pointermove",
    "wheel",
    "keydown",
    "gamepadconnected",
    "openretro-user-activity",
  ];
  for (const event of activityEvents) window.addEventListener(event, activity);
  const timer = setInterval(() => {
    if (!idle && Date.now() - lastActivity >= 300000) {
      idle = true;
      void invoke("social_idle", { idle: true }).catch(() => {});
    }
  }, 30000);
  return () => {
    enabled = false;
    presenceReady = false;
    activityTracker.clear();
    clearSocialActivity();
    ++generation;
    ++requestVersion;
    void unlisten.then((fn) => fn()).catch(() => {});
    window.removeEventListener("openretro-account-changed", changed);
    for (const event of activityEvents)
      window.removeEventListener(event, activity);
    clearInterval(timer);
    void invoke("social_stop").catch(() => {});
    update({
      ...emptyFriends(),
      session: signedOut,
      connected: false,
      loading: false,
      error: "",
    });
  };
}
