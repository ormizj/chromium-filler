/**
 * Pulls the job title and description out of the page for the modal, using the
 * site config selectors with generic fallbacks. `previewContainer` exposes the
 * same resolution (with its source) so the Setup panel can show what each
 * container selector currently matches — including auto-detected fallbacks.
 */

import type { SiteConfig } from '../shared/types';

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
  text?: string;
  source: ContainerSource;
}

/** Resolve one job-info container: explicit selector first, then generic fallbacks. */
export function previewContainer(config: SiteConfig, key: ContainerKey): ContainerPreview {
  const selector = config.extract[key];
  if (selector) {
    const el = elFor(selector);
    return el
      ? { el, text: el.textContent!.trim(), source: 'override' }
      : { el: null, source: 'override-miss' };
  }
  const el = firstMatch(FALLBACKS[key]);
  return el ? { el, text: el.textContent!.trim(), source: 'auto' } : { el: null, source: 'none' };
}

export interface ExtractedJob {
  title?: string;
  description?: string;
  requirements?: string;
}

export function extractJob(config: SiteConfig): ExtractedJob {
  return {
    title: previewContainer(config, 'jobTitle').text ?? document.title,
    description: previewContainer(config, 'jobDescription').text,
    requirements: previewContainer(config, 'jobRequirements').text,
  };
}
