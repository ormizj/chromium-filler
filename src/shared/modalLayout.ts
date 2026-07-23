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

/**
 * What a browser window costs on top of the OS bars when the delta cannot be
 * measured. Only the framed/implausible path uses it — see `modelledViewport`.
 */
export const NOMINAL_CHROME = { width: 0, height: 90 };

/** Beyond this share of the screen, an `outer - inner` delta is not chrome. */
const MAX_CHROME_SHARE = 0.4;

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

/* ---------------- Modelling the user's screen ---------------- */

/** Everything `modelledViewport` needs, taken from `window` and `window.screen`. */
export interface ScreenMetrics {
  /** `screen.availWidth/Height` — the display minus the OS bars. */
  availWidth: number;
  availHeight: number;
  outerWidth: number;
  outerHeight: number;
  innerWidth: number;
  innerHeight: number;
  /** `window.top !== window.self` — an iframe's inner size is not a window's. */
  framed: boolean;
}

export interface ModelledViewport {
  /** The page viewport a browser window would have on that screen, in CSS px. */
  width: number;
  height: number;
  chromeWidth: number;
  chromeHeight: number;
  /** `reference` = the metrics describe a phone (or nonsense) and were not used. */
  source: 'screen' | 'reference';
  /** False when the nominal chrome stood in — the figure is an estimate, say so. */
  chromeMeasured: boolean;
}

/**
 * The screen the layout simulator should model, and the part of it a page gets.
 *
 * The modal lives in the page viewport, not on the screen, so the display's own
 * size is only half the answer: `availWidth/Height` already excludes the OS bars,
 * and the browser's chrome comes off on top of that. That chrome is *measured*
 * rather than assumed, because the page asking is itself a tab in the browser
 * being modelled — `outerHeight - innerHeight` is the tab strip, the address bar
 * and the bookmarks bar if the user keeps one open. Someone with bookmarks showing
 * genuinely has a shorter, wider-ratio viewport, and the frame has to show that.
 *
 * The options window's own size is irrelevant: an unmaximized window has the same
 * chrome, so the delta holds and the model stays "the whole screen".
 */
/** A screen, as one window reported it. */
export interface ScreenSample {
  availWidth: number;
  availHeight: number;
  chromeWidth: number;
  chromeHeight: number;
  /** False when the nominal fallback stood in — an estimate, and labelled as one. */
  chromeMeasured: boolean;
}

const finite = (v: number) => Number.isFinite(v) && v > 0;

/** What this window currently says the screen and its own chrome are. */
export function measureScreen(m: ScreenMetrics): ScreenSample {
  // An iframe reports the frame's inner size against the top window's outer size,
  // so the delta is meaningless — the dev harness runs the options page this way.
  const axis = (outer: number, inner: number, avail: number): number | undefined => {
    if (m.framed || !finite(outer) || !finite(inner) || !finite(avail)) return undefined;
    const delta = Math.max(0, outer - inner);
    return delta > avail * MAX_CHROME_SHARE ? undefined : delta;
  };
  const w = axis(m.outerWidth, m.innerWidth, m.availWidth);
  const h = axis(m.outerHeight, m.innerHeight, m.availHeight);
  return {
    availWidth: m.availWidth,
    availHeight: m.availHeight,
    chromeWidth: Math.round(w ?? NOMINAL_CHROME.width),
    chromeHeight: Math.round(h ?? NOMINAL_CHROME.height),
    chromeMeasured: w !== undefined && h !== undefined,
  };
}

/**
 * The screen, read once and then left alone for the life of the page.
 *
 * Resizing a window changes neither the screen nor the browser's furniture — but
 * it changes every number they are read from. `inner*` and `outer*` update out of
 * step mid-drag, so the chrome delta briefly reads as hundreds of pixels; some
 * environments never update `outer*` at all; and headless Chromium reports
 * `screen.avail*` as the viewport outright. Re-reading through any of that swings
 * the frame's aspect ratio around while the user drags the window edge, and that
 * ratio is the one thing this frame exists to be honest about.
 *
 * Every "re-read once things settle" rule tried here failed on the same fact: a
 * single resize produces several repaints, so "settled" arrives before the window
 * has stopped. Reading once is the only rule that holds in every environment. The
 * cost is that a bookmarks bar toggled *while this panel is open* lands on the next
 * load of the options page rather than immediately — a rare change, against a frame
 * that would otherwise move under the user's hand mid-drag.
 */
export function sampleScreen(prev: ScreenSample | undefined, m: ScreenMetrics): ScreenSample {
  return prev ?? measureScreen(m);
}

/** The page viewport a browser window would have on the screen that was sampled. */
export function modelledViewport(s: ScreenSample): ModelledViewport {
  const reference = (): ModelledViewport => ({
    ...REFERENCE_VIEWPORT,
    chromeWidth: NOMINAL_CHROME.width,
    chromeHeight: NOMINAL_CHROME.height,
    source: 'reference',
    chromeMeasured: false,
  });

  if (!finite(s.availWidth) || !finite(s.availHeight)) return reference();

  const { chromeWidth, chromeHeight, chromeMeasured } = s;
  const width = Math.round(Math.max(0, s.availWidth - chromeWidth));
  const height = Math.round(Math.max(0, s.availHeight - chromeHeight));

  // A phone. The layout is desktop-only, so modelling the real screen here would
  // clamp the user's desktop card down to 390px the moment they opened this tab.
  if (width <= NARROW_WIDTH || height <= 0) return reference();

  return {
    width,
    height,
    chromeWidth: Math.round(chromeWidth),
    chromeHeight: Math.round(chromeHeight),
    source: 'screen',
    chromeMeasured,
  };
}

