// How the interface reaches OpenRetro's backend: Tauri on the PC, or, on a
// paired phone, the PC's phone-play server over the local network. Every
// page imports invoke, listen and convertFileSrc from here.
import {
  convertFileSrc as tauriFileSrc,
  invoke as tauriInvoke,
} from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";

type Window = typeof globalThis & {
  __TAURI_INTERNALS__?: unknown;
  __OPENRETRO_REMOTE__?: boolean;
};
const scope = (typeof window === "undefined" ? {} : window) as Window;

/** Running in OpenRetro on the PC. */
export const isTauri = "__TAURI_INTERNALS__" in scope;
/** Running on a phone paired with the PC. */
export const isRemote = scope.__OPENRETRO_REMOTE__ === true;
/** A backend answers either way; false only in a plain browser preview. */
export const hasBackend = isTauri || isRemote;
/** The same check, made at call time for code that runs before setup. */
export function backendAvailable() {
  if (typeof window === "undefined") return false;
  const current = window as Window;
  return (
    "__TAURI_INTERNALS__" in current || current.__OPENRETRO_REMOTE__ === true
  );
}

export async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isRemote)
    return args === undefined
      ? tauriInvoke<T>(command)
      : tauriInvoke<T>(command, args);
  const response = await fetch("/api/invoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd: command, args: args ?? {} }),
  });
  if (response.status === 403)
    throw "A conexão com o computador expirou. Abra pelo QR code de novo.";
  const body = (await response.json()) as { result?: T; error?: string };
  if (!response.ok) throw body.error ?? "O computador não respondeu.";
  return body.result as T;
}

export function convertFileSrc(path: string) {
  return isRemote ? `/file?p=${encodeURIComponent(path)}` : tauriFileSrc(path);
}

type Handler = (event: { payload: unknown }) => void;
const handlers = new Map<string, Set<Handler>>();
let socket: WebSocket | undefined;

function openEvents() {
  socket = new WebSocket(`ws://${location.host}/events`);
  socket.onmessage = (message) => {
    const { name, payload } = JSON.parse(message.data as string) as {
      name: string;
      payload: unknown;
    };
    handlers.get(name)?.forEach((handler) => handler({ payload }));
  };
  socket.onclose = () => {
    socket = undefined;
    if (handlers.size) setTimeout(openEvents, 1500);
  };
}

export async function listen<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<() => void> {
  if (!isRemote) return tauriListen<T>(event, handler);
  const set = handlers.get(event) ?? new Set<Handler>();
  set.add(handler as Handler);
  handlers.set(event, set);
  if (!socket) openEvents();
  return () => {
    set.delete(handler as Handler);
    if (!set.size) handlers.delete(event);
  };
}
