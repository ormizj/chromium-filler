/**
 * Pure logic for the job-URL database: the URL is the unique key, and every
 * status change is timestamped and logged — the log is what the sync merge
 * unions. A posting is `new` (waiting) or `done`.
 */

import type { JobLogStatus, JobUrlEntry, JobUrlStats, JobUrlStatus } from './types';

/**
 * How far through the flow each status is. There are two statuses now — a
 * posting is waiting or it is done — and the rank is what the sync merge uses
 * as a *deterministic* tie-break when two devices log different statuses in the
 * same millisecond.
 *
 * Tombstones outrank everything ordinary — a removal is the user's most recent
 * word on a posting. An unrecognised status (a newer peer's) ranks -1: it is
 * never chosen as a tie-break winner by a build that cannot interpret it, while
 * the event itself is still carried in the log.
 */
export const STATUS_RANK: Record<JobUrlStatus | 'deleted', number> = {
  new: 0, done: 1, deleted: 2,
};

/**
 * What the six statuses of earlier builds mean now. Everything that said "dealt
 * with" — skipped, applied, marked done, handed off to another site — is `done`.
 * `opened` said "a tab is on it", which the queue's tab map says on its own, so
 * that posting is still waiting.
 *
 * Applied on every read by `normalizeEntry`, so stored lists, imported backups
 * and an old remote file all arrive in today's two.
 */
const LEGACY_STATUS: Record<string, JobUrlStatus> = {
  opened: 'new',
  redirected: 'done',
  applied: 'done',
  skipped: 'done',
  markedDone: 'done',
};

function currentStatus(status: JobLogStatus): JobLogStatus {
  return LEGACY_STATUS[status] ?? status;
}

/**
 * Every status a posting can be *in*, in flow order — derived from the rank
 * table rather than written out a second time. The queue filters and the row
 * status control render from it. The tombstone is not one of them — a deleted
 * posting is not shown, let alone filtered for.
 */
export const ALL_JOB_STATUSES: JobUrlStatus[] = (
  Object.keys(STATUS_RANK) as Array<JobUrlStatus | 'deleted'>
)
  .filter((s): s is JobUrlStatus => s !== 'deleted')
  .sort((a, b) => STATUS_RANK[a] - STATUS_RANK[b]);

export function statusRank(status: JobLogStatus): number {
  return STATUS_RANK[status as JobUrlStatus] ?? -1;
}

/** A status this build understands well enough to act on. */
export function isKnownStatus(status: JobLogStatus): status is JobUrlStatus {
  return status !== 'deleted' && statusRank(status) >= 0;
}

/** Removed on some device. Kept as a log entry so a sync cannot resurrect it. */
export function isDeleted(entry: JobUrlEntry): boolean {
  return entry.status === 'deleted';
}

function newId(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}`);
}

export function makeEntry(url: string, now: number): JobUrlEntry {
  return {
    id: newId(),
    url,
    status: 'new',
    addedAt: now,
    updatedAt: now,
    history: [{ status: 'new', at: now }],
  };
}

/** Fields the two-step flow wrote, which nothing reads any more. */
const DROPPED_FIELDS = ['openedAt', 'appliedAt', 'sourceUrl', 'redirectUrl'] as const;

/**
 * Today's shape, whatever build wrote the entry: missing `updatedAt`/`history`
 * backfilled, old statuses mapped (`LEGACY_STATUS`) in the status *and* the log,
 * and the two-step fields dropped.
 *
 * Idempotent, which the sync merge relies on: it normalizes both sides and its
 * output again on the next run. That is why two events the mapping made identical
 * (`skipped` and `applied` at one instant) collapse to one, but two *different*
 * consecutive events are kept — collapsing those would make a merged log differ
 * from the same log normalized again.
 */
export function normalizeEntry(entry: JobUrlEntry): JobUrlEntry {
  const status = currentStatus(entry.status ?? 'new');
  const addedAt = entry.addedAt ?? Date.now();
  const seen = new Set<string>();
  const history = (entry.history?.length ? entry.history : [{ status, at: addedAt }])
    .map((e) => ({ status: currentStatus(e.status), at: e.at }))
    .filter((e) => {
      const key = `${e.status} ${e.at}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const out: JobUrlEntry = {
    ...entry,
    status,
    addedAt,
    updatedAt: entry.updatedAt ?? addedAt,
    history,
  };
  for (const key of DROPPED_FIELDS) delete (out as unknown as Record<string, unknown>)[key];
  return out;
}

/** Add only URLs not already present (unique by URL). Returns the count added. */
export function addUrls(
  list: JobUrlEntry[],
  urls: string[],
  now: number = Date.now(),
): { list: JobUrlEntry[]; added: number } {
  const known = new Set(list.map((e) => e.url));
  const out = [...list];
  let added = 0;
  for (const url of urls) {
    if (known.has(url)) continue;
    known.add(url);
    out.push(makeEntry(url, now));
    added++;
  }
  return { list: out, added };
}

