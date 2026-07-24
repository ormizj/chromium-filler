/**
 * Shadow-DOM Setup panel: the on-page, visual way to build or reconfigure a
 * site config. Lets the user Pick the job title / description / requirements
 * containers and every profile form field (+ CV upload) directly on the page,
 * showing a live preview of what each saved selector currently resolves to.
 *
 * The panel is a dumb renderer: the Controller computes previews/`found` from
 * the DOM and supplies callbacks, mirroring the review modal's design.
 */

import type { FieldKey, PrepAction } from '../shared/types';
import {
  CONCEPT_HELP, DOT_LEGEND, SETUP_GROUP_HELP, SETUP_GROUP_TITLES, type SetupGroupKey,
} from '../shared/help';
import { BASE_CSS } from '../ui/shadowCss';
import { helpButton, helpPanel, richText } from '../ui/help';
import setupCss from './setupPanel.css?inline';

export type ContainerKey = 'jobTitle' | 'jobDescription' | 'jobRequirements';

/**
 * Which step list a prep row belongs to: pre-fill steps, pre-handoff steps, or
 * the CV-confirmation steps the review modal's Apply runs before sending.
 */
export type PrepListKey = 'prep' | 'beforeFollow' | 'submitCv';

/** Dot colour: high = matched (green), low = weak match (yellow), none = nothing (grey). */
export type RowStatus = 'high' | 'low' | 'none';

export interface SetupRow {
  /** ContainerKey for job-info rows, FieldKey for form-field rows. */
  key: string;
  label: string;
  status: RowStatus;
  /** Detail line, e.g. "auto · #email" or "saved · h1.title" or "not found". */
  note: string;
  /** Whether an explicit selector is saved for this row (enables Clear + "Re-pick"). */
  hasSave: boolean;
}

const DOT: Record<RowStatus, string> = { high: 'ok', low: 'warn', none: 'none' };

/** One prerequisite step, in run order. */
export interface PrepRow {
  action: PrepAction;
  selector?: string;
  ms?: number;
  /** Whether the step's target currently resolves on the page (for the status dot). */
  resolves?: boolean;
}

export interface SetupData {
  name: string;
  urlPattern: string;
  prep: PrepRow[];
  containers: SetupRow[];
  fields: SetupRow[];
  /** Live quick-apply vs. external-redirect verdict for the page being set up. */
  verdict: string;
  /** Redirect-classification selectors (apply link, quick-apply / external markers). */
  redirect: SetupRow[];
  /** Steps run on the posting before following an external apply link. */
  beforeFollow: PrepRow[];
  /**
   * Steps the review modal's Apply runs before pressing Send, for sites where
   * attaching the file is a separate dialog that has to be confirmed. Empty is
   * the normal state: most sites take the CV the moment it is attached.
   */
  submitCv: PrepRow[];
  /**
   * The site's Send button — the control the review modal's Apply presses. Grey
   * means none was found, which is what greys Apply out, so this row is the one
   * place a user can do something about it.
   */
  submit: SetupRow;
  /**
   * The site's confirmation element. Grey means the posting can never be
   * recorded as applied — and, because nothing unverifiable is sent, that Apply
   * is greyed out too. It is the one row that has to be filled in per site.
   */
  success: SetupRow;
  /**
   * Whether the user has already dismissed the legend. False opens it, so a
   * first-time user is told what the dots and the `auto ·` prefixes mean before
   * being asked to act on them.
   */
  helpSeen: boolean;
}

