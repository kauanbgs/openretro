import type { DownloadJob } from "../types";
export interface DownloadRequest {
  name: string;
  url: string;
  sha256: string;
}
export interface DownloadTransport {
  download(
    request: DownloadRequest,
    signal: AbortSignal,
    progress: (job: DownloadJob) => void,
  ): Promise<void>;
}
export class DownloadManager {
  validate(request: DownloadRequest) {
    const url = new URL(request.url);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error(
        "Downloads require an HTTPS URL without embedded credentials.",
      );
    if (!/^[a-f0-9]{64}$/i.test(request.sha256))
      throw new Error("A valid SHA-256 checksum is required.");
  }
  constructor(private transport?: DownloadTransport) {}
  async enqueue(
    request: DownloadRequest,
    signal: AbortSignal,
    progress: (job: DownloadJob) => void,
  ) {
    this.validate(request);
    if (!this.transport)
      throw new Error(
        "No authorized download source is configured. Import a local game file to get started.",
      );
    await this.transport.download(request, signal, progress);
  }
}
