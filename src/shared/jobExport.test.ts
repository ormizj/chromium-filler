import { describe, it, expect } from 'vitest';
import type { JobUrlEntry, JobUrlStatus } from './types';
import type { JobBlock } from './jobText';
import { makeEntry } from './jobUrls';
import type { JobDetails, JobDetailsMap } from './jobDetails';
import {
  EXPORT_FIELD_ORDER, buildExport, exportFilename, flattenBlocks, resolveExport, toCsv,
  type ExportField,
} from './jobExport';

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

describe('resolveExport', () => {
  it('exports every column, applied only, as JSON when nothing has been chosen', () => {
    expect(resolveExport()).toEqual({
      fields: EXPORT_FIELD_ORDER,
      statuses: ['applied'],
      format: 'json',
    });
  });

  it('drops only the columns turned off, and keeps the canonical order', () => {
    const { fields } = resolveExport({ fields: { description: false, requirements: false } });
    expect(fields).toEqual(EXPORT_FIELD_ORDER.filter((f) => f !== 'description' && f !== 'requirements'));
  });

  /**
   * The forward-compatibility rule, and the reason the selection is stored as a
   * sparse map of *decisions* rather than a list of included keys. A list saved
   * by today's build would silently omit a column added tomorrow, for everyone
   * who had ever opened the panel.
   */
  it('gives a key the stored selection never mentions its built-in default', () => {
    const stored = { fields: { title: false }, statuses: { skipped: true } };
    const { fields, statuses } = resolveExport(stored);
    // Unmentioned column: on. Unmentioned status: off — except `applied`.
    expect(fields).toContain('company');
    expect(fields).not.toContain('title');
    expect(statuses).toEqual(['skipped', 'applied']);
  });

  it('ignores a key it has never heard of, rather than failing on it', () => {
    const stored = JSON.parse('{"fields":{"salary":true},"statuses":{"archived":true}}');
    expect(resolveExport(stored)).toEqual(resolveExport());
  });

  it('orders the statuses by how far through the flow they are', () => {
    const all = resolveExport({ statuses: { new: true, opened: true, redirected: true, skipped: true } });
    expect(all.statuses).toEqual(['new', 'opened', 'redirected', 'skipped', 'applied']);
  });

  it('takes the format it is given and falls back to JSON for anything else', () => {
    expect(resolveExport({ format: 'csv' }).format).toBe('csv');
    expect(resolveExport(JSON.parse('{"format":"xlsx"}')).format).toBe('json');
  });
});

describe('buildExport — chosen columns', () => {
  it('exports only the columns asked for', () => {
    const e = entry('https://jobs.example.com/1');
    const fields: ExportField[] = ['url', 'title', 'requirements'];
    const [job] = buildExport([e], map(details(e.url, {
      requirements: [{ kind: 'list', items: ['5+ years React'] }],
    })), { fields });
    expect(job).toEqual({
      url: 'https://jobs.example.com/1',
      title: 'Senior Frontend Engineer',
      requirements: [{ type: 'bullet', text: '5+ years React' }],
    });
  });

  it('still leaves out a chosen column the posting has nothing for', () => {
    // Chosen means "include it when there is one", not "write null".
    const [job] = buildExport([entry('a')], map(details('a', { meta: {} })),
      { fields: ['url', 'company'] });
    expect(job).toEqual({ url: 'a' });
  });

  it('collapses a two-step chain the same way whatever the columns are', () => {
    const board = entry('board', { redirectUrl: 'ats' });
    const ats = entry('ats', { sourceUrl: 'board' });
    const jobs = buildExport([board, ats], map(details('board', { title: 'Board copy' })),
      { fields: ['url', 'title'] });
    expect(jobs).toEqual([{ url: 'ats', title: 'Board copy' }]);
  });
});

describe('toCsv', () => {
  const job = (over: Record<string, unknown> = {}) => ({
    url: 'https://jobs.example.com/1',
    title: 'Senior Frontend Engineer',
    status: 'applied' as JobUrlStatus,
    addedAt: '2026-07-20T09:00:00.000Z',
    description: [
      { type: 'heading' as const, text: 'About the role' },
      { type: 'bullet' as const, text: 'Ship things' },
    ],
    requirements: [],
    ...over,
  });

  it('heads the file with the chosen columns, in the chosen order', () => {
    const [head] = toCsv([job()], ['title', 'url']).split('\r\n');
    expect(head).toBe('title,url');
  });

  it('flattens a description into one cell, a block per line', () => {
    const [, row] = toCsv([job()], ['description']).split('\r\n');
    expect(row).toBe('"About the role\n- Ship things"');
  });

  it('quotes a cell holding a comma, a quote or a newline', () => {
    const [, row] = toCsv([job({ title: 'Engineer, "Senior"' })], ['title']).split('\r\n');
    expect(row).toBe('"Engineer, ""Senior"""');
  });

  it('leaves a cell empty for a column this posting has nothing for', () => {
    expect(toCsv([job()], ['url', 'company']).split('\r\n')[1])
      .toBe('https://jobs.example.com/1,');
  });

  it('writes the header even when there is nothing to export', () => {
    expect(toCsv([], ['url'])).toBe('url');
  });
});

describe('exportFilename', () => {
  it('names the file for the day it was written, so downloads sort and do not collide', () => {
    expect(exportFilename(new Date(T0))).toBe('applied-jobs-2026-07-20.json');
  });

  it('takes its extension from the format', () => {
    expect(exportFilename(new Date(T0), { format: 'csv', statuses: ['applied'] }))
      .toBe('applied-jobs-2026-07-20.csv');
  });

  it('stops claiming “applied” once the file holds anything else', () => {
    expect(exportFilename(new Date(T0), { format: 'json', statuses: ['applied', 'skipped'] }))
      .toBe('jobs-2026-07-20.json');
  });
});
