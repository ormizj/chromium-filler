import { describe, it, expect } from 'vitest';
import { SYNC_SCHEMA, mergeJobs, emptySnapshot, type JobSnapshot } from './syncJobs';
import type { JobDetails } from './jobDetails';
import type { JobLogStatus, JobStatusEvent, JobUrlEntry } from './types';

const T = 1_700_000_000_000;

/** An entry whose history is the single status given, unless events are passed. */
function entry(
  url: string,
  status: JobLogStatus,
  at: number,
  extra: Partial<JobUrlEntry> = {},
): JobUrlEntry {
  const history: JobStatusEvent[] = extra.history ?? [{ status, at }];
  return {
    id: `id-${url}`,
    url,
    status,
    addedAt: at,
    updatedAt: at,
    history,
    ...extra,
  };
}

/** An entry built from a log, with the status left for the merge to derive. */
function logged(url: string, events: Array<[JobLogStatus, number]>): JobUrlEntry {
  const history = events.map(([status, at]) => ({ status, at }));
  const last = history[history.length - 1];
  return entry(url, last.status, history[0].at, {
    history,
    updatedAt: last.at,
  });
}

function snap(jobUrls: JobUrlEntry[], jobDetails: Record<string, JobDetails> = {}): JobSnapshot {
  return { schema: SYNC_SCHEMA, jobUrls, jobDetails };
}

function details(url: string, capturedAt: number, over: Partial<JobDetails> = {}): JobDetails {
  return {
    url,
    description: [{ kind: 'para', text: 'body' }],
    requirements: [],
    meta: {},
    capturedAt,
    ...over,
  };
}

function emptyDetails(url: string, capturedAt: number): JobDetails {
  return { url, description: [], requirements: [], meta: {}, capturedAt };
}

function statusOf(s: JobSnapshot, url: string): JobLogStatus | undefined {
  return s.jobUrls.find((e) => e.url === url)?.status;
}

describe('mergeJobs — nothing is replaced', () => {
  it('keeps a URL only one side knows', () => {
    const a = snap([entry('a://1', 'applied', T)]);
    const b = snap([entry('a://2', 'skipped', T)]);
    expect(mergeJobs(a, b).jobUrls.map((e) => e.url).sort()).toEqual(['a://1', 'a://2']);
  });

  it('downloads the whole database onto an empty side', () => {
    const remote = snap([entry('a://1', 'applied', T)], { 'a://1': details('a://1', T) });
    const merged = mergeJobs(emptySnapshot(), remote);
    expect(merged.jobUrls).toHaveLength(1);
    expect(merged.jobDetails['a://1']).toBeDefined();
  });

  it('uploads the whole database when the far side is empty', () => {
    const local = snap([entry('a://1', 'applied', T)]);
    expect(mergeJobs(local, emptySnapshot()).jobUrls).toHaveLength(1);
  });
});

describe('mergeJobs — status is derived from the merged log', () => {
  it('takes the newest event when one side is behind', () => {
    const a = snap([logged('a://1', [['new', T], ['opened', T + 10]])]);
    const b = snap([logged('a://1', [['new', T], ['applied', T + 20]])]);
    expect(statusOf(mergeJobs(a, b), 'a://1')).toBe('applied');
  });

  it('prefers the later decision, not the stronger one', () => {
    const applied = snap([logged('a://1', [['applied', T + 100]])]);
    const skipped = snap([logged('a://1', [['skipped', T + 50]])]);
    expect(statusOf(mergeJobs(applied, skipped), 'a://1')).toBe('applied');
  });

  it('un-skips: a later reset to new survives the merge', () => {
    const reset = snap([logged('a://1', [['skipped', T], ['new', T + 500]])]);
    const stale = snap([logged('a://1', [['skipped', T]])]);
    expect(statusOf(mergeJobs(reset, stale), 'a://1')).toBe('new');
    expect(statusOf(mergeJobs(stale, reset), 'a://1')).toBe('new');
  });

  it('unions both logs rather than keeping one', () => {
    const a = snap([logged('a://1', [['new', T], ['opened', T + 10]])]);
    const b = snap([logged('a://1', [['new', T], ['skipped', T + 20]])]);
    const merged = mergeJobs(a, b).jobUrls[0];
    expect(merged.history).toEqual([
      { status: 'new', at: T },
      { status: 'opened', at: T + 10 },
      { status: 'skipped', at: T + 20 },
    ]);
  });

  it('breaks a same-millisecond tie by rank, both ways round', () => {
    const a = snap([logged('a://1', [['opened', T]])]);
    const b = snap([logged('a://1', [['applied', T]])]);
    expect(statusOf(mergeJobs(a, b), 'a://1')).toBe('applied');
    expect(statusOf(mergeJobs(b, a), 'a://1')).toBe('applied');
  });

  it('takes the earliest addedAt and appliedAt, and the latest updatedAt', () => {
    const a = snap([entry('a://1', 'applied', T, { appliedAt: T + 5, updatedAt: T + 5 })]);
    const b = snap([entry('a://1', 'applied', T - 100, { appliedAt: T + 9, updatedAt: T + 9 })]);
    const merged = mergeJobs(a, b).jobUrls[0];
    expect(merged.addedAt).toBe(T - 100);
    expect(merged.appliedAt).toBe(T + 5);
    expect(merged.updatedAt).toBe(T + 9);
  });

  it('fills in a redirect link known to only one side', () => {
    const a = snap([entry('a://1', 'redirected', T, { redirectUrl: 'b://ats' })]);
    const b = snap([entry('a://1', 'opened', T)]);
    expect(mergeJobs(b, a).jobUrls[0].redirectUrl).toBe('b://ats');
  });
});

