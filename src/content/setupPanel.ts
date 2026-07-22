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
import { BUILD_ID, BUILD_LABEL } from '../shared/buildId';
import setupCss from './setupPanel.css?inline';

export type ContainerKey = 'jobTitle' | 'jobDescription' | 'jobRequirements';

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
}

export interface SetupCallbacks {
  onAddPrep(action: PrepAction): void;
  onPickPrepTarget(index: number): void;
  onMovePrep(index: number, dir: -1 | 1): void;
  onRemovePrep(index: number): void;
  onSetPrepMs(index: number, ms: number): void;
  onRunPrep(): void;
  onPickContainer(key: ContainerKey): void;
  onClearContainer(key: ContainerKey): void;
  onPickField(field: FieldKey): void;
  onClearField(field: FieldKey): void;
  onRename(name: string, urlPattern: string): void;
  onOpenOptions(): void;
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

  constructor(cb: SetupCallbacks) {
    this.cb = cb;
    this.host = document.createElement('div');
    this.host.id = 'chromium-filler-setup-host';
    this.host.style.setProperty('all', 'initial');
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = setupCss;
    this.shadow.appendChild(style);
    document.documentElement.appendChild(this.host);
  }

  /** Hide/show the whole panel (used to get it out of the picker's way). */
  setHidden(hidden: boolean): void {
    this.host.style.display = hidden ? 'none' : '';
  }

  render(data: SetupData): void {
    const existing = this.shadow.querySelector('.cf-card');
    if (existing) existing.remove();

    const card = el('div', 'cf-card');

    // Header (drag handle)
    const header = el('div', 'cf-header');
    header.append(el('div', 'cf-grip'));
    const title = el('span', 'cf-heading');
    title.textContent = 'Set up this site';
    const build = el('span', 'cf-build');
    const mk = (cls: string, text: string): HTMLElement => {
      const s = el('span', cls);
      s.textContent = text;
      return s;
    };
    const hash = BUILD_ID.slice(BUILD_LABEL.length).replace(/^ · /, '');
    const parts = [
      mk('cf-build-version', `v${chrome.runtime.getManifest().version}`),
      ...(hash ? [mk('cf-build-hash', hash)] : []),
      mk('cf-build-label', BUILD_LABEL),
    ];
    parts.forEach((p, i) => {
      if (i) build.append(mk('cf-build-sep', '·'));
      build.append(p);
    });
    title.append(build);
    const close = el('button', 'cf-close');
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close');
    close.onclick = () => this.cb.onClose();
    header.append(title, close);
    this.makeDraggable(card, header);

    const body = el('div', 'cf-body');

    // Identity
    const identity = el('div', 'cf-identity');
    const nameInput = input('Name', data.name);
    const patternInput = input('URL pattern', data.urlPattern);
    const persistMeta = () => this.cb.onRename(nameInput.value.trim(), patternInput.value.trim());
    nameInput.onchange = persistMeta;
    patternInput.onchange = persistMeta;
    identity.append(field('Name', nameInput), field('URL pattern', patternInput));
    body.append(identity);

    // Prerequisite steps (run in order before filling)
    const prepHead = el('div', 'cf-section-row');
    prepHead.append(sectionHead('Setup steps — run in order before filling'));
    prepHead.append(btn('Run steps ▶', () => this.cb.onRunPrep(), true));
    body.append(prepHead);
    data.prep.forEach((step, i) => body.append(this.prepRow(step, i, data.prep.length)));
    const addBar = el('div', 'cf-addbar');
    addBar.append(
      btn('+ Click', () => this.cb.onAddPrep('click')),
      btn('+ Wait for', () => this.cb.onAddPrep('waitFor')),
      btn('+ Delay', () => this.cb.onAddPrep('delay')),
    );
    body.append(addBar);

    // Job info containers
    body.append(sectionHead('Job info — pick each container on the page'));
    for (const row of data.containers) {
      body.append(this.row(row,
        () => this.cb.onPickContainer(row.key as ContainerKey),
        () => this.cb.onClearContainer(row.key as ContainerKey)));
    }

    // Form fields
    body.append(sectionHead('Form fields — pick each input (optional; heuristics fill the rest)'));
    for (const row of data.fields) {
      body.append(this.row(row,
        () => this.cb.onPickField(row.key as FieldKey),
        () => this.cb.onClearField(row.key as FieldKey)));
    }

    // Footer
    const footer = el('div', 'cf-footer');
    const skip = btn('Skip', () => {});
    skip.setAttribute('disabled', 'true');
    skip.title = 'Coming soon';
    footer.append(
      skip,
      btn('Advanced (JSON)', () => this.cb.onOpenOptions()),
      btn('Done', () => this.cb.onClose(), true),
    );

    card.append(header, body, footer);
    this.shadow.append(card);
  }

  private prepRow(step: PrepRow, i: number, total: number): HTMLElement {
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
      ms.onchange = () => this.cb.onSetPrepMs(i, Math.max(0, Number(ms.value) || 0));
      actions.append(ms);
    }
    if (selectorBased) actions.append(btn(step.selector ? 'Re-pick' : 'Pick', () => this.cb.onPickPrepTarget(i), true));
    const up = btn('↑', () => this.cb.onMovePrep(i, -1));
    const down = btn('↓', () => this.cb.onMovePrep(i, 1));
    if (i === 0) up.setAttribute('disabled', 'true');
    if (i === total - 1) down.setAttribute('disabled', 'true');
    actions.append(up, down, btn('✕', () => this.cb.onRemovePrep(i)));
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
