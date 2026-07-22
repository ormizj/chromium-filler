/**
 * Pulls the job title and description out of the page for the modal, using the
 * site config selectors with generic fallbacks.
 */

import type { SiteConfig } from '../shared/types';

const TITLE_FALLBACKS = ['h1', '[class*="job-title" i]', '[class*="posting-headline" i]', 'title'];
const DESCRIPTION_FALLBACKS = [
  '[class*="job-description" i]',
  '[class*="description" i]',
  '[id*="description" i]',
  '[class*="content" i]',
  'main',
  'article',
];

function textOf(selector: string | undefined): string | undefined {
  if (!selector) return undefined;
  try {
    const el = document.querySelector(selector);
    const text = el?.textContent?.trim();
    return text || undefined;
  } catch {
    return undefined;
  }
}

function firstMatch(selectors: string[]): string | undefined {
  for (const sel of selectors) {
    const text = textOf(sel);
    if (text) return text;
  }
  return undefined;
}

export interface ExtractedJob {
  title?: string;
  description?: string;
}

export function extractJob(config: SiteConfig): ExtractedJob {
  const title = textOf(config.extract.jobTitle) ?? firstMatch(TITLE_FALLBACKS) ?? document.title;
  const description = textOf(config.extract.jobDescription) ?? firstMatch(DESCRIPTION_FALLBACKS);
  return { title, description };
}
