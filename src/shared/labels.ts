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

import type { MatchConfidence } from './types';

export interface StatusText {
  /** Capitalised, for the stat-tile caption: "Filled" / "To check" / "Unmatched". */
  tile: string;
  /** Lower-case chip/legend/summary word: "filled" / "to check" / "unmatched". */
  word: string;
  /** The spoken descriptor for a dot's `aria-label` — a touch more explicit. */
  aria: string;
}

/**
 * The three field outcomes, worded once. `high` is a value that actually went in;
 * `low` is a guess or a value the field would not take (Confirm/Pick it); `none`
 * is a field nothing on the page matched.
 */
export const STATUS_TEXT: Record<MatchConfidence, StatusText> = {
  high: { tile: 'Filled', word: 'filled', aria: 'filled' },
  low: { tile: 'To check', word: 'to check', aria: 'needs review' },
  none: { tile: 'Unmatched', word: 'unmatched', aria: 'not found' },
};

/**
 * The verbs on the extension's buttons. Kept together so "Apply", "Skip" and the
 * rest read the same on every surface — the modal footer, the setup footer, the
 * popup, the report rows.
 */
export type ActionKey =
  | 'apply'
  | 'applied'
  | 'skip'
  | 'skipNext'
  | 'rerun'
  | 'reset'
  | 'confirm'
  | 'pick'
  | 'done'
  | 'openOptions'
  | 'more'
  | 'openApplication'
  | 'openApplicationAgain'
  | 'fillAnyway'
  | 'siteSetup'
  | 'fullscreen'
  | 'exitFullscreen';

export const ACTION_LABELS: Record<ActionKey, string> = {
  apply: 'Apply',
  applied: 'Applied ✓',
  skip: 'Skip',
  skipNext: 'Skip → next',
  rerun: 'Re-run',
  reset: 'Reset',
  confirm: 'Confirm',
  pick: 'Pick',
  done: 'Done',
  openOptions: 'Open options',
  more: '⋯',
  openApplication: 'Open application',
  openApplicationAgain: 'Open again',
  fillAnyway: 'Fill this page instead',
  // Two words, like every other secondary action: it is the popup's link *and*
  // the setup sheet's collapsed pill, and those two naming the same thing
  // differently is exactly what this file exists to prevent.
  siteSetup: 'Site setup',
  // Icon-only in the modal header, so these are read aloud rather than shown —
  // which is exactly why they belong here and not inline as a string literal.
  fullscreen: 'Fullscreen',
  exitFullscreen: 'Exit fullscreen',
};
