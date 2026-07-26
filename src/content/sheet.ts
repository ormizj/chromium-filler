/**
 * The shared shell behind both on-page surfaces: the review modal and the setup
 * panel.
 *
 * They are two renderings of one object. Before this existed they were two
 * unrelated products that happened to share a stylesheet — the modal read
 * `settings.modalLayout` through `clampLayout` and re-clamped on every resize,
 * while the panel hardcoded `top: 16px; width: 400px` and had a drag that floored
 * at zero without capping, so it could be pushed off the right edge and left
 * there. Worse, `setupPanel.css` is inlined *after* `primitives.css`, so its
 * un-media-queried `.cf-card` block beat the `max-width: 640px` bottom-sheet rules
 * on source order: on a phone the panel was a 400px column hanging off the top,
 * overlapping the modal's sheet with nothing arbitrating which won.
 *
 * So geometry lives here once, and there is exactly **one slot** on the page:
 *
 * - Both sheets read the same `settings.modalLayout`, so opening either one puts a
 *   card in the same place at the same size. The Options simulator stays the only
 *   thing that writes it; a drag is a page-lifetime override (`Controller`).
 * - At most one card is expanded. The controller enforces it by folding the other
 *   to its pill — never by destroying it, because a destroyed review modal takes
 *   the fill report with it.
 * - **While a card is expanded, no pill shows.** Two pills would otherwise land on
 *   the identical bottom-right spot, and on mobile underneath the sheet itself.
 *   `setSlot` is how the controller says both things at once: a number is a rail
 *   position, `null` is "something else holds the slot, stay out of sight".
 *
 * Subclasses supply their content (`buildCard`, `buildPill`) and nothing else.
 */

import type { ModalLayout } from '../shared/types';
import {
  clampLayout, fullscreenLayout, layoutLimits, nudgeLayout, snapLayout, NARROW_WIDTH,
  type DragMode,
} from '../shared/modalLayout';
import { BASE_CSS } from '../ui/shadowCss';
import { clearLimitAttrs, setLimitAttrs } from '../ui/limits';

/** Which surface a card belongs to. Stamped as `data-sheet` — see `paint`. */
export type SheetKind = 'review' | 'setup';

/**
 * The geometry every sheet's render data carries.
 *
 * Both fields are *data* rather than instance state, unlike the peek and collapse
 * flags: those are this reader's state on this page, while these two arrive from
 * the controller, which rebuilds the render data from settings on every re-render.
 * Anything that has to outlive one re-render has to come from there — and holding
 * them here rather than beside them is what keeps `setFullscreen` from writing a
 * value the very next repaint reads back stale.
 */
export interface SheetData {
  /** Desktop size/position. Ignored on narrow screens (bottom sheet). */
  layout?: ModalLayout;
  /** Fill the whole viewport, overriding `layout` without discarding it. */
  fullscreen?: boolean;
}

export interface SheetCallbacks {
  /** The card was dragged or resized; the controller holds it for this page. */
  onLayoutChange?(layout: ModalLayout): void;
  /**
   * The card is *being* dragged — fired per pointermove, so a second view of the
   * same layout can follow it live (the Options simulator draws one). Deliberately
   * separate from `onLayoutChange`: that one persists, and a storage write per
   * pointermove is what this split exists to avoid.
   */
  onLayoutPreview?(layout: ModalLayout): void;
  /**
   * The fullscreen toggle was pressed. Unlike a drag, this one *is* a preference:
   * the controller persists it and hands it back on the next render, which is what
   * keeps it on for the postings after this one.
   */
  onFullscreen?(on: boolean): void;
  /**
   * This sheet folded or unfolded. The controller's cue to re-arbitrate the slot:
   * an unfolding sheet takes it, and everything else drops to the rail. Fired for
   * the routes the controller cannot see — Escape, and a tap on the pill.
   */
  onFold?(collapsed: boolean): void;
}

/** Below this width the card is a bottom sheet, and free-dragging makes no sense. */
const NARROW = NARROW_WIDTH;

/** A drag under this many px is a tap, not a gesture (narrow sheets only). */
const TAP_SLOP = 24;

/** What a rebuild would otherwise throw away. See `Sheet.userPlace`. */
interface UserPlace {
  scrollTop: number;
  /** `data-k` of whatever had focus, or absent if nothing in the sheet did. */
  key?: string;
  /** Typed-but-uncommitted text, and its caret. Focused control only. */
  value?: string;
  selStart?: number | null;
  selEnd?: number | null;
}

type TextControl = HTMLInputElement | HTMLTextAreaElement;

