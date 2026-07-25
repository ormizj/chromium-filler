/**
 * The archive file: the applied postings, as JSON you can read later.
 *
 * A deliberately *different* shape from the one the extension stores. Internally a
 * description is a `JobBlock[]` whose `list` groups its items so the modal can
 * render a `<ul>`; a file being read months later — by a person, a spreadsheet or
 * a model asked "which of these was worth it?" — wants one uniform sequence of
 * `{type, text}` it can walk without knowing a second shape. Dates go out as ISO
 * strings for the same reason: `1753...` answers nothing.
 *
 * Fields a posting has nothing for are left out rather than exported as null, so
 * an absent company reads as absent instead of as a value.
 *
 * Pure; the download itself is the options page's job (an MV3 service worker has
 * no `URL.createObjectURL`).
 */

import type { JobUrlEntry, JobUrlStatus } from './types';
import type { JobBlock } from './jobText';
import { resolveDetails, type JobDetailsMap } from './jobDetails';

/** One paragraph, heading or bullet of a posting. */
export interface ExportBlock {
  type: 'heading' | 'para' | 'bullet';
  text: string;
}

export interface ExportedJob {
  url: string;
  title?: string;
  /** The board this was read from (the site config's name). */
  site?: string;
  company?: string;
  location?: string;
  employmentType?: string;
  status: JobUrlStatus;
  addedAt: string;
  appliedAt?: string;
  capturedAt?: string;
  /** The board posting this application was reached from, for a two-step posting. */
  sourceUrl?: string;
  redirectUrl?: string;
  description: ExportBlock[];
  requirements: ExportBlock[];
}

export interface ExportOptions {
  /** Which statuses to include. Applied only, by default. */
  statuses?: JobUrlStatus[];
}

/** Blocks as a flat sequence — a `list` becomes one `bullet` per item. */
export function flattenBlocks(blocks: JobBlock[]): ExportBlock[] {
  const out: ExportBlock[] = [];
  for (const block of blocks) {
    if (block.kind === 'list') {
      for (const item of block.items) out.push({ type: 'bullet', text: item });
    } else {
      out.push({ type: block.kind, text: block.text });
    }
  }
  return out;
}

function iso(at: number | undefined): string | undefined {
  return at == null ? undefined : new Date(at).toISOString();
}

/** Drop the keys with nothing in them, so absent reads as absent. */
function compact(job: ExportedJob): ExportedJob {
  for (const key of Object.keys(job) as Array<keyof ExportedJob>) {
    if (job[key] === undefined) delete job[key];
  }
  return job;
}

/** When this posting was dealt with — what the archive is ordered by. */
function dealtWith(entry: JobUrlEntry): number {
  return entry.appliedAt ?? entry.updatedAt ?? entry.addedAt;
}

/**
 * The archive, newest first. A posting with no captured text is still exported:
 * the URL and the date it was applied on beat no record at all.
 *
 * A two-step posting is one application, not two. `applyStatusChain` marks both
 * the board posting and the employer's ATS applied, so the chain is collapsed to
 * the end it was actually applied on and the board's text is pulled onto it — the
 * alternative is an archive where every handoff appears twice, once with the
 * description and once with the outcome.
 */
export function buildExport(
  list: JobUrlEntry[],
  map: JobDetailsMap,
  opts: ExportOptions = {},
): ExportedJob[] {
  const wanted = new Set<JobUrlStatus>(opts.statuses ?? ['applied']);
  const selected = list.filter((entry) => wanted.has(entry.status));
  const urls = new Set(selected.map((e) => e.url));
  return selected
    .filter((entry) => !(entry.redirectUrl && urls.has(entry.redirectUrl)))
    .sort((a, b) => dealtWith(b) - dealtWith(a))
    .map((entry) => {
      const found = resolveDetails(map, entry, list);
      return compact({
        url: entry.url,
        title: found?.title,
        site: found?.site,
        company: found?.meta.company,
        location: found?.meta.location,
        employmentType: found?.meta.employmentType,
        status: entry.status,
        addedAt: iso(entry.addedAt)!,
        appliedAt: iso(entry.appliedAt),
        capturedAt: iso(found?.capturedAt),
        sourceUrl: entry.sourceUrl,
        redirectUrl: entry.redirectUrl,
        description: flattenBlocks(found?.description ?? []),
        requirements: flattenBlocks(found?.requirements ?? []),
      });
    });
}

/** Dated so successive downloads sort by day instead of colliding as `(1)`. */
export function exportFilename(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `applied-jobs-${day}.json`;
}
