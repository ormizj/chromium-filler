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
import type { ExportField } from './jobExport';

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
 * Where the user is in the one flow the extension has: filled → reviewed →
 * applied. `shared/flowState.ts` decides *which* of these a posting is in; this
 * is what each one is called.
 *
 * It exists because the modal used to say none of it. The card showed a job
 * posting and a greyed button, and the three questions it left — what happened,
 * what can I press, did it go through — were answered in three different places,
 * two of them behind a click. Now one banner answers all three, worded here.
 *
 * `detail` is the second line. Several are completed with a host or a count by
 * `flowBanner`, which is why they read as fragments on their own.
 */
export type FlowKey =
  | 'applied'
  | 'appLink'
  | 'external'
  | 'externalOpened'
  | 'noButton'
  | 'noConfirmation'
  | 'ready'
  | 'empty';

export interface FlowText {
  title: string;
  detail: string;
}

export const FLOW_TEXT: Record<FlowKey, FlowText> = {
  // Worded as what the *site* said, not as what the extension did: the claim is
  // only as good as the confirmation element that produced it.
  applied: { title: 'Application sent', detail: 'confirmed it' },
  // Names the control that was left alone, and what to do instead. Without this
  // the page just fills in place and the untouched Apply button reads as a bug.
  appLink: {
    title: 'This posting applies in an app',
    detail: 'Its apply link opens a phone app, not a web page, so nothing there can be '
      + 'filled or recorded. Any form on this page was still filled.',
  },
  external: { title: 'Applies on the employer’s own site', detail: 'Opening it fills the form there automatically.' },
  externalOpened: { title: 'Opening the employer’s application', detail: 'The form there is filled on arrival.' },
  // The two halves Apply needs. Each names the missing half and the one place to
  // go and set it — a blocked button that explains itself is the whole point.
  noButton: {
    title: 'Apply is unavailable here',
    detail: 'No Send button was found on this page. Open Site setup and pick it.',
  },
  noConfirmation: {
    title: 'Apply is unavailable here',
    detail: 'This site has no confirmation element set, so a result cannot be read back. Set it in Site setup.',
  },
  ready: { title: 'Filled — nothing has been sent yet', detail: 'ready to review' },
  empty: { title: 'Nothing to fill on this page', detail: 'No application form was found here.' },
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
  | 'addLinks'
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
  // Two words, and named for what you do there rather than for the tab it
  // lands on: the popup's Queue button and the review modal's menu item both
  // arrive at the same paste box.
  addLinks: 'Add links',
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

/* ---------------- The archive's columns and statuses ---------------- */

/**
 * Every column the archive can export, worded — and, being an ordered
 * `Record<ExportField, string>`, also the **order** they are written in and
 * offered in. `ExportField` is `keyof ExportedJob`, so a field added to the
 * export fails `npm run typecheck` until it is named here, and naming it is all
 * it takes: `EXPORT_FIELD_ORDER` is these keys, and Options draws one checkbox
 * per entry. A column nobody can name is a column nobody can choose.
 *
 * The words are what the *user* calls each one ("Job title"); the file itself
 * keeps the key (`title`), which is what a script reads.
 */
export const EXPORT_FIELD_LABELS: Record<ExportField, string> = {
  url: 'URL',
  title: 'Job title',
  site: 'Board',
  company: 'Company',
  location: 'Location',
  employmentType: 'Employment type',
  status: 'Status',
  addedAt: 'Date added',
  appliedAt: 'Date applied',
  capturedAt: 'Date captured',
  sourceUrl: 'Came from',
  redirectUrl: 'Handed off to',
  description: 'Description',
  requirements: 'Requirements',
};

/**
 * What each posting status is called where it is offered as a choice. Keyed off
 * `JobUrlStatus` for the same reason as above: a new status must be given words
 * before it can be a checkbox, and `ALL_JOB_STATUSES` then makes it one.
 */
export const JOB_STATUS_LABELS: Record<JobUrlStatus, string> = {
  new: 'Not opened yet',
  opened: 'Opened',
  redirected: 'Handed off',
  skipped: 'Skipped',
  applied: 'Applied',
};
