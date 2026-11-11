/**
 * The one save slot, kept in the browser's IndexedDB (GDD: autosave every
 * in-game day). The value is the JSON text from serialize.ts.
 */
const DATABASE = 'warehouse-manager';
const STORE = 'saves';
const SLOT = 'autosave';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(database.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export const writeSave = (json: string): Promise<unknown> => run('readwrite', (store) => store.put(json, SLOT));

export async function readSave(): Promise<string | null> {
  const value = await run<unknown>('readonly', (store) => store.get(SLOT));
  return typeof value === 'string' ? value : null;
}

export const clearSave = (): Promise<unknown> => run('readwrite', (store) => store.delete(SLOT));
