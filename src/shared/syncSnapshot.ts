/**
 * The storage edge of sync: turning `chrome.storage.local` into a `JobSnapshot`
 * and back. All the difficulty is next door in syncJobs.ts — this file only
 * reads, writes, prunes and validates.
 *
 * It reads the two keys directly rather than through `getState()`, which returns
 * four of the five and omits `jobDetails` entirely, so it is not a sufficient
 * source for anything that has to be complete.
 */

import { getJobDetails, getJobUrls, saveJobDetails, saveJobUrls } from './storage';
import { pruneTombstones } from './jobUrls';
import { pruneDetails } from './jobDetails';
import { SYNC_SCHEMA, isSupportedSnapshot, mergeJobs, type JobSnapshot } from './syncJobs';

/** What this device currently holds. */
export async function buildSnapshot(): Promise<JobSnapshot> {
  const [jobUrls, jobDetails] = await Promise.all([getJobUrls(), getJobDetails()]);
  return { schema: SYNC_SCHEMA, jobUrls, jobDetails };
}

/**
 * Replace this device's copy with a merged one.
 *
 * Pruning happens here rather than in the merge because it depends on `now`, and
 * a merge whose result changed with the clock could not be idempotent. A
 * tombstone only has to outlive the other device's next sync, and a capture is
 * worth keeping only while its posting is.
 */
export async function applySnapshot(snapshot: JobSnapshot, now: number = Date.now()): Promise<void> {
  const jobUrls = pruneTombstones(snapshot.jobUrls, now);
  const jobDetails = pruneDetails(snapshot.jobDetails, jobUrls.map((e) => e.url));
  await Promise.all([saveJobUrls(jobUrls), saveJobDetails(jobDetails)]);
}

/**
 * Fold an incoming snapshot into this device and return the result — which is
 * also what should be written back to the far side, since the merge is
 * symmetric and both ends want the same answer.
 */
export async function mergeIntoLocal(incoming: JobSnapshot): Promise<JobSnapshot> {
  const merged = mergeJobs(await buildSnapshot(), incoming);
  await applySnapshot(merged);
  return merged;
}

export class UnsupportedSnapshotError extends Error {
  constructor(readonly schema: unknown) {
    super(
      typeof schema === 'number' && schema > SYNC_SCHEMA
        ? 'This backup was written by a newer version. Update this device first.'
        : 'That file is not a job database backup.',
    );
    this.name = 'UnsupportedSnapshotError';
  }
}

/**
 * Parse a snapshot, refusing anything this build cannot interpret.
 *
 * Refusing is the safe failure: merging is all-or-nothing, so a version it does
 * not understand leaves both the local database and the remote file exactly as
 * they were. An out-of-date device can be blocked; it must never corrupt.
 */
export function parseSnapshot(text: string): JobSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new UnsupportedSnapshotError(undefined);
  }
  if (!isSupportedSnapshot(raw)) {
    throw new UnsupportedSnapshotError((raw as { schema?: unknown })?.schema);
  }
  return raw;
}

export function snapshotFilename(now: Date): string {
  return `job-database-${now.toISOString().slice(0, 10)}.json`;
}
