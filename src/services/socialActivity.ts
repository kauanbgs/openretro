import type { Friend, Presence } from "./social";
import { t } from "../i18n";

export type ActivityKind = "game" | "party" | "friendship" | "online";
export interface SocialActivity {
  id: number;
  kind: ActivityKind;
  friendId: string;
  name: string;
  avatar?: number;
  message: string;
  createdAt: number;
  read: boolean;
}
const defaults = { game: true, party: true, friendship: true, online: false };
const storageKey = "openretro-social-notifications";
function preferences() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    return Object.fromEntries(
      Object.entries(defaults).map(([key, fallback]) => [
        key,
        typeof value?.[key] === "boolean" ? value[key] : fallback,
      ]),
    ) as typeof defaults;
  } catch {
    return { ...defaults };
  }
}
let state = { entries: [] as SocialActivity[], preferences: preferences() };
let sequence = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
export const socialActivityStore = {
  snapshot: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
export function recordSocialActivity(
  kind: ActivityKind,
  friend: Friend,
  message: string,
) {
  if (!state.preferences[kind]) return;
  state = {
    ...state,
    entries: [
      {
        id: ++sequence,
        kind,
        friendId: friend.id,
        name: friend.displayName ?? friend.friendCode,
        avatar: friend.avatar,
        message,
        createdAt: Date.now(),
        read: false,
      },
      ...state.entries,
    ].slice(0, 40),
  };
  emit();
}
export function readSocialActivity() {
  state = {
    ...state,
    entries: state.entries.map((entry) => ({ ...entry, read: true })),
  };
  emit();
}
export function clearSocialActivity() {
  state = { ...state, entries: [] };
  emit();
}
export function pruneSocialActivity(ids: Set<string>) {
  state = {
    ...state,
    entries: state.entries.filter((entry) => ids.has(entry.friendId)),
  };
  emit();
}
export function setSocialActivityPreference(
  kind: ActivityKind,
  enabled: boolean,
) {
  state = { ...state, preferences: { ...state.preferences, [kind]: enabled } };
  try {
    localStorage.setItem(storageKey, JSON.stringify(state.preferences));
  } catch {
    /* Preferences still work for this session if storage is unavailable. */
  }
  emit();
}

/** Seed from snapshots; only live changes produce notifications. The bounded
 * session keys survive reconnects, so a repeated presence cannot replay a toast. */
export class SocialActivityTracker {
  private seen = new Map<string, string[]>();
  seed(friends: Friend[]) {
    const ids = new Set(friends.map((f) => f.id));
    for (const id of this.seen.keys()) if (!ids.has(id)) this.seen.delete(id);
    for (const friend of friends) {
      const p = friend.presence;
      if (p?.playing) this.remember(friend.id, this.gameKey(p));
      if (p?.party?.joinable) this.remember(friend.id, `party:${p.party.code}`);
    }
  }
  private gameKey(p: Presence) {
    return `game:${JSON.stringify([p.playing?.title, p.playing?.console, p.playing?.startedAt])}`;
  }
  private remember(id: string, key: string) {
    const keys = this.seen.get(id) ?? [];
    if (keys.includes(key)) return false;
    this.seen.set(id, [...keys, key].slice(-12));
    return true;
  }
  changes(
    friend: Friend,
    next: Presence,
  ): { kind: ActivityKind; message: string }[] {
    if (next.status === "offline") return [];
    const name = friend.displayName ?? friend.friendCode;
    const events: { kind: ActivityKind; message: string }[] = [];
    if (next.playing && this.remember(friend.id, this.gameKey(next)))
      events.push({
        kind: "game",
        message: t("{name} começou a jogar {game}.", {
          name,
          game: next.playing.title,
        }),
      });
    if (
      next.party?.joinable &&
      this.remember(friend.id, `party:${next.party.code}`)
    )
      events.push({
        kind: "party",
        message: t("{name} abriu um Party. Entre para jogar junto!", { name }),
      });
    if (
      friend.presence?.status === "offline" &&
      !next.playing &&
      !next.party?.joinable
    )
      events.push({
        kind: "online",
        message: t("{name} ficou online.", { name }),
      });
    return events;
  }
  clear() {
    this.seen.clear();
  }
}
