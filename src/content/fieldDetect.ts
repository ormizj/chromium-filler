/**
 * Which inputs on a page are ours to consider, and what each of them is.
 *
 * Two steps, kept apart because the engine runs them at different times:
 *
 *   `collectCandidates`  every input on the page that the extension may ever fill —
 *                        and, as importantly, every one it must never touch (login
 *                        forms, search boxes, card numbers, our own UI).
 *   `classify`           what each new candidate is, in a fixed order of authority:
 *                        a lesson the user taught, then the built-in heuristics and
 *                        the user's own keywords, scored together.
 *
 * Confidence: a match on a strong source (autocomplete/id/name/label/aria, a
 * lesson, a keyword the user wrote) is `high` and is filled; a placeholder-only
 * match is `low` — reported, never filled.
 */

import type {
  FieldId, FieldKey, InputKind, Lesson, MatchConfidence, MatchSource, Profile,
} from '../shared/types';
import { FIELD_KEYWORDS, AUTOCOMPLETE_MAP, TEXT_FIELDS, normalizeAttr } from '../shared/fieldKeys';
import { fingerprint, inputKind, questionText, radioGroup } from '../shared/questionText';
import { lessonFor, signatureParts, type SignatureParts } from '../shared/inputSignature';
import { keywordMatch } from '../shared/profileFields';
import { isRendered } from '../shared/visible';
import { isExtensionUi } from './extensionUi';

/** One input the engine may fill. A radio group is one candidate, keyed on its first radio. */
export interface Candidate {
  el: HTMLElement;
  /** The whole group, for a radio. */
  group?: HTMLInputElement[];
  kind: InputKind;
  /** What it asks, as the page words it — the row's title in the report. */
  question: string;
  parts: SignatureParts;
}

export interface CollectOptions {
  /** "Can the user see it?" — injectable because jsdom has no layout. */
  visible?: (el: HTMLElement) => boolean;
  /**
   * Candidates already read on an earlier sweep. Reading a question and a section
   * walks the DOM around every input, and the engine sweeps the same page many
   * times; an input's words do not change between sweeps often enough to pay that.
   */
  known?: WeakMap<Element, Candidate>;
}

/**
 * Autocomplete tokens that mark an input as somebody else's business: card
 * details, passwords, one-time codes, a login's username. Filling any of them
 * with profile data is wrong on every site in the world.
 */
const FORBIDDEN_AUTOCOMPLETE = /\b(cc-[a-z-]+|current-password|new-password|one-time-code|username|webauthn)\b/;

const CONTROL_SELECTOR = 'input, select, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

/**
 * Inside something that is not an application form: a form with a password box
 * (login, sign-up), or a search. The engine runs on every site, so this is what
 * keeps it out of the forms that are none of its business.
 */
function inForbiddenForm(el: HTMLElement): boolean {
  if (el.closest('[role="search"], search')) return true;
  const form = el.closest('form');
  if (form) {
    if (form.querySelector('input[type="password"]')) return true;
    if (form.getAttribute('role') === 'search') return true;
  }
  return false;
}

function isUsable(el: HTMLElement): boolean {
  if ((el as HTMLInputElement).disabled || (el as HTMLInputElement).readOnly) return false;
  if (el.getAttribute('aria-disabled') === 'true' || el.getAttribute('aria-readonly') === 'true') return false;
  const ac = (el.getAttribute('autocomplete') ?? '').toLowerCase();
  if (FORBIDDEN_AUTOCOMPLETE.test(ac)) return false;
  return true;
}

