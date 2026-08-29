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
 * from `getBoundingClientRect()` on every scroll and resize.
 *
 * **`position: fixed`, not `absolute`.** Page coordinates scroll for free, which is
 * tempting — and wrong for a field inside a scrollable subtree or under a CSS
 * transform, both routine on a multi-step ATS form. A rectangle read from the
 * viewport is right in every case; the cost is one pass per frame over ~10 chips,
 * which is what the picker already pays for one.
 */

import { currentPalette, withAlpha, type Palette } from '../ui/palette';
import { TAG_ATTR } from './extensionUi';
import type { MatchConfidence } from '../shared/types';

/**
 * Under the recorder bar (`…645`) and the picker's box (`…646`), over everything a
 * page is likely to draw. A chip must never sit on the one control that can stop
 * the recording it is helping with.
 */
const Z = '2147483644';

/** Each live chip and the element it names, so one pass can re-place them all. */
const tags = new Map<HTMLElement, HTMLElement>();

/** Registered lazily with the first chip, and removed with the last. */
let listening = false;
let frame = 0;

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
  if (existing) existing.remove();

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
  tags.set(el, tag);
  place(el, tag);
  listen();
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
  const tag = tags.get(el);
  if (tag) tag.style.borderLeftColor = statusColor(currentPalette(), confidence);
}

export function clearTags(): void {
  for (const tag of tags.values()) tag.remove();
  tags.clear();
  unlisten();
}

const GAP = 2;

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
 */
function place(el: HTMLElement, tag: HTMLElement): void {
  const r = el.getBoundingClientRect();
  const offScreen = r.bottom < 0 || r.top > window.innerHeight
    || r.right < 0 || r.left > window.innerWidth;
  if (!r.width || !r.height || offScreen) {
    tag.style.display = 'none';
    return;
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
}

/**
 * One pass for the whole set, batched into a frame. `scroll` is captured, because
 * the scroll that moves a field is often a container's rather than the window's and
 * those do not bubble.
 */
function reflow(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    for (const [el, tag] of tags) place(el, tag);
  });
}

function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('scroll', reflow, true);
  window.addEventListener('resize', reflow);
}

function unlisten(): void {
  if (!listening) return;
  listening = false;
  window.removeEventListener('scroll', reflow, true);
  window.removeEventListener('resize', reflow);
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
}
