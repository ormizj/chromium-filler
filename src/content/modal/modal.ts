/**
 * Shadow-DOM review modal: job title, scrollable description, and the per-field
 * report (filled / low-confidence / unmatched) with Confirm/Pick per row and
 * Submit CV / Re-run / Reset actions. Responsive bottom-sheet on narrow screens.
 *
 * On mobile this is the primary control: reaching the toolbar popup costs two or
 * three taps through the browser menu, so the modal carries the session actions
 * too, and closing it collapses to a pill instead of destroying it — the old
 * close button threw the report away, and the only route back (the popup's
 * "Reset & Re-run") wiped every field it had just filled.
 */

import type { FieldMatch } from '../../shared/types';
import type { SessionState } from '../../shared/messages';
import { FIELD_LABELS } from '../../shared/fieldKeys';
import { BASE_CSS } from '../../ui/shadowCss';
import modalCss from './modal.css?inline';

export interface ModalCallbacks {
  onRerun(): void;
  onReset(): void;
  onSubmitCv(): void;
  onConfirm(field: FieldMatch['field']): void;
  onPick(field: FieldMatch['field']): void;
  /** Follow (or re-try) the external application handoff. */
  onFollow(): void;
  /** Ignore the redirect verdict and fill this page after all. */
  onFillAnyway(): void;
  /** Mark this posting skipped and move the session on to the next one. */
  onSkip(): void;
  onClose(): void;
}

/** Set when the posting hands off to an external application instead of a form. */
export interface RedirectNotice {
  /** Destination host, when known. */
  host?: string;
  /** Why this was classified as a redirect (from the detector). */
  reason: string;
  /** True once the handoff has been triggered. */
  followed: boolean;
}

export interface ModalData {
  siteName: string;
  jobTitle?: string;
  jobDescription?: string;
  jobRequirements?: string;
  matches: FieldMatch[];
  canSubmitCv: boolean;
  redirect?: RedirectNotice;
  /** Host of the board posting this page was reached from. */
  via?: string;
  /** Queue progress, when a session is running. Drives the strip and Skip action. */
  session?: SessionState;
}

/** Below this width the card is a bottom sheet, and free-dragging makes no sense. */
const NARROW = 640;

export class FillerModal {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private cb: ModalCallbacks;
  private data?: ModalData;
  /** Collapsed to the pill. Kept across renders so a re-run doesn't pop it open. */
  private collapsed = false;
  /** Mobile sheet showing only its header + summary. */
  private peek = false;

