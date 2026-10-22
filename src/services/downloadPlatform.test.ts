import { describe, expect, it } from "vitest";
import type { SourceMatch } from "../types";
import { namedConsoles, releasesFor } from "./downloadPlatform";

const release = (title: string, uri: string, id = title): SourceMatch => ({
  id,
  title,
  uris: [uri],
  uploadDate: "",
  fileSize: "",
  sourceId: "s",
  sourceName: "Source",
});

describe("download releases per console", () => {
  const ps2 = release(
    "Guitar Hero III - Legends of Rock (USA)",
    "https://archive.org/download/PS2-Redump-2024-Individual-Games-Part6/Guitar%20Hero%20III.zip",
    "ps2",
  );
  const ps3 = release(
    "Guitar Hero III - Legends of Rock (USA)",
    "https://archive.org/download/PS3-Redump-2024-Individual-Games-Part13/Guitar%20Hero%20III.zip",
    "ps3",
  );
  const wii = release(
    "Guitar Hero III - Legends of Rock (USA)",
    "https://archive.org/download/Wii-Redump-2024-Individual-Games-Part3/x.zip",
    "wii",
  );
  const unknown = release(
    "Guitar Hero III: Legends of Rock [USA/ENG]",
    "magnet:?xt=urn:btih:841F86AD25BA0A34931CAACB01F9339ADF47AD9F",
    "unknown",
  );

  it("reads the console from links and titles", () => {
    expect(namedConsoles(ps2)).toEqual(["ps2"]);
    expect(namedConsoles(ps3)).toEqual(["ps3"]);
    expect(namedConsoles(wii)).toEqual(["wii"]);
    expect(namedConsoles(unknown)).toEqual([]);
    expect(
      namedConsoles(
        release("Sonic", "https://x/Sega%20-%20Mega%20Drive/s.zip"),
      ),
    ).toEqual(["genesis"]);
    expect(
      namedConsoles(release("Crash", "https://x/Sony%20-%20PlayStation/c.zip")),
    ).toEqual(["psx"]);
    expect(
      namedConsoles(release("Mario", "https://x/Nintendo%20-%20Wii%20U/m.zip")),
    ).toEqual(["wiiu"]);
  });

  it("drops other consoles and lists confirmed releases first", () => {
    const shown = releasesFor([unknown, ps3, wii, ps2], {
      title: "Guitar Hero III: Legends of Rock",
      platformId: "ps2",
    });
    expect(shown.map((r) => [r.id, r.confirmed])).toEqual([
      ["ps2", true],
      ["unknown", false],
    ]);
  });

  it("ignores consoles named by the game itself", () => {
    const gba = release("Sonic Genesis (USA)", "https://x/GBA/s.zip");
    expect(
      releasesFor([gba], { title: "Sonic Genesis", platformId: "gba" }),
    ).toHaveLength(1);
  });
});
