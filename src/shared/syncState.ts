/**
 * Merging two copies of the whole app state — the correctness story of sync, as
 * one pure function.
 *
 * Two devices write with nobody arbitrating, so the merge has to be
 * **commutative, associative and idempotent**: neither device is the master,
 * syncing twice must change nothing, and the order the devices happen to sync in
 * must not matter. That is also what makes the compare-and-swap retry in the
 * Drive client safe — a lost race is repaired by simply merging again.
 *
 * It is bought by making every rule a *join* rather than a choice:
 *
 * - **The job list:** `history` is a set-union of timestamped events and
 *   `status` is *derived* from it. The obvious alternative — "the stronger status
 *   wins" — reads well and is wrong at the edges: rank is monotonic, so a posting
 *   could never be set back to new. A union of events needs no special case for a
 *   manual edit: a correction is just a later event.
 * - **Everything else** (`state`): a last-writer-wins register per unit — see
 *   `syncUnits.ts`. Newest `at` wins; at the same instant a stable content key
 *   decides; a lesson keeps the higher hit count whichever side wins.
 *
 * Where two values genuinely conflict the tie-break is *symmetric*, because a
 * rule like "the left-hand side wins" would quietly destroy commutativity.
 *
 * Nothing here calls `chrome.*` or the network, or reads the clock. Pruning
 * depends on `now`, and a merge that changed with the clock could not be
 * idempotent — the storage edge prunes; see syncSnapshot.ts.
 */

import { normalizeEntry, statusRank } from './jobUrls';
import { comparable, isLessonUnit, type Stamped, type UnitMap } from './syncUnits';
import type { JobLogStatus, JobStatusEvent, JobUrlEntry, Lesson } from './types';

/**
 * The wire format's version. Bumped only for a change an older build would
 * mishandle rather than refuse.
 *
 * 3 is the whole app state. A schema-2 build would read a schema-3 file as a job
 * database, rebuild it from the keys it knows on upload, and so silently delete
 * every profile value, lesson and setting on the far side. Bumped, it refuses
 * instead and says to update. Schema 1 and 2 files — an old backup, or the
 * remote file the first time an updated device syncs — are still read
 * (`upgradeSnapshot`), as a job list with nothing else.
 */
export const SYNC_SCHEMA = 3;

/**
 * What travels between devices, and what a backup file holds.
 *
 * `jobUrls` is verbatim what `chrome.storage.local` holds — no mapping layer to
 * drift, and the round-trip is lossless by construction. `state` is everything
 * else as stamped units (`syncUnits.ts`), because the profile, lessons and
 * settings carry no history of their own to union.
 *
 * Not in it, ever: the card's layout and the sync switch
 * (`LOCAL_SETTINGS`), the OAuth client and the tokens.
 */
export interface Snapshot {
  schema: number;
  jobUrls: JobUrlEntry[];
  state: UnitMap;
}

export function emptySnapshot(): Snapshot {
  return { schema: SYNC_SCHEMA, jobUrls: [], state: {} };
}

const isMap = (v: unknown): boolean => !!v && typeof v === 'object' && !Array.isArray(v);

/** A snapshot this build understands well enough to merge. */
export function isSupportedSnapshot(value: unknown): value is Snapshot {
  const s = value as Partial<Snapshot> | null;
  if (!s || typeof s !== 'object' || !Array.isArray(s.jobUrls)) return false;
  if (s.schema === 1 || s.schema === 2) return true;
  return s.schema === SYNC_SCHEMA && isMap(s.state);
}

/**
 * Lift an older snapshot to the current shape: its job list, and no other state.
 * What schema 2 also carried — captured posting text and older builds' site
 * configs — has no reader any more and is dropped.
 */
export function upgradeSnapshot(s: Snapshot): Snapshot {
  if (s.schema === SYNC_SCHEMA) return s;
  return { schema: SYNC_SCHEMA, jobUrls: s.jobUrls, state: {} };
}

/* ---------------- The job list ---------------- */

function eventKey(e: JobStatusEvent): string {
  return `${e.status} ${e.at}`;
}

/**
 * Oldest first. At the same instant the higher rank sorts last, so it is the one
 * derived as current — and a status this build cannot interpret (rank -1) never
 * wins a tie against one it can. The final comparison on the status string
 * itself is what keeps two devices from ordering the same log differently.
 */
function byTime(x: JobStatusEvent, y: JobStatusEvent): number {
  if (x.at !== y.at) return x.at - y.at;
  const rank = statusRank(x.status) - statusRank(y.status);
  if (rank !== 0) return rank;
  return x.status < y.status ? -1 : x.status > y.status ? 1 : 0;
}

