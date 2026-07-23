/**
 * The modal's size and position are the user's to choose (Options → Settings has
 * a viewport simulator for it), which means a stored layout can outlive the
 * screen it was chosen on: a card placed on a 2560px monitor must not sit off
 * the edge of a laptop, and a stored size must never shrink to unusable.
 */
import { describe, it, expect } from 'vitest';
import {
  clampLayout, describeLimits, DEFAULT_MODAL_LAYOUT, layoutLimits, MIN_H, MIN_W,
  measureScreen, modelledViewport, NOMINAL_CHROME, REFERENCE_VIEWPORT, sampleScreen, snapLayout,
  type ScreenMetrics,
} from './modalLayout';

describe('clampLayout', () => {
  it('leaves the default alone on a roomy viewport', () => {
    expect(clampLayout(DEFAULT_MODAL_LAYOUT, 1440, 900)).toEqual(DEFAULT_MODAL_LAYOUT);
  });

  it('shrinks a card that is wider than the viewport', () => {
    const l = clampLayout({ right: 16, bottom: 16, width: 900, height: 720 }, 800, 900);
    expect(l.width).toBeLessThanOrEqual(800);
    expect(l.right + l.width).toBeLessThanOrEqual(800);
  });

  it('shrinks a card that is taller than the viewport', () => {
    const l = clampLayout({ right: 16, bottom: 16, width: 460, height: 1200 }, 1440, 700);
    expect(l.height).toBeLessThanOrEqual(700);
    expect(l.bottom + l.height).toBeLessThanOrEqual(700);
  });

  it('pulls a card stored off the left edge back on screen', () => {
    // right: 1200 on a 1440 viewport puts a 460-wide card at x = -220.
    const l = clampLayout({ right: 1200, bottom: 16, width: 460, height: 600 }, 1440, 900);
    expect(l.right).toBeLessThanOrEqual(1440 - l.width);
    expect(l.right).toBeGreaterThanOrEqual(0);
  });

  it('pulls a card stored above the top edge back on screen', () => {
    const l = clampLayout({ right: 16, bottom: 800, width: 460, height: 600 }, 1440, 900);
    expect(l.bottom).toBeLessThanOrEqual(900 - l.height);
    expect(l.bottom).toBeGreaterThanOrEqual(0);
  });

  it('never goes below the usable minimum size', () => {
    const l = clampLayout({ right: 0, bottom: 0, width: 40, height: 40 }, 1440, 900);
    expect(l.width).toBe(MIN_W);
    expect(l.height).toBe(MIN_H);
  });

  it('lets the card fill a viewport smaller than the minimum rather than overflow it', () => {
    // A phone-sized viewport never uses this path (the modal is a bottom sheet
    // there), but the numbers still have to stay on screen.
    const l = clampLayout(DEFAULT_MODAL_LAYOUT, 300, 200);
    expect(l.right).toBe(0);
    expect(l.bottom).toBe(0);
    expect(l.width).toBeLessThanOrEqual(300);
    expect(l.height).toBeLessThanOrEqual(200);
  });

  it('rounds to whole pixels, so a drag cannot accumulate fractions', () => {
    const l = clampLayout({ right: 16.4, bottom: 16.6, width: 460.2, height: 720.7 }, 1440, 900);
    for (const v of Object.values(l)) expect(Number.isInteger(v)).toBe(true);
  });
});

/**
 * The simulator has to model the screen the modal will actually appear on, and the
 * part of it a web page gets: the display minus the OS bars minus the browser's own
 * chrome. The chrome is measurable rather than assumed, because the options page is
 * itself a tab in the browser being modelled — a user with a bookmarks bar has less
 * height and a different aspect ratio, and the frame has to show that.
 */
