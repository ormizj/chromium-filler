/**
 * The Drive side of sync: one JSON file in `appDataFolder`, read and written
 * with a compare-and-swap.
 *
 * `appDataFolder` is a hidden per-application space. The user will not find this
 * file in the Drive UI, and the `drive.appdata` scope gives the extension no
 * access to anything else they own — which matters, because this is the only
 * network request the extension makes at all.
 *
 * **The compare-and-swap is the part that must not be dropped.** Two devices
 * that sync at the same time would otherwise both read version N, both merge,
 * and both write — and whichever landed second would erase the other's work
 * silently. Every write carries the version it was derived from; a mismatch is
 * reported so the caller can re-read, re-merge and try again, which is safe to
 * do because the merge is idempotent.
 */

import { SYNC_FILENAME } from '../shared/syncConfig';
import { accessToken } from './googleAuth';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

/** A file's identity and the version any write must be based on. */
export interface RemoteFile {
  id: string;
  /** Drive's own change counter — the compare-and-swap token. */
  version?: string;
  etag?: string;
}

export interface RemoteDocument {
  file?: RemoteFile;
  text?: string;
}

/** A concurrent write landed first. Re-read, re-merge, retry. */
export class RemoteConflictError extends Error {
  constructor() {
    super('The other device wrote first.');
    this.name = 'RemoteConflictError';
  }
}

async function authed(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

async function fail(res: Response, what: string): Promise<never> {
  let detail = `${res.status}`;
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body.error?.message) detail = body.error.message;
  } catch {
    /* a non-JSON error body tells us nothing the status has not already. */
  }
  throw new Error(`${what}: ${detail}`);
}

async function locate(): Promise<RemoteFile | undefined> {
  const query = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name = '${SYNC_FILENAME}' and trashed = false`,
    fields: 'files(id,version)',
    pageSize: '1',
  });
  const res = await authed(`${FILES}?${query}`);
  if (!res.ok) await fail(res, 'Could not look in the Drive app folder');
  const body = (await res.json()) as { files?: Array<{ id: string; version?: string }> };
  const found = body.files?.[0];
  if (!found) return undefined;
  return { id: found.id, version: found.version, etag: res.headers.get('etag') ?? undefined };
}

/** The remote copy, or an empty result when this account has never synced. */
export async function download(): Promise<RemoteDocument> {
  const file = await locate();
  if (!file) return {};
  const res = await authed(`${FILES}/${file.id}?alt=media`);
  if (!res.ok) await fail(res, 'Could not read the synced file');
  return { file, text: await res.text() };
}

async function create(text: string): Promise<RemoteFile> {
  const boundary = `cf${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: SYNC_FILENAME, parents: ['appDataFolder'] });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`
    + `--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n`
    + `--${boundary}--`;

  const res = await authed(`${UPLOAD}?uploadType=multipart&fields=id,version`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) await fail(res, 'Could not create the synced file');
  const saved = (await res.json()) as { id: string; version?: string };
  return { id: saved.id, version: saved.version };
}

/**
 * Write the merged database back, but only if the far side is still on the
 * version this result was derived from.
 *
 * Drive does not offer a conditional write on arbitrary uploads, so the check is
 * an explicit re-read of the version immediately before the upload. That leaves
 * a window of milliseconds rather than of however long a merge takes, which is
 * the difference between a race that effectively never happens and one that
 * happens whenever two browsers start up together. A caller that loses is told,
 * and retrying is safe.
 */
export async function upload(text: string, base?: RemoteFile): Promise<RemoteFile> {
  if (!base) {
    const existing = await locate();
    if (existing) throw new RemoteConflictError();
    return create(text);
  }

  const current = await locate();
  if (!current) throw new RemoteConflictError();
  if (current.version !== base.version) throw new RemoteConflictError();

  const res = await authed(`${UPLOAD}/${base.id}?uploadType=media&fields=id,version`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'If-Match': base.etag ?? '*' },
    body: text,
  });
  if (res.status === 412) throw new RemoteConflictError();
  if (!res.ok) await fail(res, 'Could not write the synced file');
  const saved = (await res.json()) as { id: string; version?: string };
  return { id: saved.id, version: saved.version };
}
