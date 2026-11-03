/**
 * Shadow-DOM review card: the report — one row per question on the page, what it
 * asked, and what became of it. Read-only: there is nothing to teach any more, the
 * extension learns from what the user types (`learning.ts`), and a row's tag says
 * when it did.
 *
 * The card never sends anything. The one thing left after the fill is the user's
 * own press of the site's Submit button, so the footer is "Fill again" — and, on a
 * queue tab, Skip. Its header carries the extension's on/off switch, the same one
 * the popup has.
 *
 * Closing collapses to a pill instead of destroying the card: the report is the
 * only record of what was filled, and while the extension is on the pill is how
 * the user can tell (`showActivePill`).
 */

import type { FieldMatch, MatchConfidence } from '../../shared/types';
import type { SessionState } from '../../shared/messages';
import { progressDots } from '../../shared/queue';
import { STATUS_LABELS, matchStatus } from '../../shared/fieldStatus';
import { ACTION_LABELS, PILL_ARIA, STATUS_TEXT, SWITCH_ARIA, pillText, savedText } from '../../shared/labels';
import { flowBanner } from '../../shared/flowState';
import { fingerprint } from '../../shared/questionText';
import { CONCEPT_HELP } from '../../shared/help';
import { helpButton, helpPanel } from '../../ui/help';
import { summaryLine } from '../../ui/summaryLine';
import { Sheet, type SheetCallbacks, type SheetData } from '../sheet';
import modalCss from './modal.css?inline';

export interface ModalCallbacks extends SheetCallbacks {
  /** Fill again — every empty, untouched input; never over an answer already there. */
  onRerun(): void;
  /** Mark this posting done, and move a session on to the next one. */
  onSkip(): void;
  /** The header switch — the same act as the popup's: on or off on this browser. */
  onToggle(on: boolean): void;
  onClose(): void;
  /** Put back the detail a correction just saved, and stop filling that box. */
  onUndo?(): void;
}

export interface ModalData extends SheetData {
  siteName: string;
  /** The report, in its settled order. Rows never move; see `fillEngine.ts`. */
  matches: FieldMatch[];
  /** The job database already has this URL down as done. */
  alreadyDone?: boolean;
  doneAt?: number;
  /** The profile has nothing to fill with at all. */
  profileEmpty?: boolean;
  /** Filling and learning are on for this browser — the header switch's state. */
  on: boolean;
  /**
   * Said for a moment on the pill instead of the counts. `saved` names a field a
   * correction just updated in the profile; with `undo`, an Undo is offered beside it.
   */
  flash?: { learned?: string; paused?: boolean; saved?: string; undo?: boolean };
  /** Queue progress — present only on a tab the queue opened. */
  queue?: SessionState;
}

/**
 * The `.chip` tint each outcome wears in the report. A question it does not know is
 * plain, not red: it is the ordinary state of most questions the first time they
 * are seen, and a page of red tags would read as a page of failures.
 */
const TAG_TONE: Record<MatchConfidence, string> = { high: 'ok', low: 'warn', none: '' };

export class FillerModal extends Sheet<ModalData> {
  private cb: ModalCallbacks;
  /** The open `?` on the banner. */
  private helpOpen = false;

  constructor(cb: ModalCallbacks) {
    super('review', 'chromium-filler-modal-host', modalCss, cb);
    this.cb = cb;
  }

  render(data: ModalData): void {
    this.data = data;
    this.paint();
  }

  protected repaint(): void {
    if (this.data) this.render(this.data);
  }

  protected buildCard(): HTMLElement {
    const data = this.data!;
    const card = el('div', 'cf-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', `${data.siteName} — fill report`);
    card.append(this.header(data, card));
    card.append(this.fieldsBody(data));
    if (data.queue) card.append(this.sessionStrip(data.queue));
    card.append(this.footer(data));
    return card;
  }

  protected buildPill(): HTMLElement {
    return this.pill(this.data!);
  }

  /* ---------------- Chrome ---------------- */

