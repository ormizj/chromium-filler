/**
 * The run of elements under one point on the page, and how to travel through it.
 *
 * `document.elementFromPoint` hands back exactly one node, and it is routinely not
 * the one the user means: the description is the `<div>` around the `<span>` they
 * can see, and the Send button is the `<button>` around the `<span>` the click
 * lands on. So a pick is a *chain* — the nested elements at that point, outermost
 * first — which the picker steps inward through as the user clicks the same spot
 * again.
 *
 * The rules live here rather than in `picker.ts` so they can be tested: jsdom
 * implements neither `elementsFromPoint` nor layout, so the hit-test stack and the
 * rect reader are arguments rather than globals.
 */

import { isStableClass, isStableId } from './selector';

/** How far above the innermost element a pick may start. */
export const MAX_CHAIN = 4;

interface RectLike { x: number; y: number; width: number; height: number }

export interface ChainOpts {
  /** Everything the extension drew — see `content/extensionUi.ts`. */
  isOwn?: (el: Element) => boolean;
  rectOf?: (el: Element) => RectLike;
}

const sameBox = (a: RectLike, b: RectLike): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * `stack` is innermost-first, as `document.elementsFromPoint` returns it; the
 * result is **outermost-first**, which is where a pick starts.
 *
 * Empty is a real answer, not a failure: a point over the extension's own toolbar
 * has nothing on the page to offer, and the picker ignores that click rather than
 * proposing one of its own buttons.
 */
export function elementChain(stack: Element[], opts: ChainOpts = {}): Element[] {
  const isOwn = opts.isOwn ?? (() => false);
  const rectOf = opts.rectOf ?? ((el: Element) => el.getBoundingClientRect());

  const kept: Element[] = [];
  let lastBox: RectLike | null = null;

  for (const el of stack) {
    // The page itself is never a candidate, and nothing we drew ever is.
    if (el === document.body || el === document.documentElement) continue;
    if (isOwn(el)) continue;

    const box = rectOf(el);
    // A wrapper drawing the same box as the child inside it is a click that moves
    // nothing on screen, which reads as the picker being broken.
    if (lastBox && sameBox(box, lastBox)) continue;

    kept.push(el);
    lastBox = box;
    // Counted after pruning, so a run of identical wrappers does not eat the budget.
    if (kept.length > MAX_CHAIN) break;
  }

  return kept.reverse();
}

/** Wrapping index arithmetic. `dir` +1 steps inward, -1 steps outward. */
export function stepChain(len: number, index: number, dir: 1 | -1): number {
  if (len <= 1) return 0;
  return (index + dir + len) % len;
}

/**
 * What the toolbar reads back, so the user can tell one step of the chain from the
 * next. It quotes an id or a class only when `selector.ts` would consider it worth
 * building a selector on — a generated `css-1a2b3c4d` names nothing and would be a
 * different string next deploy.
 */
export function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id && isStableId(el.id)) return `${tag}#${el.id}`;
  const cls = Array.from(el.classList).find(isStableClass);
  return cls ? `${tag}.${cls}` : tag;
}
