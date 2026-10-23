import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Exercise the hook's timers and async updater calls without a desktop window.
const hooks = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  phases: vi.fn(),
}));
vi.mock("react", () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, hooks.phases],
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useUpdates } from "./updates";

const update = {
  version: "0.4.4",
  download: vi.fn(),
  install: vi.fn(),
  downloadAndInstall: vi.fn(),
};
let cleanup: void | (() => void);
const notify = vi.fn();

function mount(options: Partial<Parameters<typeof useUpdates>[0]> = {}) {
  const result = useUpdates({
    enabled: true,
    automatic: true,
    playing: false,
    notify,
    ...options,
  });
  cleanup = hooks.effects[0]();
  return result;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  hooks.effects.length = 0;
  vi.stubGlobal("window", globalThis);
  vi.mocked(check).mockResolvedValue(
    update as unknown as Awaited<ReturnType<typeof check>>,
  );
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("installs a startup update and relaunches", async () => {
  mount();
  await vi.advanceTimersByTimeAsync(1500);
  expect(update.downloadAndInstall).toHaveBeenCalledOnce();
  expect(relaunch).toHaveBeenCalledOnce();
});

it("downloads during a game and installs only when requested", async () => {
  const { install } = mount({ playing: true });
  await vi.advanceTimersByTimeAsync(1500);
  expect(update.download).toHaveBeenCalledOnce();
  expect(update.downloadAndInstall).not.toHaveBeenCalled();
  expect(relaunch).not.toHaveBeenCalled();
  expect(hooks.phases).toHaveBeenCalledWith("ready");
  await install();
  expect(update.install).toHaveBeenCalledOnce();
  expect(relaunch).toHaveBeenCalledOnce();
});

it("announces a release without downloading when automatic updates are off", async () => {
  mount({ automatic: false });
  await vi.advanceTimersByTimeAsync(1500);
  expect(hooks.phases).toHaveBeenCalledWith("available");
  expect(update.download).not.toHaveBeenCalled();
  expect(update.downloadAndInstall).not.toHaveBeenCalled();
});

it("shows a check failure and allows a manual retry", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(check).mockRejectedValueOnce("updater.check not allowed");
  const { install } = mount();
  await vi.advanceTimersByTimeAsync(1500);
  expect(notify).toHaveBeenCalledWith(
    expect.stringContaining("updater.check not allowed"),
  );
  expect(hooks.phases).toHaveBeenCalledWith("idle");
  await install();
  expect(update.downloadAndInstall).toHaveBeenCalledOnce();
  vi.mocked(console.error).mockRestore();
});

it("keeps a failed download available for manual retry", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  update.download.mockRejectedValueOnce(new Error("Network unavailable"));
  const { install } = mount({ playing: true });
  await vi.advanceTimersByTimeAsync(1500);
  expect(notify).toHaveBeenCalledWith(
    expect.stringContaining("Network unavailable"),
  );
  expect(hooks.phases).toHaveBeenCalledWith("available");
  await install();
  expect(update.downloadAndInstall).toHaveBeenCalledOnce();
  expect(update.install).not.toHaveBeenCalled();
  vi.mocked(console.error).mockRestore();
});

it("preserves the startup check when development mode replays the effect", async () => {
  mount();
  cleanup?.();
  cleanup = hooks.effects[0]();
  await vi.advanceTimersByTimeAsync(1500);
  expect(check).toHaveBeenCalledOnce();
  expect(update.downloadAndInstall).toHaveBeenCalledOnce();
});

it("does not check when disabled", async () => {
  mount({ enabled: false });
  await vi.advanceTimersByTimeAsync(1500);
  expect(check).not.toHaveBeenCalled();
});
