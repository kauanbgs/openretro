import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { detectPlatforms } from "../db/platforms";
import type {
  AppSettings,
  Emulator,
  EmulatorInstall,
  GameMetadata,
  ImportCandidate,
  LibraryGame,
  PlayerProfile,
  SaveState,
} from "../types";
import { defaultSettings } from "../types";
import type {
  DownloadSource,
  SourceMatch,
  DownloadJob,
  DownloadedFile,
} from "../types";
import { parseDownloadSource, MAX_SOURCE_BYTES } from "./downloadSources";
import { sourceStore, type PreviewSource } from "./sourceStore";
import { DEFAULT_AVATAR, PLAYER_COLORS } from "./playerAppearance";
export interface FilePickerRequest {
  title: string;
  directory: boolean;
}
let consoleFilePicker:
  ((request: FilePickerRequest) => Promise<string | null>) | undefined;
export function registerFilePicker(
  picker: NonNullable<typeof consoleFilePicker>,
) {
  consoleFilePicker = picker;
  return () => {
    if (consoleFilePicker === picker) consoleFilePicker = undefined;
  };
}
function pickPath(request: FilePickerRequest): Promise<string | null> {
  return consoleFilePicker
    ? consoleFilePicker(request)
    : open({ ...request, multiple: false });
}

