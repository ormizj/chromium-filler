/**
 * Message contract between popup/options, the background service worker, and the
 * content script. Keep payloads structured-clone friendly (no DOM, no functions).
 */

import type { FieldKey, FieldMatch } from './types';
import type { QueueProgress } from './queue';

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
  /**
   * content -> background: this tab is working on this posting. Recorded so a
   * confirmation that appears on a *different* URL still marks the posting.
   */
  APPLYING: 'CF_APPLYING',
  /** content -> background: this posting redirects; watch where the handoff lands. */
  FOLLOW_REDIRECT: 'CF_FOLLOW_REDIRECT',
  /** background -> content: this tab is where a tracked redirect landed. */
  REDIRECT_LANDED: 'CF_REDIRECT_LANDED',
  /** options -> background: begin a queue session keeping `batchSize` tabs open. */
  SESSION_START: 'CF_SESSION_START',
  /** options/popup -> background: stop refilling (open tabs are left alone). */
  SESSION_STOP: 'CF_SESSION_STOP',
  /** any surface -> background: report session progress. */
  SESSION_STATE: 'CF_SESSION_STATE',
  /** popup/modal -> background: mark this posting skipped, close it, open the next. */
  SESSION_SKIP: 'CF_SESSION_SKIP',
  /** popup -> content: re-open the minimized review modal without re-running. */
  SHOW_REPORT: 'CF_SHOW_REPORT',
  /** options -> background: authorize a Google account to sync the job database with. */
  SYNC_CONNECT: 'CF_SYNC_CONNECT',
  /** options -> background: forget the account and its tokens; the data stays. */
  SYNC_DISCONNECT: 'CF_SYNC_DISCONNECT',
  /** options -> background: merge with the remote copy now. */
  SYNC_NOW: 'CF_SYNC_NOW',
  /** options -> background: report which account, when it last synced, what failed. */
  SYNC_STATE: 'CF_SYNC_STATE',
} as const;

/** Session snapshot shown by the popup, the options queue, and the modal strip. */
export interface SessionState {
  active: boolean;
  batchSize: number;
  /** Every entry counted for the progress bar. */
  progress: QueueProgress;
}

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
  /**
   * The review modal is collapsed to its pill. The popup offers "Show report"
   * instead of the destructive "Reset & Re-run" when this is set.
   */
  modalMinimized?: boolean;
}

/** What the options page shows in the Sync section. */
export interface SyncState {
  /** An OAuth client id is configured in this build at all. */
  configured: boolean;
  /** The Google account this browser is syncing through, once authorized. */
  account?: string;
  lastSyncAt?: number;
  lastError?: string;
  /** Postings held here and on the far side — the first-merge confirmation. */
  pending?: { local: number; remote: number };
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
  // `hash` deep-links to a tab (`profile`, `sites`, `help`, …); the options page
  // already routes on its own hash, so this only has to survive the open.
  | { type: typeof MSG.OPEN_OPTIONS; createForUrl?: string; hash?: string }
  | { type: typeof MSG.SUBMITTED; url: string }
  | { type: typeof MSG.APPLYING; url: string }
  | { type: typeof MSG.FOLLOW_REDIRECT; sourceUrl: string; href?: string }
  | { type: typeof MSG.REDIRECT_LANDED; sourceUrl: string }
  | { type: typeof MSG.SESSION_START; batchSize?: number }
  | { type: typeof MSG.SESSION_STOP }
  | { type: typeof MSG.SESSION_STATE }
  | { type: typeof MSG.SESSION_SKIP; url: string }
  | { type: typeof MSG.SHOW_REPORT }
  | { type: typeof MSG.SYNC_CONNECT }
  | { type: typeof MSG.SYNC_DISCONNECT }
  // `confirmed` is the answer to the count prompt shown before the first merge:
  // connecting the wrong Google account would union a stranger's job list into
  // this one, and that is worth one look before it happens.
  | { type: typeof MSG.SYNC_NOW; confirmed?: boolean }
  | { type: typeof MSG.SYNC_STATE };

export interface RunResult {
  status: StatusResponse;
  matches: FieldMatch[];
  jobTitle?: string;
  jobDescription?: string;
}