describe('modelledViewport', () => {
  /** A maximized window on a 2560×1440 display: 40px dock, 111px of browser chrome. */
  const desktop: ScreenMetrics = {
    availWidth: 2560, availHeight: 1400,
    outerWidth: 2560, outerHeight: 1400,
    innerWidth: 2560, innerHeight: 1289,
    framed: false,
  };

  it('subtracts the browser chrome from the available screen', () => {
    const vp = modelledViewport(measureScreen(desktop));
    expect(vp).toMatchObject({ width: 2560, height: 1289, source: 'screen', chromeMeasured: true });
    expect(vp.chromeHeight).toBe(111);
  });

  it('sees a bookmarks bar as lost height, not as a smaller screen', () => {
    // Same display, bookmarks bar on: inner shrinks, outer does not.
    const withBar = modelledViewport(measureScreen({ ...desktop, innerHeight: 1289 - 34 }));
    expect(withBar.height).toBe(1289 - 34);
    expect(withBar.chromeHeight).toBe(111 + 34);
    // The frame's whole job is that ratio, so it must actually move.
    expect(withBar.width / withBar.height).toBeGreaterThan(desktop.availWidth / 1289);
  });

  it('models the whole screen even when the options window is small', () => {
    // An unmaximized window has the same chrome, so the delta is still right.
    const small = modelledViewport(measureScreen({
      ...desktop, outerWidth: 900, outerHeight: 700, innerWidth: 900, innerHeight: 589,
    }));
    expect(small.width).toBe(2560);
    expect(small.height).toBe(1289);
  });

  it('falls back to nominal chrome inside an iframe, where the delta is nonsense', () => {
    // The dev harness renders options in an iframe: innerHeight is the iframe's,
    // outerHeight is the top window's.
    const vp = modelledViewport(measureScreen({ ...desktop, framed: true, innerHeight: 800 }));
    expect(vp.chromeMeasured).toBe(false);
    expect(vp.chromeHeight).toBe(NOMINAL_CHROME.height);
    expect(vp.height).toBe(1400 - NOMINAL_CHROME.height);
  });

  it('rejects an implausible chrome delta even unframed', () => {
    const vp = modelledViewport(measureScreen({ ...desktop, innerHeight: 200 }));
    expect(vp.chromeMeasured).toBe(false);
    expect(vp.chromeHeight).toBe(NOMINAL_CHROME.height);
  });

  it('never reports negative chrome', () => {
    const vp = modelledViewport(measureScreen({ ...desktop, innerHeight: 1500, innerWidth: 3000 }));
    expect(vp.chromeHeight).toBe(0);
    expect(vp.chromeWidth).toBe(0);
  });

  it('models a reference desktop screen on a phone', () => {
    // The layout is desktop-only, so clamping it to a 390px screen would destroy it.
    const vp = modelledViewport(measureScreen({
      availWidth: 390, availHeight: 844,
      outerWidth: 390, outerHeight: 844, innerWidth: 390, innerHeight: 720,
      framed: false,
    }));
    expect(vp.source).toBe('reference');
    expect(vp).toMatchObject(REFERENCE_VIEWPORT);
  });

  it('models the reference screen rather than trusting garbage metrics', () => {
    const vp = modelledViewport(measureScreen({
      availWidth: 0, availHeight: Number.NaN,
      outerWidth: 0, outerHeight: 0, innerWidth: 0, innerHeight: 0,
      framed: false,
    }));
    expect(vp.source).toBe('reference');
    expect(vp).toMatchObject(REFERENCE_VIEWPORT);
  });

  it('reports whole pixels', () => {
    const vp = modelledViewport(measureScreen({ ...desktop, availHeight: 1400.6, innerHeight: 1288.4 }));
    expect(Number.isInteger(vp.width)).toBe(true);
    expect(Number.isInteger(vp.height)).toBe(true);
  });

  /**
   * The frame's aspect ratio is the whole point of modelling a screen, so it must
   * not wobble while the options window is being dragged to a new size — the screen
   * did not change, only the window on it.
   */
  it('keeps the chrome it measured while the window is being resized', () => {
    const settled = sampleScreen(undefined, desktop);
    // Mid-resize: inner has updated, outer has not (or vice versa) — a delta that
    // would read as 900px of browser chrome.
    const midDrag = sampleScreen(settled, { ...desktop, outerHeight: 900, innerHeight: 400 });
    expect(midDrag.chromeHeight).toBe(settled.chromeHeight);
    expect(modelledViewport(midDrag).height).toBe(1289);
  });

  it('models the same screen at every window size', () => {
    // Resizing the window changes neither the screen nor the browser's chrome — but
    // it changes every number they are read from, and some environments report
    // `screen.avail*` as the viewport outright. Nothing the frame is drawn from may
    // move: the ratio the user configured against has to survive them dragging the
    // options window about.
    let sample = sampleScreen(undefined, desktop);
    const first = modelledViewport(sample);
    for (const [ow, oh] of [[1800, 1000], [900, 1000], [700, 400], [2560, 1400]]) {
      const m: ScreenMetrics = {
        ...desktop,
        availWidth: ow, availHeight: oh,   // an environment that equates screen and window
        outerWidth: ow, outerHeight: oh, innerWidth: ow, innerHeight: oh - 111,
      };
      sample = sampleScreen(sample, m);
      expect(modelledViewport(sample)).toEqual(first);
    }
  });

  it('reads a bookmarks bar on the load that follows it', () => {
    // The live version of this cost more than it was worth (see `sampleScreen`),
    // but a fresh page must still see the shorter viewport it left behind.
    const withBar = sampleScreen(undefined, { ...desktop, innerHeight: desktop.innerHeight - 34 });
    expect(withBar.chromeHeight).toBe(measureScreen(desktop).chromeHeight + 34);
    expect(modelledViewport(withBar).height).toBe(1289 - 34);
  });
});

