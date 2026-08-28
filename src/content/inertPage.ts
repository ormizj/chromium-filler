/**
 * Making the host page inert, for the two surfaces that have to.
 *
 * The picker and the recorder both ask the user to aim at a page rather than use
 * it, and both need the same thing while they do: the page's own JavaScript must
 * not see the gesture, and — for the events where the browser itself does
 * something — the browser must not act on it either. They had one copy of that
 * list each, which is exactly how two lists drift; this is the one copy.
 *
 * The split between the two lists below is the whole content of this module.
 *
 * **Everything is stopped.** `stopPropagation` + `stopImmediatePropagation` at
 * `document` in the capture phase means nothing deeper ever runs — a listener on
 * the element, an `onclick` attribute, a delegated handler on a wrapper. That is
 * the half that makes the page inert to its own code.
 *
 * **Only `CANCELLED` is also `preventDefault`ed.** A default action is the
 * browser's, not the page's: following a link, submitting a form, opening a
 * context menu, typing a character. Those have to go. The pointer, mouse and
 * touch *down and up* events do not, because their default is **scrolling** —
 * `preventDefault` on `pointerdown` or `touchstart` cancels native panning, and
 * a recording runs for minutes on a posting the user has to be able to read.
 *
 * `picker.ts` passes `hard: true` and opts back into cancelling those as well:
 * a pick lasts seconds, and suppressing the text selection a drag would start is
 * worth more there than scrolling is.
 *
 * `wheel` and `scroll` are deliberately not in either list. They are how the
 * user reads the page, and a page that acts on them is a page that is scrolling.
 */

/** Stopped, and the browser's own default goes too. */
const CANCELLED = ['click', 'dblclick', 'auxclick', 'contextmenu', 'keydown', 'keypress', 'submit'];

/** Stopped, but the browser still does what it would have done — including scroll. */
const QUIET = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'keyup'];

export interface InertOptions {
  /** Our own chrome, which must keep working — its buttons are the way out. */
  isExempt(el: Element | null): boolean;
  /**
   * Called per event: `true` lets this one through untouched. It is a function
   * rather than a flag because the caller's mode changes while this is attached,
   * and re-attaching listeners on every change would race the gesture in flight.
   */
  passes?(e: Event): boolean;
  /** Cancel the default on `QUIET` too. Costs scrolling; see the note above. */
  hard?: boolean;
}

/** Attach the suppression. Returns the detach. */
export function swallowPageInput(opts: InertOptions): () => void {
  const handle = (e: Event): void => {
    if (opts.isExempt(e.target as Element | null)) return;
    if (opts.passes?.(e)) return;
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (opts.hard || CANCELLED.includes(e.type)) e.preventDefault();
  };

  const types = [...CANCELLED, ...QUIET];
  for (const type of types) document.addEventListener(type, handle, true);
  return () => {
    for (const type of types) document.removeEventListener(type, handle, true);
  };
}