export const isDesktop =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const key = "openretro-preview-v1";
export interface PlayerProfiles {
  activeId: string;
  players: PlayerProfile[];
}
export interface GameCapture {
  name: string;
  takenAt: string;
  data: string;
}
function readPlayerProfiles(): PlayerProfiles {
  const stored: PlayerProfiles = JSON.parse(
    localStorage.getItem("openretro-players") ?? "null",
  ) ?? { activeId: "default", players: [{ id: "default", name: "Jogador 1" }] };
  // Profiles saved before avatars existed get the same defaults as the database.
  stored.players = stored.players.map((player) => ({
    ...player,
    avatar: player.avatar ?? DEFAULT_AVATAR,
    color: player.color ?? PLAYER_COLORS[0],
  }));
  return stored;
}
interface PreviewStore {
  library: LibraryGame[];
  emulators: Emulator[];
  settings: AppSettings;
}
function read(): PreviewStore {
  try {
    return (
      JSON.parse(localStorage.getItem(key) ?? "null") ?? {
        library: [],
        emulators: [],
        settings: defaultSettings,
      }
    );
  } catch {
    return { library: [], emulators: [], settings: defaultSettings };
  }
}
function write(data: PreviewStore) {
  localStorage.setItem(key, JSON.stringify(data));
}
export const bridge = {
  async browseFiles(
    path: string,
    query: string,
    directoriesOnly: boolean,
  ): Promise<{
    path: string;
    parent: string | null;
    entries: { name: string; path: string; isDirectory: boolean }[];
    truncated: boolean;
  }> {
    if (!isDesktop)
      throw new Error(
        "Abra o aplicativo OpenRetro para acessar seus arquivos.",
      );
    return invoke("browse_files", { path, query, directoriesOnly });
  },
  async pickSourceJson(): Promise<string | null> {
    if (!isDesktop) return null;
    const path = await pickPath({
      title: "Selecionar fonte JSON",
      directory: false,
    });
    return path ? invoke("read_source_json", { path }) : null;
  },
  async profiles(): Promise<PlayerProfiles> {
    if (isDesktop) return invoke("list_profiles");
    return readPlayerProfiles();
  },
  async createProfile(name: string): Promise<void> {
    if (isDesktop) return invoke("create_profile", { name });
    const profiles = readPlayerProfiles();
    if (!name.trim() || name.trim().length > 32)
      throw new Error("Use um nome entre 1 e 32 caracteres.");
    profiles.players.push({
      id: crypto.randomUUID(),
      name: name.trim(),
      avatar: DEFAULT_AVATAR,
      color: PLAYER_COLORS[profiles.players.length % PLAYER_COLORS.length],
    });
    localStorage.setItem("openretro-players", JSON.stringify(profiles));
  },
  async updateProfile(
    id: string,
    name: string,
    avatar: string,
    color: string,
  ): Promise<void> {
    if (isDesktop) return invoke("update_profile", { id, name, avatar, color });
    const profiles = readPlayerProfiles();
    const player = profiles.players.find((p) => p.id === id);
    if (!player) throw new Error("Jogador não encontrado.");
    if (!name.trim() || name.trim().length > 32)
      throw new Error("Use um nome entre 1 e 32 caracteres.");
    Object.assign(player, { name: name.trim(), avatar, color });
    localStorage.setItem("openretro-players", JSON.stringify(profiles));
  },
  async selectProfile(id: string): Promise<void> {
    if (isDesktop) return invoke("select_profile", { id });
    const profiles = readPlayerProfiles();
    if (!profiles.players.some((p) => p.id === id))
      throw new Error("Jogador não encontrado.");
    // Preview uses the same projection behavior as the native library.
    const progress = JSON.parse(
      localStorage.getItem("openretro-player-progress") ?? "{}",
    );
    progress[profiles.activeId] = read().library.map(({ item }) => ({
      id: item.id,
      favorite: item.favorite,
      playtime: item.playtime,
      lastPlayedAt: item.lastPlayedAt,
    }));
    localStorage.setItem("openretro-player-progress", JSON.stringify(progress));
    const store = read();
    store.library = store.library.map((entry) => {
      const item = progress[id]?.find(
        (p: { id: string }) => p.id === entry.item.id,
      );
      return {
        ...entry,
        item: {
          ...entry.item,
          favorite: item?.favorite ?? false,
          playtime: item?.playtime ?? 0,
          lastPlayedAt: item?.lastPlayedAt ?? null,
        },
      };
    });
    write(store);
    localStorage.setItem(
      "openretro-players",
      JSON.stringify({ ...profiles, activeId: id }),
    );
  },
  async downloadSources(): Promise<DownloadSource[]> {
    return isDesktop
      ? invoke("list_download_sources")
      : (await sourceStore.list()).map(
          ({ document: _document, ...source }) => source,
        );
  },
  async saveDownloadSource(
    text: string | null,
    url: string | null = null,
    id: string | null = null,
  ): Promise<void> {
    if (isDesktop) return invoke("save_download_source", { text, url, id });
    if (!text) {
      if (!url || new URL(url).protocol !== "https:")
        throw new Error("Enter an HTTPS source URL.");
      const response = await fetch(url, {
        signal: AbortSignal.timeout(45000),
      }).catch(() => {
        throw new Error(
          "This source cannot be fetched by the browser. Paste/import its JSON, or use the desktop app.",
        );
      });
      if (!response.ok)
        throw new Error(`Source returned HTTP ${response.status}.`);
      if (Number(response.headers.get("content-length")) > MAX_SOURCE_BYTES)
        throw new Error("Source exceeds the 16 MB limit.");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Empty source response.");
      const decoder = new TextDecoder();
      let size = 0;
      text = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_SOURCE_BYTES)
            throw new Error("Source exceeds the 16 MB limit.");
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        await reader.cancel();
      }
    }
    const document = parseDownloadSource(text);
    const sources = await sourceStore.list();
    if (url && sources.some((s) => s.url === url && s.id !== id))
      throw new Error("This source URL is already registered.");
    const previous = sources.find((s) => s.id === id);
    const source: PreviewSource = {
      id: id ?? crypto.randomUUID(),
      name: document.name,
      url,
      enabled: previous?.enabled ?? true,
      updatedAt: new Date().toISOString(),
      gameCount: document.downloads.length,
      document,
    };
    await sourceStore.put(source);
  },
  async setDownloadSource(id: string, enabled: boolean): Promise<void> {
    if (isDesktop) return invoke("set_download_source", { id, enabled });
    await sourceStore.setEnabled(id, enabled);
  },
  async removeDownloadSource(id: string): Promise<void> {
    if (isDesktop) return invoke("remove_download_source", { id });
    await sourceStore.remove(id);
  },
  async searchDownloadSources(query: string): Promise<SourceMatch[]> {
    if (isDesktop) return invoke("search_download_sources", { query });
    return sourceStore.search(query, 60);
  },
  async availableDownloadTitles(titles: string[]): Promise<string[]> {
    if (isDesktop) return invoke("available_download_titles", { titles });
    return sourceStore.available(titles);
  },
  async startDownload(
    match: SourceMatch,
    uriIndex: number,
    game?: GameMetadata,
    downloadDirectory?: string | null,
    autoExtract = true,
    autoAddToLibrary = true,
  ): Promise<string> {
    if (!isDesktop)
      throw new Error(
        "Use the OpenRetro desktop app to download files. Source management is available in this preview.",
      );
    return invoke("start_source_download", {
      sourceId: match.sourceId,
      entryId: match.id,
      uriIndex,
      game: game ?? null,
      downloadDirectory: downloadDirectory ?? null,
      autoExtract,
      autoAddToLibrary,
    });
  },
  async downloadJobs(): Promise<DownloadJob[]> {
    if (isDesktop) return invoke("list_download_jobs");
    return [];
  },
  async controlDownload(
    id: string,
    action: "pause" | "resume" | "cancel",
  ): Promise<void> {
    if (isDesktop) return invoke("control_download", { id, action });
  },
  async removeDownload(id: string): Promise<void> {
    if (isDesktop) return invoke("remove_download", { id });
  },
  /** Runs the import in the background; progress appears on the job. */
  async addDownloadToLibrary(id: string, path?: string): Promise<void> {
    if (!isDesktop)
      throw new Error("Use o aplicativo desktop para adicionar downloads.");
    return invoke("add_download_to_library", { id, path: path ?? null });
  },
  async downloadFiles(id: string): Promise<DownloadedFile[]> {
    return isDesktop ? invoke("download_files", { id }) : [];
  },
  async inspect(path: string): Promise<ImportCandidate> {
    if (!isDesktop)
      throw new Error("Inspect downloaded files in the desktop app.");
    return invoke("inspect_game", { path });
  },
  async pickDownloadDirectory(): Promise<string | null> {
    if (!isDesktop) throw new Error("Choose the directory in the desktop app.");
    return pickPath({
      directory: true,
      title: "Choose download directory",
    });
  },
  library: (): Promise<LibraryGame[]> =>
    isDesktop ? invoke("list_library") : Promise.resolve(read().library),
  emulators: (): Promise<Emulator[]> =>
    isDesktop ? invoke("list_emulators") : Promise.resolve(read().emulators),
  emulatorInstallOptions: (): Promise<EmulatorInstall[]> =>
    isDesktop ? invoke("emulator_install_options") : Promise.resolve([]),
  async installEmulator(id: string): Promise<string> {
    if (!isDesktop)
      throw new Error("Install emulators in the OpenRetro desktop app.");
    return invoke("install_emulator", { id });
  },
  settings: (): Promise<AppSettings> =>
    isDesktop ? invoke("get_settings") : Promise.resolve(read().settings),
  async pickGame(): Promise<ImportCandidate | null> {
    if (isDesktop) {
      const path = await pickPath({
        directory: false,
        title: "Locate your game file",
      });
      return path ? invoke("inspect_game", { path }) : null;
    }
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.oncancel = () => resolve(null);
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        const hash = await crypto.subtle.digest(
          "SHA-256",
          await file.arrayBuffer(),
        );
        resolve({
          path: file.name,
          filename: file.name,
          sha256: Array.from(new Uint8Array(hash))
            .map((x) => x.toString(16).padStart(2, "0"))
            .join(""),
          platformIds: detectPlatforms(file.name),
        });
      };
      input.click();
    });
  },
  async pickGameFolder(): Promise<string | null> {
    if (!isDesktop)
      throw new Error("Folder import requires the OpenRetro desktop app.");
    return pickPath({
      directory: true,
      title: "Choose a folder with game files",
    });
  },
  async inspectGameFolder(path: string): Promise<ImportCandidate[]> {
    if (!isDesktop)
      throw new Error("Folder import requires the OpenRetro desktop app.");
    return invoke("inspect_game_folder", { path });
  },
  async pickExecutable(): Promise<string | null> {
    if (!isDesktop)
      throw new Error(
        "Emulator executables can be configured in the desktop app. Run npm run tauri dev.",
      );
    return pickPath({
      directory: false,
      title: "Select emulator executable",
    });
  },
  async pickBios(): Promise<string | null> {
    if (!isDesktop)
      throw new Error("BIOS configuration requires the desktop app.");
    return pickPath({
      directory: false,
      title: "Select your legally obtained BIOS file",
    });
  },
  async addGame(game: GameMetadata, candidate: ImportCandidate): Promise<void> {
    if (isDesktop) return invoke("add_game", { game, candidate });
    const data = read();
    if (data.library.some((l) => l.item.sha256 === candidate.sha256))
      throw new Error("This file is already in your library.");
    data.library.unshift({
      game,
      item: {
        id: crypto.randomUUID(),
        gameId: game.id,
        platformId: game.platformId,
        sourceProvider: "local",
        sourcePath: candidate.path,
        emulatorId: null,
        installed: true,
        favorite: false,
        addedAt: new Date().toISOString(),
        lastPlayedAt: null,
        playtime: 0,
        sha256: candidate.sha256,
        biosPath: null,
        runtimeArgs: [],
      },
    });
    write(data);
  },
  async removeGame(id: string, deleteFile = false) {
    if (isDesktop) return invoke("remove_game", { id, deleteFile });
    const d = read();
    d.library = d.library.filter((x) => x.item.id !== id);
    write(d);
  },
  async favorite(id: string, favorite: boolean) {
    if (isDesktop) return invoke("set_favorite", { id, favorite });
    const d = read();
    d.library = d.library.map((x) =>
      x.item.id === id ? { ...x, item: { ...x.item, favorite } } : x,
    );
    write(d);
  },
  async configureGame(
    id: string,
    emulatorId: string | null,
    biosPath: string | null,
    runtimeArgs: string[],
  ) {
    if (isDesktop)
      return invoke("configure_game", {
        id,
        emulatorId,
        biosPath,
        runtimeArgs,
      });
    throw new Error("Launch configuration requires the desktop app.");
  },
  async relocate(id: string, candidate: ImportCandidate) {
    if (isDesktop) return invoke("relocate_game", { id, candidate });
    const d = read();
    const entry = d.library.find((x) => x.item.id === id);
    if (entry) {
      entry.item.sourcePath = candidate.path;
      entry.item.sha256 = candidate.sha256;
      write(d);
    }
  },
  async verify(id: string): Promise<boolean> {
    if (isDesktop) return invoke("verify_game", { id });
    throw new Error(
      "File verification requires the desktop app, which can access the original path.",
    );
  },
  async exists(path: string): Promise<boolean> {
    if (isDesktop) return invoke("file_exists", { path });
    return false;
  },
  async saveEmulator(emulator: Emulator) {
    if (isDesktop) return invoke("save_emulator", { emulator });
    throw new Error("Emulator configuration requires the desktop app.");
  },
  async removeEmulator(id: string) {
    if (isDesktop) return invoke("remove_emulator", { id });
  },
  async detectEmulators(): Promise<Emulator[]> {
    return isDesktop ? invoke("detect_emulators") : [];
  },
  async testEmulator(id: string): Promise<string> {
    if (isDesktop) return invoke("test_emulator", { id });
    throw new Error("Testing executables requires the desktop app.");
  },
  /** `slot` starts from a saved state: -1 is the automatic resume state. */
  async launch(id: string, slot?: number): Promise<number> {
    if (isDesktop) return invoke("launch_game", { id, slot: slot ?? null });
    throw new Error(
      "Open the desktop app to launch a game with your configured emulator.",
    );
  },
  async saveStates(id: string): Promise<SaveState[]> {
    return isDesktop ? invoke("list_save_states", { id }) : [];
  },
  async deleteSaveState(id: string, slot: number): Promise<void> {
    if (!isDesktop)
      throw new Error("Abra o aplicativo desktop para gerenciar seus saves.");
    return invoke("delete_save_state", { id, slot });
  },
  async runtimeBiosStatus(platformId: string): Promise<boolean> {
    return isDesktop
      ? invoke("runtime_bios_status", { platform: platformId })
      : true;
  },
  /** Asks for a BIOS file or ZIP and copies it; resolves null when cancelled. */
  async installRuntimeBios(platformId: string): Promise<number | null> {
    if (!isDesktop)
      throw new Error("Abra o aplicativo desktop para adicionar a BIOS.");
    const path = await pickPath({
      directory: false,
      title: "Selecione a BIOS (.bin) ou um .zip com ela",
    });
    return path
      ? invoke("install_runtime_bios", { platform: platformId, path })
      : null;
  },
  async gameCaptures(id: string): Promise<GameCapture[]> {
    return isDesktop ? invoke("list_game_screenshots", { id }) : [];
  },
  async openGameScreenshots(id: string): Promise<void> {
    if (!isDesktop)
      throw new Error("Abra o aplicativo desktop para ver suas capturas.");
    return invoke("open_game_screenshots", { id });
  },
  async saveSettings(settings: AppSettings) {
    if (isDesktop) return invoke("save_settings", { settings });
    const d = read();
    d.settings = settings;
    write(d);
  },
  async appPaths(): Promise<{ database: string; cache: string; logs: string }> {
    return isDesktop
      ? invoke("app_paths")
      : {
          database: "Browser preview · localStorage",
          cache: "Browser cache",
          logs: "Browser developer console",
        };
  },
};
