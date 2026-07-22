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

export function removeUrl(list: JobUrlEntry[], url: string): JobUrlEntry[] {
  return list.filter((e) => e.url !== url);
}

export function jobUrlStats(list: JobUrlEntry[]): JobUrlStats {
  const stats: JobUrlStats = { total: list.length, new: 0, opened: 0, applied: 0, skipped: 0 };
  for (const e of list) stats[e.status]++;
  return stats;
}
