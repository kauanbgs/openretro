import { describe, expect, it } from "vitest";
import {
  loudness,
  parsePartyReaction,
  parseSpeakers,
  reactionMessage,
  speakersMessage,
  talking,
} from "./partyLive";

describe("party reactions", () => {
  it("accepts only the fixed set", () => {
    const line = {
      type: "reaction",
      id: "r1",
      reaction: "fire",
      name: "Ana",
      player: 2,
    };
    expect(parsePartyReaction(line)).toMatchObject({ emoji: "🔥", player: 2 });
    expect(parsePartyReaction({ ...line, reaction: "<b>hi</b>" })).toBeNull();
    expect(parsePartyReaction({ ...line, player: 9 })).toBeNull();
    expect(parsePartyReaction({ ...line, name: "x".repeat(65) })).toBeNull();
    expect(reactionMessage("clap")).toEqual({
      type: "reaction",
      reaction: "clap",
    });
  });
});

describe("who is talking", () => {
  it("round-trips the host's list and refuses a bad one", () => {
    const speakers = [{ player: 1, name: "Kauan" }];
    expect(parseSpeakers(speakersMessage(speakers))).toEqual(speakers);
    expect(parseSpeakers("{")).toBeNull();
    expect(
      parseSpeakers(
        JSON.stringify({ type: "voice", speaking: [{ player: 7, name: "x" }] }),
      ),
    ).toBeNull();
    expect(
      parseSpeakers(
        JSON.stringify({
          type: "voice",
          speaking: [
            { player: 1, name: "a" },
            { player: 1, name: "b" },
          ],
        }),
      ),
    ).toBeNull();
  });
  it("measures loudness", () => {
    expect(loudness([])).toBe(0);
    expect(loudness([0, 0, 0])).toBe(0);
    expect(loudness([0.5, -0.5])).toBeCloseTo(0.5);
  });
  it("keeps a voice for a moment after it goes quiet", () => {
    const last = new Map<string, number>();
    const loud = new Map([["host", 0.3]]);
    const quiet = new Map([["host", 0]]);
    expect(talking(loud, last, 1000)).toEqual(["host"]);
    expect(talking(quiet, last, 1200)).toEqual(["host"]);
    expect(talking(quiet, last, 1500)).toEqual([]);
  });
  it("forgets a voice that left", () => {
    const last = new Map<string, number>();
    talking(new Map([["a", 0.3]]), last, 0);
    expect(talking(new Map(), last, 10)).toEqual([]);
  });
});
