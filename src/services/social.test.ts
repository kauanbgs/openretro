import { afterEach, describe, expect, it, vi } from "vitest";
import { socialActivityStore } from "./socialActivity";
const native = vi.hoisted(() => ({
  call: vi.fn(),
  listener: undefined as
    undefined | ((event: { payload: Record<string, unknown> }) => void),
}));
vi.mock("./transport", () => ({
  isTauri: true,
  isRemote: false,
  invoke: native.call,
  listen: vi.fn(async (_: string, handler: typeof native.listener) => {
    native.listener = handler;
    return () => {
      native.listener = undefined;
    };
  }),
}));
vi.mock("./account", async () => {
  const original =
    await vi.importActual<typeof import("./account")>("./account");
  return {
    ...original,
    accountApi: {
      session: async () => ({
        supported: true,
        hasSession: true,
        online: true,
        user: null,
        expiresAt: 1000,
      }),
    },
  };
});
import {
  emptyFriends,
  elapsedMinutes,
  offlinePresence,
  presenceDelta,
  sortFriends,
  type Friend,
  type SocialState,
} from "./social";
const friend = (
  id: string,
  status: "online" | "idle" | "offline" = "offline",
  playing = false,
): Friend => ({
  id,
  displayName: id,
  friendCode: `${id}#123456789abc`,
  presence: {
    status,
    playing: playing
      ? {
          title: "Mario",
          console: "Super Nintendo",
          cover: null,
          startedAt: 1000,
        }
      : null,
    party: null,
  },
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("optional friends and presence", () => {
  it("announces live game starts once, suppresses reconnect snapshots and ignores unknown friends", async () => {
    const social = await import("./social");
    vi.stubGlobal("window", new EventTarget());
    let rows = { ...emptyFriends(), friends: [friend("Alice", "online")] };
    native.call.mockImplementation(async (command) =>
      command === "social_friends" ? rows : undefined,
    );
    const stop = social.startSocialClient(vi.fn());
    try {
      await vi.waitFor(() =>
        expect(social.socialStore.snapshot().friends).toHaveLength(1),
      );
      native.listener!({ payload: { type: "connected" } });
      await social.refreshFriends();
      const playing = friend("Alice", "online", true).presence!;
      const event = {
        payload: { type: "presence", id: "Alice", presence: playing },
      };
      native.listener!(event);
      native.listener!(event);
      expect(socialActivityStore.snapshot().entries).toHaveLength(1);
      expect(socialActivityStore.snapshot().entries[0].message).toBe(
        "Alice começou a jogar Mario.",
      );
      native.listener!({
        payload: { type: "presence", id: "stranger", presence: playing },
      });
      rows = { ...rows, friends: [friend("Alice", "online", true)] };
      native.listener!({ payload: { type: "disconnected" } });
      native.listener!({ payload: { type: "connected" } });
      await social.refreshFriends();
      native.listener!(event);
      expect(socialActivityStore.snapshot().entries).toHaveLength(1);
    } finally {
      stop();
    }
    expect(socialActivityStore.snapshot().entries).toHaveLength(0);
  });
  it("sorts playing, online, away and offline without mutating the list", () => {
    const list = [
      friend("Zelda"),
      friend("Away", "idle"),
      friend("Online", "online"),
      friend("Playing", "online", true),
    ];
    expect(sortFriends(list).map((row) => row.id)).toEqual([
      "Playing",
      "Online",
      "Away",
      "Zelda",
    ]);
    expect(list[0].id).toBe("Zelda");
  });
  it("ignores delayed deltas for removed or blocked users", () => {
    const state = {
      ...emptyFriends(),
      friends: [friend("friend")],
      session: {
        supported: true,
        hasSession: true,
        online: true,
        user: null,
        expiresAt: 1,
      },
      connected: true,
      loading: false,
      error: "",
    } satisfies SocialState;
    expect(
      presenceDelta(state, "blocked", {
        ...offlinePresence(),
        status: "online",
      }).friends,
    ).toEqual(state.friends);
    expect(
      presenceDelta(state, "friend", { ...offlinePresence(), status: "online" })
        .friends[0].presence?.status,
    ).toBe("online");
    expect(elapsedMinutes(1000, 121000)).toBe(2);
    expect(elapsedMinutes(121000, 1000)).toBe(0);
  });
  it("subscribes before connecting, announces new requests and clears presence on disconnect", async () => {
    const social = await import("./social");
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    let rows = {
      ...emptyFriends(),
      friends: [friend("Alice", "online", true)],
    };
    native.call.mockImplementation(async (command: string) =>
      command === "social_friends" ? rows : undefined,
    );
    const notify = vi.fn(),
      stop = social.startSocialClient(notify);
    try {
      await vi.waitFor(() =>
        expect(social.socialStore.snapshot().friends).toHaveLength(1),
      );
      expect(native.listener).toBeDefined();
      await social.joinFriendParty("Alice");
      expect(native.call).toHaveBeenCalledWith("social_join", {
        friendId: "Alice",
      });
      await social.joinFriendRoom("Alice");
      expect(native.call).toHaveBeenCalledWith("social_join_room", {
        friendId: "Alice",
      });
      await social.discoverPeople();
      expect(native.call).toHaveBeenLastCalledWith("social_people", {
        after: null,
      });
      await social.publicProfile("Alice");
      expect(native.call).toHaveBeenLastCalledWith("social_person", {
        userId: "Alice",
      });
      native.call.mockResolvedValueOnce(true);
      await expect(social.checkPartyAvailable(friend("Alice"))).rejects.toThrow(
        "Feche o jogo para entrar no Party de Alice.",
      );
      expect(native.call).toHaveBeenLastCalledWith("social_game_busy");
      await expect(
        social.checkPartyAvailable(friend("Alice")),
      ).resolves.toBeUndefined();
      native.listener!({ payload: { type: "disconnected" } });
      expect(social.socialStore.snapshot().friends[0].presence).toEqual(
        offlinePresence(),
      );
      rows = { ...rows, incoming: [friend("Bob")] };
      native.listener!({ payload: { type: "changed" } });
      await vi.waitFor(() =>
        expect(socialActivityStore.snapshot().entries[0]?.message).toBe(
          "Bob enviou um pedido de amizade.",
        ),
      );
      await social.friendAction("block", "Alice");
      expect(native.call).toHaveBeenCalledWith("social_action", {
        action: "block",
        target: "Alice",
      });
    } finally {
      stop();
    }
    expect(social.socialStore.snapshot().session.hasSession).toBe(false);
  });
});
