import { describe, expect, it } from "vitest";
import { validatePartyServer } from "./partyConfig";

describe("Party server address", () => {
  it("accepts secure services and localhost for development", () => {
    expect(validatePartyServer("https://party.example.com").origin).toBe(
      "https://party.example.com",
    );
    expect(validatePartyServer("http://localhost:8787").port).toBe("8787");
  });
  it("rejects insecure internet services and embedded credentials", () => {
    for (const value of [
      "http://party.example.com",
      "https://user:secret@party.example.com",
      "https://party.example.com/path",
      "https://party.example.com/?key=secret",
      "https://party.example.com/#invite",
      "javascript:alert(1)",
    ])
      expect(() => validatePartyServer(value)).toThrow();
  });
});
