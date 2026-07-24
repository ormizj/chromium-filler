import { describe, it, expect } from 'vitest';
import {
  addUrls, applyStatus, applyStatusChain, jobUrlStats, linkRedirect, normalizeEntry,
  recordStatus, removeUrl,
} from './jobUrls';
import type { JobUrlEntry } from './types';

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
    const list = applyStatus(base, 'https://x.com/1', 'opened', 2000);
    const e = list[0];
    expect(e.status).toBe('opened');
    expect(e.updatedAt).toBe(2000);
    expect(e.openedAt).toBe(2000);
    expect(e.history).toEqual([
      { status: 'new', at: 1000 },
      { status: 'opened', at: 2000 },
    ]);
  });

  it('sets appliedAt on first applied and keeps it stable', () => {
    let list = applyStatus(base, 'https://x.com/1', 'applied', 3000);
    expect(list[0].appliedAt).toBe(3000);
    // A later re-apply must not overwrite the original appliedAt.
    list = applyStatus(list, 'https://x.com/1', 'applied', 5000);
    expect(list[0].appliedAt).toBe(3000);
  });

  it('does not duplicate a no-op status change in history', () => {
    const list = applyStatus(base, 'https://x.com/1', 'new', 2000);
    expect(list[0].history).toHaveLength(1);
    expect(list[0].updatedAt).toBe(1000);
  });

  it('is a no-op for an unknown url', () => {
    const list = applyStatus(base, 'https://nope.com', 'applied', 2000);
    expect(list).toEqual(base);
  });
});

/**
 * Skipping and applying happen on whatever posting is in front of the user, and
 * that is often one they opened by hand rather than imported. `applyStatus`
 * alone silently drops those, so the record the user thinks they just made never
 * existed. `recordStatus` is the pairing that cannot be forgotten at a call site.
 */
describe('recordStatus — records a posting that was never queued', () => {
  const base = addUrls([], ['https://x.com/1'], 1000).list;

  it('adds an unknown url and gives it the status', () => {
    const list = recordStatus([], 'https://x.com/1', 'skipped', 2000);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('skipped');
    expect(list[0].addedAt).toBe(2000);
  });

  it('keeps the full history when the url was already known', () => {
    const list = recordStatus(base, 'https://x.com/1', 'skipped', 2000);
    expect(list).toHaveLength(1);
    expect(list[0].history).toEqual([
      { status: 'new', at: 1000 },
      { status: 'skipped', at: 2000 },
    ]);
  });

  it('stamps appliedAt on a url it had to add itself', () => {
    const list = recordStatus([], 'https://x.com/1', 'applied', 2000);
    expect(list[0].appliedAt).toBe(2000);
  });
});

describe('applyStatusChain — records an unqueued destination too', () => {
  it('adds the url it is given before walking the chain', () => {
    const list = applyStatusChain([], 'https://ats.com/apply', 'applied', 2000);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('applied');
  });

  it('still propagates up an existing sourceUrl', () => {
    const linked = linkRedirect([], 'https://board.com/1', 'https://ats.com/apply', 1000);
    const list = applyStatusChain(linked, 'https://ats.com/apply', 'applied', 2000);
    expect(list.find((e) => e.url === 'https://board.com/1')?.status).toBe('applied');
  });
});

describe('jobUrlStats', () => {
  it('counts by status', () => {
    let { list } = addUrls([], ['a://1', 'a://2', 'a://3', 'a://4', 'a://5'], 0);
    list = applyStatus(list, 'a://2', 'opened', 1);
    list = applyStatus(list, 'a://3', 'applied', 1);
    list = applyStatus(list, 'a://4', 'skipped', 1);
    list = applyStatus(list, 'a://5', 'redirected', 1);
    expect(jobUrlStats(list)).toEqual({
      total: 5, new: 1, opened: 1, redirected: 1, applied: 1, skipped: 1,
    });
  });
});