  private header(data: ModalData, card: HTMLElement): HTMLElement {
    const header = el('div', 'cf-header');
    header.append(el('div', 'cf-grip'));

    const site = el('span', 'cf-site');
    site.textContent = data.siteName;

    const close = el('button', 'cf-close');
    close.textContent = '×';
    close.setAttribute('aria-label', 'Minimize');
    close.onclick = () => this.cb.onClose();

    header.append(site);
    if (data.alreadyDone) {
      const chip = el('span', 'chip ok cf-sent-chip');
      chip.textContent = 'Done';
      header.append(chip);
    }
    // The report's worst status, so a question still waiting for the user shows
    // on the header even with the rows scrolled away. An empty report has none.
    if (data.matches.some((m) => !m.ignored)) {
      const worst = worstStatus(data.matches);
      const dot = el('span', `cf-dot cf-header-dot ${worst}`);
      dot.setAttribute('role', 'img');
      dot.setAttribute('aria-label', STATUS_LABELS[worst]);
      header.append(dot);
    }
    header.append(this.onSwitch(data), close);
    this.makeDraggable(card, header);
    return header;
  }

  /**
   * The extension's on/off switch — what the user reaches for when the pill says it
   * is on and they are not applying for anything. The same act as the popup's:
   * every tab on this browser stands down, this one included.
   */
  private onSwitch(data: ModalData): HTMLElement {
    const wrap = el('label', 'switch cf-switch');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'switch-input';
    input.checked = data.on;
    input.setAttribute('aria-label', SWITCH_ARIA);
    input.dataset.k = 'switch:on';
    input.onchange = () => this.cb.onToggle(input.checked);
    const track = el('span', 'switch-track');
    track.setAttribute('aria-hidden', 'true');
    track.append(el('i'));
    wrap.append(input, track);
    return wrap;
  }

  /**
   * Fill again and — on a queue tab — Skip. Skip is visible only on a queue tab,
   * where it is the decision the strip above it is read for ("posting 8 of 13 —
   * skip it?");
   * anywhere else there is no queue to skip through, and the job database has no
   * business learning about a shop's checkout page.
   */
  private footer(data: ModalData): HTMLElement {
    const footer = el('div', 'cf-footer');
    if (data.flash?.saved && data.flash.undo) footer.append(this.savedNote(data.flash.saved));
    const banner = this.flowBanner(data);
    if (banner.classList.contains('quiet')) footer.append(banner);

    const actions = el('div', 'cf-footer-actions');
    const fill = btn(ACTION_LABELS.fillAgain, () => this.cb.onRerun());
    fill.classList.add('cf-fill-again');
    actions.append(fill);

    if (data.queue) {
      const skip = btn(ACTION_LABELS.skipNext, () => this.cb.onSkip());
      // Skip on a posting already done has nothing left to finish. Retired, never
      // removed, so the press can still say why.
      if (data.alreadyDone) {
        skip.setAttribute('aria-disabled', 'true');
        skip.setAttribute('aria-label', 'Skip — this posting is already done, press to find out why');
        skip.onclick = () => { this.helpOpen = !this.helpOpen; this.repaint(); };
      }
      actions.append(skip);
    }

    footer.append(actions);
    return footer;
  }

  /** "Saved · First name — Undo", in the open card: the pill's flash, for a card that hides it. */
  private savedNote(field: string): HTMLElement {
    const note = el('div', 'cf-saved-note');
    note.setAttribute('aria-live', 'polite');
    const text = el('span');
    text.textContent = savedText(field);
    note.append(text, this.undoButton());
    return note;
  }

  private undoButton(): HTMLButtonElement {
    const undo = btn(ACTION_LABELS.undo, () => this.cb.onUndo?.());
    undo.classList.add('btn-ghost', 'cf-undo');
    return undo;
  }

  /* ---------------- The flow banner ---------------- */

  private flowBanner(data: ModalData): HTMLElement {
    const counts = statCounts(data.matches);
    const flow = flowBanner({
      alreadyDone: data.alreadyDone,
      doneAt: data.doneAt,
      profileEmpty: data.profileEmpty,
      total: data.matches.filter((m) => !m.ignored).length,
      filled: counts.high,
      fresh: counts.none,
      siteName: data.siteName,
    });

    const box = el('div', `cf-flow ${flow.tone}`);
    const head = el('div', 'cf-flow-head');
    if (flow.tone === 'ok' || flow.tone === 'warn') {
      const dot = el('span', `cf-dot ${flow.tone}`);
      dot.setAttribute('role', 'img');
      dot.setAttribute('aria-label', flow.tone === 'ok' ? 'done' : 'attention');
      head.append(dot);
    }
    const titleLine = el('div', 'cf-flow-titleline');
    const title = el('b', 'cf-flow-title');
    title.textContent = flow.title;
    titleLine.append(title);
    const detail = el('span', 'cf-flow-detail');
    detail.textContent = flow.detail;
    head.append(titleLine, detail);
    if (flow.help) {
      titleLine.append(helpButton(flow.title, this.helpOpen, (open) => { this.helpOpen = open; this.repaint(); }));
    }
    box.append(head);
    if (flow.help && this.helpOpen) box.append(helpPanel(CONCEPT_HELP[flow.help]));
    return box;
  }

