import { describe, it, expect } from 'vitest';
import {
  ALL_JOB_STATUSES, addUrls, applyStatus, deleteUrl, finishOnClose, jobUrlStats, makeEntry,
  normalizeEntry, pruneTombstones, recordStatus, removeUrl, statusForUrl, TOMBSTONE_TTL_MS,
  visibleUrls,
} from './jobUrls';
import type { JobUrlEntry } from './types';

describe('statusForUrl — what the database says about the page in front of you', () => {
  const list = applyStatus(addUrls([], ['a://1', 'a://2'], 1000).list, 'a://1', 'done', 2000);

  it('reports a recorded status', () => {
    expect(statusForUrl(list, 'a://1')).toBe('done');
    expect(statusForUrl(list, 'a://2')).toBe('new');
  });

  /**
   * The commonest answer by far: most pages the extension runs on were browsed
   * rather than imported, and have never been near the database.
   */
  it('is undefined for a url it has never seen', () => {
    expect(statusForUrl(list, 'a://nope')).toBeUndefined();
  });

  /**
   * A tombstone answers `'deleted'`, not `undefined`. Callers compare against the
   * one status they care about, so a deleted posting falls out of every such test
   * without this needing to know about tombstones at all.
   */
  it('reports a tombstone as deleted rather than hiding it', () => {
    expect(statusForUrl(deleteUrl(list, 'a://1', 3000), 'a://1')).toBe('deleted');
  });
});

describe('ALL_JOB_STATUSES', () => {
  /**
   * Derived from STATUS_RANK rather than typed out again, so a new status cannot
   * be added to the model without appearing everywhere it is offered as a choice.
   */
  it('is every status a posting can be in, in flow order', () => {
    expect(ALL_JOB_STATUSES).toEqual(['new', 'done']);
  });

  it('leaves out the tombstone, which is not a state a posting is shown in', () => {
    expect(ALL_JOB_STATUSES).not.toContain('deleted');
  });
});

describe('addUrls — unique by URL', () => {
  it('adds new urls with new status and history', () => {
    const { list, added } = addUrls([], ['https://x.com/1', 'https://x.com/2'], 1000);
    expect(added).toBe(2);
    expect(list.map((e) => e.url)).toEqual(['https://x.com/1', 'https://x.com/2']);
    expect(list[0].status).toBe('new');
    expect(list[0].addedAt).toBe(1000);
    expect(list[0].history).toEqual([{ status: 'new', at: 1000 }]);
  });

  it('does not add a url that already exists (URL is the unique key)', () => {
    const first = addUrls([], ['https://x.com/1'], 1000).list;
    const { list, added } = addUrls(first, ['https://x.com/1', 'https://x.com/3'], 2000);
    expect(added).toBe(1);
    expect(list.map((e) => e.url)).toEqual(['https://x.com/1', 'https://x.com/3']);
  });

  it('dedupes within the same batch', () => {
    const { list, added } = addUrls([], ['https://x.com/1', 'https://x.com/1'], 1000);
    expect(added).toBe(1);
    expect(list).toHaveLength(1);
  });
});

describe('applyStatus — history + timestamps', () => {
  const base = addUrls([], ['https://x.com/1'], 1000).list;

  it('records a status change with timestamp and history', () => {
    const list = applyStatus(base, 'https://x.com/1', 'done', 2000);
    const e = list[0];
    expect(e.status).toBe('done');
    expect(e.updatedAt).toBe(2000);
    expect(e.history).toEqual([
      { status: 'new', at: 1000 },
      { status: 'done', at: 2000 },
    ]);
  });

  it('does not duplicate a no-op status change in history', () => {
    const list = applyStatus(base, 'https://x.com/1', 'new', 2000);
    expect(list[0].history).toHaveLength(1);
    expect(list[0].updatedAt).toBe(1000);
  });

  it('is a no-op for an unknown url', () => {
    const list = applyStatus(base, 'https://nope.com', 'done', 2000);
    expect(list).toEqual(base);
  });
});

/**
 * Skipping happens on whatever posting is in front of the user, and that is often
 * one they opened by hand rather than imported. `applyStatus` alone silently
 * drops those, so the record the user thinks they just made never existed.
 * `recordStatus` is the pairing that cannot be forgotten at a call site.
 */
describe('recordStatus — records a posting that was never queued', () => {
  const base = addUrls([], ['https://x.com/1'], 1000).list;

  it('adds an unknown url and gives it the status', () => {
    const list = recordStatus([], 'https://x.com/1', 'done', 2000);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('done');
    expect(list[0].addedAt).toBe(2000);
  });

  it('keeps the full history when the url was already known', () => {
    const list = recordStatus(base, 'https://x.com/1', 'done', 2000);
    expect(list).toHaveLength(1);
    expect(list[0].history).toEqual([
      { status: 'new', at: 1000 },
      { status: 'done', at: 2000 },
    ]);
  });
});

describe('jobUrlStats', () => {
  it('counts by status', () => {
    let { list } = addUrls([], ['a://1', 'a://2', 'a://3'], 0);
    list = applyStatus(list, 'a://2', 'done', 1);
    list = applyStatus(list, 'a://3', 'done', 1);
    expect(jobUrlStats(list)).toEqual({ total: 3, new: 1, done: 2 });
  });

  it('counts a status from a newer peer toward the total only', () => {
    let { list } = addUrls([], ['a://1'], 0);
    list = applyStatus(list, 'a://1', 'interviewing', 1);
    expect(jobUrlStats(list)).toEqual({ total: 1, new: 0, done: 0 });
  });
});

describe('removeUrl', () => {
  it('removes by url', () => {
    const { list } = addUrls([], ['a://1', 'a://2'], 0);
    expect(removeUrl(list, 'a://1').map((e) => e.url)).toEqual(['a://2']);
  });
});

