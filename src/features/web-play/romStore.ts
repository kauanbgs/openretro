// ROMs the player opened from their own computer in the web build, kept in
// IndexedDB on this device only. Nothing is uploaded anywhere.

export type StoredRom = {
  id: string;
  title: string;
  platformId: string;
  fileName: string;
  coverUrls: string[];
  addedAt: string;
  rom: Blob;
};

const DB_NAME = "openretro-web-play";
const STORE = "roms";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = action(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const listRoms = () => run<StoredRom[]>("readonly", (s) => s.getAll());
export const getRom = (id: string) =>
  run<StoredRom | undefined>("readonly", (s) => s.get(id));
export const saveRom = (rom: StoredRom) => run("readwrite", (s) => s.put(rom));
export const deleteRom = (id: string) => run("readwrite", (s) => s.delete(id));
