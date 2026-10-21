import type { DownloadJob, GameMetadata, SourceMatch } from "../../types";

interface DownloadError {
  message?: string;
  name?: string;
}
interface DownloadListener {
  onprogress(id: number, received: number, total: number): void;
  onpaused(id: number): void;
  oncanceled(id: number): void;
  oncompleted(id: number, path: string): void;
  onfailed(id: number, error: DownloadError): void;
}
interface DownloadRequestValue {}
interface ArchiveEntry {
  name: string;
  extract(
    destination: string,
    success: () => void,
    failure: (error: DownloadError) => void,
    progress?: unknown,
    stripName?: boolean,
    overwrite?: boolean,
  ): number;
}
interface ArchiveFile {
  getEntries(
    success: (entries: ArchiveEntry[]) => void,
    failure: (error: DownloadError) => void,
  ): number;
  close(): void;
}
interface DownloadApi {
  DownloadRequest: new (
    url: string,
    destination?: string,
    fileName?: string,
    networkType?: "WIFI" | "ALL",
  ) => DownloadRequestValue;
  download: {
    start(request: DownloadRequestValue, listener: DownloadListener): number;
    pause(id: number): void;
    resume(id: number): void;
    cancel(id: number): void;
  };
  filesystem: {
    createDirectory(path: string, makeParents?: boolean): void;
  };
  archive: {
    open(
      path: string,
      mode: "r",
      success: (archive: ArchiveFile) => void,
      failure: (error: DownloadError) => void,
    ): number;
  };
}

const storageKey = "openretro-tizen-downloads-v1";
let jobs: DownloadJob[] = (() => {
  try {
    return (
      JSON.parse(localStorage.getItem(storageKey) ?? "[]") as DownloadJob[]
    ).map((job) =>
      ["QUEUED", "DOWNLOADING", "PAUSED", "INSTALLING"].includes(job.state)
        ? {
            ...job,
            state: "FAILED" as const,
            bytesPerSecond: 0,
            remainingSeconds: null,
            error: "O download foi interrompido quando o aplicativo fechou.",
          }
        : job,
    );
  } catch {
    return [];
  }
})();
const nativeIds = new Map<string, number>();
const startedAt = new Map<string, { time: number; bytes: number }>();