describe('linkRedirect — two-step postings', () => {
  const BOARD = 'https://board.com/job/1';
  const ATS = 'https://boards.greenhouse.io/acme/jobs/7';

  it('links a known posting to a newly-discovered destination', () => {
    const before = addUrls([], [BOARD], 1000).list;
    const list = linkRedirect(before, BOARD, ATS, 2000);

    const source = list.find((e) => e.url === BOARD)!;
    expect(source.status).toBe('redirected');
    expect(source.redirectUrl).toBe(ATS);
    expect(source.history.map((h) => h.status)).toEqual(['new', 'redirected']);

    const dest = list.find((e) => e.url === ATS)!;
    expect(dest.status).toBe('opened');
    expect(dest.sourceUrl).toBe(BOARD);
    expect(dest.openedAt).toBe(2000);
  });

  it('adds the source too when the posting was browsed, not imported', () => {
    const list = linkRedirect([], BOARD, ATS, 2000);
    expect(list.map((e) => e.url)).toEqual([BOARD, ATS]);
    expect(list[0].status).toBe('redirected');
    expect(list[0].addedAt).toBe(2000);
  });

  it('does not duplicate a destination that is already in the database', () => {
    const before = addUrls([], [BOARD, ATS], 1000).list;
    const list = linkRedirect(before, BOARD, ATS, 2000);
    expect(list).toHaveLength(2);
    expect(list.find((e) => e.url === ATS)!.sourceUrl).toBe(BOARD);
  });

  it('keeps an already-applied destination applied (never demotes it)', () => {
    let list = addUrls([], [BOARD, ATS], 1000).list;
    list = applyStatus(list, ATS, 'applied', 1500);
    list = linkRedirect(list, BOARD, ATS, 2000);
    const dest = list.find((e) => e.url === ATS)!;
    expect(dest.status).toBe('applied');
    expect(dest.sourceUrl).toBe(BOARD);
  });

  it('is a no-op when the destination is the source (no real redirect)', () => {
    const before = addUrls([], [BOARD], 1000).list;
    expect(linkRedirect(before, BOARD, BOARD, 2000)).toEqual(before);
  });
});

describe('applyStatusChain — propagate to the originating posting', () => {
  const BOARD = 'https://board.com/job/1';
  const ATS = 'https://boards.greenhouse.io/acme/jobs/7';

  it('marks the destination and the board posting applied', () => {
    let list = linkRedirect([], BOARD, ATS, 1000);
    list = applyStatusChain(list, ATS, 'applied', 3000);
    expect(list.find((e) => e.url === ATS)!.status).toBe('applied');
    expect(list.find((e) => e.url === BOARD)!.status).toBe('applied');
    expect(list.find((e) => e.url === BOARD)!.appliedAt).toBe(3000);
  });

  it('walks a multi-hop chain without looping forever', () => {
    let list = linkRedirect([], 'a://1', 'a://2', 1000);
    list = linkRedirect(list, 'a://2', 'a://3', 1100);
    list = applyStatusChain(list, 'a://3', 'applied', 2000);
    expect(list.every((e) => e.status === 'applied')).toBe(true);
  });

  it('survives a cyclic sourceUrl chain', () => {
    let list = addUrls([], ['a://1', 'a://2'], 0).list;
    list = list.map((e) => ({ ...e, sourceUrl: e.url === 'a://1' ? 'a://2' : 'a://1' }));
    const out = applyStatusChain(list, 'a://1', 'applied', 5);
    expect(out.every((e) => e.status === 'applied')).toBe(true);
  });

  it('behaves like applyStatus for an entry with no source', () => {
    const base = addUrls([], ['a://1'], 0).list;
    expect(applyStatusChain(base, 'a://1', 'applied', 5)).toEqual(applyStatus(base, 'a://1', 'applied', 5));
  });
});

describe('removeUrl', () => {
  it('removes by url', () => {
    const { list } = addUrls([], ['a://1', 'a://2'], 0);
    expect(removeUrl(list, 'a://1').map((e) => e.url)).toEqual(['a://2']);
  });
});

describe('normalizeEntry — legacy backfill', () => {
  it('fills missing updatedAt/history on old entries', () => {
    const legacy = { id: 'x', url: 'a://1', status: 'new', addedAt: 500 } as unknown as JobUrlEntry;
    const e = normalizeEntry(legacy);
    expect(e.updatedAt).toBe(500);
    expect(e.history).toEqual([{ status: 'new', at: 500 }]);
  });
});