/**
 * Which of the card's edges cannot go any further, and why: `clampLayout` refuses
 * silently, so without this a drag that hit a wall looks like a drag that stopped.
 */
describe('layoutLimits', () => {
  it('reports a card in open space as free on every side', () => {
    expect(layoutLimits(DEFAULT_MODAL_LAYOUT, 1440, 900))
      .toEqual({ top: 'free', right: 'free', bottom: 'free', left: 'free' });
  });

  it('marks the screen edges the card is flush against', () => {
    const limits = layoutLimits({ right: 0, bottom: 0, width: 460, height: 720 }, 1440, 900);
    expect(limits.right).toBe('screen');
    expect(limits.bottom).toBe('screen');
    expect(limits.left).toBe('free');
    expect(limits.top).toBe('free');
  });

  it('marks the far edges when the card spans the screen', () => {
    const limits = layoutLimits({ right: 0, bottom: 0, width: 1440, height: 900 }, 1440, 900);
    expect(limits).toEqual({ top: 'screen', right: 'screen', bottom: 'screen', left: 'screen' });
  });

  it('distinguishes "cannot shrink" from "cannot grow"', () => {
    // At the minimum size in open space: the grip's own edges are blocked, but by
    // the minimum rather than by the screen.
    const limits = layoutLimits({ right: 100, bottom: 100, width: MIN_W, height: MIN_H }, 1440, 900);
    expect(limits.left).toBe('min');
    expect(limits.top).toBe('min');
    expect(limits.right).toBe('free');
    expect(limits.bottom).toBe('free');
  });

  it('prefers the screen edge when the card is both minimal and flush', () => {
    // A viewport narrower than the minimum, which clampLayout deliberately allows.
    const limits = layoutLimits({ right: 0, bottom: 0, width: 300, height: 200 }, 300, 200);
    expect(limits.left).toBe('screen');
    expect(limits.top).toBe('screen');
  });
});

