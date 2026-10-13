import { describe, it, expect } from 'vitest';
import {
  SYNC_SCHEMA, emptySnapshot, isSupportedSnapshot, mergeSnapshots, upgradeSnapshot, type Snapshot,
} from './syncState';
import type { UnitMap } from './syncUnits';
import type { JobLogStatus, JobStatusEvent, JobUrlEntry, Lesson } from './types';

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

function snap(jobUrls: JobUrlEntry[], state: UnitMap = {}): Snapshot {
  return { schema: SYNC_SCHEMA, jobUrls, state };
}

function statusOf(s: Snapshot, url: string): JobLogStatus | undefined {
  return s.jobUrls.find((e) => e.url === url)?.status;
}

function lesson(over: Partial<Lesson> = {}): Lesson {
  return {
    id: 'l1',
    signature: { question: 'email', kind: 'text' },
    target: { field: 'email' },
    label: 'Email',
    createdAt: T,
    hits: 0,
    ...over,
  };
}

describe('mergeSnapshots — nothing is replaced', () => {
  it('keeps a URL only one side knows', () => {
    const a = snap([entry('a://1', 'done', T)]);
    const b = snap([entry('a://2', 'new', T)]);
    expect(mergeSnapshots(a, b).jobUrls.map((e) => e.url).sort()).toEqual(['a://1', 'a://2']);
  });

  it('downloads the whole database onto an empty side', () => {
    const remote = snap([entry('a://1', 'done', T)], { 'profile.values.email': { at: T, value: 'me@x' } });
    const merged = mergeSnapshots(emptySnapshot(), remote);
    expect(merged.jobUrls).toHaveLength(1);
    expect(merged.state['profile.values.email'].value).toBe('me@x');
  });

  it('uploads the whole database when the far side is empty', () => {
    const local = snap([entry('a://1', 'done', T)]);
    expect(mergeSnapshots(local, emptySnapshot()).jobUrls).toHaveLength(1);
  });
});

describe('mergeSnapshots — status is derived from the merged log', () => {
  it('takes the newest event when one side is behind', () => {
    const a = snap([logged('a://1', [['new', T]])]);
    const b = snap([logged('a://1', [['new', T], ['done', T + 20]])]);
    expect(statusOf(mergeSnapshots(a, b), 'a://1')).toBe('done');
  });

  it('un-finishes: a later reset to new survives the merge', () => {
    const reset = snap([logged('a://1', [['done', T], ['new', T + 500]])]);
    const stale = snap([logged('a://1', [['done', T]])]);
    expect(statusOf(mergeSnapshots(reset, stale), 'a://1')).toBe('new');
    expect(statusOf(mergeSnapshots(stale, reset), 'a://1')).toBe('new');
  });

  it('unions both logs rather than keeping one', () => {
    const a = snap([logged('a://1', [['new', T], ['done', T + 10]])]);
    const b = snap([logged('a://1', [['new', T], ['done', T + 20]])]);
    expect(mergeSnapshots(a, b).jobUrls[0].history).toEqual([
      { status: 'new', at: T },
      { status: 'done', at: T + 10 },
      { status: 'done', at: T + 20 },
    ]);
  });

  it('breaks a same-millisecond tie by rank, both ways round', () => {
    const a = snap([logged('a://1', [['new', T]])]);
    const b = snap([logged('a://1', [['done', T]])]);
    expect(statusOf(mergeSnapshots(a, b), 'a://1')).toBe('done');
    expect(statusOf(mergeSnapshots(b, a), 'a://1')).toBe('done');
  });

  it('takes the earliest addedAt and the latest updatedAt', () => {
    const a = snap([entry('a://1', 'done', T, { updatedAt: T + 5 })]);
    const b = snap([entry('a://1', 'done', T - 100, { updatedAt: T + 9 })]);
    const merged = mergeSnapshots(a, b).jobUrls[0];
    expect(merged.addedAt).toBe(T - 100);
    expect(merged.updatedAt).toBe(T + 9);
  });

  /** A peer's log from before the two-status model reads in today's words. */
  it('maps an older log to new and done', () => {
    const old = snap([logged('a://1', [['new', T], ['opened', T + 1], ['applied', T + 2]])]);
    const merged = mergeSnapshots(emptySnapshot(), old).jobUrls[0];
    expect(merged.status).toBe('done');
    expect(merged.history.map((e) => e.status)).toEqual(['new', 'new', 'done']);
  });
});

