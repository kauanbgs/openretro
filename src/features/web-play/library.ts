// The library of the web build: the hand-picked games from the game list
// (public/play/games.json, or VITE_PLAY_CATALOG_URL) plus ROMs the player
// opened from their own computer. Favorites, last played and playtime are kept
// in this browser.
import { detectPlatforms } from "../../db/platforms";
import type { GameMetadata, LibraryGame } from "../../types";
import { t } from "../../i18n";
import { deleteRom, getRom, listRoms, saveRom } from "./romStore";

/** EmulatorJS core and libretro-thumbnails folder for each console. */
export const WEB_PLATFORMS: Record<
  string,
  { core: string; thumbnails: string }
> = {
  nes: { core: "nes", thumbnails: "Nintendo - Nintendo Entertainment System" },
  snes: {
    core: "snes",
    thumbnails: "Nintendo - Super Nintendo Entertainment System",
  },
  n64: { core: "n64", thumbnails: "Nintendo - Nintendo 64" },
  gb: { core: "gb", thumbnails: "Nintendo - Game Boy" },
  gbc: { core: "gb", thumbnails: "Nintendo - Game Boy Color" },
  gba: { core: "gba", thumbnails: "Nintendo - Game Boy Advance" },
  nds: { core: "nds", thumbnails: "Nintendo - Nintendo DS" },
  sms: { core: "segaMS", thumbnails: "Sega - Master System - Mark III" },
  genesis: { core: "segaMD", thumbnails: "Sega - Mega Drive - Genesis" },
  gg: { core: "segaGG", thumbnails: "Sega - Game Gear" },
  psx: { core: "psx", thumbnails: "Sony - PlayStation" },
};

/** Credits shown on a list game's page; their licenses ask for them. */
export interface WebCredits {
  license?: string;
  source?: string;
  local?: boolean;
}

interface ListEntry {
  id?: string;
  title?: string;
  platform?: string;
  rom?: string;
  cover?: string;
  screenshots?: string[];
  year?: number;
  developer?: string;
  description?: string;
  genre?: string;
  license?: string;
  source?: string;
}

interface PlayState {
  favorite?: boolean;
  lastPlayedAt?: string;
  playtime?: number;
}

const STATE_KEY = "openretro-web-play-state-v1";
const LIST_URL =
  import.meta.env.VITE_PLAY_CATALOG_URL ||
  `${import.meta.env.BASE_URL}play/games.json`;

const roms = new Map<string, { url: string; platformId: string }>();
const credits = new Map<string, WebCredits>();