describe('mergeJobs — tombstones', () => {
  it('a delete beats a live entry from the other device', () => {
    const deleted = snap([logged('a://1', [['new', T], ['deleted', T + 10]])]);
    const live = snap([logged('a://1', [['new', T]])]);
    expect(statusOf(mergeJobs(live, deleted), 'a://1')).toBe('deleted');
  });

  it('a later un-delete beats the tombstone', () => {
    const deleted = snap([logged('a://1', [['deleted', T]])]);
    const back = snap([logged('a://1', [['deleted', T], ['new', T + 10]])]);
    expect(statusOf(mergeJobs(deleted, back), 'a://1')).toBe('new');
  });

  it('does not resurrect a posting deleted on one side', () => {
    const deleted = snap([logged('a://1', [['new', T], ['deleted', T + 10]])]);
    const live = snap([logged('a://1', [['new', T]])]);
    const once = mergeJobs(live, deleted);
    expect(statusOf(mergeJobs(once, live), 'a://1')).toBe('deleted');
  });
});

describe('mergeJobs — jobDetails', () => {
  it('an empty capture never overwrites a populated one', () => {
    const full = snap([], { 'a://1': details('a://1', T) });
    const blank = snap([], { 'a://1': emptyDetails('a://1', T + 100) });
    expect(mergeJobs(full, blank).jobDetails['a://1'].description).toHaveLength(1);
    expect(mergeJobs(blank, full).jobDetails['a://1'].description).toHaveLength(1);
  });

  it('takes the newer capture when both say something', () => {
    const old = snap([], { 'a://1': details('a://1', T, { title: 'Old' }) });
    const fresh = snap([], { 'a://1': details('a://1', T + 50, { title: 'New' }) });
    expect(mergeJobs(old, fresh).jobDetails['a://1'].title).toBe('New');
    expect(mergeJobs(fresh, old).jobDetails['a://1'].title).toBe('New');
  });

  it('keeps captures each side has alone', () => {
    const a = snap([], { 'a://1': details('a://1', T) });
    const b = snap([], { 'a://2': details('a://2', T) });
    expect(Object.keys(mergeJobs(a, b).jobDetails).sort()).toEqual(['a://1', 'a://2']);
  });
});

describe('mergeJobs — forward compatibility', () => {
  it('carries a status this build has never heard of', () => {
    const future = snap([logged('a://1', [['new', T], ['interviewing', T + 10]])]);
    const merged = mergeJobs(emptySnapshot(), future);
    expect(statusOf(merged, 'a://1')).toBe('interviewing');
    expect(merged.jobUrls[0].history).toContainEqual({ status: 'interviewing', at: T + 10 });
  });

  it('never coerces an unknown status to new', () => {
    const future = snap([logged('a://1', [['interviewing', T + 10]])]);
    const stale = snap([logged('a://1', [['new', T]])]);
    expect(statusOf(mergeJobs(stale, future), 'a://1')).toBe('interviewing');
  });

  it('preserves a field this build does not know about', () => {
    const future = snap([entry('a://1', 'applied', T, { rating: 5 } as Partial<JobUrlEntry>)]);
    const merged = mergeJobs(emptySnapshot(), future);
    expect((merged.jobUrls[0] as unknown as Record<string, unknown>).rating).toBe(5);
  });

  it('backfills an entry from an older build that has no history at all', () => {
    const legacy = { id: 'x', url: 'a://1', status: 'applied', addedAt: T } as unknown as JobUrlEntry;
    const merged = mergeJobs(emptySnapshot(), snap([legacy]));
    expect(merged.jobUrls[0].history).toEqual([{ status: 'applied', at: T }]);
    expect(merged.jobUrls[0].updatedAt).toBe(T);
  });
});

describe('mergeJobs — the properties that make two-way sync safe', () => {
  const a = snap(
    [
      logged('a://1', [['new', T], ['applied', T + 30]]),
      logged('a://2', [['new', T], ['skipped', T + 10]]),
      logged('a://4', [['new', T], ['deleted', T + 5]]),
    ],
    { 'a://1': details('a://1', T + 30, { title: 'One' }) },
  );
  const b = snap(
    [
      logged('a://1', [['new', T], ['opened', T + 20]]),
      logged('a://3', [['new', T + 1]]),
      logged('a://4', [['new', T]]),
    ],
    { 'a://1': emptyDetails('a://1', T + 99), 'a://3': details('a://3', T) },
  );
  const c = snap(
    [logged('a://2', [['new', T], ['skipped', T + 10], ['new', T + 40]])],
    { 'a://2': details('a://2', T + 40) },
  );

  it('is commutative — neither device is the master', () => {
    expect(mergeJobs(a, b)).toEqual(mergeJobs(b, a));
  });

  it('is idempotent — syncing twice changes nothing', () => {
    const once = mergeJobs(a, b);
    expect(mergeJobs(once, b)).toEqual(once);
    expect(mergeJobs(once, once)).toEqual(once);
  });

  it('is associative — the order devices sync in does not matter', () => {
    expect(mergeJobs(mergeJobs(a, b), c)).toEqual(mergeJobs(a, mergeJobs(b, c)));
  });
});
