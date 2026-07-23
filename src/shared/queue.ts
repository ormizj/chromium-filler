/**
 * Pure logic for the job-queue session — the flow that turns a 60-link import
 * into something a person can actually work through.
 *
 * The queue is *derived* from the job-URL database rather than copied into a
 * separate list: an entry with status `new` is waiting, and anything else has
 * already been dealt with. That keeps one source of truth, so importing more
 * URLs, editing a status by hand, or the redirect linker marking a posting
 * `redirected` all feed the queue automatically.
 *
 * The session itself is a window, not a dump: at most `batchSize` tabs exist at
 * once, and closing one is what pulls in the next.
 */

import type { JobUrlEntry } from './types';

/** Statuses that mean "this posting still needs to be looked at". */
const WAITING = 'new';

/**
 * The URLs to open right now: the oldest waiting entries, enough to bring the
 * number of open tabs back up to `batchSize`.
 *
 * `inFlight` is passed in rather than inferred from status because the two can
 * disagree — a tab is open the instant `chrome.tabs.create` resolves, which may
 * be before its `opened` status has been written. Trusting status alone would
 * open the same posting twice.
 */
export function nextBatch(
  list: JobUrlEntry[],
  inFlight: string[],
  batchSize: number,
): string[] {
  const slots = Math.min(batchSize, batchSize - inFlight.length);
  if (slots <= 0) return [];
  const open = new Set(inFlight);
  const out: string[] = [];
  for (const entry of list) {
    if (out.length >= slots) break;
    if (entry.status !== WAITING || open.has(entry.url)) continue;
    out.push(entry.url);
  }
  return out;
}

export interface QueueProgress {
  /** Every entry in the database. */
  total: number;
  /** Waiting to be opened. */
  queued: number;
  /** Tabs open right now. */
  inFlight: number;
  applied: number;
  skipped: number;
  /** Postings that need no further action: applied, skipped, or handed off. */
  done: number;
  /** `done / total`, clamped to 0 for an empty database. */
  ratio: number;
}

/** Summarize the queue for the popup, modal, and options headers. */
export function queueProgress(list: JobUrlEntry[], inFlight: string[]): QueueProgress {
  const open = new Set(inFlight);
  let queued = 0;
  let applied = 0;
  let skipped = 0;
  let redirected = 0;
  let live = 0;
  for (const entry of list) {
    if (open.has(entry.url)) live++;
    if (entry.status === WAITING) queued++;
    else if (entry.status === 'applied') applied++;
    else if (entry.status === 'skipped') skipped++;
    else if (entry.status === 'redirected') redirected++;
  }
  // A redirected posting is finished as far as the queue is concerned — the
  // application continues on the ATS entry, which is tracked in its own right.
  const done = applied + skipped + redirected;
  return {
    total: list.length,
    queued,
    inFlight: live,
    applied,
    skipped,
    done,
    ratio: list.length === 0 ? 0 : done / list.length,
  };
}
