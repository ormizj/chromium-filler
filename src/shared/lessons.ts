/**
 * The list of things the user has taught the extension — pure operations on it.
 * The rules about what a lesson *matches* live in `inputSignature.ts`; this is the
 * bookkeeping: one lesson per signature, forgetting, counting, and what happens to
 * the lessons of a custom field that is deleted.
 */

import type { FieldId, InputSignature, Lesson, LessonTarget } from './types';

const PARTS = ['question', 'kind', 'name', 'section', 'options', 'index', 'host'] as const;

export function sameSignature(a: InputSignature, b: InputSignature): boolean {
  return PARTS.every((k) => a[k] === b[k]);
}

export interface NewLesson {
  signature: InputSignature;
  target: LessonTarget;
  label: string;
  taughtOn?: string;
}

/**
 * Add a lesson. Teaching an input that already has one replaces it — a correction,
 * not a second opinion — so there is never more than one lesson per signature.
 */
export function teach(lessons: readonly Lesson[], lesson: NewLesson, now: number, id: string): Lesson[] {
  const next: Lesson = {
    id,
    signature: lesson.signature,
    target: lesson.target,
    label: lesson.label,
    ...(lesson.taughtOn ? { taughtOn: lesson.taughtOn } : {}),
    createdAt: now,
    hits: 0,
  };
  return [...lessons.filter((l) => !sameSignature(l.signature, lesson.signature)), next];
}

export function forget(lessons: readonly Lesson[], id: string): Lesson[] {
  return lessons.filter((l) => l.id !== id);
}

/** Count a fill for each lesson that made one. The same list back when there were none. */
export function recordHits(lessons: Lesson[], ids: readonly string[]): Lesson[] {
  if (!ids.length) return lessons;
  const hit = new Set(ids);
  return lessons.map((l) => (hit.has(l.id) ? { ...l, hits: l.hits + 1 } : l));
}

export function targetField(lesson: Lesson): FieldId | undefined {
  return 'field' in lesson.target ? lesson.target.field : undefined;
}

export function lessonsFor(lessons: readonly Lesson[], field: FieldId): Lesson[] {
  return lessons.filter((l) => targetField(l) === field);
}

/** A custom field was deleted: a lesson pointing at nothing would fill nothing, silently. */
export function dropField(lessons: readonly Lesson[], field: FieldId): Lesson[] {
  return lessons.filter((l) => targetField(l) !== field);
}

export function newLessonId(): string {
  return `l_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
