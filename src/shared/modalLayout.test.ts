/**
 * The modal's size and position are the user's to choose (Options → Settings has
 * a viewport simulator for it), which means a stored layout can outlive the
 * screen it was chosen on: a card placed on a 2560px monitor must not sit off
 * the edge of a laptop, and a stored size must never shrink to unusable.
 */
import { describe, it, expect } from 'vitest';
import { clampLayout, DEFAULT_MODAL_LAYOUT, MIN_H, MIN_W } from './modalLayout';

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