  /* ---------------- The report ---------------- */

  /** Every question on the page, and what became of it. */
  private fieldsBody(data: ModalData): HTMLElement {
    const body = el('div', 'cf-body');
    const banner = this.flowBanner(data);
    if (!banner.classList.contains('quiet')) body.append(banner);

    const counts = statCounts(data.matches);
    body.append(summaryLine((['high', 'low', 'none'] as const).map((status) => ({
      dot: status,
      count: counts[status],
      word: STATUS_TEXT[status].word,
      aria: STATUS_LABELS[status],
    }))));

    if (!data.matches.length) return body;

    const report = el('div', 'cf-report');
    let laterShown = false;
    for (const m of data.matches) {
      if (m.later && !laterShown) {
        laterShown = true;
        const divider = el('div', 'cf-later');
        divider.textContent = 'Appeared later';
        report.append(divider);
      }
      report.append(this.row(m));
    }
    body.append(report);
    return body;
  }

  /**
   * The folded card — and, while the extension is on, the mark on every page that
   * says so. With nothing in the report it carries a live mark instead of a status
   * dot ("On · learning"); a lesson just learned is named on it for a moment.
   */
  private pill(data: ModalData): HTMLElement {
    const pill = el('button', 'cf-pill');
    const counts = statCounts(data.matches);
    const rows = data.matches.filter((m) => !m.ignored).length;
    const live = !rows && !data.alreadyDone;
    const mark = live || data.flash
      ? el('span', `cf-live${data.flash?.paused ? ' off' : ''}`)
      : el('span', `cf-dot ${data.alreadyDone ? 'ok' : worstStatus(data.matches)}`);
    mark.setAttribute('aria-hidden', 'true');
    pill.setAttribute('aria-label', PILL_ARIA);
    const label = el('span', 'cf-pill-text');
    label.setAttribute('aria-live', 'polite');
    label.textContent = pillText({
      filled: counts.high,
      fresh: counts.none,
      rows,
      alreadyDone: data.alreadyDone,
      learned: data.flash?.learned,
      paused: data.flash?.paused,
      saved: data.flash?.saved,
    });
    pill.append(mark, label);
    pill.onclick = () => this.restore();
    if (!data.flash?.undo) return pill;
    // Undo sits beside the pill, never inside it: a button in a button is not a
    // control anyone can reach. The pair wears the pill's look as one object.
    pill.className = 'cf-pill-main';
    const pair = el('div', 'cf-pill cf-pill-pair');
    pair.append(pill, this.undoButton());
    return pair;
  }

  /** Where this posting sits in the queue. Shown on a queue tab only. */
  private sessionStrip(session: SessionState): HTMLElement {
    const strip = el('div', 'cf-session');
    const text = el('span', 'cf-progress');
    const { done, total, queued } = session.progress;
    text.textContent = `${done}/${total} done · ${queued} waiting`;
    strip.append(text);
    const dots = progressDots(session.progress);
    if (dots.length) {
      const row = el('div', 'cf-qdots');
      row.setAttribute('aria-hidden', 'true');
      for (const kind of dots) row.append(el('span', `cf-qd ${kind}`));
      strip.append(row);
    }
    return strip;
  }

  /* ---------------- Rows ---------------- */

