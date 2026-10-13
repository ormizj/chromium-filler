/**
 * Message contract between popup/options, the background service worker, and the
 * content script. Keep payloads structured-clone friendly (no DOM, no functions).
 */

import type { QueueProgress } from './queue';

export const MSG = {
  /**
   * popup -> content: sweep and fill this page now, and open the review card —
   * whether or not `fillAutomatically` is on, and on any page.
   */
  RUN: 'CF_RUN',
  /** popup -> content: empty what was filled, clear the marks, start the report over. */
  RESET: 'CF_RESET',
  /** popup -> content: report what the page has (filled, to teach, card state). */
  STATUS: 'CF_STATUS',
  /**
   * popup -> content: point at an input to teach — for one the sweep did not list
   * (a custom widget, something we skip by default). Opens the card on its row.
   */
  TEACH: 'CF_TEACH',
  /** options -> background: open a batch of URLs in new tabs. */
  OPEN_URLS: 'CF_OPEN_URLS',
  /** popup/content -> background: open the options page. */
  OPEN_OPTIONS: 'CF_OPEN_OPTIONS',
  /** options -> background: begin a queue session keeping `batchSize` tabs open. */
  SESSION_START: 'CF_SESSION_START',
  /** options/popup -> background: stop refilling (open tabs are left alone). */
  SESSION_STOP: 'CF_SESSION_STOP',
  /** any surface -> background: report session progress. */
  SESSION_STATE: 'CF_SESSION_STATE',
  /** popup/modal -> background: mark this posting skipped, close it, open the next. */
  SESSION_SKIP: 'CF_SESSION_SKIP',
  /**
   * content/popup -> background: did the queue open *this* tab? Answered from the
   * sender's tab id, so a page cannot ask about another one.
   */
  QUEUE_TAB: 'CF_QUEUE_TAB',
  /** popup -> content: re-open the folded review card without sweeping again. */
  SHOW_REPORT: 'CF_SHOW_REPORT',
  /** options -> background: authorize a Google account to sync the job database with. */
  SYNC_CONNECT: 'CF_SYNC_CONNECT',
  /** options -> background: forget the account and its tokens; the data stays. */
  SYNC_DISCONNECT: 'CF_SYNC_DISCONNECT',
  /** options -> background: merge with the remote copy now. */
  SYNC_NOW: 'CF_SYNC_NOW',
  /** options -> background: report which account, when it last synced, what failed. */
  SYNC_STATE: 'CF_SYNC_STATE',
  /**
   * options -> background: store the Google OAuth client the user entered.
   *
   * Through the background rather than written from the options page, because
   * changing the client has to invalidate the tokens issued by the old one, and
   * that is the auth module's business.
   */
  SYNC_SET_CLIENT: 'CF_SYNC_SET_CLIENT',
} as const;

/** Session snapshot shown by the popup, the options queue, and the modal strip. */
export interface SessionState {
  active: boolean;
  batchSize: number;
  /** Every entry counted for the progress bar. */
  progress: QueueProgress;
}

/**
 * The background's answer to `QUEUE_TAB`. `inQueue` is true for a tab the queue
 * opened *and* for a tab opened from one — the employer's form behind "Apply on
 * company website" belongs to the same posting.
 */
export interface QueueTabState {
  inQueue: boolean;
  /** Only the tab the queue opened finishes the posting when it closes. */
  child?: boolean;
  /** The posting this tab belongs to. */
  url?: string;
  progress?: QueueProgress;
}

export interface StatusResponse {
  /** Inputs filled on this page. */
  filledCount: number;
  /** Rows in the report. */
  reportedCount: number;
  /** Inputs nothing recognised — the rows to teach. */
  toTeach: number;
  /** A sweep has run on this page. */
  hasRun: boolean;
  /** The review card exists and is folded to its pill. */
  modalMinimized?: boolean;
  /** The queue opened this tab, or a tab it opened. */
  inQueue?: boolean;
}

/** What the options page shows in the Sync section. */
export interface SyncState {
  /** This device has an OAuth client id at all — the first setup step. */
  configured: boolean;
  /**
   * A refresh token is held. Reported separately from `account` because that is
   * only a *label*: it comes out of the id_token, and a consent that returned no
   * `email` claim left a perfectly good connection looking unauthorized — with
   * Disconnect disabled, so it could not even be cleared from the Sync tab.
   */
  connected: boolean;
  /** The client id itself, so the options form can show what is stored. */
  clientId?: string;
  /** The Google account this browser is syncing through, once authorized. */
  account?: string;
  lastSyncAt?: number;
  lastError?: string;
  /** Postings held here and on the far side — the first-merge confirmation. */
  pending?: {
    local: number;
    remote: number;
  };
}

export type Message =
  | { type: typeof MSG.RUN }
  | { type: typeof MSG.RESET }
  | { type: typeof MSG.STATUS }
  | { type: typeof MSG.TEACH }
  | { type: typeof MSG.OPEN_URLS; urls: string[] }
  // `hash` deep-links to a tab (`profile`, `queue`, `help`, …); `at` names a
  // section on it and `focus` a control inside that, because a tab on its own is
  // not where anything is. The options page already routes on its own hash, so
  // all three only have to survive the open.
  | {
      type: typeof MSG.OPEN_OPTIONS;
      hash?: string;
      at?: string;
      focus?: string;
    }
  | { type: typeof MSG.SESSION_START; batchSize?: number }
  | { type: typeof MSG.SESSION_STOP }
  | { type: typeof MSG.SESSION_STATE }
  | { type: typeof MSG.SESSION_SKIP; url: string }
  | { type: typeof MSG.QUEUE_TAB }
  | { type: typeof MSG.SHOW_REPORT }
  | { type: typeof MSG.SYNC_CONNECT }
  | { type: typeof MSG.SYNC_DISCONNECT }
  // `confirmed` is the answer to the count prompt shown before the first merge:
  // connecting the wrong Google account would union a stranger's job list into
  // this one, and that is worth one look before it happens.
  | { type: typeof MSG.SYNC_NOW; confirmed?: boolean }
  | { type: typeof MSG.SYNC_STATE }
  | { type: typeof MSG.SYNC_SET_CLIENT; clientId: string; clientSecret: string };
