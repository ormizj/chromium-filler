/**
 * Shadow-DOM review modal. Two views behind one header toggle:
 *
 *   Job     the posting — title, description, requirements, as real prose.
 *   Fields  the per-field report (filled / low-confidence / unmatched), with
 *           Confirm/Pick per row.
 *
 * Job is the default, and that ordering is the point. Once the form is filled the
 * user's question is "do I want this job?", not "which of sixteen fields matched";
 * most postings do not even have most of those fields, so an always-expanded
 * report buried the posting under rows nobody asked for. The report is still one
 * tap away, and the Fields tab carries a status dot, so nothing needing attention
 * can hide behind the toggle.
 *
 * On mobile this is the primary control: reaching the toolbar popup costs two or
 * three taps through the browser menu, so the modal carries the session actions
 * too, and closing it collapses to a pill instead of destroying it — the old
 * close button threw the report away, and the only route back (the popup's
 * "Reset & Re-run") wiped every field it had just filled.
 */

import type { FieldMatch, MatchConfidence, ModalLayout } from '../../shared/types';
import type { SessionState } from '../../shared/messages';
import type { JobBlock } from '../../shared/jobText';
import { FIELD_LABELS } from '../../shared/fieldKeys';
import { STATUS_LABELS, matchStatus } from '../../shared/fieldStatus';
import { clampLayout, NARROW_WIDTH } from '../../shared/modalLayout';
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
  /** The card was dragged to a new spot; persist it so it stays there. */
  onLayoutChange?(layout: ModalLayout): void;
  /**
   * The card is *being* dragged — fired per pointermove, so a second view of the
   * same layout can follow it live (the Options simulator draws one). Deliberately
   * separate from `onLayoutChange`: that one persists, and a storage write per
   * pointermove is what this split exists to avoid.
   */
  onLayoutPreview?(layout: ModalLayout): void;
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

/** Which of the two views the card is showing. */
export type ModalView = 'job' | 'fields';

export interface ModalData {
  siteName: string;
  jobTitle?: string;
  /** The posting, as blocks — see shared/jobText.ts. */
  jobDescription?: JobBlock[];
  jobRequirements?: JobBlock[];
  matches: FieldMatch[];
  canSubmitCv: boolean;
  redirect?: RedirectNotice;
  /** Host of the board posting this page was reached from. */
  via?: string;
  /** Queue progress, when a session is running. Drives the strip and Skip action. */
  session?: SessionState;
  /** Desktop size/position. Ignored on narrow screens (bottom sheet). */
  layout?: ModalLayout;
}

/** Below this width the card is a bottom sheet, and free-dragging makes no sense. */
const NARROW = NARROW_WIDTH;

export class FillerModal {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private cb: ModalCallbacks;
  private data?: ModalData;
  /** Collapsed to the pill. Kept across renders so a re-run doesn't pop it open. */
  private collapsed = false;
  /** Mobile sheet showing only its header + summary. */
  private peek = false;
  /**
   * Kept across renders for the same reason `collapsed` is: confirming a field
   * re-renders, and being thrown back to the Job view every time would make the
   * report unusable exactly when it is being used.
   */
  private view: ModalView = 'job';
  private onViewportResize = () => this.applyLayout();

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
    window.addEventListener('resize', this.onViewportResize);
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
    card.setAttribute('aria-label', `${data.siteName} — ${data.jobTitle ?? 'fill report'}`);

    card.append(this.header(data, card));
    // The session strip sits under the header, never above it — the header is
    // the sheet's title and drag handle and has to stay at the top edge.
    if (data.session?.active) card.append(this.sessionStrip(data.session));
    // A two-step posting has no report and gets no toggle, so the Fields view
    // there would be an empty dead end with no way back to the job.
    const fields = this.view === 'fields' && !data.redirect;
    card.append(fields ? this.fieldsBody(data) : this.jobBody(data));
    card.append(this.footer(data));

    this.shadow.append(card);
    this.applyLayout();
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

  /**
   * Re-place the card without rebuilding it. `render` replaces the whole `.cf-card`
   * element, which is fine for new data but fatal while the card is being dragged —
   * the handle holding the pointer capture would be thrown away mid-gesture. A
   * second view driving this one (the Options simulator) uses this instead.
   */
  place(layout: ModalLayout): void {
    this.setLayout(layout);
  }