export interface SetupCallbacks {
  onAddPrep(action: PrepAction, list: PrepListKey): void;
  onPickPrepTarget(index: number, list: PrepListKey): void;
  onMovePrep(index: number, dir: -1 | 1, list: PrepListKey): void;
  onRemovePrep(index: number, list: PrepListKey): void;
  onSetPrepMs(index: number, ms: number, list: PrepListKey): void;
  onRunPrep(): void;
  onPickContainer(key: ContainerKey): void;
  onClearContainer(key: ContainerKey): void;
  onPickField(field: FieldKey): void;
  onClearField(field: FieldKey): void;
  onPickRedirect(key: string): void;
  onClearRedirect(key: string): void;
  /** Save the control Apply should press on this site. */
  onPickSubmit(): void;
  onClearSubmit(): void;
  /** Save the element that only appears once the application really went in. */
  onPickSuccess(): void;
  onClearSuccess(): void;
  onRename(name: string, urlPattern: string): void;
  onOpenOptions(): void;
  /** The legend was dismissed — persist it so the next posting stays quiet. */
  onDismissHelp(): void;
  onClose(): void;
}

const PREP_LABEL: Record<PrepAction, string> = {
  click: 'Click',
  waitFor: 'Wait for',
  scrollIntoView: 'Scroll to',
  delay: 'Delay',
};

export class SetupPanel {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private cb: SetupCallbacks;
  /** Groups the user opened by hand; re-renders must not fold them back up. */
  private openGroups = new Set<string>();
  /** Same for the `?` explanations — a re-scan mid-read must not close one. */
  private openHelp = new Set<SetupGroupKey>();
  /** The legend, once dismissed, stays folded for the rest of this page too. */
  private legendDismissed = false;
  /** Last data rendered, so opening a `?` can re-render without the Controller. */
  private last?: SetupData;

  constructor(cb: SetupCallbacks) {
    this.cb = cb;
    this.host = document.createElement('div');
    this.host.id = 'chromium-filler-setup-host';
    this.host.style.setProperty('all', 'initial');
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `${BASE_CSS}\n${setupCss}`;
    this.shadow.appendChild(style);
    document.documentElement.appendChild(this.host);
  }

  /** Hide/show the whole panel (used to get it out of the picker's way). */
  setHidden(hidden: boolean): void {
    this.host.style.display = hidden ? 'none' : '';
  }