describe('deleteUrl — tombstones', () => {
  it('keeps the entry and logs the removal, so a sync cannot resurrect it', () => {
    const { list } = addUrls([], ['a://1'], 0);
    const out = deleteUrl(list, 'a://1', 10);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('deleted');
    expect(out[0].history).toEqual([{ status: 'new', at: 0 }, { status: 'deleted', at: 10 }]);
  });

  it('is hidden from every surface by visibleUrls', () => {
    const { list } = addUrls([], ['a://1', 'a://2'], 0);
    expect(visibleUrls(deleteUrl(list, 'a://1', 10)).map((e) => e.url)).toEqual(['a://2']);
  });

  it('un-deletes by logging the old status again, as a later event', () => {
    const { list } = addUrls([], ['a://1'], 0);
    const back = applyStatus(deleteUrl(list, 'a://1', 10), 'a://1', 'done', 20);
    expect(back[0].status).toBe('done');
    expect(visibleUrls(back)).toHaveLength(1);
  });

  it('drops out of the stats it can never contribute to', () => {
    const { list } = addUrls([], ['a://1', 'a://2'], 0);
    const stats = jobUrlStats(deleteUrl(list, 'a://1', 10));
    expect(stats.total).toBe(1);
    expect(stats.new).toBe(1);
  });
});

describe('pruneTombstones', () => {
  it('keeps a fresh tombstone and forgets an expired one', () => {
    const { list } = addUrls([], ['a://1'], 0);
    const dead = deleteUrl(list, 'a://1', 1_000);
    expect(pruneTombstones(dead, 1_000 + TOMBSTONE_TTL_MS - 1)).toHaveLength(1);
    expect(pruneTombstones(dead, 1_000 + TOMBSTONE_TTL_MS)).toHaveLength(0);
  });

  it('never touches a live entry, however old', () => {
    const { list } = addUrls([], ['a://1'], 0);
    expect(pruneTombstones(list, TOMBSTONE_TTL_MS * 10)).toHaveLength(1);
  });
});

describe('normalizeEntry — legacy backfill', () => {
  it('fills missing updatedAt/history on old entries', () => {
    const legacy = { id: 'x', url: 'a://1', status: 'new', addedAt: 500 } as unknown as JobUrlEntry;
    const e = normalizeEntry(legacy);
    expect(e.updatedAt).toBe(500);
    expect(e.history).toEqual([{ status: 'new', at: 500 }]);
  });

  /**
   * Six statuses became two. Everything that meant "dealt with" is done; `opened`
   * meant "a tab is on it", which the queue's tab map now says on its own, so the
   * posting is still waiting. Mapped on every read — stored lists, imported
   * backups and an old remote file all pass through here.
   */
  it('maps every old status, in the status and in the log', () => {
    const old = {
      id: 'x', url: 'a://1', status: 'applied', addedAt: 1, updatedAt: 4,
      history: [
        { status: 'new', at: 1 }, { status: 'opened', at: 2 },
        { status: 'skipped', at: 3 }, { status: 'applied', at: 4 },
      ],
    } as JobUrlEntry;
    const e = normalizeEntry(old);
    expect(e.status).toBe('done');
    expect(e.history).toEqual([
      { status: 'new', at: 1 }, { status: 'new', at: 2 },
      { status: 'done', at: 3 }, { status: 'done', at: 4 },
    ]);
    for (const s of ['redirected', 'markedDone', 'skipped', 'applied']) {
      expect(normalizeEntry({ ...old, status: s, history: [] }).status, s).toBe('done');
    }
    expect(normalizeEntry({ ...old, status: 'opened', history: [] }).status).toBe('new');
  });

  it('drops two events the mapping made identical, and is idempotent', () => {
    const old = {
      id: 'x', url: 'a://1', status: 'applied', addedAt: 1, updatedAt: 2,
      history: [{ status: 'skipped', at: 2 }, { status: 'applied', at: 2 }],
    } as JobUrlEntry;
    const once = normalizeEntry(old);
    expect(once.history).toEqual([{ status: 'done', at: 2 }]);
    expect(normalizeEntry(once)).toEqual(once);
  });

  it('strips the fields the two-step flow used to write', () => {
    const old = {
      ...makeEntry('a://1', 1), openedAt: 2, appliedAt: 3, sourceUrl: 'a://0', redirectUrl: 'a://2',
    } as JobUrlEntry;
    const e = normalizeEntry(old) as unknown as Record<string, unknown>;
    for (const k of ['openedAt', 'appliedAt', 'sourceUrl', 'redirectUrl']) expect(e[k], k).toBeUndefined();
  });

  it('carries a status it has never heard of untouched', () => {
    const e = normalizeEntry({ ...makeEntry('a://1', 1), status: 'interviewing' });
    expect(e.status).toBe('interviewing');
  });
});

describe('finishOnClose', () => {
  const at = (status: JobUrlEntry['status']) => applyStatus([makeEntry('u', 1)], 'u', status, 2);

  it('moves a waiting posting to done', () => {
    const out = finishOnClose(at('new'), 'u', 3);
    expect(out[0].status).toBe('done');
    expect(out[0].history.at(-1)).toEqual({ status: 'done', at: 3 });
  });

  it('never rewrites a posting that already has an answer', () => {
    for (const status of ['done', 'deleted', 'interviewing']) {
      const list = at(status);
      expect(finishOnClose(list, 'u', 3), status).toBe(list);
    }
  });

  it('leaves a URL the database does not know alone', () => {
    const list = at('new');
    expect(finishOnClose(list, 'other', 3)).toBe(list);
  });
});
