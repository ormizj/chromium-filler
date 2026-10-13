/**
 * Shadow-DOM review card: the report — one row per question on the page, what it
 * asked, what went in, and, for anything not recognised, a way to teach it.
 *
 * The card never sends anything. The one thing left after the fill is the user's
 * own press of the site's Submit button, so the footer is "Fill again" and
 * "Teach" (point at a field the report did not list) — and, on a queue tab, Skip.
 *
 * Closing collapses to a pill instead of destroying the card: the report is the
 * only record of what was filled, and on mobile the card is the primary control.
 */

import type { FieldId, FieldMatch, MatchConfidence } from '../../shared/types';
import type { SessionState } from '../../shared/messages';
import { progressDots } from '../../shared/queue';
import type { FieldChoice } from '../../shared/profileFields';
import { STATUS_LABELS, matchStatus } from '../../shared/fieldStatus';
import { ACTION_LABELS, STATUS_TEXT } from '../../shared/labels';
import { flowBanner } from '../../shared/flowState';
import { fingerprint } from '../../shared/questionText';
import { CONCEPT_HELP } from '../../shared/help';
import { helpButton, helpPanel } from '../../ui/help';
import { summaryLine } from '../../ui/summaryLine';
import { Sheet, type SheetCallbacks, type SheetData } from '../sheet';
import modalCss from './modal.css?inline';

/** What a Teach can say a row is. */
export type TeachChoice =
  | { field: FieldId }
  | { ignore: true }
  | { newField: { label: string; value: string } };

export interface ModalCallbacks extends SheetCallbacks {
  /** Fill again — every empty, untouched input; never over an answer already there. */
  onRerun(): void;
  /** Fill one row the extension only guessed at, on the user's say-so. */
  onConfirm(rowId: string): void;
  /** Teach one row: a field, a new field, or "ignore this question". */
  onTeach(rowId: string, choice: TeachChoice): void;
  /** Teach: point at a field on the page the report did not list. */
  onPoint(): void;
  /** Mark this posting done, and move a session on to the next one. */
  onSkip(): void;
  onClose(): void;
}

export interface ModalData extends SheetData {
  siteName: string;
  /** The report, in its settled order. Rows never move; see `fillEngine.ts`. */
  matches: FieldMatch[];
  /** Rows Confirm has been pressed on — an acknowledgement, never a status. */
  confirmed?: string[];
  /** The job database already has this URL down as done. */
  alreadyDone?: boolean;
  doneAt?: number;
  /** The profile has nothing to fill with at all. */
  profileEmpty?: boolean;
  /** What a row can be taught as. */
  choices: FieldChoice[];
  /** Queue progress — present only on a tab the queue opened. */
  queue?: SessionState;
}

/**
 * The `.chip` tint each outcome wears in the report. A question to teach is plain,
 * not red: it is the ordinary state of most questions the first time they are seen,
 * and a page of red tags would read as a page of failures.
 */
const TAG_TONE: Record<MatchConfidence, string> = { high: 'ok', low: 'warn', none: '' };

/** The chooser's two values that are not a field. */
const NEW_FIELD = '__new';
const IGNORE = '__ignore';

interface TeachState {
  rowId: string;
  /** The `<select>`'s value: a field id, `NEW_FIELD` or `IGNORE`. */
  choice: string;
  label: string;
  value: string;
}

export class FillerModal extends Sheet<ModalData> {
  private cb: ModalCallbacks;
  /** The open `?` on the banner. */
  private helpOpen = false;
  /** The open Teach chooser, and what has been typed into it. On the instance
   *  because the engine re-renders the card while the user works in it. */
  private teaching?: TeachState;

  constructor(cb: ModalCallbacks) {
    super('review', 'chromium-filler-modal-host', modalCss, cb);
    this.cb = cb;
  }

