/**
 * Stores the user's CV so it is reachable from the CONTENT SCRIPT.
 *
 * The CV lives in chrome.storage.local, base64-encoded (chrome.storage can't
 * round-trip an ArrayBuffer). Why not IndexedDB: content scripts share the host
 * page's origin, so IndexedDB/`window` storage there is the *page's*, not the
 * extension's. chrome.storage.local is extension-scoped and readable from
 * content scripts, options, and background alike. `unlimitedStorage` covers
 * larger files.
 */

import type { CvFile } from './types';

const KEY = 'cv';

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as ArrayBuffer);
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(blob);
  });
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function fileToCvFile(file: File): Promise<CvFile> {
  return { name: file.name, type: file.type, data: await blobToArrayBuffer(file) };
}

export function cvFileToFile(cv: CvFile): File {
  return new File([cv.data], cv.name, { type: cv.type || 'application/octet-stream' });
}

interface StoredCv {
  name: string;
  type: string;
  dataBase64: string;
}

export async function setCv(file: File): Promise<CvFile> {
  const cv = await fileToCvFile(file);
  const stored: StoredCv = { name: cv.name, type: cv.type, dataBase64: arrayBufferToBase64(cv.data) };
  await chrome.storage.local.set({ [KEY]: stored });
  return cv;
}

export async function getCv(): Promise<CvFile | null> {
  const raw = await chrome.storage.local.get(KEY);
  const stored = raw[KEY] as StoredCv | undefined;
  if (!stored) return null;
  return { name: stored.name, type: stored.type, data: base64ToArrayBuffer(stored.dataBase64) };
}

export async function clearCv(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}
