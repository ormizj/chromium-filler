/**
 * Message contract between popup/options, the background service worker, and the
 * content script. Keep payloads structured-clone friendly (no DOM, no functions).
 */

import type { FieldKey, FieldMatch } from './types';

export const MSG = {
  /** popup -> content: run the full detect/prep/fill flow now. */
  RUN: 'CF_RUN',
  /** popup -> content: clear fills + highlights and re-arm. */
  RESET: 'CF_RESET',
  /** popup -> content: report current status (armed/filled/site matched). */
  STATUS: 'CF_STATUS',
  /** content/modal -> content(self): begin click-to-pick for a field. */
  PICK: 'CF_PICK',
  /** popup/modal -> content: enter on-page picker Setup mode for this site. */
  SETUP: 'CF_SETUP',
  /** options -> background: open a batch of URLs in new tabs. */
  OPEN_URLS: 'CF_OPEN_URLS',
  /** popup -> background: open the options page (optionally to create a config). */
  OPEN_OPTIONS: 'CF_OPEN_OPTIONS',
  /** content -> background: submission detected; mark applied + maybe close tab. */
  SUBMITTED: 'CF_SUBMITTED',
  /** content -> background: this posting redirects; watch where the handoff lands. */
  FOLLOW_REDIRECT: 'CF_FOLLOW_REDIRECT',
  /** background -> content: this tab is where a tracked redirect landed. */
  REDIRECT_LANDED: 'CF_REDIRECT_LANDED',
} as const;

export interface StatusResponse {
  siteMatched: boolean;
  siteName?: string;
  configId?: string;
  filledCount: number;
  reportedCount: number;
  hasRun: boolean;
  /** How this posting was classified, once a run has classified it. */
  postingKind?: 'quickApply' | 'redirect' | 'unknown';
  /** Destination of an external application, when known. */
  redirectHref?: string;
  /** The board posting this page was reached from, for a redirect destination. */
  landedFrom?: string;
}

/** Background's answer to FOLLOW_REDIRECT: who performs the navigation. */
export interface FollowRedirectResponse {
  /** The background already opened the destination; the page does nothing. */
  opened?: boolean;
  /** No URL is known — click the apply control and let the site navigate. */
  click?: boolean;
  /** Navigate this tab to this URL. */
  navigate?: string;
  error?: string;
}

export type Message =
  | { type: typeof MSG.RUN }
  | { type: typeof MSG.RESET }
  | { type: typeof MSG.STATUS }
  | { type: typeof MSG.PICK; field: FieldKey }
  | { type: typeof MSG.SETUP }
  | { type: typeof MSG.OPEN_URLS; urls: string[] }
  | { type: typeof MSG.OPEN_OPTIONS; createForUrl?: string }
  | { type: typeof MSG.SUBMITTED; url: string }
  | { type: typeof MSG.FOLLOW_REDIRECT; sourceUrl: string; href?: string }
  | { type: typeof MSG.REDIRECT_LANDED; sourceUrl: string };

export interface RunResult {
  status: StatusResponse;
  matches: FieldMatch[];
  jobTitle?: string;
  jobDescription?: string;
}
