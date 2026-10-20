export interface Platform {
  id: string;
  name: string;
  shortName: string;
  manufacturer?: string;
  extensions: string[];
  biosRequired?: boolean;
}
export interface GameMetadata {
  id: string;
  title: string;
  platformId: string;
  year: number;
  developer: string;
  description: string;
  genre: string;
  artwork: string;
  color: string;
  metadataProvider?: "igdb" | "mock";
  externalId?: number;
  coverUrl?: string;
  backgroundUrl?: string;
  screenshots?: string[];
  genreIds?: number[];
  genres?: string[];
  sourceUrl?: string;
  platformIds?: string[];
}
export interface LibraryItem {
  id: string;
  gameId: string;
  platformId: string;
  sourceProvider: string;
  sourcePath: string;
  emulatorId: string | null;
  installed: boolean;
  favorite: boolean;
  addedAt: string;
  lastPlayedAt: string | null;
  playtime: number;
  sha256: string;
  biosPath: string | null;
  runtimeArgs: string[];
}
export interface LibraryGame {
  game: GameMetadata;
  item: LibraryItem;
}
export interface Emulator {
  id: string;
  name: string;
  executablePath: string;
  supportedPlatforms: string[];
  version?: string;
  defaultPlatforms: string[];
}
export type ResolutionState =
  | "READY"
  | "MISSING_GAME"
  | "MISSING_EMULATOR"
  | "MISSING_BIOS"
  | "CONFIGURATION_REQUIRED"
  | "UNSUPPORTED";
export interface GameResolution {
  state: ResolutionState;
  message: string;
  emulator?: Emulator;
  file?: string;
  args?: string[];
}
export interface SourceResolution {
  available: boolean;
  localPath?: string;
  reason?: string;
}
export interface ImportCandidate {
  path: string;
  filename: string;
  sha256: string;
  platformIds: string[];
}
export interface AppSettings {
  theme: "dark" | "light";
  density: "comfortable" | "compact";
  animations: boolean;
  language: string;
  downloadDirectory: string;
  concurrentDownloads: number;
  bandwidthLimit: number;
  developerMode: boolean;
}
export const defaultSettings: AppSettings = {
  theme: "dark",
  density: "comfortable",
  animations: true,
  language: "en",
  downloadDirectory: "",
  concurrentDownloads: 2,
  bandwidthLimit: 0,
  developerMode: false,
};
export type DownloadState =
  | "QUEUED"
  | "DOWNLOADING"
  | "VERIFYING"
  | "INSTALLING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";
export interface DownloadJob {
  id: string;
  name: string;
  state: DownloadState;
  progress: number;
  bytesPerSecond: number;
  remainingSeconds: number | null;
  error?: string;
}
