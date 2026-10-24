import { afterEach, describe, expect, it } from "vitest";
import {
  SocialActivityTracker,
  recordSocialActivity,
  readSocialActivity,
  clearSocialActivity,
  pruneSocialActivity,
  setSocialActivityPreference,
  socialActivityStore,
} from "./socialActivity";
import type { Friend, Presence } from "./social";
const presence = (title: string | null = null, startedAt = 1): Presence => ({
  status: "online",
  playing: title ? { title, console: "SNES", cover: null, startedAt } : null,
  party: null,
});
const friend: Friend = {
  id: "alice",
  displayName: "Alice",
  friendCode: "alice#abcd",
  avatar: 4,
  presence: presence(),
};
afterEach(() => {
  clearSocialActivity();
  setSocialActivityPreference("game", true);
});
describe("social activity", () => {
  it("seeds existing games and parties without replaying them on reconnect", () => {
    const tracker = new SocialActivityTracker();
    const current = {
      ...presence("Mario"),
      party: { code: "ABC234", joinable: true },
    };
    tracker.seed([{ ...friend, presence: current }]);
    expect(tracker.changes(friend, current)).toEqual([]);
    tracker.seed([{ ...friend, presence: current }]);
    expect(tracker.changes(friend, current)).toEqual([]);
  });
  it("announces a game once, including switching games or starting a new session", () => {
    const tracker = new SocialActivityTracker();
    tracker.seed([friend]);
    expect(tracker.changes(friend, presence("Mario"))).toEqual([
      { kind: "game", message: "Alice começou a jogar Mario." },
    ]);
    expect(
      tracker.changes(friend, {
        ...presence("Mario"),
        playing: {
          ...presence("Mario").playing!,
          cover: "https://images.igdb.com/cover",
        },
      }),
    ).toEqual([]);
    expect(tracker.changes(friend, presence("Zelda"))).toHaveLength(1);
    expect(tracker.changes(friend, presence("Mario", 2))).toHaveLength(1);
  });
  it("respects offline privacy and announces a newly opened Party once", () => {
    const tracker = new SocialActivityTracker();
    const current = {
      ...presence("Mario"),
      party: { code: "ABC234", joinable: true },
    };
    expect(tracker.changes(friend, { ...current, status: "offline" })).toEqual(
      [],
    );
    expect(tracker.changes(friend, current).map((e) => e.kind)).toEqual([
      "game",
      "party",
    ]);
    expect(tracker.changes(friend, current)).toEqual([]);
  });
  it("keeps bounded activity, marks it read, and purges removed friends", () => {
    for (let i = 0; i < 60; i++)
      recordSocialActivity("game", friend, `event ${i}`);
    expect(socialActivityStore.snapshot().entries).toHaveLength(40);
    expect(socialActivityStore.snapshot().entries[0]).toMatchObject({
      avatar: 4,
      read: false,
      message: "event 59",
    });
    readSocialActivity();
    expect(socialActivityStore.snapshot().entries.every((e) => e.read)).toBe(
      true,
    );
    pruneSocialActivity(new Set());
    expect(socialActivityStore.snapshot().entries).toHaveLength(0);
  });
  it("honors notification preferences without blocking presence changes", () => {
    setSocialActivityPreference("game", false);
    recordSocialActivity("game", friend, "muted");
    expect(socialActivityStore.snapshot().entries).toHaveLength(0);
    recordSocialActivity("party", friend, "Party");
    expect(socialActivityStore.snapshot().entries).toHaveLength(1);
  });
});
