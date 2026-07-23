/**
 * The one place `LayoutLimits` becomes CSS.
 *
 * Two surfaces draw the same card against the same edges — the review modal
 * itself (`content/modal/modal.ts`) and the scale model of it in Options — and
 * both need the same question answered in CSS: which edges is this card flush
 * against? Attribute names spelled out at each call site would be two
 * vocabularies that only look like one, so they are spelled out here instead.
 * `primitives.css` (`.cf-card`) and `options.css` (`.sim-card`) read them.
 */
import type { LayoutLimits } from '../shared/modalLayout';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** `data-limit-top="screen"` and friends, one per edge. */
export function setLimitAttrs(el: HTMLElement, limits: LayoutLimits): void {
  for (const side of SIDES) el.setAttribute(`data-limit-${side}`, limits[side]);
}

/**
 * Hand the edges back to the stylesheet.
 *
 * Needed because these selectors are more specific than the bare `.cf-card`
 * rules: the narrow-viewport block gives the bottom sheet its own rounded top
 * corners, and a stale `data-limit-*` left over from a desktop render would
 * outrank it and square them.
 */
export function clearLimitAttrs(el: HTMLElement): void {
  for (const side of SIDES) el.removeAttribute(`data-limit-${side}`);
}
