/**
 * One sync: fetch, merge, write both ends.
 *
 * The interesting decisions are all next door — `syncJobs.mergeJobs` decides
 * what the answer is, `drive.ts` stops two devices overwriting each other. What
 * is left here is sequencing, and one rule: **runs never overlap**. Two triggers
 * landing together (the button pressed just as the browser starts) would
 * otherwise both read the same remote version and one would lose the race for
 * nothing. Serialized through a promise chain, the same way `session.ts` stops
 * two events claiming the same tab slot.
 *
 * There is no timer. Sync happens when the user asks and at browser startup,
 * which is why the extension needs no `alarms` permission.
 */

import type { SyncState } from '../shared/messages';
import { getSettings } from '../shared/storage';
import {
  clientProblem, isSyncConfigured, normalizeClient, readSyncClient, saveSyncClient,
  type SyncClient,
} from '../shared/syncConfig';
import { SYNC_SCHEMA, emptySnapshot, mergeJobs, type JobSnapshot } from '../shared/syncJobs';
import { buildSnapshot, applySnapshot, parseSnapshot } from '../shared/syncSnapshot';
import { connect, connectedAccount, disconnect, isConnected } from './googleAuth';
import { RemoteConflictError, download, upload, type RemoteFile } from './drive';

const KEY = 'syncStatus';
/** Enough to clear a collision; past that, something is wrong rather than busy. */
const MAX_ATTEMPTS = 3;

interface StoredStatus {
  lastSyncAt?: number;
  lastError?: string;
  /** The account has been authorized but the first merge has not been agreed to. */
  awaitingConfirm?: boolean;
}

let chain: Promise<unknown> = Promise.resolve();

/** Queue `fn` behind whatever sync is already running. */
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

async function readStatus(): Promise<StoredStatus> {
  const raw = await chrome.storage.local.get(KEY);
  return (raw[KEY] as StoredStatus) ?? {};
}

async function writeStatus(patch: Partial<StoredStatus>): Promise<void> {
  await chrome.storage.local.set({ [KEY]: { ...(await readStatus()), ...patch } });
}

export async function syncState(): Promise<SyncState> {
  const [status, account, client, connected] = await Promise.all([
    readStatus(), connectedAccount(), readSyncClient(), isConnected(),
  ]);
  return {
    configured: client.clientId.length > 0,
    connected,
    clientId: client.clientId,
    account,
    lastSyncAt: status.lastSyncAt,
    lastError: status.lastError,
  };
}

/**
 * Store the OAuth client the user entered, and drop the tokens if it is a
 * different one.
 *
 * A refresh token belongs to the client that issued it, so keeping it across a
 * change would leave the account line naming an account this build can no longer
 * get a token for — a connected state that fails at every sync. Forgetting it
 * asks for one more Connect and is honest about what happened.
 */
export async function setSyncClient(input: Partial<SyncClient>): Promise<SyncState> {
  const client = normalizeClient(input);
  const clearing = !client.clientId && !client.clientSecret;
  const problem = clearing ? undefined : clientProblem(client);
  if (problem) throw new Error(problem);

  const before = await readSyncClient();
  await saveSyncClient(client);
  if (before.clientId !== client.clientId) await disconnect();
  await writeStatus({ lastError: undefined });
  return syncState();
}

/** Authorize an account. The first merge waits for the user to confirm it. */
export async function connectAccount(): Promise<SyncState> {
  const account = await connect();
  await writeStatus({ awaitingConfirm: true, lastError: undefined });
  return { ...(await syncState()), account };
}

export async function disconnectAccount(): Promise<SyncState> {
  await disconnect();
  await chrome.storage.local.remove(KEY);
  return syncState();
}

function decode(text: string | undefined): JobSnapshot {
  // Absent means this account has never synced; unreadable is a different thing
  // and `parseSnapshot` throws rather than quietly starting over, which would
  // replace a database it merely failed to understand.
  //
  // Blank counts as absent. A zero-byte file is what an interrupted create or
  // PATCH leaves behind, and refusing it was a dead end: every later sync failed
  // with "not a job database backup" and nothing in the UI can reset the remote
  // copy. There is no content there to protect, which is the whole difference.
  return text === undefined || text.trim() === '' ? emptySnapshot() : parseSnapshot(text);
}

/**
 * Fetch, merge, write back — retrying if the far side moved underneath us.
 *
 * Retrying is safe precisely because the merge is idempotent and commutative:
 * re-reading after a conflict and merging again produces the same answer as
 * having got there first.
 */
async function runSync(): Promise<SyncState> {
  for (let attempt = 1; ; attempt++) {
    const remote = await download();
    // What is stored locally is what goes up: `applySnapshot` prunes, and both
    // ends should be holding the same answer when this returns.
    const merged = await applySnapshot(mergeJobs(await buildSnapshot(), decode(remote.text)));
    try {
      await upload(JSON.stringify({ ...merged, schema: SYNC_SCHEMA }), remote.file as RemoteFile);
      await writeStatus({ lastSyncAt: Date.now(), lastError: undefined, awaitingConfirm: false });
      return syncState();
    } catch (e) {
      if (!(e instanceof RemoteConflictError) || attempt >= MAX_ATTEMPTS) throw e;
      // The local side already holds the merge, so the next pass only has to
      // fold in whatever the other device wrote.
    }
  }
}

/**
 * Sync now.
 *
 * The first run after connecting stops to report both counts. Connecting the
 * wrong Google account is the plausible mistake — the two profiles are meant to
 * share one account, and picking a different one in the chooser is a single
 * misclick — and it would quietly union a stranger's job list into this one.
 * Recoverable, but only by hand, so it is worth one look.
 */
export async function syncNow(confirmed = false): Promise<SyncState> {
  return serialize(async () => {
    try {
      if (!(await isSyncConfigured())) {
        throw new Error('Add your Google OAuth client below before syncing.');
      }
      if (!(await isConnected())) throw new Error('Connect a Google account first.');
      if (!(await getSettings()).syncEnabled) throw new Error('Sync is turned off.');

      if (!confirmed && (await readStatus()).awaitingConfirm) {
        const [local, remote] = await Promise.all([buildSnapshot(), download()]);
        return {
          ...(await syncState()),
          pending: {
            local: local.jobUrls.length,
            remote: decode(remote.text).jobUrls.length,
          },
        };
      }
      return await runSync();
    } catch (e) {
      const message = (e as Error).message;
      await writeStatus({ lastError: message });
      return { ...(await syncState()), lastError: message };
    }
  });
}

/**
 * Pull once when the browser starts, so a profile that was left behind is
 * current before the first posting is opened. Silent: nothing is on screen to
 * report to, and a failure is reported by the Sync section next time it is read.
 */
export async function syncOnStartup(): Promise<void> {
  const settings = await getSettings();
  if (!settings.syncEnabled || !(await isSyncConfigured()) || !(await isConnected())) return;
  if ((await readStatus()).awaitingConfirm) return;
  await syncNow(true);
}
