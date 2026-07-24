/**
 * Pure logic for the job-URL database: the URL is the unique key, and every
 * status change is timestamped and logged so the dashboard can show history and
 * track which applications were actually sent.
 */

import type { JobUrlEntry, JobUrlStats, JobUrlStatus } from './types';

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
  status: JobUrlStatus,
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
  status: JobUrlStatus,
  now: number = Date.now(),
): JobUrlEntry[] {
  return applyStatus(ensureUrl(list, url, now), url, status, now);
}

function statusOf(list: JobUrlEntry[], url: string): JobUrlStatus | undefined {
  return list.find((e) => e.url === url)?.status;
}

/**
 * Record a two-step ("redirect") posting: the board posting `sourceUrl` handed
 * off to the external application `destUrl`. Both ends are kept — the source so
 * the board posting is visibly dealt with, the destination because that is the
 * page actually applied on — and they point at each other.
 *
 * Either end may be new (a posting browsed rather than imported) or already
 * known; existing entries are never demoted, so re-visiting an application
 * already marked applied leaves it applied.
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
  if (statusOf(out, sourceUrl) !== 'applied') out = applyStatus(out, sourceUrl, 'redirected', now);

  out = out.map((e) => (e.url === destUrl ? { ...normalizeEntry(e), sourceUrl } : e));
  if (statusOf(out, destUrl) === 'new') out = applyStatus(out, destUrl, 'opened', now);

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
  status: JobUrlStatus,
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

export function removeUrl(list: JobUrlEntry[], url: string): JobUrlEntry[] {
  return list.filter((e) => e.url !== url);
}

export function jobUrlStats(list: JobUrlEntry[]): JobUrlStats {
  const stats: JobUrlStats = {
    total: list.length, new: 0, opened: 0, redirected: 0, applied: 0, skipped: 0,
  };
  for (const e of list) stats[e.status]++;
  return stats;
}
