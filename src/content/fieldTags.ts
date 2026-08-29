/**
 * The name beside each mark on the page.
 *
 * `fill.ts` outlines what the extension recognised, and an outline is colour and
 * nothing else — so a form with nine outlined inputs says nine things were found
 * and never which one is Email. That is the only field feedback there is while a
 * site is being set up: the setup panel folds to its pill the moment a recording
 * starts, and the page underneath is what the user is working in. So the outline
 * gets a label.
 *
 * Drawn the way `picker.ts` draws its box — the host page's own light DOM, styled
 * inline from `ui/palette.ts` (a content script cannot see `tokens.css`, so a
 * `var(--…)` resolves to nothing out here), `pointer-events: none`, and positioned
 * from `getBoundingClientRect()`.
 *
 * **`position: fixed`, not `absolute`.** Page coordinates scroll for free, which is
 * tempting — and wrong for a field inside a scrollable subtree or under a CSS
 * transform, both routine on a multi-step ATS form. A rectangle read from the
 * viewport is right in every case; the cost is one pass per frame over ~10 chips,
 * which is what the picker already pays for one.
 *
 * **The chip is the only extrinsic half of a mark.** `highlight` draws the outline
 * as an inline style on the element itself, so it moves with the page whatever
 * happens; a `position: fixed` chip is right only for as long as the number it was
 * given is. That asymmetry is the whole of `watchPageChange` being here: with
 * `scroll` and `resize` alone, opening a description left every name on the page
 * behind — and the mark visibly came apart into an outline in the right place and
 * a label in the wrong one — until something happened to scroll.
 */

import { currentPalette, withAlpha, type Palette } from '../ui/palette';
import { TAG_ATTR } from './extensionUi';
import { watchPageChange } from './pageChange';
import type { MatchConfidence } from '../shared/types';

/**
 * Under the recorder bar (`…645`) and the picker's box (`…646`), over everything a
 * page is likely to draw. A chip must never sit on the one control that can stop
 * the recording it is helping with.
 */
const Z = '2147483644';

