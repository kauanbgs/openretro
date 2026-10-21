import type { DownloadSource, DownloadSourceDocument } from "../types";

// Browser preview source storage. Sources can be several MB (No-Intro packs), far
// beyond the ~5 MB localStorage quota, so they live in IndexedDB and are kept
// in memory with a lowercase search index after the first read.
export type PreviewSource = DownloadSource & {
  document: DownloadSourceDocument;
};
interface IndexedSource {
  source: PreviewSource;
  titles: string[];
}

const legacyKey = "openretro-download-sources-v1";
const dbName = "openretro-sources";
const storeName = "sources";
let cache: Promise<IndexedSource[]> | undefined;
let matchCache = new Map<string, boolean>();

function index(source: PreviewSource): IndexedSource {
  return {
    source,
    titles: source.document.downloads.map((entry) => entry.title.toLowerCase()),
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(storeName, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const request = run(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function load(): Promise<IndexedSource[]> {
  let sources =
    (await transaction<PreviewSource[]>("readonly", (store) =>
      store.getAll(),
    )) ?? [];
  // One-time migration from the old localStorage key, which also frees quota.
  let legacy: PreviewSource[] = [];
  try {
    legacy = JSON.parse(localStorage.getItem(legacyKey) ?? "[]");
  } catch {
    legacy = [];
  }
  if (legacy.length) {
    const known = new Set(sources.map((s) => s.id));
    const added = legacy.filter((s) => !known.has(s.id));
    await transaction("readwrite", (store) => {
      added.forEach((s) => store.put(s));
    });
    sources = [...sources, ...added];
  }
  try {
    localStorage.removeItem(legacyKey);
  } catch {
    // Storage may be unavailable; IndexedDB already holds the sources.
  }
  return sources
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .map(index);
}

function all(): Promise<IndexedSource[]> {
  cache ??= load().catch((error) => {
    cache = undefined;
    throw error;
  });
  return cache;
}

async function mutate(update: (sources: IndexedSource[]) => IndexedSource[]) {
  const next = update(await all());
  cache = Promise.resolve(next);
  matchCache = new Map();
}

export const sourceStore = {
  async list(): Promise<PreviewSource[]> {
    return (await all()).map(({ source }) => source);
  },
  async put(source: PreviewSource): Promise<void> {
    await transaction("readwrite", (store) => store.put(source));
    await mutate((sources) => [
      ...sources.filter((s) => s.source.id !== source.id),
      index(source),
    ]);
  },
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const current = (await all()).find((s) => s.source.id === id);
    if (!current) return;
    await sourceStore.put({ ...current.source, enabled });
  },
  async remove(id: string): Promise<void> {
    await transaction("readwrite", (store) => store.delete(id));
    await mutate((sources) => sources.filter((s) => s.source.id !== id));
  },
  async search(query: string, limit: number) {
    const needle = query.trim().toLowerCase();
    const matches = [];
    for (const { source, titles } of await all()) {
      if (!source.enabled) continue;
      for (let i = 0; i < titles.length && matches.length < limit; i++)
        if (titles[i].includes(needle))
          matches.push({
            ...source.document.downloads[i],
            id: String(i),
            sourceId: source.id,
            sourceName: source.name,
          });
    }
    return matches;
  },
  async available(titles: string[]): Promise<string[]> {
    const enabled = (await all()).filter((s) => s.source.enabled);
    return titles.filter((title) => {
      const query = title.trim().toLowerCase();
      if (query.length < 3) return false;
      let hit = matchCache.get(query);
      if (hit === undefined) {
        hit = enabled.some((s) => s.titles.some((t) => t.includes(query)));
        matchCache.set(query, hit);
      }
      return hit;
    });
  },
};
