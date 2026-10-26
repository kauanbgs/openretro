import { afterEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ call: vi.fn() }));
const social = vi.hoisted(() => {
  let snapshot = {
    session: { hasSession: true, user: { id: "me" } },
    connected: true,
  };
  const listeners = new Set<() => void>();
  return {
    set(patch: Partial<typeof snapshot>) {
      snapshot = { ...snapshot, ...patch };
      listeners.forEach((fn) => fn());
    },
    socialStore: {
      snapshot: () => snapshot,
      subscribe: (fn: () => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
  };
});
vi.mock("./transport", () => ({
  invoke: native.call,
  isTauri: true,
  isRemote: false,
}));
vi.mock("./social", () => ({ socialStore: social.socialStore }));
import {
  cleanDraft,
  draftProblem,
  mergeMessages,
  messageArrived,
  messagesStore,
  newestFrom,
  refreshConversations,
  resetMessages,
  sendMessage,
  startsGroup,
  unreadTotal,
  watchThread,
  withLatest,
  type Conversation,
  type DirectMessage,
} from "./messages";

const peer = {
  id: "ana",
  displayName: "Ana",
  friendCode: "ana#ab12",
  avatar: 1,
};
const message = (id: number, senderId = "ana", createdAt = id * 1000) => ({
  id,
  senderId,
  body: `m${id}`,
  createdAt,
});
const conversation = (unread: number, last = message(1)): Conversation => ({
  peer,
  canSend: true,
  unread,
  last,
});
// The app's events travel on window; tests run without a DOM.
vi.stubGlobal("window", new EventTarget());
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
afterEach(() => {
  native.call.mockReset();
  resetMessages();
});

describe("message drafts", () => {
  it("are cleaned the way the server stores them", () => {
    expect(cleanDraft("  oi\r\n\r\n\r\n\r\ntudo bem?  ")).toBe(
      "oi\n\ntudo bem?",
    );
    expect(draftProblem("   ")).toBe("Escreva uma mensagem.");
    expect(draftProblem("é".repeat(400))).toBe("");
    expect(draftProblem("😀".repeat(401))).toMatch(/400/);
    expect(draftProblem("a\n".repeat(13))).toBe("Mensagem inválida.");
  });
});

describe("conversation helpers", () => {
  it("merges pages in order without duplicates and keeps pending sends last", () => {
    const pending: DirectMessage = {
      ...message(-5, "me"),
      clientId: "c1",
    };
    const merged = mergeMessages(
      [message(2), message(3), pending],
      [message(1), message(3)],
    );
    expect(merged.map((m) => m.id)).toEqual([1, 2, 3, -5]);
    // The server's copy replaces the pending one with the same client id.
    const sent = { ...message(4, "me"), clientId: "c1" };
    expect(mergeMessages(merged, [sent]).map((m) => m.id)).toEqual([
      1, 2, 3, 4,
    ]);
  });
  it("counts unread messages and finds the newest one from the peer", () => {
    expect(unreadTotal([conversation(2), conversation(5)])).toBe(7);
    expect(newestFrom([message(1), message(3), message(4, "me")], "ana")).toBe(
      3,
    );
    expect(newestFrom([message(4, "me")], "ana")).toBe(0);
  });
  it("moves the newest conversation to the top without going back in time", () => {
    const other = {
      ...conversation(0, message(9)),
      peer: { ...peer, id: "bia" },
    };
    const list = [other, conversation(1, message(5))];
    const updated = withLatest(list, peer, true, message(10, "me"));
    expect(updated.map((row) => row.peer.id)).toEqual(["ana", "bia"]);
    expect(updated[0].unread).toBe(1);
    expect(withLatest(updated, peer, true, message(2))).toBe(updated);
  });
  it("groups messages from one sender sent close together", () => {
    const messages = [
      message(1, "ana", 0),
      message(2, "ana", 60000),
      message(3, "me", 70000),
      message(4, "me", 70000 + 600000),
    ];
    expect(messages.map((_, i) => startsGroup(messages, i))).toEqual([
      true,
      false,
      true,
      true,
    ]);
  });
});

describe("messages store", () => {
  it("shows a message at once and replaces it with the server's copy", async () => {
    let resolve!: (value: DirectMessage) => void;
    native.call.mockImplementation(
      (command: string) =>
        new Promise((done) => {
          if (command === "social_send") resolve = done;
        }),
    );
    const sending = sendMessage(peer, "  Bora jogar?  ");
    const pending = messagesStore.snapshot().threads.ana.messages!;
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBeLessThan(0);
    expect(pending[0].body).toBe("Bora jogar?");
    const [, args] = native.call.mock.calls[0];
    expect(args).toMatchObject({ peer: "ana", body: "Bora jogar?" });
    resolve({ ...message(7, "me"), body: "Bora jogar?" });
    await sending;
    const state = messagesStore.snapshot();
    expect(state.threads.ana.messages!.map((m) => m.id)).toEqual([7]);
    expect(state.conversations[0].last.id).toBe(7);
  });
  it("keeps a failed message to retry with the same client id", async () => {
    native.call.mockRejectedValueOnce({
      message: "Você está enviando mensagens rápido demais. Aguarde um pouco.",
      kind: "limit",
    });
    await expect(sendMessage(peer, "oi")).rejects.toThrow(/rápido demais/);
    const failed = messagesStore.snapshot().threads.ana.messages![0];
    expect(failed.failed).toBe(true);
    native.call.mockResolvedValueOnce({ ...message(8, "me"), body: "oi" });
    await sendMessage(peer, "", failed);
    expect(native.call.mock.calls[1][1].clientId).toBe(failed.clientId);
    expect(
      messagesStore.snapshot().threads.ana.messages!.map((m) => m.id),
    ).toEqual([8]);
  });
  it("rejects an invalid draft before calling the PC", async () => {
    await expect(sendMessage(peer, "   ")).rejects.toThrow();
    expect(native.call).not.toHaveBeenCalled();
  });
  it("marks an open conversation as read once and announces others", async () => {
    const notify = vi.fn();
    const { startMessages } = await import("./messages");
    const stop = startMessages(notify);
    const thread = {
      peer,
      canSend: true,
      more: false,
      messages: [message(1), message(2)],
    };
    let unread = 0;
    native.call.mockImplementation(async (command: string) => {
      if (command === "social_messages") return thread;
      if (command === "social_conversations")
        return { conversations: [conversation(unread, message(2))] };
    });
    await refreshConversations();
    const unwatch = watchThread("ana");
    await flush();
    const reads = () =>
      native.call.mock.calls.filter(([command]) => command === "social_read");
    expect(reads()).toEqual([["social_read", { peer: "ana", lastId: 2 }]]);
    // The read's own nudge does not mark again or announce.
    messageArrived("ana");
    await flush();
    expect(reads()).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();
    unwatch();
    unread = 1;
    window.dispatchEvent(
      new CustomEvent("openretro-message", { detail: "ana" }),
    );
    await flush();
    expect(notify).toHaveBeenCalledWith("Nova mensagem de Ana");
    expect(messagesStore.snapshot().conversations[0].unread).toBe(1);
    stop();
  });
  it("forgets everything when the account changes", async () => {
    const { startMessages } = await import("./messages");
    const stop = startMessages(() => {});
    native.call.mockResolvedValue({ conversations: [conversation(3)] });
    await refreshConversations();
    expect(messagesStore.snapshot().conversations).toHaveLength(1);
    social.set({ session: { hasSession: true, user: { id: "other" } } });
    expect(messagesStore.snapshot().conversations).toHaveLength(0);
    stop();
  });
});
