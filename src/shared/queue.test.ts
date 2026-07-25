import { describe, it, expect } from 'vitest';
import type { JobUrlEntry, JobUrlStatus } from './types';
import { makeEntry } from './jobUrls';
import { nextBatch, queueProgress, progressDots, type QueueProgress } from './queue';

/** Build a list from `[url, status]` pairs, preserving order. */
function list(...pairs: Array<[string, JobUrlStatus]>): JobUrlEntry[] {
  return pairs.map(([url, status]) => ({ ...makeEntry(url, 1000), status }));
}

describe('nextBatch', () => {
  it('returns the "new" URLs in list order, up to the batch size', () => {
    const l = list(['a', 'new'], ['b', 'new'], ['c', 'new'], ['d', 'new']);
    expect(nextBatch(l, [], 2)).toEqual(['a', 'b']);
  });

  it('only counts free slots — in-flight tabs occupy the batch', () => {
    const l = list(['a', 'opened'], ['b', 'new'], ['c', 'new'], ['d', 'new']);
    expect(nextBatch(l, ['a'], 3)).toEqual(['b', 'c']);
  });

  it('returns nothing when the batch is already full', () => {
    const l = list(['a', 'opened'], ['b', 'opened'], ['c', 'new']);
    expect(nextBatch(l, ['a', 'b'], 2)).toEqual([]);
  });

  it('never re-opens a URL that is already in flight', () => {
    // A URL can still read "new" if the status write lost a race with the open.
    const l = list(['a', 'new'], ['b', 'new']);
    expect(nextBatch(l, ['a'], 5)).toEqual(['b']);
  });

  it('skips every status except "new" — opened, applied, skipped and redirected are dealt with', () => {
    const l = list(
      ['a', 'opened'], ['b', 'applied'], ['c', 'skipped'], ['d', 'redirected'], ['e', 'new'],
    );
    expect(nextBatch(l, [], 5)).toEqual(['e']);
  });

  it('returns an empty batch for an empty queue, a zero batch size, or a negative one', () => {
    expect(nextBatch([], [], 5)).toEqual([]);
    expect(nextBatch(list(['a', 'new']), [], 0)).toEqual([]);
    expect(nextBatch(list(['a', 'new']), [], -1)).toEqual([]);
  });

  it('does not go negative when more tabs are open than the batch allows', () => {
    // The user can lower the batch size mid-session, or open tabs by hand.
    const l = list(['a', 'opened'], ['b', 'opened'], ['c', 'opened'], ['d', 'new']);
    expect(nextBatch(l, ['a', 'b', 'c'], 2)).toEqual([]);
  });
});

describe('queueProgress', () => {
  it('summarizes the queue for the session headers', () => {
    const l = list(
      ['a', 'new'], ['b', 'new'], ['c', 'opened'], ['d', 'applied'], ['e', 'skipped'],
    );
    expect(queueProgress(l, ['c'])).toEqual({
      total: 5,
      queued: 2,
      inFlight: 1,
      applied: 1,
      skipped: 1,
      done: 2,
      ratio: 0.4,
    });
  });

  it('counts a redirected posting as done — the application moved on to the ATS', () => {
    const l = list(['a', 'redirected'], ['b', 'new']);
    const p = queueProgress(l, []);
    expect(p.done).toBe(1);
    expect(p.queued).toBe(1);
  });

  it('ignores in-flight URLs that are no longer in the database', () => {
    const l = list(['a', 'new']);
    expect(queueProgress(l, ['gone']).inFlight).toBe(0);
  });

  it('reports a zero ratio for an empty database rather than dividing by zero', () => {
    expect(queueProgress([], [])).toEqual({
      total: 0, queued: 0, inFlight: 0, applied: 0, skipped: 0, done: 0, ratio: 0,
    });
  });
});

describe('progressDots', () => {
  const progress = (over: Partial<QueueProgress> = {}): QueueProgress => ({
    total: 0, queued: 0, inFlight: 0, applied: 0, skipped: 0, done: 0, ratio: 0,
    ...over,
  });

  it('gives a small queue one dot per posting', () => {
    expect(progressDots(progress({ total: 5, done: 2, inFlight: 1, queued: 2 })))
      .toEqual(['done', 'done', 'now', 'waiting', 'waiting']);
  });

  it('has no "now" dot when no tab is open', () => {
    expect(progressDots(progress({ total: 3, done: 1, queued: 2 })))
      .toEqual(['done', 'waiting', 'waiting']);
  });

  it('scales a long queue down to the cap instead of drawing sixty dots', () => {
    // The strip is one line inside a 380px card; the dots are a glance at "how far
    // through am I", so past the cap they become proportional rather than literal.
    const dots = progressDots(progress({ total: 60, done: 9, inFlight: 1, queued: 50 }), 7);
    expect(dots).toHaveLength(7);
    expect(dots.filter((d) => d === 'done')).toHaveLength(1);
    expect(dots.filter((d) => d === 'now')).toHaveLength(1);
  });

  it('keeps room for the "now" dot when progress would round up to the whole row', () => {
    const dots = progressDots(progress({ total: 60, done: 59, inFlight: 1, queued: 0 }), 7);
    expect(dots).toEqual(['done', 'done', 'done', 'done', 'done', 'done', 'now']);
  });

  it('fills the row when everything is done', () => {
    expect(progressDots(progress({ total: 4, done: 4, applied: 4, ratio: 1 })))
      .toEqual(['done', 'done', 'done', 'done']);
  });

  it('draws nothing for an empty queue — an empty row of dots is not progress', () => {
    expect(progressDots(progress())).toEqual([]);
  });
});
