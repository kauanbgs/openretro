import { expect, it } from "vitest";
import { downloadPollInterval } from "./activity";
import type { DownloadJob } from "../types";
const jobs = (state: DownloadJob["state"]) => [{ state }] as DownloadJob[];
it("polls ongoing preparation and transfers, and stops when idle, previewing or playing", () => {
  for (const state of [
    "QUEUED",
    "RESOLVING",
    "DOWNLOADING",
    "VERIFYING",
    "INSTALLING",
  ] as const)
    expect(downloadPollInterval(jobs(state), true, false)).toBe(2000);
  for (const state of ["PAUSED", "FAILED", "CANCELLED", "COMPLETED"] as const)
    expect(downloadPollInterval(jobs(state), true, false)).toBe(false);
  expect(downloadPollInterval([], true, false)).toBe(false);
  expect(downloadPollInterval(undefined, true, false)).toBe(false);
  expect(downloadPollInterval(jobs("DOWNLOADING"), false, false)).toBe(false);
  expect(downloadPollInterval(jobs("DOWNLOADING"), true, true)).toBe(false);
});