/* ---------------- Limits ---------------- */

/** Why an edge cannot move: not at all, the screen edge, or the minimum size. */
export type EdgeLimit = 'free' | 'screen' | 'min';

export interface LayoutLimits {
  top: EdgeLimit;
  right: EdgeLimit;
  bottom: EdgeLimit;
  left: EdgeLimit;
}

/**
 * Which of the card's edges have run out of room, and why.
 *
 * `clampLayout` refuses silently, so a drag that hit a wall looks exactly like a
 * drag that stopped. The simulator paints these onto the card's borders — and the
 * two reasons are painted differently, because "the screen ends here" and "this is
 * as small as the modal gets" are answered by opposite moves.
 */
export function layoutLimits(l: ModalLayout, vw: number, vh: number): LayoutLimits {
  // Screen wins over min when both hold: a viewport narrower than MIN_W is one
  // clampLayout deliberately allows the card to fill.
  const far = (offset: number, size: number, extent: number, min: number): EdgeLimit => {
    if (offset + size >= extent) return 'screen';
    return size <= min ? 'min' : 'free';
  };
  return {
    right: l.right <= 0 ? 'screen' : 'free',
    bottom: l.bottom <= 0 ? 'screen' : 'free',
    left: far(l.right, l.width, vw, MIN_W),
    top: far(l.bottom, l.height, vh, MIN_H),
  };
}

/**
 * Every limit the card can be under, in a fixed order.
 *
 * The full list is exported because the simulator renders all of them once and
 * only toggles their visibility: chips that come and go would reflow the readout
 * and shift the buttons under it on every drag, and a control that moves while you
 * are dragging next to it is worse than no feedback at all.
 */
export const ALL_LIMITS = [
  { key: 'flushTop', label: 'Flush top', tone: 'accent' },
  { key: 'flushRight', label: 'Flush right', tone: 'accent' },
  { key: 'flushBottom', label: 'Flush bottom', tone: 'accent' },
  { key: 'flushLeft', label: 'Flush left', tone: 'accent' },
  { key: 'minWidth', label: 'At minimum width', tone: 'warn' },
  { key: 'minHeight', label: 'At minimum height', tone: 'warn' },
] as const satisfies readonly { key: string; label: string; tone: 'accent' | 'warn' }[];

export type LimitKey = (typeof ALL_LIMITS)[number]['key'];

/** Which of `ALL_LIMITS` are live right now. */
export function activeLimits(x: LayoutLimits): Set<LimitKey> {
  const on = new Set<LimitKey>();
  if (x.right === 'screen') on.add('flushRight');
  if (x.bottom === 'screen') on.add('flushBottom');
  if (x.left === 'screen') on.add('flushLeft');
  else if (x.left === 'min') on.add('minWidth');
  if (x.top === 'screen') on.add('flushTop');
  else if (x.top === 'min') on.add('minHeight');
  return on;
}

/**
 * The live limits in words. Status is never colour alone here any more than it is
 * in the fill report — and this is what the readout's `aria-live` announces.
 */
export function describeLimits(x: LayoutLimits): { label: string; tone: 'accent' | 'warn' }[] {
  const on = activeLimits(x);
  // Right and bottom first: that is the corner the card is anchored to, so it is
  // the pair the user is usually placing against.
  const order: LimitKey[] = ['flushRight', 'flushBottom', 'flushLeft', 'minWidth', 'flushTop', 'minHeight'];
  return order.filter((k) => on.has(k))
    .map((k) => { const { label, tone } = ALL_LIMITS.find((l) => l.key === k)!; return { label, tone }; });
}

/* ---------------- Snapping ---------------- */

/**
 * What a pointer drag (or an arrow key) is doing to the card. The card is anchored
 * bottom-right, so the corner grip resizes both axes while the left and top edges
 * each resize one — a width change without a stray pixel of height, which is the
 * usual thing to want once the card is roughly the right shape.
 */
export type DragMode = 'move' | 'resize' | 'resize-x' | 'resize-y';

/** How close, in real px, a drag has to get before it is taken as intentional. */
const SNAP_PX = 10;

/** Pull `v` to whichever target is both nearest and within `threshold`. */
function snapTo(v: number, targets: number[], threshold: number): number {
  let best = v;
  let bestDist = threshold;
  for (const t of targets) {
    const dist = Math.abs(v - t);
    if (dist <= bestDist) {
      // `<=` keeps the *nearest*; ties go to the earlier (flush) target.
      if (dist === bestDist && best !== v) continue;
      best = t;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Nudge a drag onto the edge or the default gutter.
 *
 * Flush is one pixel wide, so by hand it is reached by luck — which would make the
 * limit colours something the user sees by accident rather than aims for. Move
 * snaps the anchored corner; resize snaps the *far* edge, since that is the one the
 * grip is dragging.
 */
export function snapLayout(
  l: ModalLayout,
  vw: number,
  vh: number,
  mode: DragMode,
  threshold = SNAP_PX,
): ModalLayout {
  const gutter = DEFAULT_MODAL_LAYOUT.right;
  if (mode === 'move') {
    return {
      ...l,
      right: snapTo(l.right, [0, gutter], threshold),
      bottom: snapTo(l.bottom, [0, gutter], threshold),
    };
  }
  // An axis-locked drag must not snap the axis it is not touching: nudging the
  // height during a horizontal resize is exactly the surprise the lock exists to
  // prevent.
  return {
    ...l,
    width: mode === 'resize-y' ? l.width
      : snapTo(l.right + l.width, [vw, vw - gutter], threshold) - l.right,
    height: mode === 'resize-x' ? l.height
      : snapTo(l.bottom + l.height, [vh, vh - gutter], threshold) - l.bottom,
  };
}