/** Every input on the page the extension may fill, in page order. */
export function collectCandidates(root: ParentNode, opts: CollectOptions = {}): Candidate[] {
  const visible = opts.visible ?? isRendered;
  const out: Candidate[] = [];
  const seenGroups = new Set<HTMLInputElement>();

  for (const node of Array.from(root.querySelectorAll(CONTROL_SELECTOR))) {
    const el = node as HTMLElement;
    const kind = inputKind(el);
    if (!kind) continue;
    if (isExtensionUi(el) || !isUsable(el) || inForbiddenForm(el)) continue;
    // A file input is routinely `display: none` behind a styled "Upload CV" button,
    // and is still the control that takes the file.
    if (kind !== 'file' && !visible(el)) continue;

    const cached = opts.known?.get(el);
    if (cached) {
      if (cached.group) {
        if (seenGroups.has(el as HTMLInputElement)) continue;
        for (const r of cached.group) seenGroups.add(r);
      }
      out.push(cached);
      continue;
    }

    let group: HTMLInputElement[] | undefined;
    if (kind === 'radio') {
      const radio = el as HTMLInputElement;
      if (seenGroups.has(radio)) continue;
      group = radioGroup(radio);
      for (const r of group) seenGroups.add(r);
    }
    if (kind === 'checkbox') {
      // A group of checkboxes is a multiple choice ("Which languages do you speak?"),
      // and one stored value cannot say which of them to tick. Left to the user.
      const name = (el as HTMLInputElement).name;
      const scope: ParentNode = (el as HTMLInputElement).form ?? el.ownerDocument;
      const boxes = name ? Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) : [];
      if (boxes.filter((b) => b.name === name).length > 1) continue;
    }

    out.push({ el, group, kind, question: questionText(el), parts: signatureParts(el) });
  }
  return out;
}

/* ---------------- Scoring ---------------- */

const STRONG_WEIGHT = 5; // >= this => high confidence
const WEIGHT = {
  autocomplete: 10,
  /** A wording the user wrote — their own word outranks every guess but autocomplete. */
  keyword: 8,
  id: 7,
  name: 7,
  label: 6,
  aria: 6,
  /**
   * The question as `questionText` reads it — which, past the label sources already
   * scored above, means the words written *above* the box. Loose evidence: "Tell us
   * about your first project" says "first". So it is `low` on its own — reported,
   * never filled — and one Teach makes it a lesson everywhere.
   */
  question: 4,
  placeholder: 4,
};

/** The text-like kinds the built-in heuristics are written for. */
const HEURISTIC_KINDS = new Set<InputKind>(['text', 'email', 'tel', 'url', 'number', 'date', 'textarea', 'select', 'editable']);

interface Context {
  idN: string;
  nameN: string;
  labelN: string;
  ariaN: string;
  questionN: string;
  placeholderN: string;
  autocompleteTokens: string[];
}

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

function contextFor(c: Candidate): Context {
  const el = c.el;
  return {
    idN: normalizeAttr(el.id),
    nameN: normalizeAttr(el.getAttribute('name')),
    labelN: normalizeAttr(labelText(el)),
    ariaN: normalizeAttr(el.getAttribute('aria-label')),
    questionN: normalizeAttr(c.question),
    placeholderN: normalizeAttr(el.getAttribute('placeholder')),
    autocompleteTokens: (el.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/),
  };
}

/** Best (highest-weight) built-in source that matches this field for this input; 0 if none. */
function scoreField(ctx: Context, field: FieldKey): number {
  let best = 0;
  const acTokens = AUTOCOMPLETE_MAP[field];
  if (acTokens && acTokens.some((t) => ctx.autocompleteTokens.includes(t))) best = WEIGHT.autocomplete;

  const keywords = FIELD_KEYWORDS[field];
  const sources: Array<[string, number]> = [
    [ctx.idN, WEIGHT.id],
    [ctx.nameN, WEIGHT.name],
    [ctx.labelN, WEIGHT.label],
    [ctx.ariaN, WEIGHT.aria],
    [ctx.questionN, WEIGHT.question],
    [ctx.placeholderN, WEIGHT.placeholder],
  ];
  for (const [text, weight] of sources) {
    if (!text || weight <= best) continue;
    if (keywords.some((re) => re.test(text))) best = weight;
  }
  return best;
}

function confidenceFor(weight: number): MatchConfidence {
  if (weight >= STRONG_WEIGHT) return 'high';
  if (weight > 0) return 'low';
  return 'none';
}

/* ---------------- Classifying ---------------- */

export interface Classified {
  cand: Candidate;
  /** What it is. Absent: not recognised — a row the user can teach. */
  field?: FieldId;
  source: MatchSource;
  confidence: MatchConfidence;
  /** The lesson that decided it, for the hit counter. */
  lessonId?: string;
  /** A lesson says to leave this input alone. Never reported, never filled. */
  ignored?: boolean;
}

export interface ClassifyContext {
  profile: Profile;
  lessons: readonly Lesson[];
  /** The page's host — only consulted for lessons pinned to one site. */
  host: string;
  /** Fields already holding a live input from an earlier sweep of this page. */
  claimed?: ReadonlySet<FieldId>;
}

