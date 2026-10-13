/**
 * Where a page is, decided in one place — the review card's banner renders from
 * this and from nothing else.
 *
 * There is far less to decide than there was. The extension no longer sends
 * anything, follows anything or waits for a confirmation, so every state is about
 * the filling: done and waiting for the user to submit on the site, nothing
 * recognised yet, nothing in the profile to fill with — or a posting the job
 * database already has down as done.
 */

import { FLOW_TEXT, type FlowKey } from './labels';
import type { ConceptKey } from './help';

export type FlowTone = 'ok' | 'warn' | 'accent' | 'quiet';

export interface FlowInput {
  /** The job database already has this URL down as `done`. */
  alreadyDone?: boolean;
  /** When it was marked done, if the log says. */
  doneAt?: number;
  /** The profile has nothing at all to fill with — no details, no CV, no own fields. */
  profileEmpty?: boolean;
  /** Rows in the report, rows that took a value, rows nothing recognised. */
  total: number;
  filled: number;
  toTeach: number;
  /** For the sentence — the page's host. */
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
  alreadyDone: 'ok',
  ready: 'quiet',
  nothing: 'quiet',
  empty: 'quiet',
};

const HELP: Partial<Record<FlowKey, ConceptKey>> = {
  alreadyDone: 'alreadyDone',
  nothing: 'teaching',
  ready: 'neverSubmits',
};

export function flowBanner(input: FlowInput): FlowBanner {
  const key = classify(input);
  const words = FLOW_TEXT[key];
  return {
    key,
    tone: TONES[key],
    title: words.title,
    detail: detail(key, words.detail, input),
    help: HELP[key],
  };
}

function classify(input: FlowInput): FlowKey {
  // A record of the posting being done outranks anything about this visit's fill.
  if (input.alreadyDone) return 'alreadyDone';
  // Only the profile can cause this, so it is worded about the profile — never
  // "no form was found", which blamed the site.
  if (input.profileEmpty) return 'empty';
  // Questions on the page and none of them recognised: an invitation to teach,
  // not a failure.
  if (input.total > 0 && input.filled === 0 && input.toTeach === input.total) return 'nothing';
  return 'ready';
}

function detail(key: FlowKey, base: string, input: FlowInput): string {
  if (key === 'alreadyDone') {
    // The date only when the entry carries one; a sentence with "undefined" in it
    // is worse than no date.
    const when = input.doneAt ? ` on ${new Date(input.doneAt).toLocaleDateString()}` : '';
    return `${input.siteName ?? 'This posting'} ${base.replace('{when}', when)}`;
  }
  if (key === 'ready') {
    const teach = input.toTeach ? ` · ${input.toTeach} to teach` : '';
    return `${input.filled} filled${teach} — ${base}`;
  }
  return base;
}
