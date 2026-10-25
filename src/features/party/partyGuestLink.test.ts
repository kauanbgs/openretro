import { describe, expect, it } from "vitest";
import { parsePartyGuestLink } from "./partyGuestLink";

const origin = "https://party.example.com";
const room = `${origin}/party/ABC234`;
const token = "KQ2M9X";
const message = {
  type: "guest-link",
  url: `${origin}/${token}`,
  player: 2,
  expires: 1800000000000,
};

describe("Party guest link", () => {
  it("accepts the room's own link and its closing", () => {
    expect(parsePartyGuestLink(message, room)).toEqual({
      url: `${origin}/${token}`,
      player: 2,
      expires: 1800000000000,
    });
    expect(parsePartyGuestLink({ type: "guest-link", url: null }, room)).toBe(
      null,
    );
  });
  it("rejects links to other servers, room addresses and malformed seats", () => {
    for (const value of [
      null,
      { ...message, url: `https://evil.example.com/${token}` },
      { ...message, url: `${origin}/party/ABC234` },
      { ...message, url: `${origin}/party/${token}` },
      { ...message, url: `${origin}/${token}?x=1` },
      { ...message, url: `${origin}/SHORT` },
      { ...message, url: `${origin}/${token}#t=${token}` },
      { ...message, url: "javascript:alert(1)" },
      { ...message, player: 1 },
      { ...message, player: "2" },
      { ...message, expires: "soon" },
      { ...message, url: undefined },
    ])
      expect(() => parsePartyGuestLink(value, room)).toThrow();
  });
});
