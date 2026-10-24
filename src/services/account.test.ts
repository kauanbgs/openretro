import { describe, expect, it, vi } from "vitest";
import {
  accountFailure,
  getPendingLogin,
  rememberPendingLogin,
  clearPendingLogin,
  createAccountApi,
  mergeAccountSession,
  remainingSeconds,
  signedOut,
  validDisplayName,
  validFriendTag,
  friendPrefix,
  type AccountSession,
} from "./account";
import type { invoke } from "./transport";
// @ts-expect-error The Worker module is plain JavaScript without types.
import { friendPrefix as serverPrefix } from "../../party-server/cloudflare/social/friend-code.mjs";

describe("friend codes", () => {
  it("prefix the code with the simplified name, the same as the server", () => {
    const names: [string | null, string][] = [
      ["dasdasd", "dasdasd"],
      ["Kauã Plaza!", "kauaplaza"],
      ["bgs.", "bgs"],
      ["  ÁÉÍ Õ ç  ", "aeioc"],
      ["Um nome muito comprido demais", "umnomemuitocompr"],
      ["🎮🎮🎮", "jogador"],
      [null, "jogador"],
    ];
    for (const [name, prefix] of names) {
      expect(friendPrefix(name)).toBe(prefix);
      expect(serverPrefix(name)).toBe(prefix);
    }
  });
});

const user = {
  id: "test-user",
  email: "test@example.test",
  displayName: "Jogador",
  friendCode: "jogador#123456",
  avatar: 4,
  showPlaying: true,
  appearOffline: false,
  createdAt: 1,
};
describe("optional account client", () => {
  it("accepts exactly four chosen ASCII letters or digits", () => {
    for (const tag of ["1234", "AB12", "zzzz", " a1b2 "])
      expect(validFriendTag(tag)).toBe(true);
    for (const tag of [
      "123",
      "12345",
      "a_b1",
      "ab#1",
      "é123",
      "１２３４",
      "ab\n1",
    ])
      expect(validFriendTag(tag)).toBe(false);
  });
  it("does not invoke native commands on previews or paired phones", async () => {
    const call = vi.fn();
    const api = createAccountApi(call as typeof invoke, false);
    expect(await api.session()).toEqual(signedOut);
    await expect(api.start("test@example.test")).rejects.toMatchObject({
      kind: "unsupported",
    });
    await expect(
      api.verify("test@example.test", "123456"),
    ).rejects.toMatchObject({ kind: "unsupported" });
    expect(call).not.toHaveBeenCalled();
  });
  it("uses typed native actions without reading or writing browser credentials", async () => {
    const call = vi.fn().mockResolvedValue({});
    const api = createAccountApi(call as typeof invoke, true);
    await api.start(" TEST@EXAMPLE.TEST ");
    await api.verify(" TEST@EXAMPLE.TEST ", " 123456 ");
    await api.profile({ displayName: "Jogador" });
    await api.logout(true);
    await api.remove("EXCLUIR");
    expect(call.mock.calls).toEqual([
      ["account_start", { email: "test@example.test" }],
      ["account_verify", { email: "test@example.test", code: "123456" }],
      ["account_profile", { patch: { displayName: "Jogador" } }],
      ["account_logout", { all: true }],
      ["account_delete", { confirmation: "EXCLUIR" }],
    ]);
  });
  it("keeps only in-memory metadata offline and clears it after logout", () => {
    const online: AccountSession = {
      supported: true,
      hasSession: true,
      online: true,
      user,
      expiresAt: 1000,
    };
    const offline: AccountSession = { ...online, online: false, user: null };
    expect(mergeAccountSession(online, offline).user).toBe(user);
    expect(
      mergeAccountSession(online, { ...signedOut, supported: true }).user,
    ).toBeNull();
  });
  it("derives resend cooldowns from absolute deadlines and clamps remote limits", () => {
    expect(remainingSeconds(61000, 1000)).toBe(60);
    expect(remainingSeconds(61000, 60999)).toBe(1);
    expect(remainingSeconds(61000, 62000)).toBe(0);
    expect(
      accountFailure({ message: "Aguarde", retryAfter: 999999 }).retryAfter,
    ).toBe(3600);
    expect(
      accountFailure({ message: "Aguarde", retryAfter: -10 }).retryAfter,
    ).toBe(0);
    expect(accountFailure(new Error("Falha")).message).toBe("Falha");
    expect(accountFailure(undefined).message).not.toBeUndefined();
  });
  it("validates code-point lengths and rejects invisible/control characters", () => {
    expect(validDisplayName("  Jogador 🎮  ")).toBe(true);
    for (const name of [
      "ab",
      "x".repeat(25),
      "a\u0000bc",
      "a\u200bbc",
      "a\u2028bc",
    ])
      expect(validDisplayName(name)).toBe(false);
  });
});

it("preserves a pending challenge only in memory while changing settings sections", () => {
  rememberPendingLogin("test@example.test", 61000);
  expect(getPendingLogin()).toEqual({
    email: "test@example.test",
    resendAt: 61000,
  });
  clearPendingLogin();
  expect(getPendingLogin()).toBeNull();
});
