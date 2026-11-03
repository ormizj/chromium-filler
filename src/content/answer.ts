/**
 * Reading an answer back out of an input, and asking which profile fields hold it —
 * the other direction from `fill.ts`, for learning from what the user typed.
 *
 * A select and a radio group are compared by the rule the fill itself uses
 * (`optionFor`, `radioFor`): "Israel" is the country field's answer to a list
 * because filling the country field would have chosen that same option, not
 * because two strings happen to look alike.
 */

import type { FieldId, Profile } from '../shared/types';
import { fieldChoices, fieldValue } from '../shared/profileFields';
import { normalizeAnswer } from '../shared/learning';
import type { Candidate } from './fieldDetect';
import { hasValue, optionFor, radioFor } from './fill';

export interface Docs {
  cv: File | null;
  cover: File | null;
}

/** A radio's label as the page wrote it, for the record — `radioText` is lower-cased. */
function radioLabel(r: HTMLInputElement): string {
  const own = r.labels?.length ? Array.from(r.labels).map((l) => l.textContent ?? '').join(' ') : '';
  return (own || r.value).replace(/\s+/g, ' ').trim();
}

/** What the input holds now, as text. Empty when it holds nothing. */
export function readAnswer(cand: Candidate): string {
  const el = cand.el;
  if (!hasValue(el, cand.group)) return '';
  if (cand.kind === 'radio') {
    const checked = (cand.group ?? [el as HTMLInputElement]).find((r) => r.checked);
    return checked ? radioLabel(checked) : '';
  }
  if (cand.kind === 'checkbox') return (el as HTMLInputElement).checked ? 'Yes' : 'No';
  if (cand.kind === 'file') return (el as HTMLInputElement).files?.[0]?.name ?? '';
  if (el instanceof HTMLSelectElement) return el.selectedOptions[0]?.text.trim() ?? '';
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value.trim();
  return (el.textContent ?? '').trim();
}

/**
 * Every field whose stored value would have produced what the input holds now.
 * Several is a real answer — the city and the state both "Haifa" — and it is the
 * caller's to refuse (`decideLearning`), not this file's to break the tie.
 */
export function fieldsAnswering(profile: Profile, cand: Candidate, docs: Docs): FieldId[] {
  const el = cand.el;
  if (!hasValue(el, cand.group)) return [];

  if (cand.kind === 'file') {
    const name = (el as HTMLInputElement).files?.[0]?.name;
    if (!name) return [];
    const out: FieldId[] = [];
    if (docs.cv?.name === name) out.push('resume');
    if (docs.cover?.name === name) out.push('coverLetter');
    return out;
  }
  if (cand.kind === 'checkbox') return [];

  const current = normalizeAnswer(readAnswer(cand));
  const out: FieldId[] = [];
  for (const { id } of fieldChoices(profile)) {
    const value = fieldValue(profile, id);
    if (!value) continue;
    let same: boolean;
    if (cand.kind === 'radio') {
      const group = cand.group ?? [el as HTMLInputElement];
      const pick = radioFor(group, value);
      same = !!pick && pick.checked;
    } else if (el instanceof HTMLSelectElement) {
      const pick = optionFor(el, value);
      same = !!pick && pick === el.selectedOptions[0];
    } else {
      same = normalizeAnswer(value) === current;
    }
    if (same) out.push(id);
  }
  return out;
}