describe('describeLimits', () => {
  it('says nothing when nothing is blocked', () => {
    expect(describeLimits(layoutLimits(DEFAULT_MODAL_LAYOUT, 1440, 900))).toEqual([]);
  });

  it('names each blocked edge in words, so the colour is never the only signal', () => {
    const said = describeLimits(layoutLimits({ right: 0, bottom: 0, width: 460, height: 720 }, 1440, 900));
    expect(said.map((s) => s.label)).toEqual(['Flush right', 'Flush bottom']);
    expect(said.every((s) => s.tone === 'accent')).toBe(true);
  });

  it('tones a minimum-size limit differently from a screen edge', () => {
    const said = describeLimits(layoutLimits({ right: 100, bottom: 100, width: MIN_W, height: MIN_H }, 1440, 900));
    expect(said).toEqual([
      { label: 'At minimum width', tone: 'warn' },
      { label: 'At minimum height', tone: 'warn' },
    ]);
  });
});

/**
 * Flush is a single pixel wide, so by hand it is reached by luck. Snapping is what
 * makes the limit feedback reachable at all.
 */
describe('snapLayout', () => {
  const vp = { w: 1440, h: 900 };

  it('leaves a card that is nowhere near a target alone', () => {
    const l = { right: 200, bottom: 200, width: 460, height: 720 };
    expect(snapLayout(l, vp.w, vp.h, 'move')).toEqual(l);
  });

  it('snaps a move flush to the screen corner', () => {
    const l = snapLayout({ right: 4, bottom: 3, width: 460, height: 720 }, vp.w, vp.h, 'move');
    expect(l.right).toBe(0);
    expect(l.bottom).toBe(0);
  });

  it('snaps a move to the default gutter', () => {
    const l = snapLayout({ right: 21, bottom: 12, width: 460, height: 720 }, vp.w, vp.h, 'move');
    expect(l.right).toBe(DEFAULT_MODAL_LAYOUT.right);
    expect(l.bottom).toBe(DEFAULT_MODAL_LAYOUT.bottom);
  });

  it('does not move the card while resizing it', () => {
    const l = snapLayout({ right: 4, bottom: 3, width: 460, height: 720 }, vp.w, vp.h, 'resize');
    expect(l.right).toBe(4);
    expect(l.bottom).toBe(3);
  });

  it('snaps a resize so the far edge lands flush against the screen', () => {
    // right 16 + width 1420 leaves the left edge 4px short of the screen edge.
    const l = snapLayout({ right: 16, bottom: 16, width: 1420, height: 720 }, vp.w, vp.h, 'resize');
    expect(l.right + l.width).toBe(vp.w);
  });

  it('snaps a resize to the gutter on the far side', () => {
    const l = snapLayout({ right: 16, bottom: 16, width: 1400, height: 870 }, vp.w, vp.h, 'resize');
    expect(l.right + l.width).toBe(vp.w - DEFAULT_MODAL_LAYOUT.right);
    expect(l.bottom + l.height).toBe(vp.h - DEFAULT_MODAL_LAYOUT.bottom);
  });

  it('snaps to the nearest target when two are in range', () => {
    const l = snapLayout({ right: 6, bottom: 11, width: 460, height: 720 }, vp.w, vp.h, 'move');
    expect(l.right).toBe(0);
    expect(l.bottom).toBe(DEFAULT_MODAL_LAYOUT.bottom);
  });

  it('leaves the locked axis untouched on a one-axis resize', () => {
    // Both far edges are within snapping distance, but only the dragged one moves:
    // a horizontal resize that nudged the height is the surprise the lock prevents.
    const l = { right: 16, bottom: 16, width: 1420, height: 878 };
    expect(snapLayout(l, vp.w, vp.h, 'resize-x')).toMatchObject({ width: 1424, height: 878 });
    expect(snapLayout(l, vp.w, vp.h, 'resize-y')).toMatchObject({ width: 1420, height: 884 });
  });

  it('honours a wider threshold', () => {
    const l = snapLayout({ right: 40, bottom: 40, width: 460, height: 720 }, vp.w, vp.h, 'move', 50);
    expect(l.right).toBe(DEFAULT_MODAL_LAYOUT.right);
  });
});