function mergeHistory(a: JobStatusEvent[], b: JobStatusEvent[]): JobStatusEvent[] {
  const seen = new Map<string, JobStatusEvent>();
  for (const e of [...a, ...b]) seen.set(eventKey(e), e);
  return [...seen.values()].sort(byTime);
}

/** The status the merged log says a posting is at now: its newest event. */
export function deriveStatus(history: JobStatusEvent[], fallback: JobLogStatus): JobLogStatus {
  return history.length ? history[history.length - 1].status : fallback;
}

/**
 * Which of two records of the same posting is the one to prefer for anything the
 * rules below do not decide — including fields this build has never heard of.
 *
 * Newest wins; at the same instant the id decides. Both halves are symmetric,
 * which is the point: `a` winning ties would make the whole merge order-
 * dependent, and the bug would only show as two devices disagreeing forever.
 */
function preferred(a: JobUrlEntry, b: JobUrlEntry): [JobUrlEntry, JobUrlEntry] {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? [a, b] : [b, a];
  return a.id <= b.id ? [a, b] : [b, a];
}

function mergeEntry(left: JobUrlEntry, right: JobUrlEntry): JobUrlEntry {
  const a = normalizeEntry(left);
  const b = normalizeEntry(right);
  const [first, second] = preferred(a, b);
  const history = mergeHistory(a.history, b.history);

  // Spread both so a newer peer's extra fields survive a round-trip through this
  // build instead of being silently dropped on every sync; the winner is chosen
  // symmetrically above. The named fields below then overwrite what we do decide.
  return {
    ...second,
    ...first,
    id: a.id <= b.id ? a.id : b.id,
    url: a.url,
    history,
    status: deriveStatus(history, first.status),
    addedAt: Math.min(a.addedAt, b.addedAt),
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
    note: first.note ?? second.note,
  };
}

function mergeUrls(a: JobUrlEntry[], b: JobUrlEntry[]): JobUrlEntry[] {
  const byUrl = new Map<string, JobUrlEntry>();
  for (const e of a) byUrl.set(e.url, normalizeEntry(e));
  for (const e of b) {
    const existing = byUrl.get(e.url);
    byUrl.set(e.url, existing ? mergeEntry(existing, e) : normalizeEntry(e));
  }
  return [...byUrl.values()].sort((x, y) => (x.url < y.url ? -1 : x.url > y.url ? 1 : 0));
}

/* ---------------- Everything else ---------------- */

/**
 * Newest wins. At the same instant something beats nothing — a removal and a
 * value with one timestamp is a copy that never saw the value arrive, not a
 * decision to remove it — and then the content decides. Symmetric either way.
 */
function pick(key: string, a: Stamped, b: Stamped): Stamped {
  if (a.at !== b.at) return a.at > b.at ? a : b;
  const aGone = a.value === null;
  if (aGone !== (b.value === null)) return aGone ? b : a;
  return comparable(key, a.value) <= comparable(key, b.value) ? a : b;
}

function mergeUnit(key: string, a: Stamped, b: Stamped): Stamped {
  const won = pick(key, a, b);
  // A lesson's hits are counted on every device that fills with it. The higher
  // count is the better guess at the truth, and `max` keeps the join a join —
  // a re-teach on one side must not reset the other side's count.
  if (isLessonUnit(key) && won.value && a.value && b.value) {
    const hits = Math.max((a.value as Lesson).hits ?? 0, (b.value as Lesson).hits ?? 0);
    if ((won.value as Lesson).hits !== hits) return { at: won.at, value: { ...(won.value as Lesson), hits } };
  }
  return won;
}

function mergeUnits(a: UnitMap, b: UnitMap): UnitMap {
  const out: UnitMap = { ...a };
  for (const [key, unit] of Object.entries(b)) {
    const existing = out[key];
    out[key] = existing ? mergeUnit(key, existing, unit) : unit;
  }
  // Sorted so both ends write the same file for the same state.
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
}

/**
 * Join two copies of the app state. Neither argument is privileged: the result is
 * the same whichever way round they are passed, and merging it again with either
 * input returns it unchanged.
 */
export function mergeSnapshots(a: Snapshot, b: Snapshot): Snapshot {
  return {
    schema: SYNC_SCHEMA,
    jobUrls: mergeUrls(a.jobUrls, b.jobUrls),
    state: mergeUnits(a.state ?? {}, b.state ?? {}),
  };
}
