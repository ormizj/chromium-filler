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
  /** options -> background: open a batch of URLs in new tabs. */
  OPEN_URLS: 'CF_OPEN_URLS',
  /** popup -> background: open the options page (optionally to create a config). */
  OPEN_OPTIONS: 'CF_OPEN_OPTIONS',
} as const;

export interface StatusResponse {
  siteMatched: boolean;
  siteName?: string;
  configId?: string;
  filledCount: number;
  reportedCount: number;
  hasRun: boolean;
}

export type Message =
  | { type: typeof MSG.RUN }
  | { type: typeof MSG.RESET }
  | { type: typeof MSG.STATUS }
  | { type: typeof MSG.PICK; field: FieldKey }
  | { type: typeof MSG.OPEN_URLS; urls: string[] }
  | { type: typeof MSG.OPEN_OPTIONS; createForUrl?: string };

export interface RunResult {
  status: StatusResponse;
  matches: FieldMatch[];
  jobTitle?: string;
  jobDescription?: string;
}
