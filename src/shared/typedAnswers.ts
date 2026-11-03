/**
 * The record of answers the user typed that none of their fields holds — pure.
 *
 * Nothing here is ever filled. It is a tally for Options → "Answers you've typed":
 * "Software developer, typed 20×" is a value the user keeps giving and may want to
 * save. Saving one makes it a profile value, and from then on `learning.ts` links
 * the questions it answers like any other.
 */

import type { FieldId, InputKind, TypedAnswer } from './types';
import { normalizeAnswer } from './learning';

/** How many of the questions an answer was given to are kept, for the Options row. */
export const MAX_QUESTIONS = 5;
/** How many records are kept at all. */
export const MAX_ANSWERS = 300;

export interface TypedInput {
  value: string;
  question: string;
  kind: InputKind;
  field?: FieldId;
}

export function recordAnswer(
  list: readonly TypedAnswer[],
  input: TypedInput,
  now: number,
  cap = MAX_ANSWERS,
): TypedAnswer[] {
  const key = normalizeAnswer(input.value);
  if (!key) return list as TypedAnswer[];
  const value = input.value.replace(/\s+/g, ' ').trim();
  const question = input.question.trim();
  const prev = list.find((a) => a.key === key);
  const questions = prev?.questions ?? [];
  const next: TypedAnswer = {
    key,
    value,
    kind: input.kind,
    count: (prev?.count ?? 0) + 1,
    questions: question
      ? [question, ...questions.filter((q) => q !== question)].slice(0, MAX_QUESTIONS)
      : questions,
    ...(input.field ?? prev?.field ? { field: input.field ?? prev?.field } : {}),
    firstAt: prev?.firstAt ?? now,
    lastAt: now,
  };
  const rest = list.filter((a) => a.key !== key);
  // Over the cap, the least used go first, the oldest among those — never the one
  // just typed.
  const keep = cap - 1;
  const trimmed = rest.length > keep
    ? [...rest].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt).slice(0, keep)
    : rest;
  return [...trimmed, next];
}

export function dismissAnswer(list: readonly TypedAnswer[], key: string): TypedAnswer[] {
  return list.filter((a) => a.key !== key);
}

/** Most used first, then most recent — the order Options lists them in. */
export function sortedAnswers(list: readonly TypedAnswer[]): TypedAnswer[] {
  return [...list].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}
