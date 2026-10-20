import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { detectPlatforms } from "../db/platforms";
import type {
  AppSettings,
  Emulator,
  GameMetadata,
  ImportCandidate,
  LibraryGame,
} from "../types";
import { defaultSettings } from "../types";

export const isDesktop =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const key = "openretro-preview-v1";
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
  library: (): Promise<LibraryGame[]> =>
    isDesktop ? invoke("list_library") : Promise.resolve(read().library),
  emulators: (): Promise<Emulator[]> =>
    isDesktop ? invoke("list_emulators") : Promise.resolve(read().emulators),
  settings: (): Promise<AppSettings> =>
    isDesktop ? invoke("get_settings") : Promise.resolve(read().settings),
  async pickGame(): Promise<ImportCandidate | null> {
    if (isDesktop) {
      const path = await open({
        multiple: false,
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
  async pickExecutable(): Promise<string | null> {
    if (!isDesktop)
      throw new Error(
        "Emulator executables can be configured in the desktop app. Run npm run tauri dev.",
      );
    return open({
      multiple: false,
      directory: false,
      title: "Select emulator executable",
    });
  },
  async pickBios(): Promise<string | null> {
    if (!isDesktop)
      throw new Error("BIOS configuration requires the desktop app.");
    return open({
      multiple: false,
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
  async removeGame(id: string) {
    if (isDesktop) return invoke("remove_game", { id });
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
    return isDesktop ? invoke("file_exists", { path }) : false;
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
  async launch(id: string): Promise<number> {
    if (isDesktop) return invoke("launch_game", { id });
    throw new Error(
      "Open the desktop app to launch a game with your configured emulator.",
    );
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
