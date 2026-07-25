/**
 * The captured posting: what the page actually said, kept after the tab closes.
 *
 * `extractJob` has always read the title, the description blocks and the chips —
 * but only to render the modal's Job view, re-extracting on every re-render and
 * throwing the result away. That is fine for deciding *now* and useless for
 * deciding later, which is what an archive of applications is for.
 *
 * Kept under its own storage key rather than as fields on `JobUrlEntry`: the
 * job-URL list is read and rewritten whole on every status change, every session
 * tick and every queue render, and folding kilobytes of prose per posting into it
 * would make each of those a multi-megabyte round-trip. This map is touched twice
 * — once when a posting is read, once when the archive is exported.
 *
 * Pure; the storage wrappers live in storage.ts.
 */

import type { JobUrlEntry } from './types';
import type { JobBlock } from './jobText';
import type { JobMeta } from './jobMeta';

/** One posting, as it read on the page. Keyed by URL, the job database's key. */
export interface JobDetails {
  url: string;
  title?: string;
  /** The site config's name, so the archive says which board this came from. */
  site?: string;
  description: JobBlock[];
  requirements: JobBlock[];
  /** Company / location / employment type — see jobMeta.ts. Any may be absent. */
  meta: JobMeta;
  capturedAt: number;
}

export type JobDetailsMap = Record<string, JobDetails>;

/** Nothing worth keeping was read off the page. */
export function isEmptyDetails(details: JobDetails): boolean {
  return (
    !details.title?.trim() &&
    details.description.length === 0 &&
    details.requirements.length === 0 &&
    !details.meta.company &&
    !details.meta.location &&
    !details.meta.employmentType
  );
}

/**
 * Record a posting, replacing any earlier capture of the same URL.
 *
 * With one exception: an empty capture never overwrites a non-empty one. The
 * modal re-renders — and so re-extracts — after a re-run, a redirect follow, a
 * Reset and every field confirmation, and by then the container the description
 * came from may be gone (a single-page board swapping views, a form replacing the
 * posting). Writing that through would trade the text for nothing, silently, at
 * exactly the moment the user thinks the posting is safely recorded.
 */
export function captureDetails(map: JobDetailsMap, details: JobDetails): JobDetailsMap {
  const existing = map[details.url];
  if (existing && !isEmptyDetails(existing) && isEmptyDetails(details)) return map;
  return { ...map, [details.url]: details };
}

/** The captures for a posting and everything it was reached from, nearest first. */
function chain(map: JobDetailsMap, entry: JobUrlEntry, list: JobUrlEntry[]): JobDetails[] {
  const found: JobDetails[] = [];
  const seen = new Set<string>();
  let current: JobUrlEntry | undefined = entry;
  while (current && !seen.has(current.url)) {
    seen.add(current.url);
    const details = map[current.url];
    if (details && !isEmptyDetails(details)) found.push(details);
    // `linkRedirect` writes both ends and points them at each other, so a cycle
    // is reachable from real data, not just from a corrupt store.
    const source: string | undefined = current.sourceUrl;
    current = source ? list.find((e) => e.url === source) : undefined;
  }
  return found;
}

/**
 * Everything known about a posting, gathered along the `sourceUrl` chain it was
 * reached through — nearest page wins each field.
 *
 * A two-step posting splits itself across two pages: the board carries the
 * description, the employer's ATS carries the form, and `applyStatusChain` marks
 * both applied. Field by field rather than picking one of the two records, because
 * the split is rarely clean — the ATS end always has *a* title (`extractJob`
 * falls back to `document.title`) while having no description at all, so taking
 * the nearest non-empty *record* would hand back a title and an empty body and
 * leave the board's description sitting unused one hop away.
 */
export function resolveDetails(
  map: JobDetailsMap,
  entry: JobUrlEntry,
  list: JobUrlEntry[],
): JobDetails | undefined {
  const found = chain(map, entry, list);
  if (found.length === 0) return undefined;
  const first = <T>(pick: (d: JobDetails) => T | undefined): T | undefined => {
    for (const d of found) {
      const value = pick(d);
      if (value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)) {
        return value;
      }
    }
    return undefined;
  };
  return {
    // Identified by the page nearest the application — the one applied on.
    url: found[0].url,
    capturedAt: found[0].capturedAt,
    title: first((d) => d.title?.trim() || undefined),
    site: first((d) => d.site),
    description: first((d) => d.description) ?? [],
    requirements: first((d) => d.requirements) ?? [],
    meta: {
      company: first((d) => d.meta.company),
      location: first((d) => d.meta.location),
      employmentType: first((d) => d.meta.employmentType),
    },
  };
}

/** Drop captures for postings no longer in the database. Identity when clean. */
export function pruneDetails(map: JobDetailsMap, urls: string[]): JobDetailsMap {
  const known = new Set(urls);
  const stale = Object.keys(map).filter((url) => !known.has(url));
  if (stale.length === 0) return map;
  const next = { ...map };
  for (const url of stale) delete next[url];
  return next;
}
