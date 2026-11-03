/**
 * Every input on the page passes through here.
 *
 * The extension used to fill a page once, on a site somebody had set up, from a
 * list of fields the profile could supply. This is the opposite shape: it runs on
 * every site, it keeps watching, and it reports per *input* — what the page asks,
 * and what became of each question.
 *
 *   sweep      collect the inputs, classify the ones not seen before (lessons, then
 *              heuristics and keywords), fill the confident ones that are empty,
 *              add a row for each to the report.
 *   watch      a DOM-only page watch re-sweeps when the page settles, so the form
 *              behind "Apply now" and page two of a wizard are filled as they
 *              appear. It pauses while the tab is hidden and stands down after a
 *              long quiet, so a carousel cannot keep it busy for the life of a tab.
 *   respect    an input that already holds a value is never written, and one the
 *              user has typed in (a trusted `input`/`change`) is never written again.
 *   listen     when the user commits an answer — a trusted `change`, which the
 *              browser fires on blur after an edit — the engine reads it back and
 *              hands it to `onAnswer`, which decides what to learn (`learning.ts`).
 *
 * The report holds still. Rows are ordered once, at the first sweep (unrecognised,
 * then to check, then filled — what needs the user first), and every later input
 * joins the end marked `later`. A row's status may change in place — an answer
 * typed, a lesson learned — but no row ever moves under the eye reading the list.
 */

import type { FieldId, FieldMatch, Lesson, LessonTarget, MatchConfidence, MatchSource, Profile } from '../shared/types';
import { fieldLabel, fieldValue } from '../shared/profileFields';
import { matchStatus } from '../shared/fieldStatus';
import { hostOf } from '../shared/url';
import { classify, collectCandidates, type Candidate, type Classified } from './fieldDetect';
import { readAnswer } from './answer';
import { normalizeAnswer } from '../shared/learning';
import {
  clearHighlights, fillCheckbox, fillFileInput, fillRadioGroup, fillTextField, hasValue, highlight,
  unhighlight,
} from './fill';
import { watchPageChange } from './pageChange';

/** How long the page must hold still before a sweep — a page reacting to a click is a burst. */
export const SETTLE_MS = 400;
/** With no new input for this long, the page is done arriving and the watch stands down. */
export const IDLE_STOP_MS = 10 * 60_000;
/**
 * The user working the page keeps the watch up — re-armed at most this often. A
 * long step one of a wizard is not a quiet page: the step two behind "Next" is
 * still to come, and a watch that stood down meanwhile would never see it.
 */
export const WAKE_THROTTLE_MS = 30_000;

/** An answer the user committed — what `onAnswer` learns from. */
export interface UserAnswer {
  rowId: string;
  cand: Candidate;
  /** What the input holds now, as text — empty when the user cleared it. */
  answer: string;
  /** The row as it was before the user's edit. */
  before: {
    field?: FieldId;
    confidence: MatchConfidence;
    source: MatchSource;
    /** We wrote into it. */
    filled: boolean;
    /** What we wrote, when we did. */
    filledValue?: string;
  };
  /** The lesson that decided the row, if one did — a new one keeps its signature. */
  lessonId?: string;
}

export interface EngineDeps {
  profile(): Profile;
  lessons(): readonly Lesson[];
  /** The two documents, as Files, or null when none is stored. */
  docs(): { cv: File | null; cover: File | null };
  /** The report changed — re-render whatever shows it. */
  onReport(): void;
  /** These lessons filled something — count them (debounced by the caller). */
  onLessonHits?(ids: string[]): void;
  /** The user committed an answer to one input. */
  onAnswer?(answer: UserAnswer): void;
  /** Injectable for jsdom, which has no layout. */
  visible?: (el: HTMLElement) => boolean;
  /** Injectable for tests; the real one is `watchPageChange`. */
  watch?: (cb: () => void) => () => void;
  /** The page's host, for site-pinned lessons. */
  host?: string;
  /**
   * Whether an event came from the user. `isTrusted` — our own fills dispatch
   * untrusted events — and injectable only because no test can forge it.
   */
  isUserEvent?: (e: Event) => boolean;
}