/** Where a chip was last put, so a pass can tell movement from a repeat. */
interface Mark {
  tag: HTMLElement;
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Each live chip and the element it names, so one pass can re-place them all. */
const tags = new Map<HTMLElement, Mark>();

/** Registered lazily with the first chip, and removed with the last. */
let detach: (() => void) | undefined;
let frame = 0;
/** When something last actually moved — see `pass()` for what it buys. */
let lastMove = 0;

function statusColor(p: Palette, confidence: MatchConfidence): string {
  return confidence === 'high' ? p.ok : confidence === 'low' ? p.warn : p.err;
}

/**
 * Name one mark. The label is the caller's — `FIELD_LABELS[key]` for a field, "Send
 * button" for the control Apply presses — because the surfaces that mark things
 * already hold the right word and a second lookup here could only disagree with it.
 */
export function tagElement(el: HTMLElement, label: string, confidence: MatchConfidence): void {
  const existing = tags.get(el);
  if (existing) existing.tag.remove();

  const p = currentPalette();
  const tag = document.createElement('span');
  tag.setAttribute(TAG_ATTR, 'name');
  // These sit in the *page's* DOM, so without this a screen reader reads them in the
  // form's own reading order — a second, worse copy of every label the page already
  // has. The panel's rows are the accessible surface for this; the chip is the
  // sighted shortcut to them, exactly as the picker's box is.
  tag.setAttribute('aria-hidden', 'true');
  tag.textContent = label;
  Object.assign(tag.style, {
    position: 'fixed',
    zIndex: Z,
    pointerEvents: 'none',
    // Deliberately the picker toolbar's inverted chip: these two are the only things
    // the extension draws directly on someone else's page, and one treatment between
    // them is what stops the page looking like it has two extensions on it.
    background: p.ink,
    color: p.onInk,
    font: '11px/1.4 system-ui, sans-serif',
    fontWeight: '500',
    padding: '2px 6px',
    borderRadius: '4px',
    // The one part that is not the toolbar's: a stripe in the mark's own colour, so
    // the chip and the outline it belongs to read as one thing rather than as a label
    // that happens to be nearby.
    borderLeft: `3px solid ${statusColor(p, confidence)}`,
    boxShadow: `0 1px 4px ${withAlpha('#000000', 0.3)}`,
    whiteSpace: 'nowrap',
    maxWidth: '40vw',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: 'none',
  } as CSSStyleDeclaration);

  document.body.append(tag);
  const mark: Mark = { tag, top: NaN, left: NaN, width: NaN, height: NaN };
  tags.set(el, mark);
  place(el, mark);
  listen();
  // A chip is routinely drawn *into* a page that is still settling — the sweep after
  // a click runs while the modal it opened is still animating open — so the follow
  // loop starts with the mark rather than waiting for the next thing to move.
  reflow();
}

/**
 * The same mark, a different outcome — used by the label-less `highlight`.
 *
 * `confirmField` re-colours a field's outline after a Confirm and passes no label,
 * because it is not naming anything: the name has not changed, only whether the
 * value went in. Removing the chip there would take the name off the one field the
 * user has just acted on, and leaving it untouched would leave a yellow stripe on a
 * mark that has gone green — a chip disagreeing with the outline it belongs to. So
 * the stripe follows and the text stays.
 *
 * Nothing to re-colour is not a failure: a fill draws no chips at all.
 */
export function retintTag(el: HTMLElement, confidence: MatchConfidence): void {
  const mark = tags.get(el);
  if (mark) mark.tag.style.borderLeftColor = statusColor(currentPalette(), confidence);
}

export function clearTags(): void {
  for (const mark of tags.values()) mark.tag.remove();
  tags.clear();
  unlisten();
}

const GAP = 2;
/**
 * How long the follow loop keeps looking after the last thing it saw move.
 *
 * A `MutationObserver` reports the class flip that starts a transition and nothing
 * at all about the 300ms of movement that follows it, so a single pass would place
 * every chip at the position the *first* frame happened to show. Keeping the loop
 * alive for a beat past the last real change is what makes a chip ride the
 * animation out — and, because the tail is measured from movement rather than from
 * the trigger, a `transition-delay` is covered too.
 */
const FOLLOW_MS = 300;

/**
 * Above the control and **aligned to its right-hand edge**, dropping inside it when
 * there is no room above.
 *
 * Right, not left, and that is the whole of the placement rule. The gap above a form
 * control is where the form's own `<label>` lives — so a chip pinned above-left sits
 * on top of the very words it is echoing, on essentially every field of every form.
 * Labels are short and controls are wide, so the right-hand end of that same gap is
 * almost always empty. It costs the tidy left-hand column a mouse reading would have
 * given, and buys a chip that is legible on a real page.
 *
 * The vertical fallback is the topmost field on a form scrolled to the top — the
 * commonest field on the page rather than an edge case — and it goes *inside* the
 * control rather than below it, because below is where the next field's chip lives.
 *
 * A rectangle with no area, or one entirely off screen, gets no chip at all: a name
 * floating over nothing is worse than no name, and the `display: none` file input
 * behind a custom "Upload CV" button is the commonest shape of `resume` on an ATS.
 * Hidden, never removed — the element scrolls back and its mark has to come with it.
 *
 * Returns whether the rectangle it was given differs from the one this chip was last
 * placed against, which is what tells the loop the page is still moving.
 */
function place(el: HTMLElement, mark: Mark): boolean {
  const r = el.getBoundingClientRect();
  const moved = r.top !== mark.top || r.left !== mark.left
    || r.width !== mark.width || r.height !== mark.height;
  mark.top = r.top;
  mark.left = r.left;
  mark.width = r.width;
  mark.height = r.height;
  if (!moved) return false;

  const { tag } = mark;
  const offScreen = r.bottom < 0 || r.top > window.innerHeight
    || r.right < 0 || r.left > window.innerWidth;
  if (!r.width || !r.height || offScreen) {
    tag.style.display = 'none';
    return true;
  }
  // Measured, not assumed: both depend on the page's own font metrics, which is
  // exactly what this chip is drawn on top of.
  tag.style.display = 'block';
  const { offsetHeight: h, offsetWidth: w } = tag;

  const above = r.top - h - GAP;
  tag.style.top = `${above >= 0 ? above : r.top + GAP}px`;

  // Right-aligned to the control, then clamped so a control at either edge of the
  // viewport cannot push its own name off screen.
  const right = r.right - w;
  tag.style.left = `${Math.min(Math.max(right, GAP), window.innerWidth - w - GAP)}px`;
  return true;
}

/**
 * Something happened. Start looking, and keep looking until the page holds still.
 *
 * The trigger extends the window as well as opening it, so a page that is mutating
 * continuously keeps the loop alive — that is the cost, and it is the right way
 * round: a page that never stops changing is exactly the page whose chips would
 * otherwise never be right.
 */
function reflow(): void {
  lastMove = performance.now();
  if (!frame) frame = requestAnimationFrame(pass);
}

/** One placement pass for the whole set, and the decision to run another. */
function pass(): void {
  frame = 0;
  let moved = false;
  for (const [el, mark] of tags) if (place(el, mark)) moved = true;
  const now = performance.now();
  if (moved) lastMove = now;
  if (tags.size && now - lastMove < FOLLOW_MS) frame = requestAnimationFrame(pass);
}

function listen(): void {
  if (detach) return;
  detach = watchPageChange(reflow);
}

function unlisten(): void {
  if (!detach) return;
  detach();
  detach = undefined;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
}
