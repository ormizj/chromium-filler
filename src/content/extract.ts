/**
 * Pulls the job title and description out of the page for the modal, using the
 * site config selectors with generic fallbacks. `previewContainer` exposes the
 * same resolution (with its source) so the Setup panel can show what each
 * container selector currently matches — including auto-detected fallbacks.
 *
 * The container's *text* is never taken raw: shared/jobText.ts walks it into
 * blocks, so the modal can render prose as prose and so the broad fallbacks below
 * do not drag the application form and the sidebar in with the posting.
 */

import type { SiteConfig } from '../shared/types';
import { blocksToText, extractBlocks, type JobBlock } from '../shared/jobText';

export type ContainerKey = 'jobTitle' | 'jobDescription' | 'jobRequirements';

const TITLE_FALLBACKS = ['h1', '[class*="job-title" i]', '[class*="posting-headline" i]', 'title'];
const DESCRIPTION_FALLBACKS = [
  '[class*="job-description" i]',
  '[class*="description" i]',
  '[id*="description" i]',
  '[class*="content" i]',
  'main',
  'article',
];
// Requirements have no generic fallback — shown only when explicitly configured.
const FALLBACKS: Record<ContainerKey, string[]> = {
  jobTitle: TITLE_FALLBACKS,
  jobDescription: DESCRIPTION_FALLBACKS,
  jobRequirements: [],
};

function elFor(selector: string | undefined): HTMLElement | null {
  if (!selector) return null;
  try {
    const el = document.querySelector(selector) as HTMLElement | null;
    return el?.textContent?.trim() ? el : null;
  } catch {
    return null;
  }
}

function firstMatch(selectors: string[]): HTMLElement | null {
  for (const sel of selectors) {
    const el = elFor(sel);
    if (el) return el;
  }
  return null;
}

/** How a container's text was resolved, for the Setup panel's status dot. */
export type ContainerSource = 'override' | 'override-miss' | 'auto' | 'none';

export interface ContainerPreview {
  el: HTMLElement | null;
  /** The container's readable structure — what the modal renders. */
  blocks: JobBlock[];
  /** The same content as plain text, one line per block (Setup panel snippets). */
  text?: string;
  source: ContainerSource;
}

function resolved(el: HTMLElement, source: ContainerSource): ContainerPreview {
  const blocks = extractBlocks(el);
  return { el, blocks, text: blocksToText(blocks), source };
}

const MISSING = (source: ContainerSource): ContainerPreview => ({ el: null, blocks: [], source });

/** Resolve one job-info container: explicit selector first, then generic fallbacks. */
export function previewContainer(config: SiteConfig, key: ContainerKey): ContainerPreview {
  const selector = config.extract[key];
  if (selector) {
    const el = elFor(selector);
    return el ? resolved(el, 'override') : MISSING('override-miss');
  }
  const el = firstMatch(FALLBACKS[key]);
  return el ? resolved(el, 'auto') : MISSING('none');
}

export interface ExtractedJob {
  title?: string;
  description: JobBlock[];
  requirements: JobBlock[];
}

export function extractJob(config: SiteConfig): ExtractedJob {
  const title = previewContainer(config, 'jobTitle');
  return {
    // A title is one line, so it stays a string — but a normalized one: an <h1>
    // wrapped across three source lines used to arrive with its indentation.
    title: (title.text || document.title).replace(/\s+/g, ' ').trim(),
    description: previewContainer(config, 'jobDescription').blocks,
    requirements: previewContainer(config, 'jobRequirements').blocks,
  };
}