  private row(m: FieldMatch): HTMLElement {
    const status = matchStatus(m);
    const row = el('div', `cf-row${m.ignored ? ' cf-ignored' : ''}`);
    row.dataset.row = m.id;
    const dot = el('span', `cf-dot ${status}`);
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', m.ignored ? 'ignored' : STATUS_LABELS[status]);
    row.append(dot);

    const field = el('div', 'cf-field');
    const name = el('b');
    name.textContent = m.question || `Unlabelled ${KIND_NAMES[m.kind] ?? 'field'}`;
    const detail = el('small');
    detail.textContent = rowDetail(m);
    detail.title = detail.textContent;
    field.append(name, detail);
    row.append(field);

    const tag = el('span', `chip cf-tag ${m.ignored ? '' : TAG_TONE[status]}`.trimEnd());
    tag.textContent = rowTag(m, status);
    row.append(tag);
    return row;
  }
}

/** The row's tag: what the user's typing made of it, else its status word. */
function rowTag(m: FieldMatch, status: MatchConfidence): string {
  if (m.ignored) return ACTION_LABELS.ignored;
  if (m.saved) return ACTION_LABELS.saved;
  if (m.learned) return ACTION_LABELS.learned;
  if (m.answered && !m.filled) return ACTION_LABELS.answered;
  return STATUS_TEXT[status].word;
}

const KIND_NAMES: Partial<Record<FieldMatch['kind'], string>> = {
  text: 'text box', email: 'email box', tel: 'phone box', url: 'link box', number: 'number box',
  date: 'date', textarea: 'text area', select: 'drop-down', radio: 'choice', checkbox: 'checkbox',
  file: 'upload', editable: 'text box',
};

/**
 * The row's second line: what it was taken for, and what went in. The field's name
 * is left off when the question already says it — "Email / Email · ada@…" is the
 * same word twice — and kept whenever the two differ, because then the name *is*
 * the news: "Where are you based? / City · London".
 */
function rowDetail(m: FieldMatch): string {
  if (m.ignored) return 'Not filled from now on';
  if (m.saved && m.field) return `${m.fieldLabel ?? m.field} · saved to your profile`;
  if (m.answered && !m.filled) {
    if (!m.field) return 'Your answer';
    return m.learned ? `${m.fieldLabel ?? m.field} · learned from your answer` : `${m.fieldLabel ?? m.field} · your answer`;
  }
  if (!m.field) return m.required ? 'Not recognised yet · required' : 'Not recognised yet';
  const label = m.fieldLabel ?? m.field;
  if (fingerprint(m.question) === fingerprint(label)) {
    if (m.kind === 'file') return m.filled ? (m.valueToFill ?? 'Attached') : m.valueToFill ? 'Not attached yet' : 'Nothing stored to attach';
    if (m.kept) return 'Kept the answer already there';
    if (!m.valueToFill) return 'Nothing in your profile for this';
    if (m.filled) return m.valueToFill;
    if (m.confidence === 'low') return `${m.valueToFill}?`;
    return `Would not take “${m.valueToFill}”`;
  }
  const name = label;
  if (m.kind === 'file') {
    if (m.filled) return `${name} · ${m.valueToFill ?? 'attached'}`;
    return m.valueToFill ? `${name}?` : `${name} · nothing stored to attach`;
  }
  if (m.kept) return `${name} · kept the answer already there`;
  if (!m.valueToFill) return `${name} · nothing in your profile for this`;
  if (m.filled) return `${name} · ${m.valueToFill}`;
  if (m.confidence === 'low') return `${name}? · ${m.valueToFill}`;
  return `${name} · would not take “${m.valueToFill}”`;
}

/**
 * The report in three buckets, keyed by the same `matchStatus` the dots use, so
 * the summary, the tiles and the rows never count a row into different columns.
 * Ignored rows are in none of them: they asked nothing of anyone.
 */
function statCounts(matches: FieldMatch[]): Record<MatchConfidence, number> {
  const counts: Record<MatchConfidence, number> = { high: 0, low: 0, none: 0 };
  for (const m of matches) if (!m.ignored) counts[matchStatus(m)] += 1;
  return counts;
}

/** The worst outcome in the report — what the header dot advertises. */
function worstStatus(matches: FieldMatch[]): MatchConfidence {
  const statuses = matches.filter((m) => !m.ignored).map(matchStatus);
  if (statuses.includes('none')) return 'none';
  return statuses.includes('low') ? 'low' : 'high';
}

function el(tag: string, className = ''): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function btn(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'cf-btn';
  b.textContent = text;
  b.onclick = onClick;
  return b;
}
