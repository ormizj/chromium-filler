/**
 * "Can the user see this?" — asked by two parts of the extension that need
 * genuinely different answers, so they get two functions rather than one that
 * is subtly wrong for one caller.
 *
 * `isRendered` is the strict, layout-based test. `successSelector` needs it:
 * sites pre-render a hidden thank-you node, and "present in the DOM" is not the
 * signal — occupying a box on screen is. Nothing but a real browser can answer
 * it, which is why the code paths using it are covered by E2E rather than units.
 *
 * `isDisplayed` asks only whether anything in the ancestor chain has switched
 * this subtree off. That is the right question for the submit-button heuristic —
 * a control inside a collapsed panel must not be offered — and, unlike
 * `isRendered`, it is answerable without a layout engine, so the heuristic stays
 * unit-testable under jsdom.
 */

/** Strict: really rendered, with a box on screen. Needs a real browser. */
export function isRendered(el: HTMLElement): boolean {
  if (!isDisplayed(el)) return false;
  return el.getClientRects().length > 0;
}

/** Loose: not switched off by `hidden`, `display`, `visibility` or `opacity`. */
export function isDisplayed(el: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
  }
  return true;
}