  /** Which view is showing — the dev harness boots straight into one. */
  setView(view: ModalView): void {
    if (this.view === view) return;
    this.view = view;
    if (this.data) this.render(this.data);
  }

  /* ---------------- Chrome ---------------- */

  private header(data: ModalData, card: HTMLElement): HTMLElement {
    const header = el('div', 'cf-header');
    header.append(el('div', 'cf-grip'));

    const site = el('span', 'cf-site');
    site.textContent = data.via ? `${data.siteName} · via ${data.via}` : data.siteName;

    const close = el('button', 'cf-close');
    close.textContent = '×';
    close.setAttribute('aria-label', 'Minimize');
    close.onclick = () => this.cb.onClose();

    header.append(site);
    // A two-step posting has no report to switch to: there is no form on this
    // page, so an empty Fields view would be a dead end.
    if (!data.redirect) header.append(this.viewToggle(data));
    header.append(close);

    this.makeDraggable(card, header);
    return header;
  }

  /**
   * The Job/Fields switch. The Fields tab carries the report's worst status as a
   * dot, so a field that still needs the user is advertised on the closed tab —
   * hiding the report must not mean hiding a problem.
   */
  private viewToggle(data: ModalData): HTMLElement {
    const wrap = el('div', 'cf-views');
    wrap.setAttribute('role', 'tablist');

    const tab = (view: ModalView, label: string, dot?: MatchConfidence) => {
      const b = document.createElement('button');
      b.className = `cf-view${this.view === view ? ' active' : ''}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(this.view === view));
      if (dot) {
        const d = el('span', `cf-dot ${dot}`);
        d.setAttribute('role', 'img');
        d.setAttribute('aria-label', STATUS_LABELS[dot]);
        b.append(d);
      }
      b.append(document.createTextNode(label));
      b.onclick = () => this.setView(view);
      return b;
    };

    wrap.append(tab('job', 'Job'), tab('fields', 'Fields', worstStatus(data.matches)));
    return wrap;
  }

  private footer(data: ModalData): HTMLElement {
    const footer = el('div', 'cf-footer');

    if (data.redirect) {
      footer.append(
        btn('Fill this page instead', () => this.cb.onFillAnyway()),
        btn(data.redirect.followed ? 'Open again' : 'Open application', () => this.cb.onFollow(), true),
      );
      return footer;
    }

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
    return footer;
  }

  /* ---------------- The two views ---------------- */

  /** The posting. The default view, and the reason the modal is worth reading. */
  private jobBody(data: ModalData): HTMLElement {
    const body = el('div', 'cf-body');

    if (data.jobTitle) {
      const t = el('h2', 'cf-title');
      t.textContent = data.jobTitle;
      body.append(t);
    }

    if (data.redirect) {
      // Two-step posting: say where the application actually lives, directly
      // under the title — a long description must never bury it.
      const notice = el('p', 'cf-notice');
      notice.textContent = data.redirect.host
        ? `${data.redirect.followed ? 'Opening' : 'Applies on'} ${data.redirect.host} — external application`
        : 'External application — this posting applies on the employer’s site';
      const why = el('small', 'cf-why');
      why.textContent = data.redirect.reason;
      body.append(notice, why);
    }

    const description = data.jobDescription ?? [];
    if (description.length) body.append(prose(description));

    const requirements = data.jobRequirements ?? [];
    if (requirements.length) {
      const label = el('div', 'cf-section');
      label.textContent = 'Requirements';
      body.append(label, prose(requirements));
    }

    if (!description.length && !requirements.length && !data.redirect) {
      const empty = el('p', 'cf-empty');
      empty.textContent = 'No description found on this page.';
      body.append(empty);
    }

    return body;
  }

  /** The fill report: what went in, what needs a look, what was never found. */
  private fieldsBody(data: ModalData): HTMLElement {
    const body = el('div', 'cf-body');

    const filled = data.matches.filter((m) => m.filled).length;
    const missing = data.matches.filter((m) => m.confidence === 'none').length;
    const summary = el('p', 'cf-summary');
    summary.textContent = `${filled} filled · ${data.matches.length - filled} need review · ${missing} not found`;
    body.append(summary);

    const report = el('div', 'cf-report');
    for (const m of data.matches) report.append(this.row(m));
    body.append(report);

    // The report is three colours and a set of buttons, and nothing on screen
    // says what any of them mean — or that sending is still the user's job.
    const legend = el('p', 'cf-legend-line');
    for (const [cls, text] of [['ok', 'filled'], ['low', 'check it'], ['none', 'not found']] as const) {
      const dot = el('span', `cf-dot ${cls}`);
      const label = el('span');
      label.textContent = text;
      legend.append(dot, label);
    }
    const sent = el('small', 'cf-legend-send');
    sent.textContent = 'Nothing is sent — press the site’s own button when you are ready.';
    body.append(legend, sent);

    return body;
  }

  private pill(data: ModalData): HTMLElement {
    const pill = el('button', 'cf-pill');
    const filled = data.matches.filter((m) => m.filled).length;
    // Collapsed, the dot is the only status left on screen, so it has to carry
    // the same meaning as the rows it is hiding.
    const dot = el('span', `cf-dot ${pillStatus(data, filled)}`);
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
    const status = matchStatus(m);
    const row = el('div', 'cf-row');
    const dot = el('span', `cf-dot ${status}`);
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', STATUS_LABELS[status]);
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
    // Anything matched but not filled can be retried in place; only a field with
    // no element at all has nothing for Confirm to act on.
    if (!m.filled && m.confidence !== 'none') {
      actions.append(btn('Confirm', () => this.cb.onConfirm(m.field), true));
    }
    actions.append(btn('Pick', () => this.cb.onPick(m.field)));
    row.append(actions);
    return row;
  }

  /* ---------------- Geometry ---------------- */

  /** Properties `applyLayout` owns on desktop and must hand back on mobile. */
  private static readonly LAYOUT_PROPS = [
    'width', 'height', 'right', 'bottom', 'left', 'top', 'max-width', 'max-height',
  ];

  /**
   * Size and place the card from the user's stored layout — but only on desktop.
   * Under 640px the card is a full-width bottom sheet, and an inline width would
   * beat the media query that makes it one, so the properties are cleared there
   * rather than merely left unset.
   *
   * The card is a FIXED size — the exact rectangle chosen in the Options
   * simulator, which is itself a fixed card drawn to scale. So `this.data.layout`
   * is the intended size and is never touched here; what goes on the card is that
   * clamped to the current viewport, recomputed fresh every call and NOT written
   * back. This runs on every `window.resize`: writing the clamped value back
   * would turn a temporary shrink (drag the tab narrow) into a permanent one
   * (widen it again and the modal would stay small). A fixed card instead fits
   * itself to a too-small viewport and springs back when there is room again.
   * Only a drag changes the intended size, through `setLayout`.
   *
   * `max-width`/`max-height` have to be overridden, not just left alone: the
   * stylesheet caps the card at `calc(100vw - 32px)` and `min(88vh, 820px)` as a
   * fallback for when there is no stored layout, and a `max-*` beats an inline
   * `width`. Left in place they silently overrode whatever was chosen in the
   * Options simulator — a card sized to fill the screen came out 820px tall, so
   * the simulator was promising sizes the modal would never render.
   */
  private applyLayout(): void {
    const card = this.shadow.querySelector('.cf-card') as HTMLElement | null;
    if (!card) return;

    if (window.innerWidth <= NARROW || !this.data?.layout) {
      for (const prop of FillerModal.LAYOUT_PROPS) card.style.removeProperty(prop);
      return;
    }

    // The clamp is the only thing keeping the card on screen — the CSS caps that
    // used to do it are being turned off below.
    const l = clampLayout(this.data.layout, window.innerWidth, window.innerHeight);
    card.style.width = `${l.width}px`;
    card.style.height = `${l.height}px`;
    card.style.maxWidth = 'none';
    card.style.maxHeight = 'none';
    card.style.right = `${l.right}px`;
    card.style.bottom = `${l.bottom}px`;
    card.style.left = 'auto';
    card.style.top = 'auto';
  }

  /**
   * Change the *intended* size — a deliberate act (a drag), unlike the
   * viewport-driven reflow in `applyLayout`. Stored pre-clamped so the persisted
   * value can never itself be off-screen.
   */
  private setLayout(layout: ModalLayout): void {
    if (!this.data) return;
    this.data.layout = clampLayout(layout, window.innerWidth, window.innerHeight);
    this.applyLayout();
  }

  /**
   * Desktop: drag the card anywhere, and remember where. Mobile: the card is a
   * full-width bottom sheet, so a free drag would just fight the layout — a
   * vertical drag snaps between the full sheet and a peek instead.
   */
  private makeDraggable(card: HTMLElement, handle: HTMLElement): void {
    let startX = 0;
    let startY = 0;
    let originRight = 16;
    let originBottom = 16;
    let width = 0;
    let height = 0;
    let narrow = false;

    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('.cf-close, .cf-views')) return;
      narrow = window.innerWidth <= NARROW;
      startX = e.clientX;
      startY = e.clientY;
      const r = card.getBoundingClientRect();
      originRight = window.innerWidth - r.right;
      originBottom = window.innerHeight - r.bottom;
      width = r.width;
      height = r.height;
      handle.setPointerCapture(e.pointerId);
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp, { once: true });
    };

    // Route the live drag through the same clamp the stored layout uses, so the
    // card cannot be dragged off any edge. The previous version floored `right`
    // and `bottom` at 0 but capped neither, so dragging up pushed `bottom` past
    // the viewport height and the card's TOP edge climbed off the top of the
    // screen, taking the header and its drag handle with it.
    const onMove = (e: PointerEvent) => {
      if (narrow) return; // handled on release, as a snap
      this.setLayout(clampLayout(
        {
          right: originRight - (e.clientX - startX),
          bottom: originBottom - (e.clientY - startY),
          width,
          height,
        },
        window.innerWidth,
        window.innerHeight,
      ));
      if (this.data?.layout) this.cb.onLayoutPreview?.(this.data.layout);
    };

    const onUp = (e: PointerEvent) => {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener('pointermove', onMove);
      if (narrow) {
        const dy = e.clientY - startY;
        if (Math.abs(dy) < 24) return; // a tap, not a drag
        this.peek = dy > 0;
        card.classList.toggle('peek', this.peek);
        return;
      }
      // Persist on release, not per pointermove: one write per drag. `applyLayout`
      // has already clamped `this.data.layout` to the viewport during the move.
      if (this.data?.layout) this.cb.onLayoutChange?.(this.data.layout);
    };

    handle.addEventListener('pointerdown', onDown);
  }

  destroy(): void {
    window.removeEventListener('resize', this.onViewportResize);
    this.host.remove();
  }
}

/**
 * The pill's dot summarizes the whole report. A redirect notice has no fields to
 * summarize, so it stays neutral-positive: nothing failed, there was simply
 * nothing to fill.
 */
function pillStatus(data: ModalData, filled: number): MatchConfidence {
  if (data.redirect || data.matches.length === 0) return 'high';
  if (filled === data.matches.length) return 'high';
  return filled > 0 ? 'low' : 'none';
}

/**
 * The worst outcome in the report — what the closed Fields tab has to advertise.
 * Green only when every field actually took its value.
 */
function worstStatus(matches: FieldMatch[]): MatchConfidence {
  if (!matches.length) return 'high';
  const statuses = matches.map(matchStatus);
  if (statuses.includes('none')) return 'none';
  return statuses.includes('low') ? 'low' : 'high';
}

/** Render extracted blocks as the prose they were on the page. */
function prose(blocks: JobBlock[]): HTMLElement {
  const wrap = el('div', 'cf-prose');
  for (const block of blocks) {
    if (block.kind === 'heading') {
      const h = document.createElement('h4');
      h.textContent = block.text;
      wrap.append(h);
    } else if (block.kind === 'list') {
      const ul = document.createElement('ul');
      for (const item of block.items) {
        const li = document.createElement('li');
        li.textContent = item;
        ul.append(li);
      }
      wrap.append(ul);
    } else {
      const p = document.createElement('p');
      p.textContent = block.text;
      wrap.append(p);
    }
  }
  return wrap;
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