interface Entry {
  row: FieldMatch;
  cand: Candidate;
  lessonId?: string;
  /** What we wrote into it, when we did — the "before" of a correction. */
  wrote?: string;
}

const RANK: Record<MatchConfidence, number> = { none: 0, low: 1, high: 2 };

/** A contenteditable root — by its attribute too, which is all jsdom implements. */
function isEditable(el: HTMLElement): boolean {
  if (el.isContentEditable) return true;
  const ce = el.getAttribute?.('contenteditable');
  return ce === '' || ce === 'true' || ce === 'plaintext-only';
}

export class FillEngine {
  private entries: Entry[] = [];
  /** Every element a sweep has decided about, row or not — classified once. */
  private seen = new WeakMap<Element, Entry | 'skip'>();
  /** Inputs the user has typed in. Never written again. */
  private touched = new WeakSet<Element>();
  private candidates = new WeakMap<Element, Candidate>();
  private nextId = 1;
  private swept = false;
  private stopWatch?: () => void;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private pending = false;
  private lastArm = 0;
  /** A contenteditable's text when focus arrived — it has no `change` to say it was edited. */
  private editStart = new WeakMap<Element, string>();

  constructor(private deps: EngineDeps) {}

  /** The report, in its settled order. */
  get rows(): FieldMatch[] {
    return this.entries.map((e) => e.row);
  }

  get hasRun(): boolean {
    return this.swept;
  }

  private get host(): string {
    return this.deps.host ?? hostOf(location.href) ?? location.host;
  }

  /** Start listening: the user's own typing, and the page changing under us. */
  start(): void {
    document.addEventListener('input', this.onUserInput, true);
    document.addEventListener('change', this.onUserInput, true);
    document.addEventListener('change', this.onChange, true);
    document.addEventListener('focusin', this.onFocusIn, true);
    document.addEventListener('focusout', this.onFocusOut, true);
    document.addEventListener('pointerdown', this.onActivity, true);
    document.addEventListener('keydown', this.onActivity, true);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.watchAgain();
  }

  /** Stand down entirely: no watching, no filling, no listening to the user. */
  stop(): void {
    document.removeEventListener('input', this.onUserInput, true);
    document.removeEventListener('change', this.onUserInput, true);
    document.removeEventListener('change', this.onChange, true);
    document.removeEventListener('focusin', this.onFocusIn, true);
    document.removeEventListener('focusout', this.onFocusOut, true);
    document.removeEventListener('pointerdown', this.onActivity, true);
    document.removeEventListener('keydown', this.onActivity, true);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.stopWatch?.();
    this.stopWatch = undefined;
    if (this.idleTimer) clearTimeout(this.idleTimer);
  }

  private watchAgain(): void {
    if (this.stopWatch) return;
    const watch = this.deps.watch ?? ((cb) => watchPageChange(cb, SETTLE_MS, { layout: false }));
    this.stopWatch = watch(() => this.onPageChanged());
    this.armIdle();
  }

