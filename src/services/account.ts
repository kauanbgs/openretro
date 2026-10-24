import { invoke, isTauri, isRemote } from "./transport";
import defaultOrigin from "../../src-tauri/src/remote_play/party-url.txt?raw";

export interface AccountUser {
  id: string;
  email: string;
  displayName: string | null;
  friendCode: string;
  /** One of the 15 preset icons, 0 to 14. */
  avatar: number;
  showPlaying: boolean;
  appearOffline: boolean;
  discoverable?: boolean;
  shareHistory?: boolean;
  createdAt: number;
}
export interface AccountSession {
  supported: boolean;
  hasSession: boolean;
  online: boolean;
  user: AccountUser | null;
  expiresAt: number | null;
}
export interface AccountFailure {
  message: string;
  kind: string;
  retryAfter: number;
}
export interface AccountPatch {
  friendTag?: string;
  displayName?: string;
  showPlaying?: boolean;
  appearOffline?: boolean;
  avatar?: number;
  discoverable?: boolean;
  shareHistory?: boolean;
}
export const signedOut: AccountSession = {
  supported: false,
  hasSession: false,
  online: false,
  user: null,
  expiresAt: null,
};
export function accountFailure(error: unknown): AccountFailure {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    const value = error as Partial<AccountFailure>;
    return {
      message: value.message!,
      kind: value.kind ?? "server",
      retryAfter: Math.min(3600, Math.max(0, Number(value.retryAfter) || 0)),
    };
  }
  return {
    message: "Não foi possível acessar sua conta. Tente novamente.",
    kind: "server",
    retryAfter: 0,
  };
}
export function remainingSeconds(deadline: number, now = Date.now()) {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
export function validDisplayName(name: string) {
  const value = name.trim();
  return (
    [...value].length >= 3 &&
    [...value].length <= 24 &&
    !/[\p{C}\p{Zl}\p{Zp}]/u.test(value)
  );
}
/** The part of the friend code before the #: the name without accents,
 * spaces or symbols, up to 16 characters, or "jogador". Identical to the
 * server's `friendPrefix` (party-server/cloudflare/social/friend-code.mjs). */
export function friendPrefix(name: string | null | undefined) {
  const slug = (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 16);
  return slug || "jogador";
}
export function validFriendTag(tag: string) {
  return /^[a-z0-9]{4}$/i.test(tag.trim());
}
export function mergeAccountSession(
  previous: AccountSession,
  next: AccountSession,
): AccountSession {
  // Offline metadata is memory-only, and disappears as soon as the session is gone.
  return next.hasSession && !next.online
    ? { ...next, user: previous.user }
    : next;
}
export interface AccountApi {
  session(): Promise<AccountSession>;
  start(email: string): Promise<{ resendAfter: number }>;
  verify(email: string, code: string): Promise<AccountSession>;
  profile(patch: AccountPatch): Promise<AccountSession>;
  logout(all: boolean): Promise<void>;
  forget(): Promise<void>;
  remove(confirmation: string): Promise<void>;
  export(): Promise<boolean>;
  privacy(): Promise<string>;
  openPrivacy(): Promise<void>;
}
export function createAccountApi(
  call: typeof invoke,
  desktop: boolean,
): AccountApi {
  const native = <T>(command: string, args?: Record<string, unknown>) => {
    if (!desktop)
      return Promise.reject({
        message: "O login está disponível no aplicativo para Windows.",
        kind: "unsupported",
        retryAfter: 0,
      });
    return call<T>(command, args);
  };
  const changed = <T>(result: T) => {
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event("openretro-account-changed"));
    return result;
  };
  return {
    session: () =>
      desktop ? native("account_session") : Promise.resolve(signedOut),
    start: (email) =>
      native("account_start", { email: email.trim().toLowerCase() }),
    verify: (email, code) =>
      native<AccountSession>("account_verify", {
        email: email.trim().toLowerCase(),
        code: code.trim(),
      }).then(changed),
    profile: (patch) =>
      native<AccountSession>("account_profile", { patch }).then(changed),
    logout: (all) => native<void>("account_logout", { all }).then(changed),
    forget: () => native<void>("account_forget").then(changed),
    remove: (confirmation) =>
      native<void>("account_delete", { confirmation }).then(changed),
    export: () => native("account_export"),
    privacy: () =>
      desktop
        ? native("account_privacy")
        : Promise.resolve(new URL("/privacidade", defaultOrigin.trim()).href),
    openPrivacy: () => native("account_open_privacy"),
  };
}
export const accountApi = createAccountApi(invoke, isTauri && !isRemote);

// Pending email/code navigation is transient; never persist a challenge in browser storage.
let pendingLogin: { email: string; resendAt: number } | null = null;
export const getPendingLogin = () => pendingLogin;
export function rememberPendingLogin(email: string, resendAt: number) {
  pendingLogin = { email, resendAt };
}
export function clearPendingLogin() {
  pendingLogin = null;
}
