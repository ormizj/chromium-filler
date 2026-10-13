/**
 * The fields a value can come from — the sixteen built in, and whatever the user
 * added — as one catalog. Every surface that names a field, offers a list of them,
 * or looks a value up goes through here, so a custom field is a field everywhere
 * and not a special case at each call site.
 */

import type { CustomField, CustomFieldKind, FieldId, FieldKey, Profile, TextFieldKey } from './types';
import { FIELD_LABELS, FIELD_ORDER } from './fieldKeys';
import { fingerprint, phraseIn } from './questionText';

export const CUSTOM_PREFIX = 'c_';

export function isCustomId(id: FieldId): boolean {
  return id.startsWith(CUSTOM_PREFIX);
}

export function newCustomField(label: string, kind: CustomFieldKind, value = '', id?: string): CustomField {
  return {
    id: id ?? `${CUSTOM_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    label: label.trim(),
    kind,
    value,
    keywords: [],
  };
}

function custom(profile: Profile, id: FieldId): CustomField | undefined {
  return profile.customFields?.find((f) => f.id === id);
}

/**
 * A field's name, for display. A lesson can outlive the custom field it pointed at
 * if the two are removed out of order, and that has to read as what it is.
 */
export function fieldLabel(profile: Profile, id: FieldId): string {
  if (isCustomId(id)) return custom(profile, id)?.label ?? 'Deleted field';
  return FIELD_LABELS[id as FieldKey] ?? id;
}

/** The text a field fills with. `undefined` for the two documents and for nothing set. */
export function fieldValue(profile: Profile, id: FieldId): string | undefined {
  const v = isCustomId(id) ? custom(profile, id)?.value : profile.values[id as TextFieldKey];
  return v != null && v !== '' ? v : undefined;
}

/**
 * Every wording a field answers, fingerprinted: a custom field's label and its
 * keywords, or the extra wordings the user gave a built-in one. The built-ins'
 * own regex tables (`FIELD_KEYWORDS`) are not here — the heuristics use those.
 */
function phrasesFor(profile: Profile): Array<{ id: FieldId; phrase: string }> {
  const out: Array<{ id: FieldId; phrase: string }> = [];
  for (const [id, words] of Object.entries(profile.keywords ?? {})) {
    for (const w of words ?? []) out.push({ id, phrase: fingerprint(w) });
  }
  for (const f of profile.customFields ?? []) {
    for (const w of [f.label, ...f.keywords]) out.push({ id: f.id, phrase: fingerprint(w) });
  }
  return out.filter((p) => p.phrase);
}

/**
 * The field whose wording appears in this question, as a whole phrase.
 *
 * The longest phrase wins ("notice period" over "notice"), and two *different*
 * fields matching at the same length match neither: two custom fields both called
 * "Start date" is a question the user has to settle, not one to guess.
 */
export function keywordMatch(profile: Profile, question: string): FieldId | undefined {
  let best: { id: FieldId; len: number } | undefined;
  let tie = false;
  for (const { id, phrase } of phrasesFor(profile)) {
    if (!phraseIn(question, phrase)) continue;
    const len = phrase.length;
    if (!best || len > best.len) { best = { id, len }; tie = false; }
    else if (len === best.len && id !== best.id) tie = true;
  }
  return best && !tie ? best.id : undefined;
}

export interface FieldChoice {
  id: FieldId;
  label: string;
  group: 'builtIn' | 'custom';
}

/** Everything a row can be taught as: the built-ins in reading order, then the user's own. */
export function fieldChoices(profile: Profile): FieldChoice[] {
  return [
    ...FIELD_ORDER.map((id) => ({ id, label: FIELD_LABELS[id], group: 'builtIn' as const })),
    ...(profile.customFields ?? []).map((f) => ({ id: f.id, label: f.label, group: 'custom' as const })),
  ];
}
