import type { ImportCandidate } from "../types";

const stem = (name: string) => name.replace(/\.[^.]+$/, "");
const parts = (path: string) => path.split(/[\\/]/).filter(Boolean);
const folderOf = (path: string) => parts(path).slice(0, -1).join("/");
/** Dump names carry tags and underscores the catalog does not. */
const clean = (name: string) =>
  name
    .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
    .replace(/[_.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isSwitch = (candidate: ImportCandidate) =>
  candidate.platformIds.includes("switch");

/** Folders that only organize files and say nothing about the game. */
const GENERIC_FOLDERS =
  /^(games?|roms?|switch|nsp|xci|base|update|dlc|user|nand|contents|registered)$/i;

/**
 * The name to look the game up by. A Switch game's files are named after
 * title IDs or just "base" and "update", so its folder says what it is.
 */
export function importTitle(candidate: ImportCandidate): string {
  if (candidate.titleHint) return candidate.titleHint;
  const file = clean(stem(candidate.filename));
  if (!isSwitch(candidate)) return file;
  const folders = parts(candidate.path).slice(0, -1).reverse();
  const folder = folders.find((name) => !GENERIC_FOLDERS.test(name));
  return (folder && clean(folder)) || file;
}

/** The Switch title ID in a file name: base games end in 000, updates in 800. */
function titleId(filename: string) {
  return /(?:^|[\[\s_])(0100[0-9a-f]{12})(?![0-9a-f])/i
    .exec(filename)?.[1]
    .toLowerCase();
}
function switchRank(candidate: ImportCandidate) {
  const name = candidate.filename.toLowerCase();
  const id = titleId(name);
  let rank = 0;
  if (id ? !id.endsWith("000") : /update|dlc|patch|\bv\d{4,}/.test(name))
    rank += 10;
  if (/\.(nsp|nsz)$/.test(name)) rank += 1;
  return rank;
}

/** A bundle's own emulator: yuzu.exe, but not its command-line twin. */
const EMULATOR_EXE =
  /^(yuzu|eden|citron|suyu|sudachi|torzu|ryujinx)(?!.*cmd).*\.exe$/i;

export interface ImportGroup {
  main: ImportCandidate;
  /** Other files of the same game: updates and DLC. */
  extra: ImportCandidate[];
  /** The emulator that sits in the game's folder, or above it. */
  emulator?: ImportCandidate;
}

/**
 * A Switch game's files (base, update, DLC) sit in one folder: the game is the
 * base file and the others are files to choose when playing. A folder that
 * also holds yuzu.exe brings its own emulator, and its executables are not
 * DOS games.
 */
export function groupSwitchFiles(candidates: ImportCandidate[]): ImportGroup[] {
  const switchFolders = new Set(
    candidates.filter(isSwitch).map((candidate) => folderOf(candidate.path)),
  );
  const inSwitchFolder = (candidate: ImportCandidate) => {
    const folder = folderOf(candidate.path);
    return [...switchFolders].some(
      (root) => root === folder || root.startsWith(folder + "/"),
    );
  };
  const emulators = candidates.filter(
    (candidate) =>
      !isSwitch(candidate) &&
      EMULATOR_EXE.test(candidate.filename) &&
      inSwitchFolder(candidate),
  );
  // The emulator's own executables (crash handlers, tools) are not games.
  const underEmulator = (candidate: ImportCandidate) =>
    emulators.some((emulator) => {
      const root = folderOf(emulator.path);
      const folder = folderOf(candidate.path);
      return folder === root || folder.startsWith(root + "/");
    });
  // Outside an emulator's own folder only programs are dropped; other
  // consoles' games next to a Switch game stay.
  const isDosOnly = (candidate: ImportCandidate) =>
    candidate.platformIds.every((id) => id === "dos");
  const groups: ImportGroup[] = [];
  const byFolder = new Map<string, ImportCandidate[]>();
  for (const candidate of candidates) {
    if (isSwitch(candidate)) {
      const folder = folderOf(candidate.path);
      byFolder.set(folder, [...(byFolder.get(folder) ?? []), candidate]);
    } else if (
      !underEmulator(candidate) &&
      (!isDosOnly(candidate) || !inSwitchFolder(candidate))
    ) {
      groups.push({ main: candidate, extra: [] });
    }
  }
  for (const [folder, files] of byFolder) {
    const [main, ...extra] = [...files].sort(
      (a, b) =>
        switchRank(a) - switchRank(b) || a.filename.localeCompare(b.filename),
    );
    // The closest emulator wins; yuzu.exe over yuzu_ea.exe.
    const emulator = emulators
      .filter((candidate) => {
        const root = folderOf(candidate.path);
        return folder === root || folder.startsWith(root + "/");
      })
      .sort(
        (a, b) =>
          folderOf(b.path).length - folderOf(a.path).length ||
          a.filename.length - b.filename.length,
      )[0];
    groups.push({ main, extra, emulator });
  }
  return groups;
}
