import { describe, expect, it } from "vitest";
import { parsePartyRoster } from "./partyRoster";
describe("Party profile roster", () => {
  it("accepts verified avatars and supports older hosts without them", () => {
    expect(
      parsePartyRoster([
        {
          id: "guest",
          name: "Marina",
          player: 2,
          avatar: 4,
          token: "discarded",
        },
      ]),
    ).toEqual([{ id: "guest", name: "Marina", player: 2, avatar: 4 }]);
    expect(
      parsePartyRoster([{ id: "legacy", name: "Marina", player: null }])[0]
        .avatar,
    ).toBe(0);
  });
  it("marks only guests the server flags as coming from the guest link", () => {
    const [link, friend] = parsePartyRoster([
      { id: "link", name: "Streamer", player: 2, anonymous: true },
      { id: "friend", name: "Marina", player: 3, anonymous: "yes" },
    ]);
    expect(link.anonymous).toBe(true);
    expect(friend.anonymous).toBeUndefined();
  });
  it("rejects malformed identities, names, seats and avatars", () => {
    const row = { id: "guest", name: "Marina", player: 2, avatar: 4 };
    for (const data of [
      null,
      [{ ...row, avatar: 15 }],
      [{ ...row, avatar: "4" }],
      [{ ...row, name: "x\n" }],
      [{ ...row, player: 1 }],
      [row, row],
      [row, { ...row, id: "other" }],
    ])
      expect(() => parsePartyRoster(data)).toThrow();
  });
});