  render(data: SetupData): void {
    this.last = data;
    const existing = this.shadow.querySelector('.cf-card');
    if (existing) existing.remove();

    const card = el('div', 'cf-card');

    // Header (drag handle)
    const header = el('div', 'cf-header');
    header.append(el('div', 'cf-grip'));
    const title = el('span', 'cf-heading');
    title.textContent = 'Set up this site';
    const close = el('button', 'cf-close');
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close');
    close.onclick = () => this.cb.onClose();
    header.append(title, close);
    this.makeDraggable(card, header);

    const body = el('div', 'cf-body');

    // One sentence answering "what am I looking at", above everything. The
    // panel used to open straight onto five jargon headings.
    const intro = el('p', 'cf-intro');
    intro.textContent = 'Teach the extension how to read and fill this site. '
      + 'It sends nothing until you press Apply.';
    body.append(intro, this.legend(data));

    // Identity
    const identity = el('div', 'cf-identity');
    const nameInput = input('Name', data.name);
    const patternInput = input('URL pattern', data.urlPattern);
    const persistMeta = () => this.cb.onRename(nameInput.value.trim(), patternInput.value.trim());
    nameInput.onchange = persistMeta;
    patternInput.onchange = persistMeta;
    identity.append(field('Name', nameInput), field('URL pattern', patternInput));

    // Every section stacked open is a wall on a phone. Each one collapses, and
    // the ones still holding unresolved rows open themselves — so the panel
    // opens on exactly the work that is left.
    const jobInfoTodo = countTodo(data.containers);
    // The Send button counts with the fields, but only when nothing was found:
    // a greyed Apply is real work. A button found by its label is the ordinary
    // healthy state, and counting that labelled every site "1 to do" — the same
    // mistake the redirect selectors below are careful not to make.
    const fieldsTodo = countTodo(data.fields)
      + (data.submit.status === 'none' ? 1 : 0)
      // Always work when unset: without it nothing on this site can ever be
      // recorded as applied, and Apply refuses to send. There is no healthy
      // "not set" for this one, unlike the redirect selectors.
      + (data.success.status === 'none' ? 1 : 0);
    // Redirect selectors are optional overrides — "not set" is the ordinary
    // state for a quick-apply site, so only a saved selector that no longer
    // resolves counts as work. Counting them like the other groups labelled
    // every healthy site "2 to do".
    const redirectTodo = data.redirect.filter((r) => r.status === 'low').length;
    const nothingTodo = jobInfoTodo + fieldsTodo + redirectTodo === 0;

    const site = this.group('site', 0, false);
    site.body.append(identity);

    const steps = this.group('steps', 0, false);
    const prepHead = el('div', 'cf-section-row');
    prepHead.append(sectionHead('Run in order before filling'));
    prepHead.append(btn('Run steps ▶', () => this.cb.onRunPrep(), true));
    steps.body.append(prepHead);
    this.appendPrepList(steps.body, data.prep, 'prep');

    // Application type: does this posting apply here, or on the employer's site?
    const kind = this.group('kind', redirectTodo, redirectTodo > 0);
    const verdict = el('div', 'cf-verdict');
    verdict.textContent = data.verdict;
    verdict.title = data.verdict;
    kind.body.append(verdict);
    for (const row of data.redirect) {
      kind.body.append(this.row(row,
        () => this.cb.onPickRedirect(row.key),
        () => this.cb.onClearRedirect(row.key)));
    }
    kind.body.append(sectionHead('Before leaving — run on the posting first, e.g. “Save job”'));
    this.appendPrepList(kind.body, data.beforeFollow, 'beforeFollow');

    // Job info containers
    const info = this.group('info', jobInfoTodo, jobInfoTodo > 0);
    for (const row of data.containers) {
      info.body.append(this.row(row,
        () => this.cb.onPickContainer(row.key as ContainerKey),
        () => this.cb.onClearContainer(row.key as ContainerKey)));
    }

    // Form fields
    const fields = this.group('fields', fieldsTodo, fieldsTodo > 0 || nothingTodo);
    fields.body.append(sectionHead('Pick only what stays grey'));
    for (const row of data.fields) {
      fields.body.append(this.row(row,
        () => this.cb.onPickField(row.key as FieldKey),
        () => this.cb.onClearField(row.key as FieldKey)));
    }
    // Sits under the CV row it is about: a few sites only register the file once
    // a dialog is confirmed, and these are the clicks that do it.
    fields.body.append(sectionHead('After attaching the CV — extra clicks this site needs'));
    this.appendPrepList(fields.body, data.submitCv, 'submitCv');

    // Last, in the order they happen: press this, then look for that.
    fields.body.append(sectionHead('The button Apply presses'));
    fields.body.append(this.row(data.submit,
      () => this.cb.onPickSubmit(),
      () => this.cb.onClearSubmit()));
    // Pick this one *after* sending, when the confirmation is on screen — which
    // is the only moment it exists. The note on the row says so.
    // The instruction lives in the heading rather than the row's note: the note
    // truncates to one line, and "pick this once a confirmation is on screen" is
    // the whole trick — it does not exist on the page you are looking at.
    fields.body.append(sectionHead('How this site says it worked — pick it with a confirmation on screen'));
    fields.body.append(this.row(data.success,
      () => this.cb.onPickSuccess(),
      () => this.cb.onClearSuccess()));

    body.append(site.el, steps.el, kind.el, info.el, fields.el);

    // Footer
    const footer = el('div', 'cf-footer');
    footer.append(
      btn('Advanced (JSON)', () => this.cb.onOpenOptions()),
      btn('Done', () => this.cb.onClose(), true),
    );

    card.append(header, body, footer);
    this.shadow.append(card);
  }

