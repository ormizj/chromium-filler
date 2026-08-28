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
import type { ConfigBindKey } from './recording';
import type { SelectorStrength } from './selector';

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
  | 'alreadyApplied'
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
  // The same posting, opened again later. It cannot borrow the line above:
  // nothing was confirmed on *this* page-load, and claiming otherwise would put a
  // live announcement on a page where nothing happened. What it does share is the
  // consequence — Apply and Skip are both retired — so that is what it leads with.
  // `{when}` is the one interpolation slot in this file that is not an append:
  // the date belongs to "recorded as applied", and tacked on the end it read as
  // "…are retired here on 5/12/2026". `flowBanner` fills it, or removes it on an
  // entry with no `appliedAt`.
  alreadyApplied: {
    title: 'Already applied',
    detail: 'is recorded as applied{when}, so Apply and Skip are retired here.',
  },
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
  // `applyState` tests the confirmation *before* the button, so a site missing
  // both only ever reaches this one — and the old wording sent the user off to
  // set the confirmation, only for Apply to stay grey with a new complaint. Both
  // rows live on the same step, so naming the step rather than the row costs a
  // word and ends the second trip.
  noConfirmation: {
    title: 'Apply is unavailable here',
    detail: 'This site has no confirmation element set, so a result cannot be read back. Set it under Site setup → Sending, along with the Send button if that is unset too.',
  },
  ready: { title: 'Filled — nothing has been sent yet', detail: 'ready to review' },
  // Not "no form was found here". This state is reached when the *report* has no
  // rows, and `main.ts` builds one row per field it has something to fill with —
  // so zero rows means an empty profile and nothing else. A page whose fields all
  // went unrecognised still reports a row each and lands on `ready`. The old
  // wording blamed the site for the one thing only the profile can cause, on the
  // run the getting-started checklist walks every new user through.
  empty: {
    title: 'Nothing to fill with yet',
    detail: 'Your profile is empty — add your details and your CV in Options → Profile.',
  },
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
  | 'confirm'
  | 'confirmed'
  | 'cancel'
  | 'pick'
  | 'wider'
  | 'deeper'
  | 'done'
  | 'openOptions'
  | 'more'
  | 'openApplication'
  | 'openApplicationAgain'
  | 'fillAnyway'
  | 'siteSetup'
  | 'fullscreen'
  | 'exitFullscreen'
  | 'record'
  | 'recordExternal'
  | 'stopRecording'
  | 'interact'
  | 'interactArmed'
  | 'declare'
  | 'keepAsClick'
  | 'undo'
  | 'saveRecording'
  | 'discardRecording';

export const ACTION_LABELS: Record<ActionKey, string> = {
  apply: 'Apply',
  applied: 'Applied ✓',
  skip: 'Skip',
  skipNext: 'Skip → next',
  rerun: 'Re-run',
  confirm: 'Confirm',
  // The retired form of the verb above, paired with it the way `applied` is with
  // `apply`. The report is a record of the last fill and does not re-colour itself
  // when a single row is confirmed, so this label is the only thing on the card
  // that says the press landed.
  confirmed: 'Confirmed ✓',
  // The picker's own way out. It had been a string literal in `picker.ts` since the
  // beginning, which left the one toolbar the user reads while aiming at a page
  // outside the catalog this file exists to be.
  cancel: 'Cancel',
  pick: 'Pick',
  // Travelling through the elements at one point: the picker starts on the box
  // around the thing and steps inward. Named for what changes — how much of the
  // page the selection covers — rather than for the direction of the arrow, which
  // is up on a rail and down in a tree depending on who is drawing it.
  wider: 'Wider',
  deeper: 'Deeper',
  done: 'Done',
  // One word, like every other secondary action. "Open options" named the verb
  // as well as the destination, which nothing else in the menu does — every item
  // in it opens something.
  openOptions: 'Options',
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
  // The two ways to set a site up by doing it once. They name *where the
  // application gets made*, not what the extension will do, because that is the
  // question the user can actually answer while looking at the posting.
  record: 'Apply on this site',
  recordExternal: 'Apply on the employer’s site',
  // "Done", not "Stop": the user has finished applying, which is a thing they did,
  // not a recording they are operating.
  stopRecording: 'Done',
  // The two things a recording can be told to do, and the whole of the bar's
  // middle. They are named for what the *user* is doing, not for what the
  // extension will do with it: "Interact" is using the page, "Declare" is saying
  // what something is. Neither is the default — while neither is chosen the page
  // is inert, which is what stops an idle click becoming a step replayed on every
  // later visit.
  interact: 'Interact',
  // The armed form of the verb above, paired with it the way `applied` is with
  // `apply`. It has to name what the extension is now waiting for, because the
  // page has just gone live under the user's finger and nothing else says so.
  interactArmed: 'Click one thing…',
  declare: 'Declare…',
  // What a step is when it is nothing else. The bar has no use for it any more —
  // a step is now precisely what Interact produces — but the review's bind select
  // still needs a word for its empty option, and it is the same word.
  keepAsClick: 'Keep as a step',
  undo: 'Undo',
  saveRecording: 'Save setup',
  discardRecording: 'Discard',
};

/* ---------------- What a recorded element can be marked as ---------------- */

/**
 * The names of the things a recording can point at. `Record<ConfigBindKey, …>`, so a
 * new slot in the model cannot ship without a word for it — the same rule as
 * `ACTION_LABELS` and for the same reason: this is read in the recorder's menu, in
 * the review timeline and in the setup panel, and three spellings of "the button
 * that sends it" is exactly the confusion the vocabulary rule exists to stop.
 *
 * The profile fields are not here: they already have `FIELD_LABELS` in
 * `fieldKeys.ts`, and a second list of the same sixteen words would be the drift
 * this file prevents everywhere else.
 */
export const BIND_LABELS: Record<ConfigBindKey, string> = {
  jobTitle: 'Job title',
  jobDescription: 'Description',
  jobRequirements: 'Requirements',
  company: 'Company',
  location: 'Location',
  employmentType: 'Employment type',
  // The extension's action is "Apply"; the site's control is "the Send button". Two
  // objects, and the distinction is load-bearing everywhere else in the product.
  submit: 'Send button',
  success: 'Confirmation',
  applySelector: 'External apply link',
  quickApplySelector: 'Quick-apply marker',
  markerSelector: 'External marker',
};

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
  applied: 'Applied',
};