describe('mergeSnapshots — tombstones', () => {
  it('a delete beats a live entry from the other device', () => {
    const deleted = snap([logged('a://1', [['new', T], ['deleted', T + 10]])]);
    const live = snap([logged('a://1', [['new', T]])]);
    expect(statusOf(mergeSnapshots(live, deleted), 'a://1')).toBe('deleted');
  });

  it('a later un-delete beats the tombstone', () => {
    const deleted = snap([logged('a://1', [['deleted', T]])]);
    const back = snap([logged('a://1', [['deleted', T], ['new', T + 10]])]);
    expect(statusOf(mergeSnapshots(deleted, back), 'a://1')).toBe('new');
  });

  it('does not resurrect a posting deleted on one side', () => {
    const deleted = snap([logged('a://1', [['new', T], ['deleted', T + 10]])]);
    const live = snap([logged('a://1', [['new', T]])]);
    const once = mergeSnapshots(live, deleted);
    expect(statusOf(mergeSnapshots(once, live), 'a://1')).toBe('deleted');
  });
});

describe('mergeSnapshots — the rest of the state', () => {
  it('keeps the newer of two changes to one unit, both ways round', () => {
    const a = snap([], { 'profile.values.email': { at: T, value: 'old@x' } });
    const b = snap([], { 'profile.values.email': { at: T + 1, value: 'new@x' } });
    expect(mergeSnapshots(a, b).state['profile.values.email'].value).toBe('new@x');
    expect(mergeSnapshots(b, a).state['profile.values.email'].value).toBe('new@x');
  });

  it('keeps both devices\' changes to different units', () => {
    const a = snap([], { 'profile.values.email': { at: T, value: 'me@x' } });
    const b = snap([], { 'settings.sessionBatchSize': { at: T, value: 4 } });
    expect(Object.keys(mergeSnapshots(a, b).state).sort())
      .toEqual(['profile.values.email', 'settings.sessionBatchSize']);
  });

  it('lets a newer removal beat an older live copy, and a newer re-add beat the removal', () => {
    const live = snap([], { 'customField.c_x': { at: T, value: { id: 'c_x' } } });
    const gone = snap([], { 'customField.c_x': { at: T + 5, value: null } });
    expect(mergeSnapshots(live, gone).state['customField.c_x'].value).toBeNull();
    const back = snap([], { 'customField.c_x': { at: T + 9, value: { id: 'c_x' } } });
    expect(mergeSnapshots(gone, back).state['customField.c_x'].value).toEqual({ id: 'c_x' });
  });

  /**
   * Same instant, different values: only possible when neither was stamped (both
   * changed before the upgrade). The pick must not depend on argument order.
   */
  it('breaks a tie by content, the same way whichever side is first', () => {
    const a = snap([], { 'profile.values.city': { at: 0, value: 'Oslo' } });
    const b = snap([], { 'profile.values.city': { at: 0, value: 'Bergen' } });
    expect(mergeSnapshots(a, b)).toEqual(mergeSnapshots(b, a));
  });

  it('lets a value beat a removal stamped at the same instant, both ways round', () => {
    const live = snap([], { 'doc.resume': { at: T, value: { name: 'cv.pdf' } } });
    const gone = snap([], { 'doc.resume': { at: T, value: null } });
    expect(mergeSnapshots(live, gone).state['doc.resume'].value).toEqual({ name: 'cv.pdf' });
    expect(mergeSnapshots(gone, live).state['doc.resume'].value).toEqual({ name: 'cv.pdf' });
  });

  it('keeps the higher hit count, whichever lesson wins', () => {
    const key = 'lesson.k';
    const retaught = snap([], { [key]: { at: T + 10, value: lesson({ target: { field: 'c_work' }, hits: 0 }) } });
    const counted = snap([], { [key]: { at: T, value: lesson({ hits: 7 }) } });
    const merged = mergeSnapshots(counted, retaught).state[key].value as Lesson;
    expect(merged.target).toEqual({ field: 'c_work' });
    expect(merged.hits).toBe(7);
  });

  it('carries a unit this build cannot place', () => {
    const future = snap([], { 'gadget.thing': { at: T, value: 1 } });
    expect(mergeSnapshots(emptySnapshot(), future).state['gadget.thing']).toEqual({ at: T, value: 1 });
  });
});

