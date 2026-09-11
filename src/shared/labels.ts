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
import type { ConfigBindKey, MarkGroupId, RecordLeg, RecordPhase } from './recording';
import type { SelectorStrength } from './selector';
import type { RowStatus } from './setupSteps';

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

export interface SetupStatusText {
  /** The count line's word: "5 found" / "2 to check" / "9 not on this page". */
  word: string;
  /** Appended to an on-page chip, or empty where the label alone says it. */
  chip: string;
  /** The spoken descriptor for a dot's `aria-label`, exactly as above. */
  aria: string;
}

/**
 * The same three outcomes, worded for **setting a site up** rather than for a
 * fill — and the reason they need their own words is `none`.
 *
 * `detectFields` returns one row per *wanted* field, so on the setup surfaces a
 * `none` means the page never asked for that field. That is the ordinary state of
 * most of the sixteen on any real form, and it is exactly the rule
 * `setupSteps.fields` encodes when it counts only the CV as work. Borrowing
 * `STATUS_TEXT.none.word` here would put "9 unmatched" on a healthy page — the
 * cry-wolf failure the whole step model is written against, and the same mistake
 * `FLOW_TEXT.empty` used to make by blaming the site for an empty profile.
 *
 * `high`/`low` differ too, in tense: nothing has been filled yet on this screen.
 */
