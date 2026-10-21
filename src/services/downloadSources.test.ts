import { describe, expect, it } from "vitest";
import { parseDownloadSource, validMagnet } from "./downloadSources";
const magnet =
  "magnet:?xt=urn:btih:0123456789012345678901234567890123456789&dn=Homebrew";
describe("Hydra-compatible download sources", () => {
  it("imports real schema fields and keeps supported magnet and HTTPS links", () => {
    const source = parseDownloadSource(
      JSON.stringify({
        name: "My source",
        downloads: [
          {
            title: "Homebrew",
            uris: [magnet, "https://example.com/file.zip"],
            uploadDate: "2026-10-20",
            fileSize: "32 KB",
          },
        ],
      }),
    );
    expect(source.downloads).toEqual([
      {
        title: "Homebrew",
        uris: ["https://example.com/file.zip", magnet],
        uploadDate: "2026-10-20",
        fileSize: "32 KB",
      },
    ]);
  });
  it("rejects malformed documents, empty sources and executable URI schemes", () => {
    for (const text of [
      "null",
      "{}",
      "<html>",
      JSON.stringify({
        name: "Test",
        downloads: [{ title: "Game", uris: ["javascript:alert(1)"] }],
      }),
    ])
      expect(() => parseDownloadSource(text)).toThrow();
    for (const uri of [
      "magnet:?xt=urn:btih:invalid",
      "magnet:?xt=urn:btmh:1220" + "a".repeat(64),
      "file:///tmp/game",
    ])
      expect(validMagnet(uri)).toBe(false);
  });
  it("accepts percent-encoded hashes, base32 hashes, and UTF-8 BOM JSON", () => {
    expect(validMagnet("magnet:?xt=urn%3Abtih%3A" + "a".repeat(40))).toBe(true);
    expect(validMagnet("magnet:?xt=urn:btih:" + "A".repeat(32))).toBe(true);
    expect(
      parseDownloadSource(
        "\uFEFF" +
          JSON.stringify({
            name: "Test",
            downloads: [{ title: "Game", uris: [magnet] }],
          }),
      ).name,
    ).toBe("Test");
  });
  it("deduplicates links and entries without merging different editions", () => {
    const entry = { title: "Game", uris: [magnet, magnet] };
    const source = parseDownloadSource(
      JSON.stringify({
        name: "Test",
        downloads: [entry, entry, { ...entry, title: "Game Deluxe" }],
      }),
    );
    expect(source.downloads).toHaveLength(2);
    expect(source.downloads[0].uris).toHaveLength(1);
  });
});
