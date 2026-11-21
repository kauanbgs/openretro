import { describe, expect, it } from "vitest";
import { sourceUrlFromPairing } from "./libraryServer";

const token = "0123456789abcdef0123456789abcdef";

describe("sourceUrlFromPairing", () => {
  it("turns a Tailscale pairing link into the server's source address", () => {
    expect(
      sourceUrlFromPairing(`http://100.101.102.103:47821/?t=${token}`),
    ).toEqual({
      url: `http://100.101.102.103:47821/api/source?t=${token}`,
      lan: false,
    });
    expect(
      sourceUrlFromPairing(`  http://100.64.0.1:47821/?t=${token}\n`).url,
    ).toBe(`http://100.64.0.1:47821/api/source?t=${token}`);
  });

  it.each([
    ["192.168.0.10", true],
    ["10.1.2.3", true],
    ["172.16.0.5", true],
    ["172.31.255.1", true],
  ])("accepts the local network address %s", (host, lan) => {
    expect(sourceUrlFromPairing(`http://${host}:47821/?t=${token}`)).toEqual({
      url: `http://${host}:47821/api/source?t=${token}`,
      lan,
    });
  });

  it.each([
    "not a link",
    `https://100.101.102.103:47821/?t=${token}`,
    "http://100.101.102.103:47821/",
    "http://100.101.102.103:47821/?t=short",
    `http://100.128.0.1:47821/?t=${token}`,
    `http://100.63.0.1:47821/?t=${token}`,
    `http://172.32.0.1:47821/?t=${token}`,
    `http://172.15.0.1:47821/?t=${token}`,
    `http://8.8.8.8:47821/?t=${token}`,
    `http://127.0.0.1:47821/?t=${token}`,
    `http://example.org/?t=${token}`,
  ])("rejects %s", (link) => {
    expect(() => sourceUrlFromPairing(link)).toThrow();
  });
});