  /**
   * The legend: what the dots, the `auto ·` / `saved ·` prefixes and the "to do"
   * chip actually mean. Open until dismissed once — none of that vocabulary is
   * guessable, and all of it is on screen from the first render.
   */
  private legend(data: SetupData): HTMLElement {
    const details = document.createElement('details');
    details.className = 'cf-legend';
    details.open = !data.helpSeen && !this.legendDismissed;

    const summary = document.createElement('summary');
    const label = el('span');
    label.textContent = 'What the rows mean';
    summary.append(label);
    details.append(summary);

    const body = el('div', 'cf-legend-body');

    // The dots are shown, not described — a colour key made of words is not a
    // key. Each is the real `.cf-dot`, glyph included.
    for (const { status, label } of DOT_LEGEND) {
      const line = el('div', 'cf-legend-dot');
      const text = el('span');
      text.textContent = label;
      line.append(el('span', `cf-dot ${status}`), text);
      body.append(line);
    }

    // One line each for the rest of the vocabulary. The full explanations are a
    // tap away behind each section's `?`; a legend that has to be scrolled past
    // to reach the work is worse than no legend.
    for (const key of ['autoVsSaved', 'picker', 'todoChip'] as const) {
      const entry = CONCEPT_HELP[key];
      const line = el('p', 'cf-legend-line');
      line.append(...richText(entry.short ?? entry.body));
      body.append(line);
    }

    const dismiss = btn('Got it', () => {
      this.legendDismissed = true;
      details.open = false;
      this.cb.onDismissHelp();
    });
    dismiss.className = 'cf-btn cf-legend-dismiss';
    body.append(dismiss);

    details.append(body);
    return details;
  }

  /**
   * A collapsible section. `todo` is how many rows still need attention — shown
   * as a chip so a collapsed group still says whether it can be ignored. The `?`
   * discloses that section's explanation as the first thing inside its body,
   * which is why it is built here rather than by each caller.
   */
  private group(key: SetupGroupKey, todo: number, open: boolean): { el: HTMLElement; body: HTMLElement } {
    const title = SETUP_GROUP_TITLES[key];
    const details = document.createElement('details');
    details.className = 'cf-group';
    details.open = open || this.openGroups.has(title);

    const summary = document.createElement('summary');
    const label = el('span');
    label.textContent = title;
    summary.append(label);
    if (todo > 0) {
      const chip = el('span', 'chip warn cf-group-count');
      chip.textContent = `${todo} to do`;
      summary.append(chip);
    }

    const helpOpen = this.openHelp.has(key);
    summary.append(helpButton(title, helpOpen, (next) => {
      if (next) {
        this.openHelp.add(key);
        // Reading the explanation is a reason to see the section, never to lose
        // it. This goes into the persistent set, not onto `details.open`: the
        // re-render below replaces this element, and the `toggle` event that
        // would have recorded it fires too late to be seen by that render.
        this.openGroups.add(title);
      } else {
        this.openHelp.delete(key);
      }
      this.refresh();
    }));
    details.append(summary);

    // Remember what the user opened, so a re-scan doesn't collapse it under them.
    details.addEventListener('toggle', () => {
      if (details.open) this.openGroups.add(title);
      else this.openGroups.delete(title);
    });

    const body = el('div', 'cf-group-body');
    if (helpOpen) body.append(helpPanel(SETUP_GROUP_HELP[key]));
    details.append(body);
    return { el: details, body };
  }

  /** Re-render from the last data — the panel is a pure function of it. */
  private refresh(): void {
    if (this.last) this.render(this.last);
  }

  /** A step list plus its "+ step" bar; both prep lists render identically. */
  private appendPrepList(body: HTMLElement, steps: PrepRow[], list: PrepListKey): void {
    steps.forEach((step, i) => body.append(this.prepRow(step, i, steps.length, list)));
    const addBar = el('div', 'cf-addbar');
    addBar.append(
      btn('+ Click', () => this.cb.onAddPrep('click', list)),
      btn('+ Wait for', () => this.cb.onAddPrep('waitFor', list)),
      btn('+ Delay', () => this.cb.onAddPrep('delay', list)),
    );
    body.append(addBar);
  }