function isTextControl(el: Element | null): el is TextControl {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

export abstract class Sheet<D extends SheetData> {
  protected host: HTMLElement;
  protected shadow: ShadowRoot;
  private readonly kind: SheetKind;
  private readonly geom: SheetCallbacks;

  /** What the last render was given. The geometry is read straight off it. */
  protected data?: D;
  /** Collapsed to the pill. Kept across renders so a re-run doesn't pop it open. */
  private collapsed = false;
  /** Mobile sheet showing only its header + summary. */
  protected peek = false;
  /** Rail position for the pill, or `null` while another sheet holds the slot. */
  private slot: number | null = 0;

  private onViewportResize = () => this.applyLayout();

  protected constructor(kind: SheetKind, hostId: string, css: string, geom: SheetCallbacks) {
    this.kind = kind;
    this.geom = geom;
    this.host = document.createElement('div');
    this.host.id = hostId;
    this.host.style.setProperty('all', 'initial');
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `${BASE_CSS}\n${css}`;
    this.shadow.appendChild(style);
    document.documentElement.appendChild(this.host);

    this.shadow.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape') this.minimize();
    });
    window.addEventListener('resize', this.onViewportResize);
  }

  /* ---------------- What subclasses provide ---------------- */

  /**
   * Build the `.cf-card`, content and all. Called fresh on every paint, so a
   * subclass may rebuild freely — with the one exception `place()` documents.
   * Implementations call `makeDraggable(card, header)` with their own header.
   */
  protected abstract buildCard(): HTMLElement;

  /** Build the collapsed `.cf-pill`. Its click must call `restore()`. */
  protected abstract buildPill(): HTMLElement;

  /* ---------------- Rendering ---------------- */

  /**
   * Swap the card (or the pill) for a freshly built one — keeping the user's
   * place in it. See `captureUserPlace`: a rebuild is how this surface shows *any*
   * change, so without this every edit is also a jump back to the top.
   */
  protected paint(): void {
    this.captureUserPlace();
    this.shadow.querySelector('.cf-card')?.remove();
    this.shadow.querySelector('.cf-pill')?.remove();

    if (this.collapsed) {
      // No rail position means another sheet is expanded and this one keeps out
      // of the way entirely. It is still alive — everything it holds comes back
      // the moment the slot frees up.
      if (this.slot === null) return;
      const pill = this.buildPill();
      pill.dataset.sheet = this.kind;
      pill.style.setProperty('--pill-slot', String(this.slot));
      this.shadow.append(pill);
      return;
    }

    const card = this.buildCard();
    card.dataset.sheet = this.kind;
    if (this.peek) card.classList.add('peek');
    // Desktop fullscreen is pure inline geometry (`applyLayout`); the class is
    // what the narrow bottom sheet is styled off, where inline styles are barred.
    if (this.data?.fullscreen) card.classList.add('cf-full');
    this.addResizeGrips(card);
    this.shadow.append(card);
    this.applyLayout();
    // After `applyLayout`, never before: the card is sized there, and a
    // `scrollTop` written to an element with no height yet clamps to 0.
    this.applyUserPlace();
  }

  /** Re-run the subclass's render against its last data. */
  protected abstract repaint(): void;

  /* ---------------- Collapse ---------------- */

  /** Collapse to the pill, keeping everything the sheet holds intact. */
  minimize(): void {
    if (this.collapsed) return;
    this.collapsed = true;
    this.repaint();
    this.geom.onFold?.(true);
  }

  restore(): void {
    if (!this.collapsed) return;
    this.collapsed = false;
    this.repaint();
    this.geom.onFold?.(false);
  }

  /** True while collapsed, so the controller can re-open rather than re-run. */
  get isMinimized(): boolean {
    return this.collapsed;
  }

  /**
   * Where this sheet's pill sits in the bottom-right rail, or `null` to show no
   * pill at all because another sheet is expanded.
   *
   * The rail crosses two shadow roots, so CSS cannot stack the pills by itself —
   * neither root can see the other's. The controller owns the arbitration and
   * hands each sheet its index.
   */
  setSlot(slot: number | null): void {
    if (this.slot === slot) return;
    this.slot = slot;
    if (this.collapsed) this.repaint();
  }

  /**
   * Hide/show the whole surface (used to get it out of the picker's way).
   *
   * `display: none` destroys the layout box, so the scroll position goes with it
   * — and the picker is exactly when it matters, because the row you pressed
   * Pick on is the row you want to be looking at when you come back. So a hide
   * captures and a show restores, on top of the capture `paint` already does:
   * the picker's sequence is hide → pick → show → `refreshSetup`, and only the
   * hide happens early enough to read the real number.
   */
  setHidden(hidden: boolean): void {
    if (hidden) this.captureUserPlace();
    this.host.style.display = hidden ? 'none' : '';
    if (!hidden) this.applyUserPlace();
  }

  /* ---------------- Keeping the user's place ---------------- */

  /**
   * Where the user was in the card, held across a rebuild.
   *
   * The sheets are dumb renderers: the controller recomputes everything from the
   * live DOM and hands back fresh data, and `paint` throws the whole `.cf-card`
   * away to show it. That is the right design and it has one cost — every edit
   * also scrolled the panel to the top, dropped focus on the floor, and wiped
   * anything typed but not yet committed. Picking the 14th of sixteen fields put
   * you back at the first one, every time.
   *
   * Identity comes from `data-k`, stamped by the subclass. It has to survive a
   * rebuild, so it is keyed on what the control *is* (`field:email`) and never on
   * its position in the DOM.
   */
  private userPlace: UserPlace = { scrollTop: 0 };

  /**
   * Read the current place off the DOM. A no-op while hidden — the numbers there
   * are all zero, and overwriting a good capture with them is the one way this
   * makes things worse than not having it.
   */
  private captureUserPlace(): void {
    if (this.host.style.display === 'none') return;
    const body = this.shadow.querySelector('.cf-body');
    const next: UserPlace = { scrollTop: body?.scrollTop ?? 0 };

    const active = this.shadow.activeElement as HTMLElement | null;
    const key = active?.dataset?.k;
    if (key) {
      next.key = key;
      if (isTextControl(active)) {
        next.value = active.value;
        // `selectionStart` throws on an input that has no text selection to
        // speak of — `type="number"`, which is exactly what the prep-step
        // timeouts are. The caret is a nicety; losing it must not cost the value.
        try {
          next.selStart = active.selectionStart;
          next.selEnd = active.selectionEnd;
        } catch { /* no selection API on this input type */ }
      }
    }
    this.userPlace = next;
  }

  /** Put it back. Every step is optional — a rebuild may legitimately have
   *  dropped the row that held focus (its prep step was just deleted). */
  private applyUserPlace(): void {
    if (this.host.style.display === 'none') return;
    const body = this.shadow.querySelector('.cf-body');
    if (body && this.userPlace.scrollTop) body.scrollTop = this.userPlace.scrollTop;

    const { key, value } = this.userPlace;
    if (!key) return;
    const el = this.shadow.querySelector<HTMLElement>(`[data-k="${key}"]`);
    if (!el) return;
    el.focus();

    // Uncommitted text, restored for the focused control **only**. These inputs
    // commit on `change`, i.e. on blur, so a refresh landing mid-edit would
    // otherwise silently discard what was typed. Writing a remembered value into
    // an unfocused field would be the opposite mistake — stale data beating the
    // fresh config read that `refreshSetup` exists to make.
    if (value === undefined || !isTextControl(el) || el.value === value) return;
    el.value = value;
    try {
      if (this.userPlace.selStart != null) {
        el.setSelectionRange(this.userPlace.selStart, this.userPlace.selEnd ?? this.userPlace.selStart);
      }
    } catch { /* see captureUserPlace */ }
  }

  /* ---------------- Geometry ---------------- */

  /**
   * Re-place the card without rebuilding it. A repaint replaces the whole
   * `.cf-card` element, which is fine for new data but fatal while the card is
   * being dragged — the handle holding the pointer capture would be thrown away
   * mid-gesture. A second view driving this one (the Options simulator) uses this.
   */
  place(layout: ModalLayout): void {
    this.setLayout(layout);
  }

  /** Properties `applyLayout` owns on desktop and must hand back on mobile. */
  private static readonly LAYOUT_PROPS = [
    'width', 'height', 'right', 'bottom', 'left', 'top', 'max-width', 'max-height',
  ];

  /**
   * Size and place the card from the user's stored layout — or, when fullscreen is
   * on, from the viewport — but only on desktop. Under 640px the card is a
   * full-width bottom sheet, and an inline width would beat the media query that
   * makes it one, so the properties are cleared there rather than merely left unset
   * (fullscreen is a class there instead — see `.cf-card.cf-full`).
   *
   * The card is a FIXED size — the exact rectangle chosen in the Options simulator,
   * which is itself a fixed card drawn to scale. So `this.data.layout` is the intended
   * size and is never touched here; what goes on the card is that clamped to the
   * current viewport, recomputed fresh every call and NOT written back. This runs
   * on every `window.resize`: writing the clamped value back would turn a temporary
   * shrink (drag the tab narrow) into a permanent one — widen it again and the card
   * would stay small. A fixed card instead fits itself to a too-small viewport and
   * springs back when there is room again. Only a gesture changes the intended
   * size, through `setLayout`.
   *
   * `max-width`/`max-height` have to be overridden, not just left alone: the
   * stylesheet caps the card as a fallback for when there is no stored layout, and
   * a `max-*` beats an inline `width`. Left in place they silently overrode
   * whatever was chosen in the Options simulator — a card sized to fill the screen
   * came out 820px tall, so the simulator was promising sizes no sheet would render.
   *
   * It also publishes which edges the card ended up flush against, because a corner
   * where two straight screen edges meet must not be rounded, and an edge lying
   * along the viewport edge must not draw its own border beside it. That is CSS
   * (`.cf-card[data-limit-…]` in primitives.css) keyed off `layoutLimits` — the same
   * reading the Options simulator paints its own card with.
   */
  private applyLayout(): void {
    const card = this.shadow.querySelector('.cf-card') as HTMLElement | null;
    if (!card) return;

    if (window.innerWidth <= NARROW || !this.data?.layout) {
      for (const prop of Sheet.LAYOUT_PROPS) card.style.removeProperty(prop);
      // The bottom sheet is flush on three edges and keeps its top corners
      // rounded anyway; a stale attribute here would outrank that rule.
      clearLimitAttrs(card);
      return;
    }

    // Fullscreen overrides the stored rectangle without touching it, and is
    // recomputed from the live viewport every call — so the card tracks a window
    // being resized, and the configured layout is still there to go back to.
    const intent = this.data.fullscreen
      ? fullscreenLayout(window.innerWidth, window.innerHeight)
      : this.data.layout;

    // The clamp is the only thing keeping the card on screen — the CSS caps that
    // used to do it are being turned off below.
    const l = clampLayout(intent, window.innerWidth, window.innerHeight);
    setLimitAttrs(card, layoutLimits(l, window.innerWidth, window.innerHeight));
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
   * Change the *intended* rectangle — a deliberate act (a gesture), unlike the
   * viewport-driven reflow in `applyLayout`. Stored pre-clamped so the value handed
   * to the controller can never itself be off-screen.
   */
  private setLayout(layout: ModalLayout): void {
    if (!this.data) return;
    this.data.layout = clampLayout(layout, window.innerWidth, window.innerHeight);
    this.applyLayout();
  }

  /**
   * Fill the viewport, or go back to the configured card.
   *
   * Writes the flag onto `this.data` *and* reports it, because the two have
   * different jobs: the local write is what this paint sees, and the callback is
   * what makes it true of the next posting. `this.data.layout` is deliberately
   * left alone — it is what "exit" has to give back.
   */
  setFullscreen(on: boolean): void {
    if (!this.data || !!this.data.fullscreen === on) return;
    this.data.fullscreen = on;
    // A 40vh peek and a full-height sheet are contradictory answers to "how much
    // room does this sheet get"; the newer one wins.
    if (on) this.peek = false;
    this.repaint();
    this.geom.onFullscreen?.(on);
  }

  /* ---------------- Gestures ---------------- */

  /**
   * Desktop: drag the card anywhere, and remember where. Mobile: the card is a
   * full-width bottom sheet, so a free drag would just fight the layout — a
   * vertical drag snaps between the full sheet and a peek instead.
   */
  protected makeDraggable(card: HTMLElement, handle: HTMLElement): void {
    let startX = 0;
    let startY = 0;
    let start: ModalLayout = { right: 16, bottom: 16, width: 0, height: 0 };
    let narrow = false;

    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('.cf-close, .cf-views, .cf-fullscreen, .cf-grab')) return;
      // Nothing to drag while fullscreen: moving the card would take it out from
      // under the flag, leaving it looking restored while the setting still said
      // fullscreen — and on narrow it would strand a 40vh peek claiming to be one.
      if (this.data?.fullscreen) return;
      narrow = window.innerWidth <= NARROW;
      startX = e.clientX;
      startY = e.clientY;
      start = rectOf(card);
      handle.setPointerCapture(e.pointerId);
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp, { once: true });
    };

    // Route the live drag through the same clamp the stored layout uses, so the
    // card cannot be dragged off any edge. An earlier version floored `right` and
    // `bottom` at 0 but capped neither, so dragging up pushed `bottom` past the
    // viewport height and the card's TOP edge climbed off the top of the screen,
    // taking the header and its drag handle with it.
    const onMove = (e: PointerEvent) => {
      if (narrow) return; // handled on release, as a snap
      this.gesture(start, 'move', e.clientX - startX, e.clientY - startY);
    };

    const onUp = (e: PointerEvent) => {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener('pointermove', onMove);
      if (narrow) {
        const dy = e.clientY - startY;
        if (Math.abs(dy) < TAP_SLOP) return; // a tap, not a drag
        this.peek = dy > 0;
        card.classList.toggle('peek', this.peek);
        return;
      }
      // Persist on release, not per pointermove: one write per gesture.
      // `applyLayout` has already clamped `this.data.layout` during the move.
      if (this.data?.layout) this.geom.onLayoutChange?.(this.data.layout);
    };

    handle.addEventListener('pointerdown', onDown);
  }

  /**
   * The three resize handles, on the card's *far* edges.
   *
   * Which edges those are follows from the anchor: a card pinned bottom-right grows
   * by moving its left and top edges, so the corner grip is the top-left one. That
   * is the same arrangement — and, through `nudgeLayout`, the same arithmetic — as
   * the Options simulator's `sim-grip` / `sim-edge-x` / `sim-edge-y`, which is the
   * scale drawing of this exact rectangle.
   *
   * The two edge handles exist separately from the corner because a width change
   * with a stray pixel of height is the usual thing to *not* want once the card is
   * roughly the right shape. Desktop only: the handles are rendered regardless and
   * hidden by the narrow media query, since under 640px the card is a bottom sheet
   * whose size is the viewport's business.
   */
  private addResizeGrips(card: HTMLElement): void {
    const modes: [string, DragMode][] = [
      ['cf-grab cf-grab-corner', 'resize'],
      ['cf-grab cf-grab-x', 'resize-x'],
      ['cf-grab cf-grab-y', 'resize-y'],
    ];
    for (const [className, mode] of modes) {
      const grab = document.createElement('div');
      grab.className = className;
      // Decorative: the keyboard route to a size is the Options simulator, which
      // is a real focusable control with arrow keys. A tab stop on each of three
      // handles, on every posting, would cost more than it bought.
      grab.setAttribute('aria-hidden', 'true');
      this.makeResizable(card, grab, mode);
      card.append(grab);
    }
  }

  private makeResizable(card: HTMLElement, handle: HTMLElement, mode: DragMode): void {
    let startX = 0;
    let startY = 0;
    let start: ModalLayout = { right: 16, bottom: 16, width: 0, height: 0 };

    const onDown = (e: PointerEvent) => {
      // A card with no stored rectangle is sized by CSS; there is nothing to
      // resize *from*, and the narrow sheet is the viewport's business.
      if (window.innerWidth <= NARROW || !this.data?.layout || this.data.fullscreen) return;
      e.preventDefault();
      e.stopPropagation(); // the header's move-drag must not also claim this
      startX = e.clientX;
      startY = e.clientY;
      // From what is on screen, not from what is stored: a card bigger than this
      // viewport is being *shown* clamped, and starting from the stored numbers
      // would jump on the first pixel of movement.
      start = rectOf(card);
      handle.setPointerCapture(e.pointerId);
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp, { once: true });
      handle.addEventListener('pointercancel', onUp, { once: true });
    };

    const onMove = (e: PointerEvent) => {
      this.gesture(start, mode, e.clientX - startX, e.clientY - startY);
    };

    const onUp = (e: PointerEvent) => {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener('pointermove', onMove);
      if (this.data?.layout) this.geom.onLayoutChange?.(this.data.layout);
    };

    handle.addEventListener('pointerdown', onDown);
  }

  /**
   * One frame of a gesture: apply the delta, snap it, clamp it, show it, announce
   * it. Snapping is what makes "flush" aimable — the edge is one pixel wide, so by
   * hand it is otherwise reached by luck, and the limit colours would be something
   * the user hit by accident rather than aimed at.
   */
  private gesture(start: ModalLayout, mode: DragMode, dx: number, dy: number): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    this.setLayout(clampLayout(snapLayout(nudgeLayout(start, mode, dx, dy), vw, vh, mode), vw, vh));
    if (this.data?.layout) this.geom.onLayoutPreview?.(this.data.layout);
  }

  destroy(): void {
    window.removeEventListener('resize', this.onViewportResize);
    this.host.remove();
  }
}

/** The card's rectangle as a `ModalLayout` — i.e. anchored to the bottom-right. */
function rectOf(card: HTMLElement): ModalLayout {
  const r = card.getBoundingClientRect();
  return {
    right: window.innerWidth - r.right,
    bottom: window.innerHeight - r.bottom,
    width: r.width,
    height: r.height,
  };
}
