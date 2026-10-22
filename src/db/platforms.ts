import type { Platform } from "../types";
export const platforms: Platform[] = [
  {
    id: "nes",
    name: "Nintendo Entertainment System",
    shortName: "NES",
    manufacturer: "Nintendo",
    extensions: ["nes"],
  },
  {
    id: "snes",
    name: "Super Nintendo",
    shortName: "SNES",
    manufacturer: "Nintendo",
    extensions: ["sfc", "smc"],
  },
  {
    id: "n64",
    name: "Nintendo 64",
    shortName: "N64",
    manufacturer: "Nintendo",
    extensions: ["z64", "n64", "v64"],
  },
  {
    id: "gb",
    name: "Game Boy",
    shortName: "GB",
    manufacturer: "Nintendo",
    extensions: ["gb"],
  },
  {
    id: "gbc",
    name: "Game Boy Color",
    shortName: "GBC",
    manufacturer: "Nintendo",
    extensions: ["gbc"],
  },
  {
    id: "gba",
    name: "Game Boy Advance",
    shortName: "GBA",
    manufacturer: "Nintendo",
    extensions: ["gba"],
  },
  {
    id: "nds",
    name: "Nintendo DS",
    shortName: "NDS",
    manufacturer: "Nintendo",
    extensions: ["nds"],
  },
  {
    id: "sms",
    name: "Master System",
    shortName: "SMS",
    manufacturer: "Sega",
    extensions: ["sms"],
  },
  {
    id: "genesis",
    name: "Mega Drive / Genesis",
    shortName: "GEN",
    manufacturer: "Sega",
    extensions: ["md", "gen", "bin"],
  },
  {
    id: "gg",
    name: "Game Gear",
    shortName: "GG",
    manufacturer: "Sega",
    extensions: ["gg"],
  },
  {
    id: "psx",
    name: "PlayStation",
    shortName: "PS1",
    manufacturer: "Sony",
    extensions: ["cue", "chd", "pbp", "bin"],
    biosRequired: true,
  },
  {
    id: "psp",
    name: "PlayStation Portable",
    shortName: "PSP",
    manufacturer: "Sony",
    extensions: ["iso", "cso", "pbp"],
  },
  {
    id: "ps2",
    name: "PlayStation 2",
    shortName: "PS2",
    manufacturer: "Sony",
    extensions: ["iso", "chd"],
    biosRequired: true,
  },
  {
    id: "ps3",
    name: "PlayStation 3",
    shortName: "PS3",
    manufacturer: "Sony",
    extensions: [],
    catalogOnly: true,
  },
  { id: "arcade", name: "Arcade", shortName: "ARC", extensions: ["zip"] },
  {
    id: "dos",
    name: "DOS",
    shortName: "DOS",
    extensions: ["exe", "com", "conf"],
  },
];
export const platformById = (id: string) => platforms.find((p) => p.id === id);
export const detectPlatforms = (filename: string): string[] =>
  platforms
    .filter((p) =>
      p.extensions.includes(filename.split(".").pop()?.toLowerCase() ?? ""),
    )
    .map((p) => p.id);