/** Update a URL's status, appending to history and stamping timestamps. */
export function applyStatus(
  list: JobUrlEntry[],
  url: string,
  status: JobLogStatus,
  now: number = Date.now(),
): JobUrlEntry[] {
  return list.map((entry) => {
    if (entry.url !== url) return entry;
    const e = normalizeEntry(entry);
    if (e.status === status) return e; // no-op, don't spam history
    const next: JobUrlEntry = {
      ...e,
      status,
      updatedAt: now,
      history: [...e.history, { status, at: now }],
    };
    return next;
  });
}

/**
 * A tab the queue opened was closed: the user is done with that posting.
 *
 * Only a waiting posting moves, and only to `done` — the user's own word, which
 * closing the tab is. One already done keeps its log as it is, and one never in
 * the database is not this tab's to finish. The same list back when nothing
 * changes, so the caller can skip the write.
 */
export function finishOnClose(list: JobUrlEntry[], url: string, now: number = Date.now()): JobUrlEntry[] {
  const entry = list.find((e) => e.url === url);
  if (!entry || normalizeEntry(entry).status !== 'new') return list;
  return applyStatus(list, url, 'done', now);
}

/** Append an entry for `url` unless the database already has one. */
function ensureUrl(list: JobUrlEntry[], url: string, now: number): JobUrlEntry[] {
  return list.some((e) => e.url === url) ? list : [...list, makeEntry(url, now)];
}

/**
 * Set a URL's status, adding it to the database first if it is not there yet.
 *
 * This is what the *user's* actions want, as opposed to the queue's. Skipping
 * happens on whatever posting is on screen, and that is routinely one
 * they opened by hand rather than imported — for which bare `applyStatus` maps
 * over a list containing no such entry and quietly changes nothing, so a skip
 * the user watched happen leaves no trace. Pairing the two here rather than at
 * each call site is deliberate: the failure is invisible, so it must not be
 * something a caller can forget.
 */
export function recordStatus(
  list: JobUrlEntry[],
  url: string,
  status: JobLogStatus,
  now: number = Date.now(),
): JobUrlEntry[] {
  return applyStatus(ensureUrl(list, url, now), url, status, now);
}

/**
 * What the database currently says about one URL, or `undefined` if it has never
 * seen it.
 *
 * Exported because the *page* now needs to ask this, not just the merge rules:
 * `content/main.ts` reads it to find out whether the posting in front of the user
 * was already finished on an earlier visit, which is the one thing that retires
 * Skip. Note a tombstone answers `'deleted'` rather than `undefined` —
 * callers compare against the status they care about, so a deleted entry falls
 * out on its own without a special case here.
 */
export function statusForUrl(list: JobUrlEntry[], url: string): JobLogStatus | undefined {
  return list.find((e) => e.url === url)?.status;
}

/**
 * Delete a posting: record a tombstone rather than splice it out.
 *
 * Sync merges two databases by unioning their logs, and a union can only grow —
 * so a spliced entry is re-added by the next sync from the other device, and the
 * delete appears to work and then silently undoes itself. Logging the removal
 * keeps it a fact both devices can see, and makes un-deleting simply a later
 * event rather than a special case.
 */
export function deleteUrl(
  list: JobUrlEntry[],
  url: string,
  now: number = Date.now(),
): JobUrlEntry[] {
  return applyStatus(list, url, 'deleted', now);
}

/**
 * Forget an entry outright, tombstone and all. For pruning only — user-facing
 * deletion is `deleteUrl`, because this cannot survive a sync.
 */
export function removeUrl(list: JobUrlEntry[], url: string): JobUrlEntry[] {
  return list.filter((e) => e.url !== url);
}

/** The postings a surface should show: everything not tombstoned. */
export function visibleUrls(list: JobUrlEntry[]): JobUrlEntry[] {
  return list.filter((e) => !isDeleted(e));
}

export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Drop tombstones that have outlived their purpose. A tombstone only has to
 * outlast the other device's next sync; keeping them forever would grow the
 * file without bound.
 */
export function pruneTombstones(
  list: JobUrlEntry[],
  now: number = Date.now(),
  maxAgeMs: number = TOMBSTONE_TTL_MS,
): JobUrlEntry[] {
  return list.filter((e) => !isDeleted(e) || now - e.updatedAt < maxAgeMs);
}

export function jobUrlStats(list: JobUrlEntry[]): JobUrlStats {
  const visible = visibleUrls(list);
  const stats: JobUrlStats = { total: visible.length, new: 0, done: 0 };
  // A status from a newer peer counts toward `total` and nothing else — there is
  // no honest bucket for it, and inventing one would misreport the queue.
  for (const e of visible) if (isKnownStatus(e.status)) stats[e.status]++;
  return stats;
}