function tizen(): DownloadApi {
  const value = (window as Window & { tizen?: DownloadApi }).tizen;
  if (!value) throw new Error("A API de downloads Tizen não está disponível.");
  return value;
}
function save() {
  localStorage.setItem(storageKey, JSON.stringify(jobs));
  window.dispatchEvent(new Event("openretro:tizen-downloads"));
}
function update(id: string, value: Partial<DownloadJob>) {
  jobs = jobs.map((job) => (job.id === id ? { ...job, ...value } : job));
  save();
}
function cleanFilename(value: string) {
  const fromUrl = decodeURIComponent(
    new URL(value).pathname.split("/").pop() ?? "game.rom",
  );
  return fromUrl.replace(/[\\/:*?"<>|\r\n]/g, "_").slice(0, 180) || "game.rom";
}

export function tizenDownloadJobs() {
  return jobs;
}

export function startTizenDownload(
  match: SourceMatch,
  uriIndex: number,
  game?: GameMetadata,
  autoExtract = true,
  onReady?: (path: string) => Promise<void>,
): string {
  const uri = match.uris[uriIndex];
  if (!uri || new URL(uri).protocol !== "https:")
    throw new Error("A TV aceita somente downloads HTTPS diretos.");
  const temporaryId = `tizen-pending-${Date.now()}`;
  const filename = cleanFilename(uri);
  const job: DownloadJob = {
    id: temporaryId,
    name: match.title,
    state: "QUEUED",
    progress: 0,
    bytesPerSecond: 0,
    remainingSeconds: null,
    sourceName: match.sourceName,
    directory: "downloads/OpenRetro",
    downloadedBytes: 0,
    game,
    autoExtract,
    autoAddToLibrary: true,
  };
  jobs = [job, ...jobs];
  save();
  const request = new (tizen().DownloadRequest)(
    uri,
    "downloads/OpenRetro",
    filename,
    "WIFI",
  );
  let id = temporaryId;
  const nativeId = tizen().download.start(request, {
    onprogress: (_native, received, total) => {
      const previous = startedAt.get(id) ?? { time: Date.now(), bytes: 0 };
      const elapsed = Math.max(1, Date.now() - previous.time);
      const speed = Math.round(((received - previous.bytes) * 1000) / elapsed);
      startedAt.set(id, { time: Date.now(), bytes: received });
      update(id, {
        state: "DOWNLOADING",
        progress: total ? (received / total) * 100 : 0,
        downloadedBytes: received,
        totalBytes: total,
        bytesPerSecond: Math.max(0, speed),
        remainingSeconds:
          speed > 0 && total > received
            ? Math.ceil((total - received) / speed)
            : null,
      });
    },
    onpaused: () => update(id, { state: "PAUSED", bytesPerSecond: 0 }),
    oncanceled: () => update(id, { state: "CANCELLED", bytesPerSecond: 0 }),
    oncompleted: (_native, path) => {
      update(id, {
        state: "INSTALLING",
        progress: 100,
        directory: path,
        bytesPerSecond: 0,
        remainingSeconds: 0,
      });
      void prepareDownloadedGame(path, id, autoExtract)
        .then(async (gamePath) => {
          await onReady?.(gamePath);
          update(id, { state: "COMPLETED", directory: gamePath });
        })
        .catch((error) =>
          update(id, { state: "FAILED", error: String(error) }),
        );
    },
    onfailed: (_native, failure) =>
      update(id, {
        state: "FAILED",
        bytesPerSecond: 0,
        error: failure.message ?? failure.name ?? "O download falhou.",
      }),
  });
  id = `tizen-${nativeId}`;
  jobs = jobs.map((entry) =>
    entry.id === temporaryId ? { ...entry, id } : entry,
  );
  nativeIds.set(id, nativeId);
  startedAt.set(id, { time: Date.now(), bytes: 0 });
  save();
  return id;
}

const playable = new Set([
  "nes",
  "sfc",
  "smc",
  "gb",
  "gbc",
  "gba",
  "sms",
  "md",
  "gen",
  "bin",
  "gg",
]);
async function prepareDownloadedGame(
  path: string,
  id: string,
  autoExtract: boolean,
) {
  if (!autoExtract || !path.toLowerCase().endsWith(".zip")) return path;
  const destination = `downloads/OpenRetro/extracted/${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  tizen().filesystem.createDirectory(destination, true);
  return new Promise<string>((resolve, reject) => {
    tizen().archive.open(
      path,
      "r",
      (archive) =>
        archive.getEntries(
          (entries) => {
            const entry = entries.find((candidate) =>
              playable.has(
                candidate.name.split(".").pop()?.toLowerCase() ?? "",
              ),
            );
            if (!entry) {
              archive.close();
              reject(
                new Error(
                  "O arquivo ZIP não contém um jogo compatível com a TV.",
                ),
              );
              return;
            }
            const filename = entry.name.split("/").pop() ?? "game.rom";
            entry.extract(
              destination,
              () => {
                archive.close();
                resolve(`${destination}/${filename}`);
              },
              (failure) => {
                archive.close();
                reject(
                  new Error(
                    failure.message ?? "Não foi possível extrair o jogo.",
                  ),
                );
              },
              undefined,
              true,
              true,
            );
          },
          (failure) => {
            archive.close();
            reject(
              new Error(
                failure.message ?? "Não foi possível abrir o arquivo ZIP.",
              ),
            );
          },
        ),
      (failure) =>
        reject(
          new Error(failure.message ?? "Não foi possível abrir o arquivo ZIP."),
        ),
    );
  });
}

export function controlTizenDownload(
  id: string,
  action: "pause" | "resume" | "cancel",
) {
  const native = nativeIds.get(id);
  if (native === undefined)
    throw new Error("Este download não pertence à sessão atual da TV.");
  tizen().download[action](native);
}

export function removeTizenDownload(id: string) {
  const job = jobs.find((entry) => entry.id === id);
  if (job && ["QUEUED", "DOWNLOADING", "PAUSED"].includes(job.state))
    throw new Error("Cancele o download antes de removê-lo.");
  jobs = jobs.filter((entry) => entry.id !== id);
  nativeIds.delete(id);
  startedAt.delete(id);
  save();
}
