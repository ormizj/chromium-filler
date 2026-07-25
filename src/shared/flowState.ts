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
  redirect?: { host?: string; followed: boolean };
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
  external: 'accent',
  externalOpened: 'accent',
  noButton: 'warn',
  noConfirmation: 'warn',
  ready: 'quiet',
  empty: 'quiet',
};

/** The longer explanation each blocked state discloses. */
const HELP: Partial<Record<FlowKey, ConceptKey>> = {
  noButton: 'apply',
  noConfirmation: 'applyUnverified',
  external: 'twoStep',
  externalOpened: 'twoStep',
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
  if (input.redirect) return input.redirect.followed ? 'externalOpened' : 'external';
  // Blocked beats empty, and the order matters. A listing page has no fields
  // *and* no Send button, and the question its greyed Apply provokes is still
  // "why can't I apply?" — answering "nothing to fill here" instead leaves a
  // dead-looking control unexplained, which is the failure this whole banner
  // exists to prevent.
  if (input.applyState !== 'ready') return input.applyState;
  // So `empty` is the narrower case it should always have been: a page the
  // extension *could* apply on, whose fields it did not recognise.
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
  if (key === 'ready') return `${input.filled} of ${input.total} fields filled — ${base}`;
  return base;
}
