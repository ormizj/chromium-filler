/**
 * What the extension learns from an answer the user typed — pure.
 *
 * There is no Teach button any more. When the user commits an answer (a trusted
 * `change`, i.e. on blur after an edit), the engine asks which profile fields would
 * have produced that same answer, and this file decides what that means:
 *
 *   one field holds it       a lesson: this question is that field, everywhere
 *   no field holds it        a *record* — counted, listed in Options, never filled
 *   it replaced our fill     a *correction*: the field we filled now holds what the
 *                            user typed, in the profile (the card offers Undo)
 *
 * A lesson only ever links a question to a value the user already keeps in their
 * profile. Text the user typed into a box we did not fill is never filled anywhere
 * on the strength of having been typed — that is what the records are for, and they
 * wait for the user. Typing over our own fill is different: it is the user's word on
 * the value we chose, and changing "Joe" to "John" means the profile was wrong.
 */

import type { FieldId, InputKind, LessonTarget, MatchConfidence, Settings } from './types';

/** Longer than this is prose, not a reusable answer — never recorded. */
export const MAX_RECORDED_LENGTH = 120;

/** Kinds whose answers are never recorded: emails and chat on other sites are prose. */
const UNRECORDED = new Set<InputKind>(['textarea', 'editable', 'file', 'checkbox']);

/**
 * Answers that say too little to identify a question. "Yes" equals a dozen yes/no
 * fields, and a lesson linking "Are you over 18?" to "Willing to relocate?" because
 * both happened to be Yes fills the wrong answer the day one of them changes.
 */
const LOW_ENTROPY = new Set(['yes', 'no', 'y', 'n', 'true', 'false', 'on', 'off', 'none', 'other', 'n/a', 'na']);

export interface LearningPolicy {
  /** Link a question to the profile field the user's answer equals. */
  lessons: boolean;
  /** Count answers no field holds, for Options → "Answers you've typed". */
  records: boolean;
  /** A value typed over our fill replaces the field's value in the profile. */
  corrections: boolean;
}

/** The one place the learning settings are read. */
export function learningPolicy(settings: Settings): LearningPolicy {
  return {
    lessons: settings.learnFromTyping,
    records: settings.rememberTypedAnswers,
    corrections: settings.updateProfileFromEdits,
  };
}

export interface LearnInput {
  kind: InputKind;
  /** What the input holds now: its text, the chosen option's label, a file's name. */
  value: string;
  /** The fields whose stored value would have produced this same answer. */
  matches: readonly FieldId[];
  /** The row before the user's edit. */
  before: {
    field?: FieldId;
    confidence: MatchConfidence;
    /** We wrote into it. */
    filled: boolean;
    /** What we wrote, when we did. */
    filledValue?: string;
  };
}

export interface Decision {
  lesson?: LessonTarget;
  /** Count this answer; `field` is the field it was typed over, when it was. */
  record?: { field?: FieldId };
  /** The user corrected our fill: this field's profile value becomes the answer. */
  update?: { field: FieldId };
}

export function normalizeAnswer(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function isDistinctive(value: string): boolean {
  const n = normalizeAnswer(value);
  if (n.length < 3) return false;
  if (LOW_ENTROPY.has(n)) return false;
  return true;
}

const alnum = (s: string) => normalizeAnswer(s).replace(/[^\p{L}\p{N}]+/gu, '');
const digits = (s: string) => s.replace(/\D+/g, '');

/**
 * Whether `after` is the user adjusting `before` rather than replacing it — a phone
 * number reformatted, a city given its full name. An adjustment says our field was
 * right for this box; a replacement says it was the wrong field.
 */
export function looksLikeEdit(before: string, after: string): boolean {
  const a = alnum(before);
  const b = alnum(after);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 3 && long.includes(short)) return true;
  const da = digits(before);
  const db = digits(after);
  return da.length >= 7 && db.length >= 7 && da.slice(-7) === db.slice(-7);
}

function recordable(kind: InputKind, value: string): boolean {
  return !UNRECORDED.has(kind) && value.trim().length > 0 && value.length <= MAX_RECORDED_LENGTH;
}

export function decideLearning(input: LearnInput, policy: LearningPolicy): Decision {
  const { kind, value, matches, before } = input;
  if (kind === 'checkbox') return {};
  const out: Decision = {};

  if (!value.trim()) {
    // Emptied what we filled: the user does not want it here.
    if (before.filled && policy.lessons) out.lesson = { ignore: true };
    return out;
  }

  if (kind === 'file') {
    if (matches.length === 1 && policy.lessons) out.lesson = { field: matches[0] };
    return out;
  }

  // Typed over our fill. Another field's value is the user moving the question to
  // that field; anything else is the user correcting the value we chose — "Joe" was
  // wrong, it is "John" — and the profile takes it.
  const corrected = before.filled && before.field && normalizeAnswer(value) !== normalizeAnswer(before.filledValue ?? '');
  if (corrected && policy.corrections) {
    if (matches.includes(before.field!) || matches.length > 1) return out;
    const [other] = matches;
    if (other && isDistinctive(value)) {
      if (policy.lessons) out.lesson = { field: other };
      return out;
    }
    out.update = { field: before.field! };
    return out;
  }

  if (matches.length > 1) return out;

  if (matches.length === 1) {
    const [field] = matches;
    if (!isDistinctive(value)) return out;
    const known = before.field === field && before.confidence === 'high';
    if (!known && policy.lessons) out.lesson = { field };
    return out;
  }

  if (policy.records && recordable(kind, value)) {
    out.record = before.filled && before.field ? { field: before.field } : {};
  }
  if (before.filled && policy.lessons && !looksLikeEdit(before.filledValue ?? '', value)) {
    out.lesson = { ignore: true };
  }
  return out;
}
