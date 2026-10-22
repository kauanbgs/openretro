import { expect, it } from "vitest";
import { displayPath, isInstalled } from "./EmulatorsPage";

it("hides Windows extended-length prefixes", () => {
  expect(displayPath(String.raw`\\?\C:\RetroArch-Win64\retroarch.exe`)).toBe(
    String.raw`C:\RetroArch-Win64\retroarch.exe`,
  );
  expect(displayPath(String.raw`\\?\UNC\server\share\emu.exe`)).toBe(
    String.raw`\\server\share\emu.exe`,
  );
  expect(displayPath(String.raw`D:\Emu\mgba.exe`)).toBe(
    String.raw`D:\Emu\mgba.exe`,
  );
});

it("matches installers to configured emulators without confusing RetroArch builds", () => {
  const installer = (id: string, name: string) => ({
    id,
    name,
    description: "",
    supportedPlatforms: [],
    sourceName: "",
    sourceUrl: "",
    isBase: false,
  });
  const emulator = (id: string, name: string) => ({
    id,
    name,
    executablePath: "",
    supportedPlatforms: [],
    defaultPlatforms: [],
  });
  const runtime = installer("retroarch", "OpenRetro Runtime");
  expect(
    isInstalled(runtime, [emulator("detected-retroarch", "RetroArch")]),
  ).toBe(false);
  expect(
    isInstalled(runtime, [
      emulator("openretro-retroarch", "OpenRetro Runtime"),
    ]),
  ).toBe(true);
  expect(
    isInstalled(installer("pcsx2", "PCSX2"), [
      emulator("detected-pcsx2", "PCSX2"),
    ]),
  ).toBe(true);
});
