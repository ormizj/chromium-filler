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
 *
 * The report holds still. Rows are ordered once, at the first sweep (unrecognised,
 * then to check, then filled — what needs the user first), and every later input
 * joins the end marked `later`. A row's status may change in place — a Teach fills
 * it — but no row ever moves under the finger that is working the list.
 */

import type { FieldId, FieldMatch, Lesson, MatchConfidence, Profile } from '../shared/types';
import { fieldLabel, fieldValue } from '../shared/profileFields';
import { matchStatus } from '../shared/fieldStatus';
import { hostOf } from '../shared/url';
import { classify, collectCandidates, type Candidate, type Classified } from './fieldDetect';
import {
  clearHighlights, fillCheckbox, fillFileInput, fillRadioGroup, fillTextField, hasValue, highlight,
  unhighlight,
} from './fill';
import { watchPageChange } from './pageChange';

/** How long the page must hold still before a sweep — a page reacting to a click is a burst. */
export const SETTLE_MS = 400;
/** With no new input for this long, the page is done arriving and the watch stands down. */
export const IDLE_STOP_MS = 10 * 60_000;

export interface EngineDeps {
  profile(): Profile;
  lessons(): readonly Lesson[];
  /** The two documents, as Files, or null when none is stored. */
  docs(): { cv: File | null; cover: File | null };
  /** The report changed — re-render whatever shows it. */
  onReport(): void;
  /** These lessons filled something — count them (debounced by the caller). */
  onLessonHits?(ids: string[]): void;
  /** Injectable for jsdom, which has no layout. */
  visible?: (el: HTMLElement) => boolean;
  /** Injectable for tests; the real one is `watchPageChange`. */
  watch?: (cb: () => void) => () => void;
  /** The page's host, for site-pinned lessons. */
  host?: string;
  /**
   * Whether to put a name chip beside each mark. On a page the user is working on —
   * a queue tab, or one they pressed Fill or Teach on — the names are what make the
   * marks readable. On every other site an outline is plenty: a dozen "Email",
   * "City" chips over a shop's checkout is the extension talking over the page.
   */
  showLabels?: () => boolean;
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
}

const RANK: Record<MatchConfidence, number> = { none: 0, low: 1, high: 2 };

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
    document.addEventListener('visibilitychange', this.onVisibility);
    this.watchAgain();
  }

  stop(): void {
    document.removeEventListener('input', this.onUserInput, true);
    document.removeEventListener('change', this.onUserInput, true);
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

  /** Only a *trusted* event is the user — our own fills dispatch untrusted ones. */
  private onUserInput = (e: Event): void => {
    if (!(this.deps.isUserEvent ?? ((ev: Event) => ev.isTrusted))(e)) return;
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

  /**
   * One pass over the page. Returns how many inputs it had not seen before.
   * `fill: false` classifies and reports without writing anything — the popup's
   * Fill presses run with it on regardless of `fillAutomatically`.
   */
  sweep({ fill = true }: { fill?: boolean } = {}): number {
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
      if (fill) this.tryFill(entry);
      else this.paint(entry);
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
      else row.filled = this.write(row.field, cand);
    }
    this.paint(entry);
  }

  /**
   * Mark the input on the page by its outcome. A question nothing recognised is
   * left unmarked: on every site in the world that would be a ring round every
   * search box and comment field — the card's list is where those are taught.
   */
  private paint(entry: Entry): void {
    const { row, cand } = entry;
    const target = cand.group?.[0]?.closest('fieldset') as HTMLElement | null ?? cand.el;
    if (!row.field || row.ignored) {
      unhighlight(target);
      return;
    }
    const label = this.deps.showLabels?.() ? row.fieldLabel : undefined;
    highlight(target, matchStatus(row), label);
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

  /** The candidate behind a row — what a Teach builds its signature from. */
  candidateFor(id: string): Candidate | undefined {
    return this.entry(id)?.cand;
  }

  /** The row for an element the picker landed on, adding one if no sweep listed it. */
  rowForElement(el: HTMLElement): FieldMatch | undefined {
    const existing = this.entryForElement(el);
    if (existing) return existing.row;
    const all = collectCandidates(document, { visible: () => true, known: this.candidates });
    const cand = all.find((c) => c.el === el || c.group?.includes(el as HTMLInputElement));
    if (!cand) return undefined;
    const entry = this.makeEntry({ cand, source: 'none', confidence: 'none' }, true);
    this.seen.set(cand.el, entry);
    this.entries.push(entry);
    this.paint(entry);
    this.deps.onReport();
    return entry.row;
  }

  /** Every candidate on the page — the set a new lesson's signature must be unique in. */
  allCandidates(): Candidate[] {
    return collectCandidates(document, { visible: () => true, known: this.candidates });
  }

  /**
   * Fill one row on the user's say-so — a low-confidence match they confirmed. The
   * user asked for this one, so neither confidence nor an existing value stops it.
   */
  confirm(id: string): boolean {
    const entry = this.entry(id);
    if (!entry?.row.field) return false;
    const ok = this.write(entry.row.field, entry.cand);
    if (ok) { entry.row.filled = true; entry.row.kept = false; }
    this.paint(entry);
    this.deps.onReport();
    return ok;
  }

  /**
   * A row has been taught: point it at a field (and fill it), or set it aside.
   * The row stays where it is; only its status changes.
   */
  applyTeaching(id: string, target: { field: FieldId } | { ignore: true }, lessonId?: string): boolean {
    const entry = this.entry(id);
    if (!entry) return false;
    const row = entry.row;
    if ('ignore' in target) {
      row.ignored = true;
      row.field = undefined;
      row.fieldLabel = undefined;
      row.valueToFill = undefined;
      row.confidence = 'none';
      row.filled = false;
      this.paint(entry);
      this.deps.onReport();
      return true;
    }
    row.ignored = false;
    row.field = target.field;
    row.fieldLabel = fieldLabel(this.deps.profile(), target.field);
    row.valueToFill = this.displayValue(target.field);
    row.source = 'lesson';
    row.confidence = 'high';
    row.taught = true;
    entry.lessonId = lessonId;
    row.filled = this.write(target.field, entry.cand);
    row.kept = false;
    this.paint(entry);
    this.deps.onReport();
    return row.filled;
  }

  /**
   * The profile or the lessons changed (in Options, or a Teach on another tab):
   * look again at every row that is still open — unrecognised, or recognised but not
   * filled — without moving any of them, and without touching what the user typed.
   */
  reconsider(): void {
    const open = this.entries.filter((e) => !e.row.filled && !e.row.kept && !e.row.ignored && !this.isTouched(e.cand));
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
