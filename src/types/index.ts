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
  metadataProvider?: "launchbox" | "igdb" | "mock";
  externalId?: number;
  coverUrl?: string;
  backgroundUrl?: string;
  screenshots?: string[];
  genreIds?: number[];
  genres?: string[];
  sourceUrl?: string;
  platformIds?: string[];
  publisher?: string;
  storyline?: string;
  rating?: number;
  ratingCount?: number;
  trailers?: { id: string; name: string }[];
  gameModes?: string[];
  /** Most players at once, from the catalog; null when not listed. */
  maxPlayers?: number | null;
  perspectives?: string[];
  themes?: string[];
  franchise?: string;
  similar?: GameMetadata[];
}
export interface SaveState {
  /** -1 is the runtime's automatic resume state. */
  slot: number;
  modifiedAt: string;
  size: number;
  thumbnail: string | null;
}
/** Hosts or joins a direct-IP netplay session in the OpenRetro Runtime. */
export interface NetplaySession {
  role: "host" | "join";
  /** The host's address, optionally with ":port". Joining only. */
  address?: string;
  port?: number;
  nickname?: string;
  password?: string;
}
/** Consoles whose Runtime cores stay in sync over netplay. */
export const NETPLAY_PLATFORMS = [
  "nes",
  "snes",
  "gb",
  "gbc",
  "gba",
  "sms",
  "genesis",
  "gg",
  "psx",
  "arcade",
];
export const NETPLAY_DEFAULT_PORT = 55435;
export interface RemotePlayStatus {
  running: boolean;
  url: string | null;
  /** The pairing URL as an SVG QR code. */
  qr: string | null;
  devices: number;
  /** The player each connected phone chose, one entry per phone. */
  players: number[];
}
export interface PlayerProfile {
  id: string;
  name: string;
  avatar: string;
  color: string;
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
  /** The translation or hack that Play starts instead of the original. */
  activeVariant?: ActiveVariant;
  variantCount?: number;
}
export interface ActiveVariant {
  id: string;
  name: string;
  path: string;
  sha256: string;
  savesShared: boolean;
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
export interface EmulatorInstall {
  id: string;
  name: string;
  description: string;
  supportedPlatforms: string[];
  sourceName: string;
  sourceUrl: string;
  isBase: boolean;
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
  autoResume?: boolean;
  theme: "dark" | "light";
  density: "comfortable" | "compact";
  animations: boolean;
  language: string;
  downloadDirectory: string;
  concurrentDownloads: number;
  bandwidthLimit: number;
  developerMode: boolean;
  /** Short sounds when moving and choosing in Big Picture. */
  navigationSounds?: boolean;
  /** Download updates in the background and install them on the next start. */
  autoUpdate?: boolean;
  /** Delete a downloaded archive once its game is extracted. */
  deleteArchives?: boolean;
  /** Install the latest official update before a PS3 game starts. */
  ps3Updates?: boolean;
  /** Internal resolution of PS2 games in the managed runtime. */
  ps2Resolution?: "1x" | "2x" | "4x" | "8x";
  /** Image sizing for PS2 and retro games in the managed runtime. */
  gameScreenMode?: "original" | "stretch";
}
export const defaultSettings: AppSettings = {
  autoResume: true,
  theme: "dark",
  density: "comfortable",
  animations: true,
  language: "en",
  downloadDirectory: "",
  concurrentDownloads: 2,
  bandwidthLimit: 0,
  developerMode: false,
  ps2Resolution: "2x",
  gameScreenMode: "original",
  navigationSounds: true,
  autoUpdate: true,
  deleteArchives: true,
  ps3Updates: true,
};
export type DownloadState =
  | "RESOLVING"
  | "PAUSED"
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
  sourceName?: string;
  directory?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  game?: GameMetadata;
  autoExtract?: boolean;
  autoAddToLibrary?: boolean;
  /** Post-transfer step, e.g. "Extraindo arquivos", while state is INSTALLING. */
  stage?: string | null;
  libraryStatus?: "added" | "manual" | null;
  libraryMessage?: string | null;
}
export interface DownloadImported {
  gameId: string;
  downloadId: string;
}
export interface DownloadSourceEntry {
  title: string;
  uris: string[];
  uploadDate?: string;
  fileSize?: string;
}
export interface DownloadSourceDocument {
  name: string;
  downloads: DownloadSourceEntry[];
}
export interface DownloadSource {
  id: string;
  name: string;
  url: string | null;
  enabled: boolean;
  updatedAt: string;
  gameCount: number;
}
export interface SourceMatch extends DownloadSourceEntry {
  id: string;
  sourceId: string;
  sourceName: string;
}
export interface DownloadedFile {
  path: string;
  filename: string;
  platformIds: string[];
}
export type ModCompatibilityStatus = "confirmed" | "unknown" | "incompatible";
export interface ModCompatibility {
  status: ModCompatibilityStatus;
  reason: string;
  /** The original matches once its 512-byte copier header is removed. */
  stripHeader: boolean;
}
export interface ModHashes {
  size?: number;
  sha256?: string;
  sha1?: string;
  md5?: string;
  crc32?: string;
}
export interface ModEntry {
  id: string;
  kind: "translation" | "romhack";
  title: string;
  description: string;
  authors: string[];
  version: string;
  language: string;
  images: string[];
  sourceUrl: string;
  license?: string | null;
  credits: string[];
  requirements: string[];
  game: {
    title: string;
    aliases: string[];
    platformId: string;
    region?: string | null;
    revision?: string | null;
  };
  base: ModHashes;
  result?: ModHashes | null;
  patch: {
    format: string;
    url?: string | null;
    sha256?: string | null;
    size?: number | null;
    path?: string | null;
  };
  /** "link": the author's page is the only place to download it. */
  distribution: "direct" | "link";
  saves?: "shared" | "separate" | null;
  stacksOn: string[];
}
export interface ModListing {
  sourceId: string;
  sourceName: string;
  entry: ModEntry;
  /** Absent when the game is not in the library yet. */
  compatibility?: ModCompatibility | null;
  /** Installed versions this patch is confirmed to apply on top of. */
  variantTargets: string[];
  installedVariantId?: string | null;
}
export interface GameVariant {
  id: string;
  libraryItemId: string;
  parentId?: string | null;
  name: string;
  kind: "translation" | "romhack" | "local";
  entryId?: string | null;
  sourceId: string;
  sourceName: string;
  version?: string | null;
  language?: string | null;
  authors: string[];
  credits: string[];
  sourceUrl?: string | null;
  license?: string | null;
  format: string;
  saves: "shared" | "separate";
  compatibility: ModCompatibilityStatus;
  path: string;
  sha256: string;
  size: number;
  createdAt: string;
}
export interface ModSource {
  id: string;
  name: string;
  url?: string | null;
  enabled: boolean;
  entries: number;
  updatedAt?: string | null;
}
export interface ModsOverview {
  listings: ModListing[];
  variants: GameVariant[];
  activeVariantId?: string | null;
  sources: ModSource[];
  plazaConfigured: boolean;
  /** Why this game cannot receive patches at all. */
  unpatchable?: string | null;
}
export type ModJobState =
  | "QUEUED"
  | "DOWNLOADING"
  | "PATCHING"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "NEEDS_CHOICE";
export interface ModJob {
  id: string;
  libraryItemId: string;
  name: string;
  state: ModJobState;
  progress: number;
  stage: string;
  error?: string | null;
  choiceKind?: "archive" | "file" | null;
  choices: string[];
  variantId?: string | null;
}
export interface ModInstallRequest {
  libraryItemId: string;
  parentVariantId?: string | null;
  origin: "catalog" | "romhackplaza" | "local";
  sourceId?: string | null;
  entryId?: string | null;
  localPath?: string | null;
  archivePath?: string | null;
  downloadFile?: string | null;
  name?: string | null;
  confirmUnknown?: boolean;
  confirmStack?: boolean;
}
export interface LocalPatchInfo {
  name?: string | null;
  info?: {
    format?: string | null;
    sourceSize?: number | null;
    sourceCrc32?: string | null;
    targetSize?: number | null;
    targetCrc32?: string | null;
    verifiesSource: boolean;
  } | null;
  compatibility?: ModCompatibility | null;
  choices: string[];
}
