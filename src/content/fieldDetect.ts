/**
 * Maps form controls to FieldKeys using per-site overrides first, then keyword
 * heuristics. Produces a per-field result the modal renders as a review report.
 *
 * Confidence: a match on a strong source (autocomplete/id/name/label/aria) is
 * `high`; a placeholder-only match is `low` (reported, not auto-filled).
 */

import type { FieldKey, MatchConfidence, MatchSource } from '../shared/types';
import { FIELD_KEYWORDS, AUTOCOMPLETE_MAP, normalizeAttr } from '../shared/fieldKeys';

export interface DetectedField {
  field: FieldKey;
  element: HTMLElement | null;
  source: MatchSource;
  confidence: MatchConfidence;
  selectorUsed?: string;
}

export interface DetectOptions {
  root: ParentNode;
  fields: FieldKey[];
  overrides?: Partial<Record<FieldKey, string>>;
  /** When false, heuristics are skipped and only overrides are used. */
  autoDetect?: boolean;
}

const STRONG_WEIGHT = 5; // >= this => high confidence
const WEIGHT = { autocomplete: 10, id: 7, name: 7, label: 6, aria: 6, placeholder: 4 };

const EXCLUDED_INPUT_TYPES = new Set([
  'hidden', 'submit', 'button', 'reset', 'image', 'checkbox', 'radio', 'file',
]);

function labelText(el: HTMLElement): string {
  let s = '';
  const labels = (el as HTMLInputElement).labels;
  if (labels) for (const l of Array.from(labels)) s += ' ' + (l.textContent ?? '');
  const ariaLabelledBy = el.getAttribute('aria-labelledby');
  if (ariaLabelledBy) {
    for (const id of ariaLabelledBy.split(/\s+/)) {
      const ref = el.ownerDocument.getElementById(id);
      if (ref) s += ' ' + (ref.textContent ?? '');
    }
  }
  return s;
}

interface Context {
  idN: string;
  nameN: string;
  labelN: string;
  ariaN: string;
  placeholderN: string;
  autocompleteTokens: string[];
}

function contextFor(el: HTMLElement): Context {
  return {
    idN: normalizeAttr(el.id),
    nameN: normalizeAttr(el.getAttribute('name')),
    labelN: normalizeAttr(labelText(el)),
    ariaN: normalizeAttr(el.getAttribute('aria-label')),
    placeholderN: normalizeAttr(el.getAttribute('placeholder')),
    autocompleteTokens: (el.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/),
  };
}

/** Best (highest-weight) source that matches this field for this element; 0 if none. */
function scoreField(ctx: Context, field: FieldKey): number {
  let best = 0;

  const acTokens = AUTOCOMPLETE_MAP[field];
  if (acTokens && acTokens.some((t) => ctx.autocompleteTokens.includes(t))) {
    best = Math.max(best, WEIGHT.autocomplete);
  }

  const keywords = FIELD_KEYWORDS[field];
  const sources: Array<[string, number]> = [
    [ctx.idN, WEIGHT.id],
    [ctx.nameN, WEIGHT.name],
    [ctx.labelN, WEIGHT.label],
    [ctx.ariaN, WEIGHT.aria],
    [ctx.placeholderN, WEIGHT.placeholder],
  ];
  for (const [text, weight] of sources) {
    if (!text) continue;
    if (keywords.some((re) => re.test(text))) best = Math.max(best, weight);
  }
  return best;
}

function confidenceFor(weight: number): MatchConfidence {
  if (weight >= STRONG_WEIGHT) return 'high';
  if (weight > 0) return 'low';
  return 'none';
}

function textCandidates(root: ParentNode): HTMLElement[] {
  const out: HTMLElement[] = [];
  root.querySelectorAll('input, textarea, select').forEach((node) => {
    const el = node as HTMLElement;
    if (el.tagName === 'INPUT') {
      const type = (el.getAttribute('type') ?? 'text').toLowerCase();
      if (EXCLUDED_INPUT_TYPES.has(type)) return;
    }
    out.push(el);
  });
  return out;
}

function fileCandidates(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll('input[type="file"]')) as HTMLElement[];
}

export function detectFields(opts: DetectOptions): DetectedField[] {
  const { root, fields, overrides, autoDetect = true } = opts;
  const result = new Map<FieldKey, DetectedField>();
  for (const f of fields) {
    result.set(f, { field: f, element: null, source: 'none', confidence: 'none' });
  }

  const usedEls = new Set<HTMLElement>();
  const assignedFields = new Set<FieldKey>();

  // 1. Overrides win outright.
  for (const field of fields) {
    const sel = overrides?.[field];
    if (!sel) continue;
    let el: HTMLElement | null = null;
    try {
      el = root.querySelector(sel) as HTMLElement | null;
    } catch {
      el = null;
    }
    if (el) {
      result.set(field, {
        field, element: el, source: 'override', confidence: 'high', selectorUsed: sel,
      });
      usedEls.add(el);
      assignedFields.add(field);
    }
  }

  if (!autoDetect) return fields.map((f) => result.get(f)!);

  // 2. Heuristic assignment for text fields (unique element per field, greedy by weight).
  const textFields = fields.filter((f) => f !== 'resume' && !assignedFields.has(f));
  const candidates = textCandidates(root).filter((el) => !usedEls.has(el));
  const order = new Map(candidates.map((el, i) => [el, i]));
  const ctxCache = new Map<HTMLElement, Context>();
  const ctx = (el: HTMLElement) => {
    let c = ctxCache.get(el);
    if (!c) { c = contextFor(el); ctxCache.set(el, c); }
    return c;
  };

  interface Pair { field: FieldKey; el: HTMLElement; weight: number; }
  const pairs: Pair[] = [];
  for (const field of textFields) {
    for (const el of candidates) {
      const weight = scoreField(ctx(el), field);
      if (weight > 0) pairs.push({ field, el, weight });
    }
  }
  pairs.sort((a, b) => b.weight - a.weight || order.get(a.el)! - order.get(b.el)!);

  for (const p of pairs) {
    if (assignedFields.has(p.field) || usedEls.has(p.el)) continue;
    result.set(p.field, {
      field: p.field, element: p.el, source: 'heuristic', confidence: confidenceFor(p.weight),
    });
    assignedFields.add(p.field);
    usedEls.add(p.el);
  }

  // 3. Résumé: pick the best-matching file input; fall back to the first one (low).
  if (fields.includes('resume') && !assignedFields.has('resume')) {
    const files = fileCandidates(root);
    let best: HTMLElement | null = null;
    let bestWeight = 0;
    for (const el of files) {
      const w = scoreField(ctx(el), 'resume');
      if (w > bestWeight) { best = el; bestWeight = w; }
    }
    if (best && bestWeight >= STRONG_WEIGHT) {
      result.set('resume', { field: 'resume', element: best, source: 'heuristic', confidence: 'high' });
    } else if (files.length > 0) {
      result.set('resume', { field: 'resume', element: best ?? files[0], source: 'heuristic', confidence: 'low' });
    }
  }

  return fields.map((f) => result.get(f)!);
}