  private armIdle(): void {
    this.lastArm = Date.now();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.stopWatch?.();
      this.stopWatch = undefined;
    }, IDLE_STOP_MS);
  }

  private onPageChanged(): void {
    if (document.visibilityState === 'hidden') { this.pending = true; return; }
    if (this.sweep() > 0) this.armIdle();
  }

  private onVisibility = (): void => {
    if (document.visibilityState === 'visible' && this.pending) {
      this.pending = false;
      this.onPageChanged();
    }
  };

  private isUser(e: Event): boolean {
    return (this.deps.isUserEvent ?? ((ev: Event) => ev.isTrusted))(e);
  }

  /**
   * The user is working the page. If the watch stood down, it comes back — and
   * looks at once, because whatever this press opened is exactly what it missed.
   */
  private onActivity = (e: Event): void => {
    if (!this.isUser(e)) return;
    if (!this.stopWatch) {
      this.watchAgain();
      this.onPageChanged();
    } else if (Date.now() - this.lastArm > WAKE_THROTTLE_MS) {
      this.armIdle();
    }
  };

  /**
   * An answer committed. `change` rather than `blur`: the browser fires it on blur
   * only when the value changed, which is exactly "the user edited this" — and our
   * own fills, which focus and blur each box, dispatch an *untrusted* one.
   */
  private onChange = (e: Event): void => {
    if (!this.isUser(e)) return;
    const el = e.target as HTMLElement | null;
    if (el && !isEditable(el)) this.commit(el);
  };

  /** A contenteditable has no `change`: remember its text as focus arrives… */
  private onFocusIn = (e: Event): void => {
    const el = e.target as HTMLElement | null;
    if (el && isEditable(el)) this.editStart.set(el, el.textContent ?? '');
  };

  /** …and commit as it leaves, if the user changed it in between. */
  private onFocusOut = (e: Event): void => {
    const el = e.target as HTMLElement | null;
    if (!el || !isEditable(el) || !this.touched.has(el)) return;
    const start = this.editStart.get(el);
    this.editStart.delete(el);
    if (start !== undefined && start !== (el.textContent ?? '')) this.commit(el);
  };

  /** Only a *trusted* event is the user — our own fills dispatch untrusted ones. */
  private onUserInput = (e: Event): void => {
    if (!this.isUser(e)) return;
    const el = e.target as HTMLElement | null;
    if (!el) return;
    this.touched.add(el);
    if (el instanceof HTMLInputElement && el.type === 'radio') {
      const entry = this.seen.get(el) ?? this.entryForElement(el);
      if (entry && entry !== 'skip') entry.cand.group?.forEach((r) => this.touched.add(r));
    }
  };

  private isTouched(cand: Candidate): boolean {
    if (this.touched.has(cand.el)) return true;
    return !!cand.group?.some((r) => this.touched.has(r));
  }

  /** One pass over the page. Returns how many inputs it had not seen before. */
  sweep(): number {
    const all = collectCandidates(document, { visible: this.deps.visible, known: this.candidates });
    for (const c of all) this.candidates.set(c.el, c);
    const fresh = all.filter((c) => !this.seen.has(c.el));
    const first = !this.swept;
    this.swept = true;
    if (!fresh.length) {
      if (first) this.deps.onReport();
      return 0;
    }

    const results = classify(all, fresh, {
      profile: this.deps.profile(),
      lessons: this.deps.lessons(),
      host: this.host,
      claimed: this.liveClaims(),
    });

    const added: Entry[] = [];
    const hits: string[] = [];
    for (const res of results) {
      if (res.ignored) { this.seen.set(res.cand.el, 'skip'); continue; }
      const prefilled = hasValue(res.cand.el, res.cand.group);
      // An input nothing recognises that already has an answer needs nothing from
      // anyone — reporting it would be a row of noise on every prefilled form.
      if (!res.field && prefilled) { this.seen.set(res.cand.el, 'skip'); continue; }

      const entry = this.makeEntry(res, !first);
      this.seen.set(res.cand.el, entry);
      for (const r of res.cand.group ?? []) this.seen.set(r, entry);
      this.tryFill(entry);
      if (entry.row.filled && entry.lessonId) hits.push(entry.lessonId);
      added.push(entry);
    }

    if (first) {
      added.sort((a, b) =>
        RANK[matchStatus(a.row)] - RANK[matchStatus(b.row)]);
    }
    this.entries.push(...added);
    if (hits.length) this.deps.onLessonHits?.(hits);
    this.deps.onReport();
    return fresh.length;
  }

  /** Fields that already hold a live input — a later sweep may not claim them again. */
  private liveClaims(): Set<FieldId> {
    const out = new Set<FieldId>();
    for (const e of this.entries) {
      if (e.row.field && e.cand.el.isConnected) out.add(e.row.field);
    }
    return out;
  }

  private makeEntry(res: Classified, later: boolean): Entry {
    const profile = this.deps.profile();
    const el = res.cand.el;
    const row: FieldMatch = {
      id: `r${this.nextId++}`,
      question: res.cand.question,
      kind: res.cand.kind,
      source: res.source,
      confidence: res.confidence,
      filled: false,
      required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
      ...(later ? { later: true } : {}),
    };
    if (res.field) {
      row.field = res.field;
      row.fieldLabel = fieldLabel(profile, res.field);
      row.valueToFill = this.displayValue(res.field);
    }
    return { row, cand: res.cand, lessonId: res.lessonId };
  }

  private displayValue(field: FieldId): string | undefined {
    if (field === 'resume') return this.deps.docs().cv?.name;
    const text = fieldValue(this.deps.profile(), field);
    if (field === 'coverLetter' && !text) return this.deps.docs().cover?.name;
    return text;
  }

  /**
   * Fill one entry if it may be filled: confident, empty, untouched, and with
   * something to fill it with. The outline is painted either way.
   */
  private tryFill(entry: Entry): void {
    const { row, cand } = entry;
    if (row.field && row.confidence === 'high' && !this.isTouched(cand)) {
      if (hasValue(cand.el, cand.group)) row.kept = true;
      else {
        row.filled = this.write(row.field, cand);
        if (row.filled) entry.wrote = row.valueToFill ?? fieldValue(this.deps.profile(), row.field);
      }
    }
    this.paint(entry);
  }

  /**
   * Mark the input on the page by its outcome, with the field's name beside it — the
   * name is what makes an outline readable without opening the card. A question
   * nothing recognised is left unmarked: on every site in the world that would be a
   * ring round every search box and comment field.
   */
  private paint(entry: Entry): void {
    const { row, cand } = entry;
    const target = cand.group?.[0]?.closest('fieldset') as HTMLElement | null ?? cand.el;
    if (!row.field || row.ignored) {
      unhighlight(target);
      return;
    }
    highlight(target, matchStatus(row), row.fieldLabel);
  }

  /** Put a field's value into a candidate. Returns whether it went in. */
  private write(field: FieldId, cand: Candidate): boolean {
    const { cv, cover } = this.deps.docs();
    const el = cand.el;
    if (cand.kind === 'file') {
      const file = field === 'resume' ? cv : field === 'coverLetter' ? cover : null;
      return !!file && fillFileInput(el as HTMLInputElement, file);
    }
    const value = fieldValue(this.deps.profile(), field);
    if (value == null) return false;
    if (cand.kind === 'radio') return fillRadioGroup(cand.group ?? [el as HTMLInputElement], value);
    if (cand.kind === 'checkbox') return fillCheckbox(el as HTMLInputElement, value);
    return fillTextField(el, value);
  }

  private entry(id: string): Entry | undefined {
    return this.entries.find((e) => e.row.id === id);
  }

  private entryForElement(el: Element): Entry | undefined {
    return this.entries.find((e) => e.cand.el === el || e.cand.group?.includes(el as HTMLInputElement));
  }

  /**
   * The row for an element the user answered, adding one if no sweep listed it —
   * an input that was prefilled and unrecognised, or one a lesson set aside. It
   * joins the end, like every later arrival: the report holds still.
   */
  private ensureEntry(el: HTMLElement): Entry | undefined {
    const existing = this.entryForElement(el);
    if (existing) return existing;
    const all = collectCandidates(document, { visible: () => true, known: this.candidates });
    const cand = all.find((c) => c.el === el || c.group?.includes(el as HTMLInputElement));
    if (!cand) return undefined;
    this.candidates.set(cand.el, cand);
    const entry = this.makeEntry({ cand, source: 'none', confidence: 'none' }, true);
    this.seen.set(cand.el, entry);
    for (const r of cand.group ?? []) this.seen.set(r, entry);
    this.entries.push(entry);
    return entry;
  }

  /** The user committed an answer: mark the row theirs, and hand it on to learn from. */
  private commit(el: HTMLElement): void {
    const entry = this.ensureEntry(el);
    if (!entry) return;
    const { row, cand } = entry;
    const answer = readAnswer(cand);
    const before: UserAnswer['before'] = {
      field: row.field,
      confidence: row.confidence,
      source: row.source,
      filled: entry.wrote !== undefined,
      ...(entry.wrote !== undefined ? { filledValue: entry.wrote } : {}),
    };
    // Whatever is in the box now is the user's — ours only while it still says
    // what we wrote.
    row.answered = !!answer;
    if (row.filled && normalizeAnswer(answer) !== normalizeAnswer(entry.wrote ?? '')) row.filled = false;
    this.paint(entry);
    this.deps.onReport();
    this.deps.onAnswer?.({ rowId: row.id, cand, answer, before, lessonId: entry.lessonId });
  }

  /** Every candidate on the page — the set a new lesson's signature must be unique in. */
  allCandidates(): Candidate[] {
    return collectCandidates(document, { visible: () => true, known: this.candidates });
  }

  /**
   * A lesson was learned from what the user typed into this row: show it, without
   * writing anything — the box already holds the user's answer. The row stays
   * where it is; only its status changes.
   */
  learned(id: string, target: LessonTarget, lessonId?: string): void {
    const entry = this.entry(id);
    if (!entry) return;
    const row = entry.row;
    row.learned = true;
    entry.lessonId = lessonId;
    if ('ignore' in target) {
      Object.assign(row, { ignored: true, field: undefined, fieldLabel: undefined, valueToFill: undefined, confidence: 'none' });
    } else {
      Object.assign(row, {
        ignored: false,
        field: target.field,
        fieldLabel: fieldLabel(this.deps.profile(), target.field),
        valueToFill: this.displayValue(target.field),
        source: 'lesson',
        confidence: 'high',
      });
    }
    this.paint(entry);
    this.deps.onReport();
  }

  /**
   * The user corrected what we filled, and the profile took their answer: say so,
   * without writing anything — the box already holds it. The row stays where it is.
   */
  saved(id: string, field: FieldId, value: string): void {
    const entry = this.entry(id);
    if (!entry) return;
    Object.assign(entry.row, { saved: true, field, fieldLabel: fieldLabel(this.deps.profile(), field), valueToFill: value });
    this.paint(entry);
    this.deps.onReport();
  }

  /**
   * The profile or the lessons changed (in Options, or a lesson learned on another tab):
   * look again at every row that is still open — unrecognised, or recognised but not
   * filled — without moving any of them, and without touching what the user typed.
   */
  reconsider(): void {
    const open = this.entries.filter((e) => !e.row.filled && !e.row.kept && !e.row.ignored && !e.row.answered && !this.isTouched(e.cand));
    if (!open.length) { this.refreshLabels(); return; }
    const all = this.allCandidates();
    const live = open.filter((e) => all.some((c) => c.el === e.cand.el));
    const results = classify(all, live.map((e) => e.cand), {
      profile: this.deps.profile(),
      lessons: this.deps.lessons(),
      host: this.host,
      claimed: new Set(this.entries.filter((e) => e.row.filled && e.row.field).map((e) => e.row.field!)),
    });
    for (const res of results) {
      const entry = live.find((e) => e.cand.el === res.cand.el)!;
      if (res.ignored) { entry.row.ignored = true; continue; }
      if (!res.field) continue;
      Object.assign(entry.row, {
        field: res.field,
        fieldLabel: fieldLabel(this.deps.profile(), res.field),
        valueToFill: this.displayValue(res.field),
        source: res.source,
        confidence: res.confidence,
      });
      entry.lessonId = res.lessonId;
      if (!hasValue(entry.cand.el, entry.cand.group)) this.tryFill(entry);
      else this.paint(entry);
    }
    this.refreshLabels();
    this.deps.onReport();
  }

  /** Draw every row's mark again — after a pause cleared them all. */
  repaint(): void {
    for (const e of this.entries) if (e.cand.el.isConnected) this.paint(e);
  }

  /** A custom field renamed in Options shows its new name on the rows that use it. */
  private refreshLabels(): void {
    const profile = this.deps.profile();
    for (const e of this.entries) {
      if (e.row.field) e.row.fieldLabel = fieldLabel(profile, e.row.field);
    }
  }

  /** Everything we filled goes back to empty, and the report starts over. */
  reset(): void {
    for (const e of this.entries) {
      if (!e.row.filled) continue;
      const el = e.cand.el;
      if (e.cand.kind === 'radio') e.cand.group?.forEach((r) => { r.checked = false; });
      else if (e.cand.kind === 'checkbox') (el as HTMLInputElement).checked = false;
      else if (e.cand.kind === 'file') (el as HTMLInputElement).value = '';
      else if (el instanceof HTMLSelectElement) {
        el.selectedIndex = 0;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (e.cand.kind !== 'editable') fillTextField(el, '');
    }
    clearHighlights();
    this.entries = [];
    this.seen = new WeakMap();
    this.swept = false;
  }
}
