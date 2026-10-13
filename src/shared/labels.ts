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
import type { SelectorStrength } from './selector';

export interface StatusText {
  /** Capitalised, for the stat-tile caption: "Filled" / "To check" / "To teach". */
  tile: string;
  /** Lower-case chip/legend/summary word: "filled" / "to check" / "to teach". */
  word: string;
  /** The spoken descriptor for a dot's `aria-label` — a touch more explicit. */
  aria: string;
}

/**
 * The three outcomes of an input, worded once. `high` is an answer that is in the
 * box; `low` is a guess, or a match with nothing to fill it with (Confirm it, or
 * add a value); `none` is a question nothing recognised — which is not a failure
 * any more but an invitation: it is the row the user teaches.
 */
export const STATUS_TEXT: Record<MatchConfidence, StatusText> = {
  high: { tile: 'Filled', word: 'filled', aria: 'filled' },
  low: { tile: 'To check', word: 'to check', aria: 'needs review' },
  none: { tile: 'To teach', word: 'to teach', aria: 'not recognised' },
};

/**
 * Where the page is, as the card's banner says it. `shared/flowState.ts` decides
 * which; this is what each is called. There is no sending any more — the user
 * presses the site's own button — so the states are only about the filling, and
 * about whether this posting was already done with.
 */
export type FlowKey = 'alreadyApplied' | 'ready' | 'nothing' | 'empty';

export interface FlowText {
  title: string;
  detail: string;
}

export const FLOW_TEXT: Record<FlowKey, FlowText> = {
  // `{when}` is filled by `flowBanner`, or removed on an entry with no date.
  alreadyApplied: {
    title: 'Already applied',
    detail: 'is recorded as applied{when}. The form was filled again anyway — change the status in Options → Queue if that record is wrong.',
  },
  // The resting state: the extension's part is done and the rest is the user's.
  // It names the site's own button because that is the one thing left, and the one
  // thing the extension will never do.
  ready: { title: 'Filled — submit on the site when you are ready', detail: 'Nothing is ever sent for you.' },
  // A page with inputs, none of them recognised. Not a failure: the rows below are
  // the questions to teach, and the sentence says so.
  nothing: { title: 'Nothing recognised yet', detail: 'Teach the questions below once, and they fill on every site from then on.' },
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
  | 'confirm'
  | 'confirmed'
  | 'cancel'
  | 'pick'
  | 'wider'
  | 'deeper'
  | 'done'
  | 'openOptions'
  | 'more'
  | 'fullscreen'
  | 'exitFullscreen'
  | 'teach'
  | 'taught'
  | 'notThis'
  | 'save'
  | 'ignore'
  | 'ignored'
  | 'newField';

export const ACTION_LABELS: Record<ActionKey, string> = {
  skip: 'Skip',
  skipNext: 'Skip → next',
  rerun: 'Re-run',
  // The footer's one visible action. "Fill again" rather than "Re-run": it is what
  // the press does to the page, and it never writes over an answer already there.
  fillAgain: 'Fill again',
  confirm: 'Confirm',
  // The retired form of the verb above. The report does not re-sort itself when a
  // row is confirmed, so this label is the acknowledgement that the press landed.
  confirmed: 'Confirmed ✓',
  cancel: 'Cancel',
  pick: 'Pick',
  // Travelling through the elements at one point: the picker starts on the box
  // around the thing and steps inward.
  wider: 'Wider',
  deeper: 'Deeper',
  done: 'Done',
  openOptions: 'Options',
  more: '⋯',
  // Icon-only in the card header, so these are read aloud rather than shown.
  fullscreen: 'Fullscreen',
  exitFullscreen: 'Exit fullscreen',
  // A row's way in to teaching, and its retired form — paired the way `confirm` is
  // with `confirmed`. Rows hold still, so the label is what says the lesson took.
  teach: 'Teach',
  taught: 'Taught ✓',
  // A recognised row that is wrong. Opens the same chooser Teach does: correcting a
  // match and teaching a new one are the same act, a lesson about one input.
  notThis: 'Not this',
  save: 'Save',
  // The chooser's third answer: this question is not one to fill. Named for what
  // happens to the question, not for what happens to the row.
  ignore: 'Ignore this question',
  ignored: 'Ignored',
  // The chooser's way to make a field on the spot. The ellipsis is real: it opens
  // two more boxes in the row.
  newField: 'New field…',
};

/**
 * The queue chip's words. Built, not looked up — it carries the position.
 * Short on purpose: it sits in a corner of somebody else's page.
 */
export function queueChipText(done: number, total: number): string {
  return total > 0 ? `Queue · ${done}/${total}` : 'Queue';
}

/**
 * How much a selector is worth, in words. A strength is drawn as a status dot, and
 * status is never colour alone — so each one needs a word for the row and a fuller
 * phrase for the dot's accessible name, exactly like `STATUS_TEXT`.
 */
export const SELECTOR_STRENGTH_TEXT: Record<SelectorStrength, { word: string; aria: string }> = {
  strong: { word: 'reliable', aria: 'reliable — identified by name' },
  ok: { word: 'usable', aria: 'usable — identified by where it sits' },
  fragile: { word: 'fragile', aria: 'fragile — identified only by its position' },
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
  markedDone: 'Marked done',
  applied: 'Applied',
};
