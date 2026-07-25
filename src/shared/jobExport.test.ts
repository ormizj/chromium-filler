import { describe, it, expect } from 'vitest';
import type { JobUrlEntry, JobUrlStatus } from './types';
import type { JobBlock } from './jobText';
import { makeEntry } from './jobUrls';
import type { JobDetails, JobDetailsMap } from './jobDetails';
import { buildExport, exportFilename, flattenBlocks } from './jobExport';

const T0 = Date.UTC(2026, 6, 20, 9, 0, 0); // 2026-07-20T09:00:00.000Z

function entry(url: string, over: Partial<JobUrlEntry> = {}): JobUrlEntry {
  return { ...makeEntry(url, T0), status: 'applied', appliedAt: T0, ...over };
}

function details(url: string, over: Partial<JobDetails> = {}): JobDetails {
  return {
    url,
    title: 'Senior Frontend Engineer',
    site: 'Example board',
    description: [{ kind: 'para', text: 'We are looking for…' }],
    requirements: [],
    meta: { company: 'Acme', location: 'Tel Aviv', employmentType: 'Full-time' },
    capturedAt: T0,
    ...over,
  };
}

function map(...list: JobDetails[]): JobDetailsMap {
  return Object.fromEntries(list.map((d) => [d.url, d]));
}

describe('flattenBlocks', () => {
  it('turns each kind of block into one flat {type, text} record', () => {
    const blocks: JobBlock[] = [
      { kind: 'heading', text: 'Requirements' },
      { kind: 'para', text: 'You will need:' },
      { kind: 'list', items: ['5+ years React', 'TypeScript'] },
    ];
    expect(flattenBlocks(blocks)).toEqual([
      { type: 'heading', text: 'Requirements' },
      { type: 'para', text: 'You will need:' },
      { type: 'bullet', text: '5+ years React' },
      { type: 'bullet', text: 'TypeScript' },
    ]);
  });

  it('flattens a list into one bullet per item, not one block per list', () => {
    // The internal shape groups items so the modal can render a <ul>; a file read
    // later wants a uniform sequence it can filter without a second shape to know.
    expect(flattenBlocks([{ kind: 'list', items: ['a', 'b', 'c'] }])).toHaveLength(3);
  });

  it('returns nothing for no blocks', () => {
    expect(flattenBlocks([])).toEqual([]);
  });
});

describe('buildExport', () => {
  it('exports an applied posting with its text, chips and readable dates', () => {
    const e = entry('https://jobs.example.com/1');
    expect(buildExport([e], map(details(e.url)))).toEqual([
      {
        url: 'https://jobs.example.com/1',
        title: 'Senior Frontend Engineer',
        site: 'Example board',
        company: 'Acme',
        location: 'Tel Aviv',
        employmentType: 'Full-time',
        status: 'applied',
        addedAt: '2026-07-20T09:00:00.000Z',
        appliedAt: '2026-07-20T09:00:00.000Z',
        capturedAt: '2026-07-20T09:00:00.000Z',
        description: [{ type: 'para', text: 'We are looking for…' }],
        requirements: [],
      },
    ]);
  });

  it('omits the fields a posting has nothing for, rather than exporting nulls', () => {
    const e = entry('a', { appliedAt: undefined });
    const [job] = buildExport([e], map(details('a', {
      title: undefined, site: undefined, meta: {}, requirements: [],
    })));
    expect(Object.keys(job).sort()).toEqual(
      ['addedAt', 'capturedAt', 'description', 'requirements', 'status', 'url'],
    );
  });

  it('exports only applied postings by default', () => {
    const list: JobUrlEntry[] = (['new', 'opened', 'redirected', 'skipped', 'applied'] as JobUrlStatus[])
      .map((status) => entry(status, { status }));
    expect(buildExport(list, {}).map((j) => j.url)).toEqual(['applied']);
  });

  it('exports the statuses it is asked for when given some', () => {
    // The text of a skipped posting is captured too, so widening the archive is
    // an argument rather than a migration.
    const list = [entry('a', { status: 'applied' }), entry('b', { status: 'skipped' })];
    expect(buildExport(list, {}, { statuses: ['applied', 'skipped'] }).map((j) => j.url))
      .toEqual(['a', 'b']);
  });

  it('exports a two-step posting once, as the page it was applied on', () => {
    // applyStatusChain marks *both* ends applied, so without collapsing the chain
    // one application would arrive in the archive as two rows: a board posting
    // holding the text and an ATS page holding the outcome.
    const board = entry('board', { redirectUrl: 'ats' });
    const ats = entry('ats', { sourceUrl: 'board' });
    const jobs = buildExport([board, ats], map(details('board', { title: 'Board copy' })));
    expect(jobs).toHaveLength(1);
    expect(jobs[0].url).toBe('ats');
    expect(jobs[0].sourceUrl).toBe('board');
    // …and the text still comes along, from the end that had it.
    expect(jobs[0].title).toBe('Board copy');
  });

  it('collapses a longer chain through a tracker to its final destination', () => {
    const list = [
      entry('board', { redirectUrl: 'hop' }),
      entry('hop', { sourceUrl: 'board', redirectUrl: 'ats' }),
      entry('ats', { sourceUrl: 'hop' }),
    ];
    expect(buildExport(list, map(details('board'))).map((j) => j.url)).toEqual(['ats']);
  });

  it('keeps a board posting whose destination was never applied to', () => {
    // Applied on the board itself, with a handoff link that went nowhere: the
    // only row there is is the board's, and dropping it would lose the record.
    const list = [
      entry('board', { redirectUrl: 'ats' }),
      entry('ats', { status: 'opened', sourceUrl: 'board' }),
    ];
    expect(buildExport(list, {}).map((j) => j.url)).toEqual(['board']);
  });

  it('still exports a posting whose text was never captured', () => {
    // A record with the URL and the date beats no record: the user knows they
    // applied, and can go and look.
    const [job] = buildExport([entry('a')], {});
    expect(job).toMatchObject({ url: 'a', status: 'applied', description: [], requirements: [] });
    expect(job.title).toBeUndefined();
  });

  it('orders the most recently applied first', () => {
    const list = [
      entry('old', { appliedAt: T0 }),
      entry('newest', { appliedAt: T0 + 2000 }),
      entry('mid', { appliedAt: T0 + 1000 }),
    ];
    expect(buildExport(list, {}).map((j) => j.url)).toEqual(['newest', 'mid', 'old']);
  });

  it('falls back to updatedAt for ordering a posting with no applied stamp', () => {
    const list = [
      entry('stamped', { appliedAt: T0 }),
      entry('unstamped', { appliedAt: undefined, updatedAt: T0 + 5000 }),
    ];
    expect(buildExport(list, {}).map((j) => j.url)).toEqual(['unstamped', 'stamped']);
  });

  it('returns an empty array for an empty database', () => {
    expect(buildExport([], {})).toEqual([]);
  });
});

describe('exportFilename', () => {
  it('names the file for the day it was written, so downloads sort and do not collide', () => {
    expect(exportFilename(new Date(T0))).toBe('applied-jobs-2026-07-20.json');
  });
});