describe('mergeSnapshots — forward compatibility', () => {
  it('carries a status this build has never heard of', () => {
    const future = snap([logged('a://1', [['new', T], ['interviewing', T + 10]])]);
    const merged = mergeSnapshots(emptySnapshot(), future);
    expect(statusOf(merged, 'a://1')).toBe('interviewing');
    expect(merged.jobUrls[0].history).toContainEqual({ status: 'interviewing', at: T + 10 });
  });

  it('never coerces an unknown status to new', () => {
    const future = snap([logged('a://1', [['interviewing', T + 10]])]);
    const stale = snap([logged('a://1', [['new', T]])]);
    expect(statusOf(mergeSnapshots(stale, future), 'a://1')).toBe('interviewing');
  });

  it('preserves a field this build does not know about', () => {
    const future = snap([entry('a://1', 'done', T, { rating: 5 } as Partial<JobUrlEntry>)]);
    const merged = mergeSnapshots(emptySnapshot(), future);
    expect((merged.jobUrls[0] as unknown as Record<string, unknown>).rating).toBe(5);
  });

  it('backfills an entry from an older build that has no history at all', () => {
    const legacy = { id: 'x', url: 'a://1', status: 'applied', addedAt: T } as unknown as JobUrlEntry;
    const merged = mergeSnapshots(emptySnapshot(), snap([legacy]));
    expect(merged.jobUrls[0].history).toEqual([{ status: 'done', at: T }]);
    expect(merged.jobUrls[0].updatedAt).toBe(T);
  });
});

describe('mergeSnapshots — the properties that make two-way sync safe', () => {
  const a = snap(
    [
      logged('a://1', [['new', T], ['done', T + 30]]),
      logged('a://2', [['new', T], ['done', T + 10]]),
      logged('a://4', [['new', T], ['deleted', T + 5]]),
    ],
    {
      'profile.values.email': { at: T + 3, value: 'a@x' },
      'lesson.k': { at: T, value: lesson({ hits: 4 }) },
      'customField.c_x': { at: T + 8, value: null },
    },
  );
  const b = snap(
    [
      logged('a://1', [['new', T], ['skipped', T + 20]]),
      logged('a://3', [['new', T + 1]]),
      logged('a://4', [['new', T]]),
    ],
    {
      'profile.values.email': { at: T + 3, value: 'b@x' },
      'lesson.k': { at: T + 2, value: lesson({ label: 'Mail', hits: 1 }) },
      'customField.c_x': { at: T + 2, value: { id: 'c_x', label: 'X' } },
    },
  );
  const c = snap(
    [logged('a://2', [['new', T], ['done', T + 10], ['new', T + 40]])],
    {
      'profile.values.email': { at: T + 9, value: 'c@x' },
      'lesson.k': { at: T + 2, value: lesson({ label: 'Mail', hits: 9 }) },
      'settings.sessionBatchSize': { at: 0, value: 3 },
    },
  );

  it('is commutative — neither device is the master', () => {
    expect(mergeSnapshots(a, b)).toEqual(mergeSnapshots(b, a));
  });

  it('is idempotent — syncing twice changes nothing', () => {
    const once = mergeSnapshots(a, b);
    expect(mergeSnapshots(once, b)).toEqual(once);
    expect(mergeSnapshots(once, once)).toEqual(once);
  });

  it('is associative — the order devices sync in does not matter', () => {
    expect(mergeSnapshots(mergeSnapshots(a, b), c)).toEqual(mergeSnapshots(a, mergeSnapshots(b, c)));
  });
});

describe('isSupportedSnapshot / upgradeSnapshot', () => {
  it('accepts the current schema', () => {
    expect(isSupportedSnapshot(emptySnapshot())).toBe(true);
  });

  /** A backup file or a remote file written before the whole state travelled. */
  it('reads a schema-1 or schema-2 file as a job list with no other state', () => {
    for (const schema of [1, 2]) {
      const old = { schema, jobUrls: [entry('a://1', 'applied', T)], jobDetails: {}, siteConfigs: [] };
      expect(isSupportedSnapshot(old), String(schema)).toBe(true);
      const up = upgradeSnapshot(old as unknown as Snapshot);
      expect(up.schema).toBe(SYNC_SCHEMA);
      expect(up.state).toEqual({});
      expect(Object.keys(up).sort()).toEqual(['jobUrls', 'schema', 'state']);
    }
  });

  it('refuses a current-schema file without its state', () => {
    expect(isSupportedSnapshot({ schema: SYNC_SCHEMA, jobUrls: [] })).toBe(false);
  });

  it('refuses a newer schema', () => {
    expect(isSupportedSnapshot({ schema: SYNC_SCHEMA + 1, jobUrls: [], state: {} })).toBe(false);
  });
});
