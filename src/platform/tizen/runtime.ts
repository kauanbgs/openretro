import type { LibraryGame } from "../../types";
import { tizenReadFile } from "./api";

export const tizenPlatforms = [
  "nes",
  "snes",
  "gb",
  "gbc",
  "gba",
  "sms",
  "genesis",
  "gg",
] as const;

const cores: Record<string, string> = {
  nes: "fceumm",
  snes: "snes9x2005",
  gb: "gambatte",
  gbc: "gambatte",
  gba: "gpsp",
  sms: "genesis_plus_gx",
  genesis: "genesis_plus_gx",
  gg: "genesis_plus_gx",
};

export const coreForTizenPlatform = (platform: string) => cores[platform];

interface EmscriptenFs {
  mkdirTree(path: string): void;
  writeFile(path: string, data: Uint8Array | string): void;
  mount(type: unknown, options: object, path: string): void;
  syncfs(populate: boolean, callback: (error?: unknown) => void): void;
  filesystems: { IDBFS: unknown };
}

interface RetroArchModule {
  FS: EmscriptenFs;
  callMain(arguments_: string[]): Promise<number> | number;
  EmscriptenSendCommand?(command: string): void;
  _cmd_toggle_pause?(): void;
  _cmd_save_state?(): void;
  _cmd_load_state?(): void;
  _cmd_take_screenshot?(): void;
}

type RuntimeFactory = (options: {
  canvas: HTMLCanvasElement;
  noInitialRun: boolean;
  locateFile(path: string): string;
  print(message: string): void;
  printErr(message: string): void;
  onExit(status: number): void;
  onAbort(reason: unknown): void;
}) => Promise<RetroArchModule>;

export interface TizenSession {
  entry: LibraryGame;
  resolve(seconds: number): void;
  reject(error: unknown): void;
}

type SessionListener = (session?: TizenSession) => void;
let current: TizenSession | undefined;
const listeners = new Set<SessionListener>();

function publish() {
  for (const listener of listeners) listener(current);
}

export function subscribeTizenSession(listener: SessionListener) {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

export function launchTizenGame(entry: LibraryGame): Promise<number> {
  if (current)
    return Promise.reject(new Error("Já existe um jogo em execução."));
  if (!coreForTizenPlatform(entry.game.platformId))
    return Promise.reject(
      new Error("Este console ainda não está disponível na versão para TV."),
    );
  return new Promise((resolve, reject) => {
    current = { entry, resolve, reject };
    publish();
  });
}

export function finishTizenSession(error?: unknown, seconds = 0) {
  const session = current;
  current = undefined;
  publish();
  if (!session) return;
  if (error) session.reject(error);
  else session.resolve(seconds);
}

function sync(fs: EmscriptenFs, populate: boolean) {
  return new Promise<void>((resolve, reject) =>
    fs.syncfs(populate, (error) => (error ? reject(error) : resolve())),
  );
}

function safeFilename(path: string) {
  const name = path.split(/[\\/]/).pop() ?? "game.rom";
  return name.replace(/[^a-zA-Z0-9._ -]/g, "_");
}

export class TizenRuntime {
  private module?: RetroArchModule;
  private startedAt = 0;

  async start(
    entry: LibraryGame,
    canvas: HTMLCanvasElement,
    onReady?: () => void,
  ) {
    const core = coreForTizenPlatform(entry.game.platformId);
    if (!core) throw new Error("Console sem runtime WebAssembly compatível.");
    const base = new URL(`./runtime/${core}/`, document.baseURI).href;
    const source = `${base}${core}_libretro.js`;
    const imported = (await import(/* @vite-ignore */ source)) as {
      default?: RuntimeFactory;
    };
    if (typeof imported.default !== "function")
      throw new Error(`O módulo ${core} do OpenRetro Runtime está ausente.`);
    let exit!: () => void;
    let abort!: (reason: unknown) => void;
    const exited = new Promise<void>((resolve, reject) => {
      exit = resolve;
      abort = reject;
    });
    const module = await imported.default({
      canvas,
      noInitialRun: true,
      locateFile: (path) => `${base}${path}`,
      print: (message) => console.info(`[runtime] ${message}`),
      printErr: (message) => console.error(`[runtime] ${message}`),
      onExit: () => exit(),
      onAbort: (reason) => abort(reason),
    });
    this.module = module;
    const fs = module.FS;
    fs.mkdirTree("/openretro/content");
    fs.mkdirTree("/openretro/userdata");
    fs.mount(fs.filesystems.IDBFS, {}, "/openretro/userdata");
    await sync(fs, true);
    for (const directory of ["saves", "states", "screenshots", "system"])
      fs.mkdirTree(`/openretro/userdata/${directory}`);
    const rom = `/openretro/content/${safeFilename(entry.item.sourcePath)}`;
    fs.writeFile(rom, await tizenReadFile(entry.item.sourcePath));
    fs.writeFile(
      "/openretro/openretro.cfg",
      [
        'config_save_on_exit = "false"',
        'video_fullscreen = "false"',
        'menu_enable_widgets = "false"',
        'savefile_directory = "/openretro/userdata/saves"',
        'savestate_directory = "/openretro/userdata/states"',
        'screenshot_directory = "/openretro/userdata/screenshots"',
        'system_directory = "/openretro/userdata/system"',
        'savestate_auto_save = "true"',
        'savestate_auto_load = "true"',
      ].join("\n"),
    );
    this.startedAt = performance.now();
    onReady?.();
    try {
      void Promise.resolve(
        module.callMain(["--appendconfig", "/openretro/openretro.cfg", rom]),
      ).catch((error) => {
        if (String(error) !== "unwind") abort(error);
      });
    } catch (error) {
      if (String(error) !== "unwind") throw error;
    }
    await exited;
    await sync(fs, false);
  }

  pause() {
    this.module?._cmd_toggle_pause?.();
  }
  save() {
    this.module?._cmd_save_state?.();
  }
  load() {
    this.module?._cmd_load_state?.();
  }
  screenshot() {
    this.module?._cmd_take_screenshot?.();
  }
  async stop() {
    this.module?.EmscriptenSendCommand?.("QUIT");
    if (this.module) await sync(this.module.FS, false).catch(() => undefined);
    return Math.max(0, Math.round((performance.now() - this.startedAt) / 1000));
  }
}