/**
 * The fields that can be satisfied by a file input, in the order they get to
 * claim one. Order is the whole rule: a page with one unlabelled upload means
 * the CV, and `resume` takes it before `coverLetter` is even considered.
 *
 * Only `resume` gets that fallback. A cover letter attached to an unlabelled
 * input is the wrong document sent to an employer, so this fails closed and
 * reports the input unrecognised instead.
 */
const UPLOAD_FIELDS: FieldKey[] = ['resume', 'coverLetter'];

/**
 * Decide what each of `fresh` is. `all` is every candidate on the page, fresh or
 * not: a lesson can only be judged unique against the whole page.
 *
 * Authority, highest first:
 *   1. a lesson — the user's own word about this exact input;
 *   2. the built-in heuristics and the user's keywords, scored together so the
 *      strongest evidence wins, one input per field (greedy, like before);
 *   3. for uploads, the CV's fallback onto an unlabelled file input, at `low`.
 */
export function classify(all: Candidate[], fresh: Candidate[], ctx: ClassifyContext): Classified[] {
  const parts = all.map((c) => c.parts);
  const indexOf = new Map(all.map((c, i) => [c, i]));
  const result = new Map<Candidate, Classified>();
  const claimed = new Set<FieldId>(ctx.claimed ?? []);
  const open: Candidate[] = [];

  // 1. Lessons.
  for (const cand of fresh) {
    const lesson = lessonFor(ctx.lessons, parts, indexOf.get(cand)!, ctx.host);
    if (lesson && lesson !== 'ambiguous') {
      if ('ignore' in lesson.target) {
        result.set(cand, { cand, source: 'lesson', confidence: 'none', ignored: true, lessonId: lesson.id });
      } else {
        result.set(cand, { cand, field: lesson.target.field, source: 'lesson', confidence: 'high', lessonId: lesson.id });
        claimed.add(lesson.target.field);
      }
      continue;
    }
    // Two inputs one lesson cannot tell apart: neither is filled, and both are
    // left for the user — without a heuristic guess standing in for the lesson.
    if (lesson === 'ambiguous') {
      result.set(cand, { cand, source: 'none', confidence: 'none' });
      continue;
    }
    open.push(cand);
  }

  // 2. Heuristics and keywords, scored together.
  interface Pair { field: FieldId; cand: Candidate; weight: number; source: MatchSource }
  const pairs: Pair[] = [];
  for (const cand of open) {
    if (cand.kind === 'file') continue;
    const kw = keywordMatch(ctx.profile, fingerprint(cand.question));
    if (kw) pairs.push({ field: kw, cand, weight: WEIGHT.keyword, source: 'keyword' });
    if (!HEURISTIC_KINDS.has(cand.kind)) continue;
    const c = contextFor(cand);
    for (const field of TEXT_FIELDS) {
      const weight = scoreField(c, field);
      if (weight > 0) pairs.push({ field, cand, weight, source: 'heuristic' });
    }
  }
  const order = new Map(all.map((c, i) => [c, i]));
  pairs.sort((a, b) => b.weight - a.weight || order.get(a.cand)! - order.get(b.cand)!);
  for (const p of pairs) {
    if (claimed.has(p.field) || result.has(p.cand)) continue;
    result.set(p.cand, { cand: p.cand, field: p.field, source: p.source, confidence: confidenceFor(p.weight) });
    claimed.add(p.field);
  }

  // 3. Uploads — every *named* input is claimed before the CV's fallback runs, or a
  //    page whose one upload says "Cover letter" would have it taken by the CV.
  const files = () => open.filter((c) => c.kind === 'file' && !result.has(c));
  for (const field of UPLOAD_FIELDS) {
    if (claimed.has(field)) continue;
    let best: Candidate | undefined;
    let bestWeight = 0;
    for (const cand of files()) {
      const w = scoreField(contextFor(cand), field);
      if (w > bestWeight) { best = cand; bestWeight = w; }
    }
    if (best && bestWeight >= STRONG_WEIGHT) {
      result.set(best, { cand: best, field, source: 'heuristic', confidence: 'high' });
      claimed.add(field);
    }
  }
  if (!claimed.has('resume')) {
    const [first] = files();
    if (first) {
      result.set(first, { cand: first, field: 'resume', source: 'heuristic', confidence: 'low' });
      claimed.add('resume');
    }
  }

  return fresh.map((c) => result.get(c) ?? { cand: c, source: 'none', confidence: 'none' });
}
