import { describe, it, expect } from 'vitest';
import { addUrls, applyStatus, jobUrlStats, normalizeEntry, removeUrl } from './jobUrls';
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

describe('jobUrlStats', () => {
  it('counts by status', () => {
    let { list } = addUrls([], ['a://1', 'a://2', 'a://3', 'a://4'], 0);
    list = applyStatus(list, 'a://2', 'opened', 1);
    list = applyStatus(list, 'a://3', 'applied', 1);
    list = applyStatus(list, 'a://4', 'skipped', 1);
    expect(jobUrlStats(list)).toEqual({ total: 4, new: 1, opened: 1, applied: 1, skipped: 1 });
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