  constructor(cb: ModalCallbacks) {
    this.cb = cb;
    this.host = document.createElement('div');
    this.host.id = 'chromium-filler-modal-host';
    this.host.style.setProperty('all', 'initial');
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `${BASE_CSS}\n${modalCss}`;
    this.shadow.appendChild(style);
    document.documentElement.appendChild(this.host);

    this.shadow.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape') this.minimize();
    });
  }

  render(data: ModalData): void {
    this.data = data;
    this.shadow.querySelector('.cf-card')?.remove();
    this.shadow.querySelector('.cf-pill')?.remove();

    if (this.collapsed) {
      this.shadow.append(this.pill(data));
      return;
    }

    const card = el('div', 'cf-card');
    if (this.peek) card.classList.add('peek');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', `${data.siteName} — fill report`);

    // Header (drag handle)
    const header = el('div', 'cf-header');
    header.append(el('div', 'cf-grip'));
    const site = el('span', 'cf-site');
    site.textContent = data.via ? `${data.siteName} · via ${data.via}` : data.siteName;
    const close = el('button', 'cf-close');
    close.textContent = '×';
    close.setAttribute('aria-label', 'Minimize');
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

    const footer = el('div', 'cf-footer');

    if (data.redirect) {
      // Two-step posting: there is no form here to report on. Say where the
      // application actually lives and leave a way back to filling in place,
      // in case the classification was wrong.
      const notice = el('p', 'cf-summary');
      notice.textContent = data.redirect.host
        ? `${data.redirect.followed ? 'Opening' : 'Applies on'} ${data.redirect.host} — external application`
        : 'External application — this posting applies on the employer’s site';
      const why = el('small', 'cf-why');
      why.textContent = data.redirect.reason;
      body.append(notice, why);

      footer.append(
        btn('Fill this page instead', () => this.cb.onFillAnyway()),
        btn(data.redirect.followed ? 'Open again' : 'Open application', () => this.cb.onFollow(), true),
      );
    } else {
      const filled = data.matches.filter((m) => m.filled).length;
      const missing = data.matches.filter((m) => m.confidence === 'none').length;
      const summary = el('p', 'cf-summary');
      summary.textContent = `${filled} filled · ${data.matches.length - filled} need review · ${missing} not found`;
      body.append(summary);

      const report = el('div', 'cf-report');
      for (const m of data.matches) report.append(this.row(m));
      body.append(report);

      const submitCv = btn('Submit CV', () => this.cb.onSubmitCv());
      if (!data.canSubmitCv) submitCv.setAttribute('disabled', 'true');
      const rerun = btn('Re-run', () => this.cb.onRerun());
      const reset = btn('Reset', () => this.cb.onReset());

      if (data.session?.active) {
        // During a session the thumb-sized action is "move on"; the rest of the
        // controls are still one tap away, just not competing for the width.
        footer.append(
          btn('Skip → next', () => this.cb.onSkip(), true),
          this.overflow([submitCv, rerun, reset]),
        );
      } else {
        footer.append(submitCv, rerun, reset);
      }
    }

    // The session strip sits under the header, never above it — the header is
    // the sheet's title and drag handle and has to stay at the top edge.
    card.append(header);
    if (data.session?.active) card.append(this.sessionStrip(data.session));
    card.append(body, footer);
    this.shadow.append(card);
  }

  /** Collapse to the pill, keeping every fill and the report intact. */
  minimize(): void {
    if (this.collapsed) return;
    this.collapsed = true;
    if (this.data) this.render(this.data);
  }

  restore(): void {
    if (!this.collapsed) return;
    this.collapsed = false;
    if (this.data) this.render(this.data);
  }

  /** True while collapsed, so the controller can re-open rather than re-run. */
  get isMinimized(): boolean {
    return this.collapsed;
  }

  private pill(data: ModalData): HTMLElement {
    const pill = el('button', 'cf-pill');
    const filled = data.matches.filter((m) => m.filled).length;
    const dot = el('span', 'cf-dot high');
    pill.setAttribute('aria-label', 'Reopen the fill report');
    const label = el('span');
    label.textContent = data.redirect
      ? 'External application'
      : `${filled}/${data.matches.length} filled`;
    pill.append(dot, label);
    pill.onclick = () => this.restore();
    return pill;
  }

  /**
   * Where this posting sits in the queue. Read-only on purpose: the footer's
   * "Skip → next" is the action, and a second Skip button here just duplicated
   * it a few pixels away.
   */
  private sessionStrip(session: SessionState): HTMLElement {
    const strip = el('div', 'cf-session');
    const text = el('span', 'cf-progress');
    const { done, total, applied, queued } = session.progress;
    text.textContent = `${done}/${total} done · ${applied} applied · ${queued} waiting`;
    strip.append(text);
    return strip;
  }

  /** A "more" button whose menu holds the secondary footer actions. */
  private overflow(items: HTMLButtonElement[]): HTMLElement {
    const wrap = el('div', 'cf-more');
    const toggle = btn('⋯', () => {});
    toggle.setAttribute('aria-label', 'More actions');
    toggle.setAttribute('aria-expanded', 'false');
    const menu = el('div', 'cf-more-menu');
    (menu as HTMLElement).hidden = true;
    menu.append(...items);
    toggle.onclick = (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      toggle.setAttribute('aria-expanded', String(!menu.hidden));
    };
    wrap.append(toggle, menu);
    return wrap;
  }

  private row(m: FieldMatch): HTMLElement {
    const row = el('div', 'cf-row');
    const dot = el('span', `cf-dot ${m.confidence}`);
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label',
      m.confidence === 'high' ? 'filled' : m.confidence === 'low' ? 'needs review' : 'not found');
    row.append(dot);

    const field = el('div', 'cf-field');
    const name = el('b');
    name.textContent = FIELD_LABELS[m.field] ?? m.field;
    const detail = el('small');
    if (m.confidence === 'none') detail.textContent = 'not found';
    else if (m.field === 'resume') detail.textContent = m.filled ? 'CV attached' : (m.selectorUsed ?? 'file input');
    else detail.textContent = `${m.valueToFill ?? ''} · ${m.selectorUsed ?? ''}`.trim();
    detail.title = detail.textContent ?? '';
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

  /**
   * Desktop: drag the card anywhere. Mobile: the card is a full-width bottom
   * sheet, so a free drag would just fight the layout — a vertical drag snaps
   * between the full sheet and a peek instead.
   */
  private makeDraggable(card: HTMLElement, handle: HTMLElement): void {
    let startX = 0;
    let startY = 0;
    let originRight = 16;
    let originBottom = 16;
    let narrow = false;

    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('.cf-close')) return;
      narrow = window.innerWidth <= NARROW;
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
      if (narrow) return; // handled on release, as a snap
      card.style.right = `${Math.max(0, originRight - (e.clientX - startX))}px`;
      card.style.bottom = `${Math.max(0, originBottom - (e.clientY - startY))}px`;
      card.style.left = 'auto';
    };

    const onUp = (e: PointerEvent) => {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener('pointermove', onMove);
      if (!narrow) return;
      const dy = e.clientY - startY;
      if (Math.abs(dy) < 24) return; // a tap, not a drag
      this.peek = dy > 0;
      card.classList.toggle('peek', this.peek);
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
