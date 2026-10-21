import type { DownloadJob } from "../types";
export const activeTransferStates = new Set([
  "QUEUED",
  "RESOLVING",
  "DOWNLOADING",
  "VERIFYING",
  "INSTALLING",
]);
export function downloadPollInterval(
  jobs: DownloadJob[] | undefined,
  desktop: boolean,
  playing: boolean,
): 2000 | false {
  return desktop &&
    !playing &&
    jobs?.some((job) => activeTransferStates.has(job.state))
    ? 2000
    : false;
}