  render(data: ModalData): void {
    this.data = data;
    // A chooser whose row is gone (a Reset) has nothing left to teach.
    if (this.teaching && !data.matches.some((m) => m.id === this.teaching!.rowId)) this.teaching = undefined;
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

  /**
   * Open the Teach chooser on one row — from the row's own button, and from the
   * picker once the user has pointed at a field. Public for the second, and for
   * the dev harness, which cannot press anything.
   */
  openTeach(rowId: string, opts: { newField?: boolean } = {}): void {
    const row = this.data?.matches.find((m) => m.id === rowId);
    if (!row) return;
    this.teaching = {
      rowId,
      choice: opts.newField ? NEW_FIELD : row.field ?? '',
      label: row.question,
      value: '',
    };
    this.restore();
    if (this.data) this.render(this.data);
  }

  private closeTeach(): void {
    this.teaching = undefined;
    if (this.data) this.render(this.data);
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
    header.append(close);
    this.makeDraggable(card, header);
    return header;
  }

  /**
   * Fill again, Teach, and — on a queue tab — Skip. Teach is the popup's Teach:
   * point at a field the report did not list. Skip is visible only on a queue tab,
   * where it is the decision the strip above it is read for ("posting 8 of 13 —
   * skip it?");
   * anywhere else there is no queue to skip through, and the job database has no
   * business learning about a shop's checkout page.
   */
  private footer(data: ModalData): HTMLElement {
    const footer = el('div', 'cf-footer');
    const banner = this.flowBanner(data);
    if (banner.classList.contains('quiet')) footer.append(banner);

    const actions = el('div', 'cf-footer-actions');
    const fill = btn(ACTION_LABELS.fillAgain, () => this.cb.onRerun());
    fill.classList.add('cf-fill-again');
    actions.append(
      fill,
      btn(ACTION_LABELS.teach, () => this.cb.onPoint()),
    );

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

  /* ---------------- The flow banner ---------------- */

  private flowBanner(data: ModalData): HTMLElement {
    const counts = statCounts(data.matches);
    const flow = flowBanner({
      alreadyDone: data.alreadyDone,
      doneAt: data.doneAt,
      profileEmpty: data.profileEmpty,
      total: data.matches.filter((m) => !m.ignored).length,
      filled: counts.high,
      toTeach: counts.none,
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

    if (!data.matches.length) {
      const empty = el('p', 'cf-empty');
      empty.textContent = 'No fields on this page yet. Anything that appears is checked as it does.';
      body.append(empty);
      return body;
    }

    const confirmed = new Set(data.confirmed);
    const report = el('div', 'cf-report');
    let laterShown = false;
    for (const m of data.matches) {
      if (m.later && !laterShown) {
        laterShown = true;
        const divider = el('div', 'cf-later');
        divider.textContent = 'Appeared later';
        report.append(divider);
      }
      report.append(this.row(m, confirmed.has(m.id)));
      if (this.teaching?.rowId === m.id) report.append(this.teachPanel(m, data));
    }
    body.append(report);
    return body;
  }

  private pill(data: ModalData): HTMLElement {
    const pill = el('button', 'cf-pill');
    const counts = statCounts(data.matches);
    const dot = el('span', `cf-dot ${data.alreadyDone ? 'ok' : worstStatus(data.matches)}`);
    pill.setAttribute('aria-label', 'Reopen the fill report');
    const label = el('span');
    label.textContent = data.alreadyDone
      ? 'Already done'
      : counts.none
        ? `${counts.high} filled · ${counts.none} to teach`
        : `${counts.high} filled`;
    pill.append(dot, label);
    pill.onclick = () => this.restore();
    return pill;
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

  private row(m: FieldMatch, confirmed: boolean): HTMLElement {
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
    tag.textContent = m.ignored ? ACTION_LABELS.ignored : STATUS_TEXT[status].word;
    row.append(tag);

    const actions = el('div', 'cf-actions');
    const teachBtn = (label: string) => {
      const b = btn(label, () => (this.teaching?.rowId === m.id ? this.closeTeach() : this.openTeach(m.id)));
      b.setAttribute('aria-expanded', String(this.teaching?.rowId === m.id));
      return b;
    };
    if (m.taught) {
      const done = btn(ACTION_LABELS.taught, () => {});
      done.setAttribute('aria-disabled', 'true');
      actions.append(done);
    } else if (!m.field && !m.ignored) {
      actions.append(teachBtn(ACTION_LABELS.teach));
    } else {
      // A guess with something to fill it with can be confirmed in place. Once it
      // has been, the row turns green where it stands and its button retires —
      // the press is acknowledged on the row it was made on.
      if (confirmed) {
        const done = btn(ACTION_LABELS.confirmed, () => {});
        done.setAttribute('aria-disabled', 'true');
        actions.append(done);
      } else if (m.field && !m.filled && !m.kept && m.confidence === 'low' && m.valueToFill) {
        actions.append(btn(ACTION_LABELS.confirm, () => this.cb.onConfirm(m.id)));
      }
      actions.append(teachBtn(ACTION_LABELS.notThis));
    }
    row.append(actions);
    return row;
  }

  /**
   * The Teach chooser, inline under its row rather than a popover: on a phone a
   * popover over a list is a second thing to scroll, and the row it is about would
   * be underneath it. One select, grouped the way Options groups the fields, and
   * two answers that are not a field — a new one, made here, or "ignore".
   */
  private teachPanel(m: FieldMatch, data: ModalData): HTMLElement {
    const t = this.teaching!;
    const panel = el('div', 'cf-teach');
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', `Teach: ${m.question || 'this field'}`);

    const label = el('label', 'cf-fld-label');
    label.textContent = 'This is';
    const select = document.createElement('select');
    select.className = 'cf-input';
    select.dataset.k = 'teach:choice';
    const placeholder = new Option('Choose…', '');
    placeholder.disabled = true;
    select.append(placeholder);
    for (const [group, heading] of [['builtIn', 'Your details'], ['custom', 'Your own fields']] as const) {
      const items = data.choices.filter((c) => c.group === group);
      if (!items.length) continue;
      const og = document.createElement('optgroup');
      og.label = heading;
      for (const c of items) og.append(new Option(c.label, c.id));
      select.append(og);
    }
    const other = document.createElement('optgroup');
    other.label = 'Something else';
    other.append(new Option(ACTION_LABELS.newField, NEW_FIELD), new Option(ACTION_LABELS.ignore, IGNORE));
    select.append(other);
    select.value = t.choice;
    select.onchange = () => { t.choice = select.value; this.repaint(); };
    const selectId = `cf-teach-${m.id}`;
    select.id = selectId;
    label.setAttribute('for', selectId);
    panel.append(label, select);

    if (t.choice === NEW_FIELD) {
      panel.append(
        this.textBox('Field name', 'teach:label', t.label, (v) => { t.label = v; }),
        this.textBox('Your answer', 'teach:value', t.value, (v) => { t.value = v; }),
      );
    }

    const actions = el('div', 'cf-teach-actions');
    const ready = t.choice === NEW_FIELD ? !!t.label.trim() : !!t.choice;
    const save = btn(ACTION_LABELS.save, () => {
      if (!ready) return;
      const choice: TeachChoice = t.choice === IGNORE
        ? { ignore: true }
        : t.choice === NEW_FIELD
          ? { newField: { label: t.label.trim(), value: t.value } }
          : { field: t.choice };
      // Closed before the callback, not after: the teach is async (a new field, a
      // lesson to store) and the row should not sit there open while it runs.
      this.closeTeach();
      this.cb.onTeach(m.id, choice);
    });
    if (!ready) save.setAttribute('aria-disabled', 'true');
    actions.append(btn(ACTION_LABELS.cancel, () => this.closeTeach()), save);
    panel.append(actions);
    return panel;
  }

  private textBox(caption: string, key: string, value: string, set: (v: string) => void): HTMLElement {
    const wrap = el('label', 'cf-fld');
    const cap = el('span', 'cf-fld-label');
    cap.textContent = caption;
    const input = document.createElement('input');
    input.className = 'cf-input';
    input.dataset.k = key;
    input.value = value;
    input.oninput = () => {
      set(input.value);
      // Save's availability follows the name box; repaint only on the edge.
      const save = this.shadow.querySelector<HTMLButtonElement>('.cf-teach-actions .cf-btn:last-child');
      const ready = !!this.teaching?.label.trim();
      if (save) {
        if (ready) save.removeAttribute('aria-disabled');
        else save.setAttribute('aria-disabled', 'true');
      }
    };
    wrap.append(cap, input);
    return wrap;
  }
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
  if (m.ignored) return 'Never filled';
  if (!m.field) return m.required ? 'Not recognised · required' : 'Not recognised';
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

function btn(text: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `cf-btn${primary ? ' primary' : ''}`;
  b.textContent = text;
  b.onclick = onClick;
  return b;
}
