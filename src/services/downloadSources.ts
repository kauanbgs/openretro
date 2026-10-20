import type { DownloadSourceDocument, DownloadSourceEntry } from "../types";
export const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
export function validMagnet(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > 16384) return false;
  try {
    const url = new URL(uri);
    return (
      url.protocol === "magnet:" &&
      url.searchParams
        .getAll("xt")
        .some((xt) => /^urn:btih:(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(xt))
    );
  } catch {
    return false;
  }
}
export function parseDownloadSource(text: string): DownloadSourceDocument {
  if (new TextEncoder().encode(text).length > MAX_SOURCE_BYTES)
    throw new Error("Source exceeds the 16 MB limit.");
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("Invalid JSON. Expected name and a downloads array.");
  }
  if (
    !raw ||
    typeof raw !== "object" ||
    !("name" in raw) ||
    typeof raw.name !== "string" ||
    !raw.name.trim() ||
    raw.name.trim().length > 200 ||
    !("downloads" in raw) ||
    !Array.isArray(raw.downloads) ||
    raw.downloads.length > 100000
  )
    throw new Error("Expected a source name and a downloads array.");
  const entries: DownloadSourceEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw.downloads) {
    if (!item || typeof item.title !== "string" || !Array.isArray(item.uris))
      continue;
    const title = item.title.trim();
    const uris = [...new Set<string>(item.uris.filter(validMagnet))].sort();
    if (
      !title ||
      title.length > 1000 ||
      !uris.length ||
      uris.length > 32 ||
      (item.fileSize !== undefined &&
        (typeof item.fileSize !== "string" || item.fileSize.length > 100)) ||
      (item.uploadDate !== undefined &&
        (typeof item.uploadDate !== "string" || item.uploadDate.length > 100))
    )
      continue;
    const key = JSON.stringify([title, uris]);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      title,
      uris,
      fileSize: item.fileSize ?? "",
      uploadDate: item.uploadDate ?? "",
    });
  }
  if (!entries.length)
    throw new Error(
      "No supported magnet downloads found. Direct links and v2-only magnets are not supported yet.",
    );
  return { name: raw.name.trim(), downloads: entries };
}
