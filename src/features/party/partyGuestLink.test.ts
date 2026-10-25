import { describe, expect, it } from "vitest";
import { parsePartyGuestLink } from "./partyGuestLink";

const room = "https://party.example.com/party/ABC234";
const token = "a".repeat(64);
const message = {
  type: "guest-link",
  url: `${room}#g=${token}`,
  player: 2,
  expires: 1800000000000,
};

describe("Party guest link", () => {
  it("accepts the room's own link and its closing", () => {
    expect(parsePartyGuestLink(message, room)).toEqual({
      url: `${room}#g=${token}`,
      player: 2,
      expires: 1800000000000,
    });
    expect(parsePartyGuestLink({ type: "guest-link", url: null }, room)).toBe(
      null,
    );
  });
  it("rejects links to other servers or rooms and malformed seats", () => {
    for (const value of [
      null,
      { ...message, url: `https://evil.example.com/party/ABC234#g=${token}` },
      { ...message, url: `https://party.example.com/party/XYZ789#g=${token}` },
      { ...message, url: `${room}?x=1#g=${token}` },
      { ...message, url: `${room}#g=short` },
      { ...message, url: `${room}#t=${token}` },
      { ...message, url: "javascript:alert(1)" },
      { ...message, player: 1 },
      { ...message, player: "2" },
      { ...message, expires: "soon" },
      { ...message, url: undefined },
    ])
      expect(() => parsePartyGuestLink(value, room)).toThrow();
  });
});