export const SETUP_STATUS_TEXT: Record<RowStatus, SetupStatusText> = {
  high: { word: 'found', chip: '', aria: 'found on this page' },
  low: { word: 'to check', chip: 'check', aria: 'found, needs checking' },
  none: { word: 'not on this page', chip: '', aria: 'not on this page' },
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
  | 'finishSetup'
  | 'finishSetupSaved'
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
  // set the confirmation, only for Apply to stay grey with a new complaint. So it
  // names the surface that fixes both halves rather than one row: it used to send
  // the user to the wizard's Sending step, which is not a place an unrecorded site
  // can be reached from at all.
  noConfirmation: {
    title: 'Apply is unavailable here',
    detail: 'This site has no confirmation element set, so a result cannot be read back. Open Site setup and record this site — the first pass marks the Send button, and “Mark the confirmation” captures the message the site shows back.',
  },
  /**
   * The one state here that is not a report but an offer.
   *
   * It is `noConfirmation` with a way out. The site fills and its Send button is
   * known; the only thing missing is the element that says an application landed, and
   * that element does not exist until one has. So this says what pressing Apply will
   * do *before* it does it — send this application, then ask where the site's answer
   * is — because a button that quietly starts a second job is worse than a grey one.
   */
  finishSetup: {
    title: 'Set up to fill, not yet to confirm',
    detail: 'Apply sends this application and then asks you to point at the message the '
      + 'site shows back — or send it yourself and mark that message when it appears. '
      + 'Either way, it is the last thing this site needs.',
  },
  /**
   * The same offer, at the one moment it answers something the user just did.
   *
   * A first pass ends by writing a config that can fill this site and knows what
   * sends it, and it leaves exactly one thing outstanding — which is why the card is
   * put in front of the user right then. So it leads with the press that got here
   * rather than with the site, exactly as `alreadyApplied` leads with the record and
   * `applied` with the moment. Two moments, one consequence, two keys.
   */
  finishSetupSaved: {
    title: 'Site setup saved — one thing left',
    detail: 'This site still needs the message it shows once an application has really '
      + 'gone in, and that only exists after one has. Apply sends this application and '
      + 'then asks you to point at the reply — or send it yourself and mark the reply '
      + 'when it appears.',
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
  | 'backToHome'
  | 'stopRecording'
  | 'resetRecording'
  | 'resetRecordingConfirm'
  | 'interact'
  | 'interactArmed'
  | 'declare'
  | 'moveBarToBottom'
  | 'moveBarToTop'
  | 'applyFinishSetup'
  | 'sendItMyself'
  | 'notTheSendButton'
  | 'notYet'
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
  // The setup panel's way back out of the six-step wizard, and icon-only for the
  // same reason those two are: it sits in the header, where there is room for a
  // mark and none for a word. Named for where it *goes* rather than "Back" — the
  // footer already carries a Back, and that one walks one step; this one walks the
  // whole screen. Two controls a card apart both reading "Back" is the drift this
  // catalog exists to stop.
  backToHome: 'Back to Site setup',
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
  //
  // Its ellipsis is deliberate and is *not* the one `declare` used to carry: here
  // it means "waiting for you", there it meant "opens a further choice" — and the
  // choice is the menu that drops open under the button, so the mark said nothing
  // the press did not already show. Do not make these two match.
  interactArmed: 'Click one thing…',
  declare: 'Declare',
  // Where the toolbar will go if this is pressed, never where it is now: the
  // button is a move, so it is named for its destination. Drawn as an icon, so
  // these two strings are the whole of what a screen reader gets.
  moveBarToBottom: 'Move the toolbar to the bottom of the page',
  moveBarToTop: 'Move the toolbar to the top of the page',
  // Apply, plus what else this particular press is going to do. The extra half is
  // not decoration: this is the one Apply that starts a second job after sending,
  // and the vocabulary rule ("our action is Apply") is kept by leading with the verb.
  applyFinishSetup: 'Apply · finish setup',
  // The other answer to the same question, and it has to be a *visible* control:
  // the one thing this site still needs is the message it shows after an
  // application, and a user who would rather press Send themselves has to be able
  // to see that doing so still finishes the setup. Named for the user's half of it
  // — the extension's half (watch for the reply, and ask) is unchanged either way.
  sendItMyself: 'I’ll send it myself',
  // The way out of a held press. `looksLikeSend` matches "apply" and "finish", and on
  // most boards the button that *opens* the form says "Apply now" — so the guess has
  // to be refusable in one press, or the first pass cannot be run on those sites at
  // all. Worded as the user's correction, not as an override.
  notTheSendButton: 'Not the Send button — press it',
  // Standing the after-sending pass down. Not "Cancel": nothing is being abandoned,
  // and the site keeps everything the first pass taught it.
  notYet: 'Not yet',
  // What a step is when it is nothing else. The bar has no use for it any more —
  // a step is now precisely what Interact produces — but the review's bind select
  // still needs a word for its empty option, and it is the same word.
  keepAsClick: 'Keep as a step',
  undo: 'Undo',
  // The bar's third exit, and the only one that cannot be walked back: Undo is a step
  // at a time, Done ends the recording, and this throws every step away and takes the
  // page back to the posting. Named for the button the user asked for rather than for
  // "start over", which is what the confirm behind it says.
  resetRecording: 'Reset',
  // The confirm's own verb, more specific than the control it hangs off — the same
  // shape as Options → Queue's `Clear all` → `Delete`. Repeating "Reset" here would
  // make the popover look like the button had simply moved.
  resetRecordingConfirm: 'Start over',
  saveRecording: 'Save setup',
  discardRecording: 'Discard',
};

/* ---------------- The two ways to set a site up by doing it once ---------------- */

/**
 * The two passes, named once, for every surface that draws one.
 *
 * Setting a site up follows the application, and an application has two halves. That
 * split is now the shape of the setup panel's home screen, of the recorder bar's two
 * shapes, and of the rule deciding what may be declared where (`marksFor`) — so the
 * words for it have to be in one place or the three will disagree. They were in
 * none: "Before sending" and its paragraph were written inline into
 * `setupPanel.passes()`, a second time into its saved screen, and the bar's own
 * `aria-label` said something different again.
 *
 * `Record<RecordPhase, …>`, so a third pass cannot ship unnamed — the same guard
 * `SETUP_STEP_TITLES` gives the wizard's steps.
 *
 * This replaces `RECORD_FLOW_TEXT`, which asked the user a third question — "does
 * this posting apply here or on the employer's site?" — that they usually cannot
 * answer and that `compileRecording` then overruled anyway (rule 1). The classifier
 * on the page already knows, so the recording takes its hint from there and the
 * screen asks about the passes instead.
 */
export const RECORD_PASS_TEXT: Record<RecordPhase, {
  /** The pass's name, on the home screen and in the review. */
  name: string;
  /** What it is and what it costs — the button's caption as much as the block's. */
  lead: string;
  /** The control that starts it. */
  action: string;
  /**
   * The same control once this pass has already produced something.
   *
   * A pass can be wrong as well as missing — a confirmation captured off the wrong
   * banner, a recording that identified the Send button as the "Save job" beside it —
   * so both blocks keep a way back in once they are settled. It is a separate word
   * rather than the same one because "Record the first pass" on a site that has
   * already been recorded reads as though nothing was saved.
   *
   * Here and not in `ACTION_LABELS` for the reason `markConfirmation` is: it is one
   * pass's own verb, and the same label in two catalogs is the drift this file exists
   * to stop.
   */
  again: string;
  /** The recorder bar's toolbar name while this pass runs. Spoken, never shown. */
  aria: string;
}> = {
  beforeSend: {
    name: 'Before sending',
    // "Nothing is submitted" is the fact people were right to hesitate over, and it
    // has to be in the caption rather than behind a `?`: the honest reading of "apply
    // to one job while it watches" is that an application is about to go out.
    lead: 'Apply as you normally would and say what you are doing. It ends by marking '
      + 'the button that sends it — pointed at, not pressed. Nothing is submitted.',
    action: 'Record the first pass',
    again: 'Record it again',
    aria: 'Recording this site',
  },
  afterSend: {
    name: 'After sending',
    lead: 'The message this site shows once an application has really gone in. It '
      + 'does not exist until then, so it is captured the first time you press Apply.',
    action: 'Mark the confirmation',
    again: 'Mark it again',
    aria: 'Finishing this site’s setup',
  },
};

/**
 * What the recorder bar says in the space where it usually reports the last step.
 *
 * Here for the reason `AFTER_SEND_ASK` is: these are the recorder's own sentences,
 * and a sentence written inline in the surface that draws it is the drift this file
 * exists to stop.
 *
 * `armed` is the loudest thing on the bar. While a gesture is armed the whole
 * toolbar takes the accent skin and every control but one is blocked, so this line
 * is the statement of the mode in words — colour is never the only signal, and the
 * second half of it is what says the rest of the bar is standing down.
 *
 * One sentence for `armed` and `live` alike: the difference between "waiting for a
 * click" and "you are typing into a field" is the recorder's business, and both mean
 * the same thing to the user — the page is theirs for one gesture.
 *
 * **Keep `armed` short enough to hold one line on a 720px bar.** `.cf-rec-what` is a
 * two-line clamp whose second line is reserved only under 640px, deliberately, so a
 * sentence that wraps up there changes the bar's height the instant the page goes
 * live — and on a bottom-docked bar that lifts every button out from under the thumb.
 */
export const RECORDER_READOUT: Record<'armed' | 'start' | 'element', string> = {
  armed: 'The page is live for one click — use it as you normally would. Nothing else here acts.',
  start: 'Interact to use the page, Declare to name something on it.',
  // The readout's fallback name for a step that has neither a label nor a selector.
  element: 'that element',
};

/**
 * The one thing the after-sending bar has to say, and there are two of them because
 * the pass has two doors.
 *
 * Through Apply the application has already gone in, and the bar is explaining a page
 * that changed under the user a moment ago. Through `I’ll send it myself` — or the
 * panel's own `Mark the confirmation` — nothing has been sent yet, and the same
 * sentence would be a plain untruth: the user is being asked to press the site's own
 * button and come back. That second wording is what the by-hand route has always
 * lacked.
 *
 * Here rather than inline in `recorderBar.ts` for the reason everything else in this
 * file is: it is the only copy on the surface, and the surface is one line long.
 */
export const AFTER_SEND_ASK: Record<'sent' | 'unsent', string> = {
  sent: 'Your application went in. Point at the message the site shows back, and '
    + 'this site is finished.',
  unsent: 'Send this application yourself when you are ready. The moment the site '
    + 'answers, point at its message and this site is finished.',
};

/**
 * What Reset is about to do, in words, before it does it.
 *
 * The one line of prose in this file, and the only thing here that is built rather
 * than looked up: it counts what is going, and it has to say a *different* thing on
 * each leg because Reset does a different thing on each. On the posting it is a
 * reload; on the employer's site it is a walk back to the board, which means leaving
 * the page the user is looking at — and a warning that does not mention that is not a
 * warning.
 *
 * It lives here rather than in `help.ts` because it is wording, not explanation: the
 * long form of why recording works this way is `CONCEPT_HELP.recording`.
 */
export function resetRecordingPrompt(stepCount: number, leg: RecordLeg): string {
  const steps = `${stepCount} step${stepCount === 1 ? '' : 's'}`;
  return leg === 'destination'
    ? `Discard ${steps} and start again on the posting? This page will be left.`
    : `Discard ${steps} and record this site again? The page reloads.`;
}

/**
 * Why the button the user just pressed did nothing.
 *
 * The first pass cannot send: the only moment the Send button can be pointed at is
 * *before* it is pressed, and pressing it is what ends the page it lives on. So a
 * press that looks like a send is held, marked, and explained — and it has to be
 * explained here and now, or the user presses it four more times and concludes the
 * extension is broken.
 *
 * Built rather than looked up, like `resetRecordingPrompt`, because naming the
 * control back to the user is most of what makes it legible as a decision about
 * *that* button rather than a rule about buttons in general.
 */
export function heldSendNotice(label: string): string {
  const name = label.trim() ? `“${label.trim()}”` : 'That button';
  return `${name} looks like the button that sends this application, so it was marked `
    + 'as the Send button rather than pressed. Sending happens in the second pass.';
}

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
 * The heads the marks are read under. `Record<MarkGroupId, …>`, so a fifth kind of
 * mark cannot ship unnamed — the same rule as `BIND_LABELS` above it.
 *
 * The first two are why there is more than one head. Sending the application from
 * this page and handing it off to the employer are opposite answers to the same
 * question, and under one head the four marks read as a list of interchangeable
 * things to point at. The words echo the distinction the wizard's `kind` step
 * already draws in `REDIRECT_GROUPS`; they are shorter here because a menu item is
 * read on the way past, not as a conclusion.
 */
export const MARK_GROUP_TEXT: Record<MarkGroupId, string> = {
  sending: 'Applying on this page',
  leaving: 'Applying on the employer\u2019s site',
  info: 'What the posting says',
  fields: 'Form fields',
};

/**
 * Why a field that was just declared is still empty.
 *
 * Declaring a field fills it, which is the whole point — a wrong box is obvious the
 * moment the wrong value lands in it. So a box that stays empty has to say why, or
 * the one feature that proves the pick worked reads as the pick having failed.
 * Built rather than looked up, for `heldSendNotice`'s reason: it is about *that*
 * field, and naming it back is most of what makes it actionable.
 */
export function emptyProfileNotice(label: string): string {
  return `Marked as “${label}”, but there is nothing in your profile to put there yet. `
    + 'Options → Profile is where that is filled in; the mark is saved either way.';
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
  applied: 'Applied',
};
