/**
 * The one place the user-facing *wording on controls and statuses* is written —
 * the counterpart to `help.ts`, which owns the longer *explanations*. Before this
 * existed the same three field outcomes were worded four different ways (the row
 * aria-label, the legend key, the summary line and the setup legend all disagreed),
 * and every button label was a string literal wherever it happened to be built.
 *
 * The `Record<…>` types are load-bearing in the same way help.ts's are: a new
 * `MatchConfidence` or a new `ActionKey` fails `npm run typecheck` until it has
 * been given words here, so the vocabulary cannot silently grow a synonym.
 *
 * Note the dot *class* stays the `MatchConfidence` value itself (`cf-dot high` /
 * `low` / `none`, aliased to ok/warn/none in primitives.css) — this file governs
 * the words, not the class names.
 */

import type { JobUrlStatus, MatchConfidence } from './types';

export interface StatusText {
  /** Capitalised, for the stat-tile caption: "Filled" / "To check" / "New". */
  tile: string;
  /** Lower-case chip/legend/summary word: "filled" / "to check" / "new". */
  word: string;
  /** The spoken descriptor for a dot's `aria-label` — a touch more explicit. */
  aria: string;
}

/**
 * The three outcomes of an input, worded once. `high` is an answer that is in the
 * box — ours, or the user's; `low` is a guess, or a match with nothing to fill it
 * with; `none` is a question nothing recognised yet — not a failure: the user
 * answers it, and if the answer is one of their details it is learned.
 */
export const STATUS_TEXT: Record<MatchConfidence, StatusText> = {
  high: { tile: 'Filled', word: 'filled', aria: 'filled' },
  low: { tile: 'To check', word: 'to check', aria: 'needs review' },
  none: { tile: 'New', word: 'new', aria: 'not recognised yet' },
};

/**
 * Where the page is, as the card's banner says it. `shared/flowState.ts` decides
 * which; this is what each is called. There is no sending any more — the user
 * presses the site's own button — so the states are only about the filling, and
 * about whether this posting was already done with.
 */
export type FlowKey = 'alreadyDone' | 'ready' | 'nothing' | 'empty' | 'watching';

export interface FlowText {
  title: string;
  detail: string;
}

export const FLOW_TEXT: Record<FlowKey, FlowText> = {
  // `{when}` is filled by `flowBanner`, or removed on an entry with no date.
  alreadyDone: {
    title: 'Already done',
    detail: 'was marked done{when}. The form was filled again anyway — set it back to New in Options → Queue if you are not finished with it.',
  },
  // The resting state: the extension's part is done and the rest is the user's.
  // It names the site's own button because that is the one thing left, and the one
  // thing the extension will never do.
  ready: { title: 'Filled — submit on the site when you are ready', detail: 'Nothing is ever sent for you.' },
  // A page with inputs, none of them recognised. Not a failure: answering them is
  // how they are learned, and the sentence says so.
  nothing: {
    title: 'Nothing recognised yet',
    detail: 'Answer them yourself — when an answer is one of your details, the question is learned for every site.',
  },
  // The card opened from the always-on pill on a page with nothing to fill. Says
  // what the extension is doing here, because that is why the pill is showing.
  watching: {
    title: 'Watching this page',
    detail: 'Anything that appears is filled as it does, and answers you type are learned.',
  },
  // Not "no form was found here": this is reached when the profile is empty, and
  // only the profile can cause it.
  empty: {
    title: 'Nothing to fill with yet',
    detail: 'Your profile is empty — add your details and your CV in Options → Profile.',
  },
};

/**
 * The verbs on the extension's buttons. Kept together so the same action reads
 * the same on every surface — the card's footer, its rows, the popup.
 */
export type ActionKey =
  | 'skip'
  | 'skipNext'
  | 'rerun'
  | 'fillAgain'
  | 'done'
  | 'learned'
  | 'answered'
  | 'saved'
  | 'undo'
  | 'ignored';

export const ACTION_LABELS: Record<ActionKey, string> = {
  skip: 'Skip',
  skipNext: 'Skip → next',
  rerun: 'Re-run',
  // The footer's one visible action. "Fill again" rather than "Re-run": it is what
  // the press does to the page, and it never writes over an answer already there.
  fillAgain: 'Fill again',
  done: 'Done',
  // A row's tags once the user has been at it. Rows hold still, so the tag is what
  // says something happened: "Learned" — the question is now one of their fields,
  // everywhere; "Yours" — they answered it, and it is not one we know.
  learned: 'Learned',
  answered: 'Yours',
  // The user corrected what we filled, and the profile field took their answer.
  saved: 'Saved',
  // Puts a just-saved detail back, and stops filling that box.
  undo: 'Undo',
  // A question a lesson sets aside: the user emptied or replaced what we put there.
  ignored: 'Won’t fill',
};

/**
 * The queue chip's words. Built, not looked up — it carries the position.
 * Short on purpose: it sits in a corner of somebody else's page.
 */
export function queueChipText(done: number, total: number): string {
  return total > 0 ? `Queue · ${done}/${total}` : 'Queue';
}

/* ---------------- The pill ---------------- */

export interface PillInput {
  filled: number;
  /** Questions nothing recognised yet. */
  fresh: number;
  rows: number;
  alreadyDone?: boolean;
  /** Just learned this field, by name — shown for a moment instead of the counts. */
  learned?: string;
  /** Just switched off from the card — said for a moment before the pill goes. */
  paused?: boolean;
  /** Just saved a correction to this field, by name — shown beside an Undo. */
  saved?: string;
}

/**
 * The pill's words. It is the one mark the extension keeps on every page while it
 * is on, so on a page with nothing to fill it says *that it is on* rather than
 * "0 filled" — the user should always be able to tell it is reading the page.
 */
export function pillText(p: PillInput): string {
  if (p.paused) return 'Paused · turn back on from the toolbar button';
  if (p.saved) return savedText(p.saved);
  if (p.learned) return `Learned · ${p.learned}`;
  if (p.alreadyDone) return 'Already done';
  if (!p.rows) return 'On · learning';
  return p.fresh ? `${p.filled} filled · ${p.fresh} new` : `${p.filled} filled`;
}

/** A correction just saved to the profile — the pill's words and the open card's. */
export function savedText(field: string): string {
  return `Saved · ${field}`;
}

/** The pill's accessible name: what it is, and what pressing it does. */
export const PILL_ARIA = 'Chromium Filler is on and learning on this page — open the report';

/** The on/off switch on the card and in the popup, as a screen reader hears it. */
export const SWITCH_ARIA = 'Fill and learn on this browser';

/* ---------------- Posting statuses ---------------- */

/**
 * What each posting status is called where it is offered as a choice — the
 * queue filters and a row's status control. Keyed off `JobUrlStatus`, so a new
 * status must be given words before `ALL_JOB_STATUSES` can offer it.
 */
export const JOB_STATUS_LABELS: Record<JobUrlStatus, string> = {
  new: 'New',
  done: 'Done',
};
