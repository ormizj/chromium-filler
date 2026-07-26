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
import { ALL_JOB_STATUSES } from './jobUrls';
import { EXPORT_FIELD_LABELS } from './labels';

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

/** One column of the archive. */
export type ExportField = keyof ExportedJob;

/**
 * The columns in the order they are written and offered, taken from the labels
 * catalog so there is one list rather than two. `EXPORT_FIELD_LABELS` is a
 * `Record<ExportField, string>`, so a field added to `ExportedJob` fails
 * `npm run typecheck` until it has been named — and once named it is a column
 * here and a checkbox in Options with nothing else to remember.
 */
export const EXPORT_FIELD_ORDER = Object.keys(EXPORT_FIELD_LABELS) as ExportField[];

export type ExportFormat = 'json' | 'csv';

/**
 * What the user chose to export, as *sparse overrides* rather than a list of
 * what to include — and that is the whole design.
 *
 * A stored list of included columns would silently omit any column a later build
 * adds, for everyone who had ever opened the panel: the new field is not in the
 * list, so it never appears, and nothing says why. A map of decisions instead
 * lets an unmentioned key take its built-in default (a column is on; a status is
 * off unless it is `applied`), so the schema can grow underneath a selection
 * saved months ago. Same reasoning as `normalizeEntry` in syncJobs.ts: the build
 * that has to cope is the older one, and it copes by not assuming the set is
 * closed. A key this build has never heard of is simply never consulted.
 */
export interface ExportSelection {
  fields?: Partial<Record<ExportField, boolean>>;
  statuses?: Partial<Record<JobUrlStatus, boolean>>;
  format?: ExportFormat;
}

export interface ResolvedExport {
  fields: ExportField[];
  statuses: JobUrlStatus[];
  format: ExportFormat;
}

/** The stored selection as concrete lists, in canonical order. Pure. */
export function resolveExport(sel: ExportSelection = {}): ResolvedExport {
  return {
    fields: EXPORT_FIELD_ORDER.filter((f) => sel.fields?.[f] ?? true),
    statuses: ALL_JOB_STATUSES.filter((s) => sel.statuses?.[s] ?? s === 'applied'),
    format: sel.format === 'csv' ? 'csv' : 'json',
  };
}

export interface ExportOptions {
  /** Which statuses to include. Applied only, by default. */
  statuses?: JobUrlStatus[];
  /**
   * Which columns to include. Every one, by default — a caller that has not been
   * asked to narrow the file should not have to name fourteen fields to get it.
   */
  fields?: ExportField[];
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

/**
 * Drop the keys with nothing in them, so absent reads as absent — and the keys
 * the user did not ask for. Choosing a column means "include it when there is
 * one", so a chosen-but-empty field still goes, rather than arriving as a null.
 */
function compact(job: ExportedJob, keep?: Set<ExportField>): ExportedJob {
  for (const key of Object.keys(job) as ExportField[]) {
    if (job[key] === undefined || (keep && !keep.has(key))) delete job[key];
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
  const wanted = new Set<string>(opts.statuses ?? ['applied']);
  const keep = opts.fields ? new Set(opts.fields) : undefined;
  // Membership decides this, so a tombstone or a newer peer's status is excluded
  // by simply not being asked for — no separate filter to keep in step.
  const selected = list.filter((entry): entry is JobUrlEntry & { status: JobUrlStatus } =>
    wanted.has(entry.status));
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
      }, keep);
    });
}

/* ---------------- CSV ---------------- */

/** A block sequence as plain text: one block per line, bullets marked as such. */
function blocksToText(blocks: ExportBlock[]): string {
  return blocks.map((b) => (b.type === 'bullet' ? `- ${b.text}` : b.text)).join('\n');
}

function csvCell(value: unknown): string {
  const text = Array.isArray(value)
    ? blocksToText(value as ExportBlock[])
    : value == null ? '' : String(value);
  // RFC 4180: only a cell holding a delimiter, a quote or a line break needs
  // quoting, and a quote inside one is doubled.
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The same archive as a spreadsheet. Pure; the BOM a spreadsheet needs to read
 * this as UTF-8 belongs with the download, not in the text.
 *
 * The header is the field *keys*, not their labels: the two formats then name
 * the same column the same way, and a script that reads one can read the other.
 * A description arrives as one cell of text, because a row per block would stop
 * this being one posting per row — which is the only reason to want a CSV.
 */
export function toCsv(jobs: ExportedJob[], fields: ExportField[]): string {
  const rows = jobs.map((job) => fields.map((f) => csvCell(job[f])).join(','));
  return [fields.join(','), ...rows].join('\r\n');
}

/**
 * Dated so successive downloads sort by day instead of colliding as `(1)`, and
 * named for what is actually in it: a file holding skipped postings too must not
 * still call itself the applied ones.
 */
export function exportFilename(
  now: Date,
  sel: Pick<ResolvedExport, 'format' | 'statuses'> = { format: 'json', statuses: ['applied'] },
): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const appliedOnly = sel.statuses.length === 1 && sel.statuses[0] === 'applied';
  return `${appliedOnly ? 'applied-jobs' : 'jobs'}-${day}.${sel.format}`;
}
