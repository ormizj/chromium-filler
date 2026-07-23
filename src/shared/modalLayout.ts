/**
 * Where the review modal sits on a desktop viewport, and how big it is.
 *
 * This is a user setting (Options → Settings has a viewport simulator for it),
 * which means a stored layout outlives the screen it was chosen on: a card placed
 * against the right edge of a 2560px monitor would otherwise sit off the edge of a
 * laptop, and a card dragged tiny would be unusable with no way back. Every read
 * and every write goes through `clampLayout`.
 *
 * Only desktop uses these numbers. Under 640px the modal is a full-width bottom
 * sheet (primitives.css), and the modal deliberately clears the inline styles
 * there — an inline width would beat the media query.
 */

export interface ModalLayout {
  /** Distance from the viewport's right edge, in CSS px. */
  right: number;
  /** Distance from the viewport's bottom edge, in CSS px. */
  bottom: number;
  width: number;
  height: number;
}

/**
 * Roomy by default: a job description is long prose, and the old 380×640 card
 * was a keyhole onto it.
 */
export const DEFAULT_MODAL_LAYOUT: ModalLayout = {
  right: 16,
  bottom: 16,
  width: 460,
  height: 720,
};

/** Below this the header, a line of prose and the footer stop coexisting. */
export const MIN_W = 320;
export const MIN_H = 260;

/**
 * At or below this viewport width the modal is a full-width bottom sheet and this
 * layout is not used at all. Shared with primitives.css's `max-width: 640px`
 * block and with modal.ts — the three have to agree or the card is sized by one
 * rule and positioned by another.
 */
export const NARROW_WIDTH = 640;

/**
 * The screen the Options simulator models when the options page is itself on a
 * phone. Configuring a desktop-only layout from a phone is a perfectly ordinary
 * thing to do here — the extension's whole point is mobile job-hunting — but
 * clamping the stored layout to a 390px viewport would quietly destroy it.
 */
export const REFERENCE_VIEWPORT = { width: 1440, height: 900 };

const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(Math.max(v, lo), hi));

/** Fit a stored layout to the viewport it is about to be shown on. */
export function clampLayout(layout: ModalLayout, vw: number, vh: number): ModalLayout {
  // A viewport smaller than the minimum still has to hold the card: filling it
  // beats overflowing it.
  const width = clamp(layout.width, Math.min(MIN_W, vw), vw);
  const height = clamp(layout.height, Math.min(MIN_H, vh), vh);
  return {
    width,
    height,
    right: clamp(layout.right, 0, Math.max(0, vw - width)),
    bottom: clamp(layout.bottom, 0, Math.max(0, vh - height)),
  };
}