  private prepRow(step: PrepRow, i: number, total: number, list: PrepListKey): HTMLElement {
    const row = el('div', 'cf-row');
    const selectorBased = step.action !== 'delay';
    const status = !selectorBased ? 'ok' : step.selector ? (step.resolves ? 'ok' : 'warn') : 'none';
    row.append(el('span', `cf-dot ${status}`));

    const info = el('div', 'cf-field');
    const name = el('b');
    name.textContent = `${i + 1}. ${PREP_LABEL[step.action]}`;
    const detail = el('small');
    detail.textContent = selectorBased
      ? (step.selector ?? 'no target — Pick one')
      : `${step.ms ?? 0} ms`;
    detail.title = detail.textContent;
    info.append(name, detail);
    row.append(info);

    const actions = el('div', 'cf-actions');
    if (step.action === 'delay' || step.action === 'waitFor') {
      const ms = document.createElement('input');
      ms.type = 'number';
      ms.className = 'cf-ms';
      ms.value = String(step.ms ?? (step.action === 'waitFor' ? 10000 : 500));
      ms.title = step.action === 'waitFor' ? 'timeout (ms)' : 'delay (ms)';
      ms.onchange = () => this.cb.onSetPrepMs(i, Math.max(0, Number(ms.value) || 0), list);
      actions.append(ms);
    }
    if (selectorBased) {
      actions.append(btn(step.selector ? 'Re-pick' : 'Pick', () => this.cb.onPickPrepTarget(i, list), true));
    }
    const up = btn('↑', () => this.cb.onMovePrep(i, -1, list));
    const down = btn('↓', () => this.cb.onMovePrep(i, 1, list));
    if (i === 0) up.setAttribute('disabled', 'true');
    if (i === total - 1) down.setAttribute('disabled', 'true');
    actions.append(up, down, btn('✕', () => this.cb.onRemovePrep(i, list)));
    row.append(actions);
    return row;
  }

  private row(m: SetupRow, onPick: () => void, onClear: () => void): HTMLElement {
    const row = el('div', 'cf-row');
    row.append(el('span', `cf-dot ${DOT[m.status]}`));

    const info = el('div', 'cf-field');
    const name = el('b');
    name.textContent = m.label;
    const detail = el('small');
    detail.textContent = m.note;
    detail.title = m.note;
    info.append(name, detail);
    row.append(info);

    const actions = el('div', 'cf-actions');
    actions.append(btn(m.hasSave ? 'Re-pick' : 'Pick', onPick, true));
    if (m.hasSave) actions.append(btn('Clear', onClear));
    row.append(actions);
    return row;
  }

  private makeDraggable(card: HTMLElement, handle: HTMLElement): void {
    let startX = 0;
    let startY = 0;
    let originRight = 16;
    let originTop = 16;
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('.cf-close')) return;
      startX = e.clientX;
      startY = e.clientY;
      const r = card.getBoundingClientRect();
      originRight = window.innerWidth - r.right;
      originTop = r.top;
      handle.setPointerCapture(e.pointerId);
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp, { once: true });
    };
    const onMove = (e: PointerEvent) => {
      card.style.right = `${Math.max(0, originRight - (e.clientX - startX))}px`;
      card.style.top = `${Math.max(0, originTop + (e.clientY - startY))}px`;
      card.style.left = 'auto';
      card.style.bottom = 'auto';
    };
    const onUp = (e: PointerEvent) => {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener('pointermove', onMove);
    };
    handle.addEventListener('pointerdown', onDown);
  }

  destroy(): void {
    this.host.remove();
  }
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

function input(placeholder: string, value: string): HTMLInputElement {
  const i = document.createElement('input');
  i.className = 'cf-input';
  i.placeholder = placeholder;
  i.value = value;
  return i;
}

function field(label: string, control: HTMLElement): HTMLElement {
  const wrap = el('label', 'cf-fld');
  const l = el('span', 'cf-fld-label');
  l.textContent = label;
  wrap.append(l, control);
  return wrap;
}

function sectionHead(text: string): HTMLElement {
  const h = el('div', 'cf-section');
  h.textContent = text;
  return h;
}

/** Rows that still need a decision: nothing found, or only a weak match. */
function countTodo(rows: SetupRow[]): number {
  return rows.filter((r) => r.status !== 'high').length;
}
