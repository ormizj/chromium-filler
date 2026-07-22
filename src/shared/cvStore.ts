/**
 * Stores the user's CV as raw bytes in IndexedDB (avoids chrome.storage quota
 * and base64 bloat), plus pure helpers to convert between a File and CvFile.
 */

import type { CvFile } from './types';

const DB_NAME = 'chromium-filler';
const STORE = 'cv';
const KEY = 'current';

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as ArrayBuffer);
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(blob);
  });
}

export async function fileToCvFile(file: File): Promise<CvFile> {
  return { name: file.name, type: file.type, data: await blobToArrayBuffer(file) };
}

export function cvFileToFile(cv: CvFile): File {
  return new File([cv.data], cv.name, { type: cv.type || 'application/octet-stream' });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const store = db.transaction(STORE, mode).objectStore(STORE);
        const req = run(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function setCv(file: File): Promise<CvFile> {
  const cv = await fileToCvFile(file);
  await tx('readwrite', (store) => store.put(cv, KEY));
  return cv;
}

export async function getCv(): Promise<CvFile | null> {
  try {
    const cv = await tx<CvFile | undefined>('readonly', (store) => store.get(KEY));
    return cv ?? null;
  } catch {
    return null;
  }
}

export async function clearCv(): Promise<void> {
  await tx('readwrite', (store) => store.delete(KEY));
}
