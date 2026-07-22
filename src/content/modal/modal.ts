/**
 * Shadow-DOM review modal: job title, scrollable description, and the per-field
 * report (filled / low-confidence / unmatched) with Confirm/Pick per row and
 * Submit CV / Re-run / Reset actions. Responsive bottom-sheet on narrow screens.
 */

import type { FieldMatch } from '../../shared/types';
import { FIELD_LABELS } from '../../shared/fieldKeys';
import modalCss from './modal.css?inline';

export interface ModalCallbacks {
  onRerun(): void;
  onReset(): void;
  onSubmitCv(): void;
  onConfirm(field: FieldMatch['field']): void;
  onPick(field: FieldMatch['field']): void;
  onClose(): void;
}

export interface ModalData {
  siteName: string;
  jobTitle?: string;
  jobDescription?: string;
  jobRequirements?: string;
  matches: FieldMatch[];
  canSubmitCv: boolean;
}

export class FillerModal {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private cb: ModalCallbacks;

  constructor(cb: ModalCallbacks) {
    this.cb = cb;
    this.host = document.createElement('div');
    this.host.id = 'chromium-filler-modal-host';
    this.host.style.setProperty('all', 'initial');
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = modalCss;
    this.shadow.appendChild(style);
    document.documentElement.appendChild(this.host);
  }

  render(data: ModalData): void {
    const existing = this.shadow.querySelector('.cf-card');
    if (existing) existing.remove();

    const card = el('div', 'cf-card');

    // Header (drag handle)
    const header = el('div', 'cf-header');
    header.append(el('div', 'cf-grip'));
    const site = el('span', 'cf-site');
    site.textContent = data.siteName;
    const close = el('button', 'cf-close');
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close');
    close.onclick = () => this.cb.onClose();
    header.append(site, close);
    this.makeDraggable(card, header);

    // Body
    const body = el('div', 'cf-body');
    if (data.jobTitle) {
      const t = el('h2', 'cf-title');
      t.textContent = data.jobTitle;
      body.append(t);
    }
    if (data.jobDescription) {
      const d = el('div', 'cf-desc');
      d.textContent = data.jobDescription;
      body.append(d);
    }
    if (data.jobRequirements) {
      const label = el('div', 'cf-req-label');
      label.textContent = 'Requirements';
      const r = el('div', 'cf-desc cf-req');
      r.textContent = data.jobRequirements;
      body.append(label, r);
    }

    const filled = data.matches.filter((m) => m.filled).length;
    const missing = data.matches.filter((m) => m.confidence === 'none').length;
    const summary = el('p', 'cf-summary');
    summary.textContent = `${filled} filled · ${data.matches.length - filled} need review · ${missing} not found`;
    body.append(summary);

    const report = el('div', 'cf-report');
    for (const m of data.matches) report.append(this.row(m));
    body.append(report);

    // Footer
    const footer = el('div', 'cf-footer');
    const submitCv = btn('Submit CV', () => this.cb.onSubmitCv());
    if (!data.canSubmitCv) submitCv.setAttribute('disabled', 'true');
    footer.append(
      submitCv,
      btn('Re-run', () => this.cb.onRerun()),
      btn('Reset', () => this.cb.onReset()),
    );

    card.append(header, body, footer);
    this.shadow.append(card);
  }

  private row(m: FieldMatch): HTMLElement {
    const row = el('div', 'cf-row');
    row.append(el('span', `cf-dot ${m.confidence}`));

    const field = el('div', 'cf-field');
    const name = el('b');
    name.textContent = FIELD_LABELS[m.field] ?? m.field;
    const detail = el('small');
    if (m.confidence === 'none') detail.textContent = 'not found';
    else if (m.field === 'resume') detail.textContent = m.filled ? 'CV attached' : (m.selectorUsed ?? 'file input');
    else detail.textContent = `${m.valueToFill ?? ''} · ${m.selectorUsed ?? ''}`.trim();
    field.append(name, detail);
    row.append(field);

    const actions = el('div', 'cf-actions');
    if (m.confidence === 'low' && !m.filled) {
      actions.append(btn('Confirm', () => this.cb.onConfirm(m.field), true));
    }
    actions.append(btn('Pick', () => this.cb.onPick(m.field)));
    row.append(actions);
    return row;
  }

  private makeDraggable(card: HTMLElement, handle: HTMLElement): void {
    let startX = 0;
    let startY = 0;
    let originRight = 16;
    let originBottom = 16;
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('.cf-close')) return;
      startX = e.clientX;
      startY = e.clientY;
      const r = card.getBoundingClientRect();
      originRight = window.innerWidth - r.right;
      originBottom = window.innerHeight - r.bottom;
      handle.setPointerCapture(e.pointerId);
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp, { once: true });
    };
    const onMove = (e: PointerEvent) => {
      card.style.right = `${Math.max(0, originRight - (e.clientX - startX))}px`;
      card.style.bottom = `${Math.max(0, originBottom - (e.clientY - startY))}px`;
      card.style.left = 'auto';
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
