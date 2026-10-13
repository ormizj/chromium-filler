/**
 * Pure logic for the job-queue session — the flow that turns a 60-link import
 * into something a person can actually work through.
 *
 * The queue is *derived* from the job-URL database rather than copied into a
 * separate list: an entry with status `new` is waiting, and anything else has
 * already been dealt with. That keeps one source of truth, so importing more
 * URLs or editing a status by hand feed the queue automatically.
 *
 * The session itself is a window, not a dump: at most `batchSize` tabs exist at
 * once, and closing one is what pulls in the next.
 */

import type { JobUrlEntry } from './types';
import { visibleUrls } from './jobUrls';

/** Statuses that mean "this posting still needs to be looked at". */
const WAITING = 'new';

/**
 * The URLs to open right now: the oldest waiting entries, enough to bring the
 * number of open tabs back up to `batchSize`.
 *
 * `inFlight` is passed in rather than inferred from status because status does
 * not say it: a posting with a tab on it is still `new` until the user finishes
 * it. Trusting status alone would open the same posting twice.
 *
 * `seen` is everything this session has already opened, for the same reason: a
 * posting whose tab was closed without finishing it (a finish that lost a
 * race) is still `new`, and must not come straight back.
 * It takes no slot — only `inFlight` does.
 */
export function nextBatch(
  list: JobUrlEntry[],
  inFlight: string[],
  batchSize: number,
  seen: string[] = [],
): string[] {
  const slots = Math.min(batchSize, batchSize - inFlight.length);
  if (slots <= 0) return [];
  const open = new Set([...inFlight, ...seen]);
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
  /** Tabs open right now. Their postings are still `new`, but not `queued`. */
  inFlight: number;
  /** Postings the user finished — closed, skipped or marked done by hand. */
  done: number;
  /** `done / total`, clamped to 0 for an empty database. */
  ratio: number;
}

/** One mark in the session strip's progress row. */
export type ProgressDot = 'done' | 'now' | 'waiting';

/**
 * The session strip's row of dots (the reference's `.qdots`) — the shape of the
 * queue at a glance, beside the sentence that gives the numbers.
 *
 * Up to `max` postings it is literal: one dot each. Past that it is proportional,
 * because the strip is a single line inside a 380px card and sixty dots is not a
 * glance at anything. Either way the currently-open posting gets its own mark, and
 * it is never squeezed out by rounding — knowing which one is live is the reason
 * the row is more useful than the ratio alone.
 */
export function progressDots(progress: QueueProgress, max = 7): ProgressDot[] {
  const { total, done, inFlight } = progress;
  if (total <= 0) return [];
  const slots = Math.min(total, max);
  const live = inFlight > 0 ? 1 : 0;
  const scaled = total <= max ? done : Math.round((done / total) * slots);
  const filled = Math.min(scaled, slots - live);
  return Array.from({ length: slots }, (_, i) =>
    i < filled ? 'done' : i < filled + live ? 'now' : 'waiting');
}

/** Summarize the queue for the popup, modal, and options headers. */
export function queueProgress(rawList: JobUrlEntry[], inFlight: string[]): QueueProgress {
  // A tombstone is a posting the user removed; counting it would leave the
  // session reporting progress against a denominator it can never finish.
  const list = visibleUrls(rawList);
  const open = new Set(inFlight);
  let queued = 0;
  let done = 0;
  let live = 0;
  for (const entry of list) {
    if (open.has(entry.url)) live++;
    // A waiting posting with a tab on it is in flight, not queued.
    if (entry.status === WAITING && !open.has(entry.url)) queued++;
    else if (entry.status === 'done') done++;
  }
  return {
    total: list.length,
    queued,
    inFlight: live,
    done,
    ratio: list.length === 0 ? 0 : done / list.length,
  };
}
