/**
 * Which step of the one flow a posting is in — and therefore what the review
 * modal's banner says.
 *
 * The modal used to decide this inline, in three places that did not know about
 * each other: an `applied` banner at the top of the body, a `redirect` notice a
 * few lines further down, and a note about the greyed-out Apply button that only
 * existed *after* the user pressed it. The result was a card that, at rest, said
 * nothing at all about what had happened or what to press — the complaint this
 * module exists to fix.
 *
 * Pure and unit-tested, like every decision in `shared/`. The words come from
 * `labels.FLOW_TEXT`; only the choosing and the interpolation happen here.
 */

import { FLOW_TEXT, type FlowKey } from './labels';
import type { ConceptKey } from './help';

/**
 * Whether Apply can run here. The two failures are kept apart because they need
 * different answers from the user: find the button, or teach the site what its
 * confirmation looks like. One shared "unavailable" told them neither.
 *
 * Lives here rather than in `content/modal/modal.ts` because it is now an input
 * to a pure decision; the modal re-exports it so its callers are unaffected.
 */
export type ApplyState = 'ready' | 'noButton' | 'noConfirmation';

/**
 * How loud the banner is. Deliberately not a colour: `ok`/`warn`/`accent` map to
 * the shared status tints and `quiet` to plain muted text, so a state can be
 * re-toned without any surface learning a new colour name.
 */
export type FlowTone = 'ok' | 'warn' | 'accent' | 'quiet';

export interface FlowInput {
  applyState: ApplyState;
  /** The site's own confirmation appeared — this posting really was sent. */
  applied?: boolean;
  /**
   * The job database already had this URL down as `applied` before this visit.
   *
   * Kept apart from `applied` rather than folded into it because the two are true
   * of different moments and so cannot share a sentence: one is a receipt for
   * something that just happened, the other is a record being read back. They do
   * share their consequence — neither posting has a decision left to take.
   */
  alreadyApplied?: boolean;
  /** When that record says the application went in, if the entry carries it. */
  appliedAt?: number;
  redirect?: { host?: string; followed: boolean };
  /**
   * This page's apply control hands off to a phone app with no web form to reach
   * instead, so it was left alone (`content/redirectDetect.ts`, `appLink`).
   */
  appLink?: boolean;
  /** Fields that took a value, and fields detected in total. */
  filled: number;
  total: number;
  siteName?: string;
}

export interface FlowBanner {
  key: FlowKey;
  tone: FlowTone;
  title: string;
  detail: string;
  /** The catalog entry behind this banner's `?`, when there is more to say. */
  help?: ConceptKey;
}

const TONES: Record<FlowKey, FlowTone> = {
  applied: 'ok',
  alreadyApplied: 'ok',
  // `warn`, not `accent`: unlike a two-step posting, nothing is being followed —
  // there is a control on the page the extension cannot use.
  appLink: 'warn',
  external: 'accent',
  externalOpened: 'accent',
  noButton: 'warn',
  noConfirmation: 'warn',
  ready: 'quiet',
  empty: 'quiet',
};

/** The longer explanation each blocked state discloses. */
const HELP: Partial<Record<FlowKey, ConceptKey>> = {
  // Both applied states, because both retire Apply *and* Skip. A control that has
  // gone grey needs somewhere to say why, and until now the confirmed state had
  // nothing behind it because nothing there was blocked.
  applied: 'alreadyApplied',
  alreadyApplied: 'alreadyApplied',
  noButton: 'apply',
  noConfirmation: 'applyUnverified',
  external: 'twoStep',
  externalOpened: 'twoStep',
  appLink: 'appLink',
};

/**
 * The order of these branches is the whole design. A confirmed application is
 * the entire answer and outranks everything — including a two-step posting,
 * whose destination was where it was sent from, and including a blocked Apply,
 * which cannot be true any more once something went through.
 */
export function flowBanner(input: FlowInput): FlowBanner {
  const key = classify(input);
  const words = FLOW_TEXT[key];
  return {
    key,
    tone: TONES[key],
    title: title(key, words.title, input),
    detail: detail(key, words.detail, input),
    help: HELP[key],
  };
}

function classify(input: FlowInput): FlowKey {
  if (input.applied) return 'applied';
  // Directly below it, and above everything else for the same reason `applied` is:
  // once a posting is on record as done, a pending handoff or a blocked Apply
  // cannot still be the useful answer. Below `applied` because a confirmation that
  // arrived just now is the more specific truth about the page on screen — and it
  // is the one that earns the live announcement.
  if (input.alreadyApplied) return 'alreadyApplied';
  // Above the redirect branch, because a *configured* apply control can be both:
  // the site is marked two-step and its link turns out to open an app. "Opening
  // the employer's application" would then be a plain lie — nothing was opened —
  // so the specific failure has to win. Below `applied` like everything else: an
  // unusable apply link cannot still be the answer once something went through.
  if (input.appLink) return 'appLink';
  if (input.redirect) return input.redirect.followed ? 'externalOpened' : 'external';
  // Blocked beats empty, and the order matters. A listing page has no fields
  // *and* no Send button, and the question its greyed Apply provokes is still
  // "why can't I apply?" — answering "nothing to fill here" instead leaves a
  // dead-looking control unexplained, which is the failure this whole banner
  // exists to prevent.
  if (input.applyState !== 'ready') return input.applyState;
  // `total` is the number of rows in the report, and `main.ts` builds one per
  // field it has something to fill *with* (`wantedFields`) — so this is not "the
  // page had no form". It is "the profile is empty": a page whose fields all went
  // unrecognised still reports a row each and falls through to `ready` below.
  // `FLOW_TEXT.empty` is worded for that, and only that.
  if (input.total === 0) return 'empty';
  return 'ready';
}

function title(key: FlowKey, base: string, input: FlowInput): string {
  const host = input.redirect?.host;
  // Only name the host when the detector actually resolved one; the generic
  // wording is the fallback, rather than a sentence with "undefined" in it.
  if (key === 'external' && host) return `Applies on ${host}`;
  if (key === 'externalOpened' && host) return `Opening ${host}`;
  return base;
}

function detail(key: FlowKey, base: string, input: FlowInput): string {
  if (key === 'applied') return `${input.siteName ?? 'The site'} ${base}`;
  if (key === 'alreadyApplied') {
    // The date only when the entry actually carries one — `appliedAt` is stamped
    // by `applyStatus`, so a posting marked applied by hand before that existed
    // has none, and a sentence with "undefined" in it is worse than no date. The
    // slot is mid-sentence rather than appended, because the date is a fact about
    // the record and not about the buttons the clause ends on.
    const when = input.appliedAt ? ` on ${new Date(input.appliedAt).toLocaleDateString()}` : '';
    return `${input.siteName ?? 'This posting'} ${base.replace('{when}', when)}`;
  }
  if (key === 'ready') return `${input.filled} of ${input.total} fields filled — ${base}`;
  return base;
}
