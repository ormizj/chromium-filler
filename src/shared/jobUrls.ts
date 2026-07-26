/**
 * Pure logic for the job-URL database: the URL is the unique key, and every
 * status change is timestamped and logged so the dashboard can show history and
 * track which applications were actually sent.
 */

import type { JobLogStatus, JobUrlEntry, JobUrlStats, JobUrlStatus } from './types';

/**
 * How far through the flow each status is. Two callers need it and they need it
 * for different reasons, which is why it is a constant rather than a comparison
 * written twice: `linkRedirect` below must not demote a posting by re-visiting
 * it, and the sync merge needs a *deterministic* tie-break when two devices log
 * different statuses in the same millisecond.
 *
 * Tombstones outrank everything ordinary — a removal is the user's most recent
 * word on a posting. An unrecognised status (a newer peer's) ranks -1: it is
 * never chosen as a tie-break winner by a build that cannot interpret it, while
 * the event itself is still carried in the log.
 */
export const STATUS_RANK: Record<JobUrlStatus | 'deleted', number> = {
  new: 0, opened: 1, redirected: 2, skipped: 3, applied: 4, deleted: 5,
};

/**
 * Every status a posting can be *in*, in flow order — derived from the rank
 * table rather than written out a second time.
 *
 * Everything that offers the statuses as a choice renders from this: the queue
 * filters and the archive's status checkboxes. Deriving it is what makes a new
 * status show up in both places, since it cannot be added to the model without
 * joining `STATUS_RANK` first. The tombstone is not one of them — a deleted
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

/** Backfill legacy entries that predate updatedAt/history. */
export function normalizeEntry(entry: JobUrlEntry): JobUrlEntry {
  const status = entry.status ?? 'new';
  const addedAt = entry.addedAt ?? Date.now();
  return {
    ...entry,
    status,
    addedAt,
    updatedAt: entry.updatedAt ?? addedAt,
    history: entry.history?.length ? entry.history : [{ status, at: addedAt }],
  };
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
    if (status === 'opened' && next.openedAt == null) next.openedAt = now;
    if (status === 'applied' && next.appliedAt == null) next.appliedAt = now;
    return next;
  });
}

/** Append an entry for `url` unless the database already has one. */
function ensureUrl(list: JobUrlEntry[], url: string, now: number): JobUrlEntry[] {
  return list.some((e) => e.url === url) ? list : [...list, makeEntry(url, now)];
}

/**
 * Set a URL's status, adding it to the database first if it is not there yet.
 *
 * This is what the *user's* actions want, as opposed to the queue's. Skipping or
 * applying happens on whatever posting is on screen, and that is routinely one
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
 * was already applied on an earlier visit, which is the one thing that retires
 * Apply and Skip. Note a tombstone answers `'deleted'` rather than `undefined` —
 * callers compare against the status they care about, so a deleted entry falls
 * out on its own without a special case here.
 */
export function statusForUrl(list: JobUrlEntry[], url: string): JobLogStatus | undefined {
  return list.find((e) => e.url === url)?.status;
}

/**
 * Move a posting forward through the flow, never back.
 *
 * The "never demote" rule the two-step path relies on, said once. It also
 * declines to touch a status this build does not recognise — after a sync a
 * newer peer's value can be sitting here, and overwriting what we cannot
 * interpret is how the log stops being the truth.
 */
function promote(
  list: JobUrlEntry[],
  url: string,
  status: JobUrlStatus,
  now: number,
): JobUrlEntry[] {
  const current = statusForUrl(list, url);
  if (current === undefined) return applyStatus(list, url, status, now);
  if (!isKnownStatus(current)) return list;
  return statusRank(current) >= statusRank(status) ? list : applyStatus(list, url, status, now);
}

/**
 * Record a two-step ("redirect") posting: the board posting `sourceUrl` handed
 * off to the external application `destUrl`. Both ends are kept — the source so
 * the board posting is visibly dealt with, the destination because that is the
 * page actually applied on — and they point at each other.
 *
 * Either end may be new (a posting browsed rather than imported) or already
 * known; existing entries are never demoted (`promote`), so re-visiting an
 * application already marked applied — or skipped — leaves it that way.
 */
export function linkRedirect(
  list: JobUrlEntry[],
  sourceUrl: string,
  destUrl: string,
  now: number = Date.now(),
): JobUrlEntry[] {
  if (!sourceUrl || !destUrl || sourceUrl === destUrl) return list;

  let out = ensureUrl(ensureUrl(list, sourceUrl, now), destUrl, now);

  out = out.map((e) => (e.url === sourceUrl ? { ...normalizeEntry(e), redirectUrl: destUrl } : e));
  out = promote(out, sourceUrl, 'redirected', now);

  out = out.map((e) => (e.url === destUrl ? { ...normalizeEntry(e), sourceUrl } : e));
  out = promote(out, destUrl, 'opened', now);

  return out;
}

/**
 * Apply a status to `url` and to every posting it came from, following
 * `sourceUrl` upward. Submitting on the ATS is what marks the board posting
 * applied, since that is where the application actually happened. Cycle-safe.
 *
 * Uses `recordStatus`, so applying on a page nobody imported still records it.
 * For the hops above the first that is a no-op — an entry named by a live
 * `sourceUrl` is by definition already in the list.
 */
export function applyStatusChain(
  list: JobUrlEntry[],
  url: string,
  status: JobLogStatus,
  now: number = Date.now(),
): JobUrlEntry[] {
  let out = list;
  const seen = new Set<string>();
  let current: string | undefined = url;
  while (current && !seen.has(current)) {
    const at: string = current;
    seen.add(at);
    out = recordStatus(out, at, status, now);
    current = out.find((e) => e.url === at)?.sourceUrl;
  }
  return out;
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
  const stats: JobUrlStats = {
    total: visible.length, new: 0, opened: 0, redirected: 0, applied: 0, skipped: 0,
  };
  // A status from a newer peer counts toward `total` and nothing else — there is
  // no honest bucket for it, and inventing one would misreport the queue.
  for (const e of visible) if (isKnownStatus(e.status)) stats[e.status]++;
  return stats;
}