function readState(): Record<string, PlayState> {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function updateState(id: string, change: (state: PlayState) => PlayState) {
  const all = readState();
  all[id] = change(all[id] ?? {});
  localStorage.setItem(STATE_KEY, JSON.stringify(all));
}

export function thumbnailUrls(platformId: string, names: string[]): string[] {
  const system = WEB_PLATFORMS[platformId]?.thumbnails;
  if (!system) return [];
  const base = `https://thumbnails.libretro.com/${encodeURIComponent(system)}/Named_Boxarts/`;
  // libretro replaces these characters with "_" in file names.
  return names.map(
    (name) =>
      `${base}${encodeURIComponent(name.replace(/[&*/:`<>?\\|"]/g, "_"))}.png`,
  );
}

function entry(
  game: GameMetadata,
  state: PlayState,
  addedAt: string,
  local: boolean,
): LibraryGame {
  return {
    game,
    item: {
      id: game.id,
      gameId: game.id,
      platformId: game.platformId,
      sourceProvider: local ? "web-local" : "web-list",
      sourcePath: "",
      emulatorId: null,
      installed: true,
      favorite: state.favorite ?? false,
      addedAt,
      lastPlayedAt: state.lastPlayedAt ?? null,
      playtime: state.playtime ?? 0,
      sha256: "",
      biosPath: null,
      runtimeArgs: [],
    },
  };
}

let listCache: Promise<ListEntry[]> | undefined;
async function loadList(): Promise<ListEntry[]> {
  listCache ??= fetch(new URL(LIST_URL, location.href), { cache: "no-cache" })
    .then((r) => {
      if (!r.ok)
        throw new Error(t("Não foi possível carregar a lista de jogos."));
      return r.json() as Promise<{ games?: ListEntry[] }>;
    })
    .then((data) => data.games ?? [])
    .catch((error) => {
      listCache = undefined;
      throw error;
    });
  return listCache;
}

export async function webLibrary(): Promise<LibraryGame[]> {
  const listUrl = new URL(LIST_URL, location.href);
  const state = readState();
  const [list, local] = await Promise.all([
    loadList(),
    listRoms().catch(() => []),
  ]);
  // List order is the curated order: newest "addedAt" first keeps it in the library.
  const start = Date.UTC(2026, 0, 1);
  const fromList = list.flatMap((g, index): LibraryGame[] => {
    if (!g.title || !g.rom || !g.platform || !WEB_PLATFORMS[g.platform])
      return [];
    const id = `web:${g.id ?? `${g.platform}-${index}`}`;
    roms.set(id, { url: new URL(g.rom, listUrl).href, platformId: g.platform });
    credits.set(id, { license: g.license, source: g.source });
    const cover = g.cover ? new URL(g.cover, listUrl).href : undefined;
    const screenshots = (g.screenshots ?? []).map(
      (s) => new URL(s, listUrl).href,
    );
    const game: GameMetadata = {
      id,
      title: g.title,
      platformId: g.platform,
      year: g.year ?? 0,
      developer: g.developer ?? "",
      description: g.description ?? "",
      genre: g.genre ?? "",
      genres: g.genre ? g.genre.split(", ") : undefined,
      artwork: "neutral",
      color: "#12ace2",
      coverUrl: cover,
      backgroundUrl: screenshots[0] ?? cover,
      screenshots,
      sourceUrl: g.source,
    };
    return [
      entry(
        game,
        state[id] ?? {},
        new Date(start - index * 60000).toISOString(),
        false,
      ),
    ];
  });
  const fromComputer = local.map((rom) => {
    const id = `local:${rom.id}`;
    credits.set(id, { local: true });
    const game: GameMetadata = {
      id,
      title: rom.title,
      platformId: rom.platformId,
      year: 0,
      developer: "",
      description: "",
      genre: "",
      artwork: "neutral",
      color: "#12ace2",
      coverUrl: rom.coverUrls[0],
    };
    return entry(game, state[id] ?? {}, rom.addedAt, true);
  });
  return [...fromComputer, ...fromList];
}

export function webCredits(id: string): WebCredits | undefined {
  return credits.get(id);
}

/** What EmulatorJS needs to start a library game. */
export async function webLaunchTarget(
  id: string,
): Promise<{ core: string; rom: File | string } | null> {
  if (id.startsWith("local:")) {
    const rom = await getRom(id.slice("local:".length));
    if (!rom) return null;
    return {
      core: WEB_PLATFORMS[rom.platformId].core,
      rom: new File([rom.rom], rom.fileName),
    };
  }
  if (!roms.has(id)) await webLibrary();
  const target = roms.get(id);
  return target
    ? { core: WEB_PLATFORMS[target.platformId].core, rom: target.url }
    : null;
}

export function webFavorite(id: string, favorite: boolean) {
  updateState(id, (s) => ({ ...s, favorite }));
}

export function webSessionStarted(id: string) {
  updateState(id, (s) => ({ ...s, lastPlayedAt: new Date().toISOString() }));
}

export function webSessionPlayed(id: string, seconds: number) {
  if (seconds > 0)
    updateState(id, (s) => ({
      ...s,
      playtime: (s.playtime ?? 0) + Math.round(seconds),
    }));
}

export async function webRemove(id: string) {
  if (id.startsWith("local:")) await deleteRom(id.slice("local:".length));
  const all = readState();
  delete all[id];
  localStorage.setItem(STATE_KEY, JSON.stringify(all));
}

/** Extensions the file picker offers: every console EmulatorJS runs here. */
export function webAcceptedExtensions(): string[] {
  return [
    "nes",
    "sfc",
    "smc",
    "z64",
    "n64",
    "v64",
    "gb",
    "gbc",
    "gba",
    "nds",
    "sms",
    "md",
    "gen",
    "gg",
    "cue",
    "chd",
    "pbp",
  ];
}

/** The first of these image URLs that loads, if any. */
async function firstImage(urls: string[]): Promise<string | undefined> {
  for (const url of urls) {
    const ok = await new Promise<boolean>((resolve) => {
      const image = new Image();
      image.referrerPolicy = "no-referrer";
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
      image.src = url;
    });
    if (ok) return url;
  }
  return undefined;
}

/** Opens ROMs from the player's computer into the library. */
export function pickWebRoms(): Promise<number> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = webAcceptedExtensions()
      .map((e) => `.${e}`)
      .join(",");
    input.oncancel = () => resolve(0);
    input.onchange = async () => {
      let added = 0;
      for (const file of Array.from(input.files ?? [])) {
        const platformId = detectPlatforms(file.name).find(
          (p) => WEB_PLATFORMS[p],
        );
        if (!platformId) {
          reject(
            t("{name} não é de um console que roda no navegador.", {
              name: file.name,
            }),
          );
          return;
        }
        const base = file.name.replace(/\.[^.]+$/, "");
        const title = base.replace(/\s*[([].*$/, "").trim() || base;
        const regions = ["USA", "USA, Europe", "World", "Europe", "Japan"];
        // No-Intro file names match the thumbnail names exactly.
        const cover = await firstImage(
          thumbnailUrls(platformId, [
            base,
            ...regions.map((r) => `${title} (${r})`),
          ]),
        );
        await saveRom({
          id: crypto.randomUUID(),
          title,
          platformId,
          fileName: file.name,
          coverUrls: cover ? [cover] : [],
          addedAt: new Date().toISOString(),
          rom: file,
        });
        added++;
      }
      resolve(added);
    };
    input.click();
  });
}
