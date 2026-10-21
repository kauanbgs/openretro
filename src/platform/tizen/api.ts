import { isTizen } from "../environment";

interface TizenError {
  message?: string;
  name?: string;
}

interface TizenFileHandle {
  readDataNonBlocking(
    success: (data: Uint8Array) => void,
    failure: (error: TizenError) => void,
  ): void;
  close(): void;
}

interface TizenApi {
  application: {
    getCurrentApplication(): { exit(): void };
  };
  filesystem: {
    openFile(path: string, mode: "r"): TizenFileHandle;
  };
  tvinputdevice?: {
    registerKey(key: string): void;
  };
}

function api(): TizenApi | undefined {
  return (window as Window & { tizen?: TizenApi }).tizen;
}

export function initializeTizen() {
  const tizen = api();
  if (!isTizen || !tizen) return;
  for (const key of [
    "MediaPlayPause",
    "MediaStop",
    "ColorF0Red",
    "ColorF1Green",
    "ColorF2Yellow",
    "ColorF3Blue",
  ]) {
    try {
      tizen.tvinputdevice?.registerKey(key);
    } catch {
      // Older models expose only the directional and return keys by default.
    }
  }
}

export function exitTizenApplication() {
  api()?.application.getCurrentApplication().exit();
}

export async function tizenReadFile(path: string): Promise<Uint8Array> {
  const tizen = api();
  if (!tizen)
    throw new Error("O sistema de arquivos Tizen só está disponível na TV.");
  const handle = tizen.filesystem.openFile(path, "r");
  return new Promise((resolve, reject) => {
    handle.readDataNonBlocking(
      (data) => {
        handle.close();
        resolve(data);
      },
      (failure) => {
        handle.close();
        reject(
          new Error(
            failure.message ?? failure.name ?? "Não foi possível ler o jogo.",
          ),
        );
      },
    );
  });
}

export async function tizenFileExists(path: string): Promise<boolean> {
  try {
    const tizen = api();
    if (!tizen) return false;
    const handle = tizen.filesystem.openFile(path, "r");
    handle.close();
    return true;
  } catch {
    return false;
  }
}
