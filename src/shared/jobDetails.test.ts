import { describe, it, expect } from 'vitest';
import type { JobUrlEntry } from './types';
import type { JobBlock } from './jobText';
import { makeEntry } from './jobUrls';
import {
  captureDetails,
  isEmptyDetails,
  pruneDetails,
  resolveDetails,
  type JobDetails,
  type JobDetailsMap,
} from './jobDetails';

const PARA: JobBlock[] = [{ kind: 'para', text: 'Build things.' }];

function details(url: string, over: Partial<JobDetails> = {}): JobDetails {
  return {
    url,
    title: `Role at ${url}`,
    description: PARA,
    requirements: [],
    meta: {},
    capturedAt: 1000,
    ...over,
  };
}

/** A job-URL list from `[url, sourceUrl?]` pairs. */
function list(...pairs: Array<[string, string?]>): JobUrlEntry[] {
  return pairs.map(([url, sourceUrl]) => ({ ...makeEntry(url, 1000), sourceUrl }));
}

function map(...entries: JobDetails[]): JobDetailsMap {
  return Object.fromEntries(entries.map((d) => [d.url, d]));
}

describe('isEmptyDetails', () => {
  it('is empty only when there is no title, no prose and no chip', () => {
    expect(isEmptyDetails(details('a', { title: undefined, description: [], requirements: [] })))
      .toBe(true);
    expect(isEmptyDetails(details('a', { title: '  ' , description: [], requirements: [] })))
      .toBe(true);
    expect(isEmptyDetails(details('a', { title: 'Engineer', description: [] }))).toBe(false);
    expect(isEmptyDetails(details('a', { title: undefined }))).toBe(false);
    expect(isEmptyDetails(
      details('a', { title: undefined, description: [], meta: { company: 'Acme' } }),
    )).toBe(false);
  });
});

describe('captureDetails', () => {
  it('stores a posting under its URL, and leaves the other entries alone', () => {
    const before = map(details('a'));
    const after = captureDetails(before, details('b'));
    expect(Object.keys(after)).toEqual(['a', 'b']);
    expect(after.b).toEqual(details('b'));
    // Pure: the caller's map is not mutated.
    expect(Object.keys(before)).toEqual(['a']);
  });

  it('replaces an earlier capture of the same posting', () => {
    const after = captureDetails(map(details('a')), details('a', { title: 'Renamed', capturedAt: 2000 }));
    expect(after.a.title).toBe('Renamed');
    expect(after.a.capturedAt).toBe(2000);
  });

  it('never lets an empty capture erase text already stored', () => {
    // `showModal` re-extracts on every re-render — after a re-run, a redirect
    // follow, or a Reset — and a page whose container has been replaced by then
    // extracts to nothing. Writing that blindly would trade good text for none.
    const before = map(details('a'));
    const after = captureDetails(before, details('a', {
      title: undefined, description: [], requirements: [], capturedAt: 2000,
    }));
    expect(after.a).toEqual(details('a'));
  });

  it('stores an empty capture when nothing is known about the posting yet', () => {
    // Better a row saying the page had no readable posting than no row at all.
    const empty = details('a', { title: undefined, description: [], requirements: [] });
    expect(captureDetails({}, empty)).toEqual({ a: empty });
  });
});

describe('resolveDetails', () => {
  it('returns the posting\'s own text when it has some', () => {
    const [entry] = list(['a']);
    expect(resolveDetails(map(details('a')), entry, [entry])).toEqual(details('a'));
  });

  it('walks up sourceUrl when the posting itself has no text', () => {
    // The two-step case, and the common one: the description lives on the board
    // posting, the application happens on the employer's ATS, and applyStatusChain
    // marks both applied. Without the walk every handoff exports an empty body.
    const entries = list(['board'], ['ats', 'board']);
    const resolved = resolveDetails(map(details('board')), entries[1], entries);
    expect(resolved).toEqual(details('board'));
  });

  it('walks more than one hop, through a tracker in the middle', () => {
    const entries = list(['board'], ['hop', 'board'], ['ats', 'hop']);
    expect(resolveDetails(map(details('board')), entries[2], entries)).toEqual(details('board'));
  });

  it('prefers the destination\'s own text over the board\'s', () => {
    const entries = list(['board'], ['ats', 'board']);
    const resolved = resolveDetails(map(details('board'), details('ats')), entries[1], entries);
    expect(resolved?.url).toBe('ats');
  });

  it('takes each field from the nearest page that has one', () => {
    // The split is rarely clean. An employer's ATS always has *a* title —
    // extractJob falls back to document.title — and routinely no description at
    // all, so preferring the nearest non-empty *record* would return that title
    // with an empty body and leave the board's description one hop away unread.
    const entries = list(['board'], ['ats', 'board']);
    const ats = details('ats', {
      title: 'Senior Widget Engineer — Acme',
      description: [],
      meta: { company: 'Acme' },
    });
    const board = details('board', {
      title: 'Senior Widget Engineer',
      description: PARA,
      meta: { company: 'Widgets Inc', location: 'Berlin' },
    });
    expect(resolveDetails(map(board, ats), entries[1], entries)).toEqual({
      url: 'ats',
      capturedAt: 1000,
      title: 'Senior Widget Engineer — Acme',
      site: undefined,
      description: PARA,
      requirements: [],
      meta: { company: 'Acme', location: 'Berlin', employmentType: undefined },
    });
  });

  it('skips a link whose stored text is empty and keeps climbing', () => {
    const entries = list(['board'], ['ats', 'board']);
    const empty = details('ats', { title: undefined, description: [], requirements: [] });
    expect(resolveDetails(map(details('board'), empty), entries[1], entries)).toEqual(details('board'));
  });

  it('returns undefined when nothing in the chain was captured', () => {
    const entries = list(['board'], ['ats', 'board']);
    expect(resolveDetails({}, entries[1], entries)).toBeUndefined();
  });

  it('terminates on a cycle rather than looping forever', () => {
    // linkRedirect writes both ends, so a posting that redirects to itself — or a
    // pair that redirect to each other — is reachable from real data.
    const entries = list(['a', 'b'], ['b', 'a']);
    expect(resolveDetails({}, entries[0], entries)).toBeUndefined();
  });
});

describe('pruneDetails', () => {
  it('drops captures whose posting is no longer in the database', () => {
    const after = pruneDetails(map(details('a'), details('b')), ['a']);
    expect(Object.keys(after)).toEqual(['a']);
  });

  it('returns the same object when there is nothing to drop, so callers can skip the write', () => {
    const before = map(details('a'));
    expect(pruneDetails(before, ['a', 'b'])).toBe(before);
  });
});
