import { describe, expect, it } from "vitest";
import { groupSwitchFiles, importTitle } from "./importTitle";
import type { ImportCandidate } from "../types";

const file = (path: string, platformIds = ["switch"]): ImportCandidate => ({
  path,
  filename: path.split(/[//]/).pop()!,
  sha256: path,
  platformIds,
});

describe("import titles", () => {
  it("names a Switch game by its folder, not by its title-ID file", () => {
    expect(
      importTitle(file("D:/Switch/Mario Kart 8 Deluxe/0100152000022000.nsp")),
    ).toBe("Mario Kart 8 Deluxe");
  });
  it("skips a packaged game's data/games folders", () => {
    expect(
      importTitle(file("C:/Jogos/Mario Party Superstars/data/games/MPS.nsp")),
    ).toBe("Mario Party Superstars");
  });
  it("reads Windows paths with backslashes", () => {
    expect(
      importTitle({
        path: String.raw`D:\Switch\Kirby and the Forgotten Land\game.xci`,
        filename: "game.xci",
        sha256: "x",
        platformIds: ["switch"],
      }),
    ).toBe("Kirby and the Forgotten Land");
  });
  it("uses the yuzu.exe in a game's folder and ignores its other executables", () => {
    const yuzu = file("D:/Mario Kart/yuzu.exe", ["dos"]);
    const early = file("D:/Mario Kart/yuzu_ea.exe", ["dos"]);
    const command = file("D:/Mario Kart/yuzu-cmd.exe", ["dos"]);
    const tool = file("D:/Mario Kart/bin/crashpad.exe", ["dos"]);
    const game = file("D:/Mario Kart/games/base.xci");
    const groups = groupSwitchFiles([early, command, tool, yuzu, game]);
    expect(groups).toHaveLength(1);
    expect(groups[0].main).toBe(game);
    expect(groups[0].emulator).toBe(yuzu);
    expect(importTitle(game)).toBe("Mario Kart");
  });
  it("names a game installed in a portable yuzu by the folder around it", () => {
    const installed = file(
      "C:/Jogos/Mario Kart 8 Deluxe/user/nand/user/Contents/registered/450a70da.nca",
    );
    const yuzu = file("C:/Jogos/Mario Kart 8 Deluxe/yuzu.exe", ["dos"]);
    const shader = file(
      "C:/Jogos/Mario Kart 8 Deluxe/user/shader/0100152000022000.bin",
      ["genesis", "psx"],
    );
    expect(importTitle(installed)).toBe("Mario Kart 8 Deluxe");
    const groups = groupSwitchFiles([yuzu, shader, installed]);
    expect(groups).toHaveLength(1);
    expect(groups[0].emulator).toBe(yuzu);
  });
  it("prefers the title an emulator cached for the game", () => {
    expect(
      importTitle({
        ...file(
          "D:/Jogos/pasta qualquer/user/nand/user/Contents/registered/a.nca",
        ),
        titleHint: "Mario Kart 8 Deluxe",
      }),
    ).toBe("Mario Kart 8 Deluxe");
  });
  it("keeps naming other consoles by their file", () => {
    expect(
      importTitle(file("D:/Roms/SNES/Super Mario World (USA).sfc", ["snes"])),
    ).toBe("Super Mario World");
  });
  it("groups a Switch game's base, update and DLC under the base file", () => {
    const base = file("D:/S/Zelda/Zelda [01007EF00011E000].nsp");
    const update = file("D:/S/Zelda/Zelda [01007EF00011E800][v65536].nsp");
    const dlc = file("D:/S/Zelda/Zelda DLC [01007EF00011F001].nsp");
    const other = file("D:/S/Kirby/Kirby.xci");
    const snes = file("D:/S/Zelda/zelda.sfc", ["snes"]);
    const groups = groupSwitchFiles([update, dlc, base, other, snes]);
    const zelda = groups.find((g) => g.main === base)!;
    expect(zelda.extra.map((f) => f.path).sort()).toEqual(
      [dlc.path, update.path].sort(),
    );
    expect(groups.map((g) => g.main)).toEqual(
      expect.arrayContaining([other, snes]),
    );
    expect(groups).toHaveLength(3);
  });
});
