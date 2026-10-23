// Translations and ROM hacks: the catalog, compatibility labels and the
// backend calls behind the "Traduções e mods" tab. Patches are applied by the
// desktop app; the browser preview can only show the bundled catalog.
import { invoke, listen } from "./transport";
import { bridge, isDesktop } from "./bridge";
import bundledCatalog from "../db/mods-catalog.json";
import type {
  LibraryItem,
  LocalPatchInfo,
  ModCompatibilityStatus,
  ModEntry,
  ModInstallRequest,
  ModJob,
  ModListing,
  ModsOverview,
  ModSource,
} from "../types";
import { locale, t } from "../i18n";

export const PATCH_FORMATS = ["IPS", "BPS", "UPS", "xdelta"];

export const compatibilityLabels: Record<ModCompatibilityStatus, string> = {
  confirmed: t("Compatibilidade confirmada"),
  unknown: t("Compatibilidade desconhecida"),
  incompatible: t("Incompatível"),
};

export const kindLabels: Record<string, string> = {
  translation: t("Tradução"),
  romhack: t("Romhack"),
  local: t("Patch local"),
};

/** "pt-BR" → "português (Brasil)"; names that are not codes stay as given. */
export function languageLabel(language: string | null | undefined): string {
  if (!language) return t("Idioma não informado");
  try {
    if (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(language))
      return (
        new Intl.DisplayNames([locale()], { type: "language" }).of(language) ??
        language
      );
  } catch {
    // Older engines without DisplayNames show the code.
  }
  return language;
}

/** Titles compare without case, punctuation or a leading article, like the backend. */
export function normalizeTitle(title: string): string {
  const words = title
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (words[0] === "the" ? words.slice(1) : words).join(" ");
}

export function titleMatches(entry: ModEntry, title: string): boolean {
  const wanted = normalizeTitle(title);
  return (
    wanted.length > 0 &&
    [entry.game.title, ...entry.game.aliases].some(
      (candidate) => normalizeTitle(candidate) === wanted,
    )
  );
}

/** The bundled catalog for a game, without compatibility: used before a game is installed and in the preview. */
export function catalogListings(
  title: string,
  platformId: string,
  entries = bundledCatalog.entries as unknown as ModEntry[],
): ModListing[] {
  return entries
    .filter(
      (entry) =>
        entry.game.platformId === platformId && titleMatches(entry, title),
    )
    .map((entry) => ({
      sourceId: "openretro",
      sourceName: bundledCatalog.name,
      entry: {
        ...entry,
        images: entry.images ?? [],
        credits: entry.credits ?? [],
        requirements: entry.requirements ?? [],
        stacksOn: entry.stacksOn ?? [],
      },
      compatibility: null,
      variantTargets: [],
    }));
}

/** The file online players must share: the selected version's, not the original's. */
export function playedSha256(item: LibraryItem): string {
  return item.activeVariant?.sha256 ?? item.sha256;
}

export const jobRunning = (job: ModJob) =>
  !["COMPLETED", "FAILED", "CANCELLED", "NEEDS_CHOICE"].includes(job.state);

/**
 * Where a listing can be installed: the original when it is not incompatible,
 * and versions the catalog confirms it applies on top of. Combining with
 * anything else is never offered.
 */
export function installTargets(listing: ModListing): (string | null)[] {
  const targets: (string | null)[] = [];
  if (listing.compatibility?.status !== "incompatible") targets.push(null);
  targets.push(...listing.variantTargets);
  return targets;
}

export function formatBytes(size: number | null | undefined): string {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export const mods = {
  async overview(
    libraryItemId: string | null,
    title: string,
    platformId: string,
  ): Promise<ModsOverview> {
    if (!isDesktop)
      return {
        listings: catalogListings(title, platformId),
        variants: [],
        activeVariantId: null,
        sources: [],
        plazaConfigured: false,
        unpatchable: null,
      };
    return invoke("mods_overview", { libraryItemId, title, platformId });
  },
  searchPlaza(
    libraryItemId: string | null,
    title: string,
    platformId: string,
  ): Promise<ModListing[]> {
    return invoke("mods_search_plaza", { libraryItemId, title, platformId });
  },
  setPlazaKey(key: string | null): Promise<void> {
    return invoke("mods_set_plaza_key", { key });
  },
  async pickPatch(): Promise<string | null> {
    return bridge.pickModPatch();
  },
  inspectPatch(
    libraryItemId: string,
    parentVariantId: string | null,
    path: string,
    archivePath: string | null,
  ): Promise<LocalPatchInfo> {
    return invoke("mods_inspect_patch", {
      libraryItemId,
      parentVariantId,
      path,
      archivePath,
    });
  },
  install(request: ModInstallRequest, retryOf?: string): Promise<string> {
    if (!isDesktop)
      throw new Error(
        t("Abra o aplicativo OpenRetro para instalar modificações."),
      );
    return invoke("mods_install", { request, retryOf: retryOf ?? null });
  },
  jobs: (): Promise<ModJob[]> =>
    isDesktop ? invoke("mods_jobs") : Promise.resolve([]),
  cancel: (id: string): Promise<void> => invoke("mods_cancel", { id }),
  dismiss: (id: string): Promise<void> => invoke("mods_dismiss", { id }),
  select: (libraryItemId: string, variantId: string | null): Promise<void> =>
    invoke("mods_select_variant", { libraryItemId, variantId }),
  remove: (variantId: string): Promise<string[]> =>
    invoke("mods_remove_variant", { variantId }),
  sources: (): Promise<ModSource[]> => invoke("mods_sources"),
  addSource: (url: string): Promise<ModSource> =>
    invoke("mods_add_source", { url }),
  setSource: (id: string, enabled: boolean): Promise<void> =>
    invoke("mods_set_source", { id, enabled }),
  removeSource: (id: string): Promise<void> =>
    invoke("mods_remove_source", { id }),
  onJob(handler: (job: ModJob) => void): () => void {
    if (!isDesktop) return () => undefined;
    const unlisten = listen<ModJob>("mods-job", ({ payload }) =>
      handler(payload),
    );
    return () => void unlisten.then((fn) => fn());
  },
};
