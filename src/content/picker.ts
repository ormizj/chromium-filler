/**
 * Click/tap-to-pick element selection: click to *select*, click the same spot
 * again to step into the element inside it, Confirm to save.
 *
 * Two things this is not any more. It is not one flow for a mouse and another for
 * a finger — a click used to commit outright on a mouse, so a stray press wrote a
 * selector into the site config with nothing in between. And it is not one element
 * per point: `elementFromPoint` hands back a single node, and the thing the user
 * means is routinely the box around it (the description is the `<div>` around the
 * `<span>` you can see; the Send button is the `<button>` around the `<span>` the
 * click lands on). So a point gives a *chain* — see `shared/elementChain.ts` — and
 * a pick is a position in it.
 *
 * The chain runs outermost first, because the outer element is the one that can
 * usually name itself and the inner one is usually an unnamed `<span>`; clicking
 * again travels inward, and wraps.
 */

import { elementChain, describeElement, stepChain } from '../shared/elementChain';
import { ACTION_LABELS, SELECTOR_STRENGTH_TEXT } from '../shared/labels';
import { pickSelector } from '../shared/selector';
import { currentPalette, withAlpha } from '../ui/palette';
import { PICKER_ATTR as OWN_ATTR, isExtensionUi } from './extensionUi';

export type PickHandler = (el: Element) => void;

/** How far a second click may land from the first and still mean "the same spot". */
const SAME_SPOT_PX = 8;

export function startPicker(onPick: PickHandler, fieldLabel: string, onCancel?: () => void): () => void {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  // The toolbar lives on the host page's light DOM, which never sees tokens.css,
  // so its colours come from the palette copy rather than a `var(--…)`.
  const p = currentPalette();

  const box = document.createElement('div');
  box.setAttribute(OWN_ATTR, 'box');
  Object.assign(box.style, {
    position: 'fixed', zIndex: '2147483646', pointerEvents: 'none',
    borderRadius: '4px', transition: 'all 40ms linear', display: 'none',
  } as CSSStyleDeclaration);

  const bar = document.createElement('div');
  bar.setAttribute(OWN_ATTR, 'bar');
  Object.assign(bar.style, {
    position: 'fixed', zIndex: '2147483647', left: '50%',
    // A top bar sits under the mobile URL bar and the reachable thumb zone is
    // at the bottom, so on touch the toolbar goes where the hands are.
    ...(coarse
      ? { bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))', top: 'auto' }
      : { top: '12px', bottom: 'auto' }),
    transform: 'translateX(-50%)', background: p.ink, color: p.onInk,
    font: '13px/1.4 system-ui, sans-serif', padding: '8px 12px', borderRadius: '10px',
    display: 'flex', flexDirection: 'column', gap: '8px',
    boxShadow: '0 4px 16px rgba(0,0,0,.35)',
    // `left: 50%` leaves a fixed element only half the viewport to shrink into, so
    // a shrink-to-fit bar came out 195px wide on a 390px screen and wrapped its
    // four buttons into a 2x2 block. Ask for the content width and cap it instead.
    width: 'max-content', maxWidth: 'calc(100vw - 24px)',
  } as CSSStyleDeclaration);

  // Two rows, in a fixed order, both present from the first frame. The controls
  // that are always there must not move when a selection appears — the same rule
  // the recorder bar wraps under, and for the same reason: on a 390px screen the
  // button under the thumb would otherwise be a different button each press.
  const rowText = row('space-between');
  const rowControls = row('space-between');

  const label = document.createElement('span');
  label.textContent = `Pick the "${fieldLabel}", then ${ACTION_LABELS.confirm}`;

  const readout = document.createElement('code');
  readout.setAttribute(OWN_ATTR, 'readout');
  Object.assign(readout.style, {
    font: '12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
    color: withAlpha(p.onInk, 0.75), whiteSpace: 'nowrap',
    overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '40vw',
  } as CSSStyleDeclaration);

  // Which selector this depth would get us. The whole reason depth matters: an
  // outer div with an id is a handle we will find next month, and the span inside
  // it is a position in a tree that will have moved.
  const strength = document.createElement('span');
  strength.setAttribute(OWN_ATTR, 'strength');
  Object.assign(strength.style, {
    display: 'inline-flex', alignItems: 'center', gap: '5px',
    color: withAlpha(p.onInk, 0.75), whiteSpace: 'nowrap',
  } as CSSStyleDeclaration);
  const strengthDot = document.createElement('span');
  Object.assign(strengthDot.style, {
    width: '8px', height: '8px', borderRadius: '50%', background: p.neutral, flex: '0 0 auto',
  } as CSSStyleDeclaration);
  const strengthWord = document.createElement('span');
  strength.append(strengthDot, strengthWord);

  const position = document.createElement('span');
  position.setAttribute(OWN_ATTR, 'position');
  Object.assign(position.style, {
    color: withAlpha(p.onInk, 0.75), whiteSpace: 'nowrap',
  } as CSSStyleDeclaration);

  const meta = row('flex-start');
  meta.append(readout, strength, position);
  rowText.append(label, meta);

  // One treatment for every chip on the bar; Confirm is the only accent fill.
  const chip = withAlpha(p.onInk, 0.16);
  const widerBtn = mkButton(ACTION_LABELS.wider, 'wider', chip, p.onInk, coarse);
  const deeperBtn = mkButton(ACTION_LABELS.deeper, 'deeper', chip, p.onInk, coarse);
  const confirmBtn = mkButton(ACTION_LABELS.confirm, 'confirm', p.accent, p.onStatus, coarse);
  const cancelBtn = mkButton(ACTION_LABELS.cancel, 'cancel', chip, p.onInk, coarse);

  const travel = row('flex-start');
  travel.append(widerBtn, deeperBtn);
  const decide = row('flex-end');
  decide.append(confirmBtn, cancelBtn);
  rowControls.append(travel, decide);

  bar.append(rowText, rowControls);
  document.body.append(box, bar);

  /** The elements at the point that was clicked, outermost first. */
  let chain: Element[] = [];
  let index = 0;
  /** Where the live selection was clicked. `null` means nothing is selected yet. */
  let anchor: { x: number; y: number } | null = null;
  let frame = 0;

  // Everything the extension draws, not just this toolbar: a review card left on
  // screen is a card the user can pick *from*.
  const isOwn = isExtensionUi;

  const stackAt = (x: number, y: number): Element[] => {
    const from = document.elementsFromPoint?.(x, y);
    if (from?.length) return Array.from(from);
    // No hit-test stack (jsdom, and very old engines): walk the one node up.
    const out: Element[] = [];
    for (let cur = document.elementFromPoint(x, y); cur; cur = cur.parentElement) out.push(cur);
    return out;
  };

  const chainAt = (x: number, y: number): Element[] => elementChain(stackAt(x, y), { isOwn });

  const paint = (): void => {
    const el = chain[index];
    if (!el) {
      box.style.display = 'none';
      setEnabled(false);
      return;
    }
    const selected = anchor !== null;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, {
      display: 'block',
      top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`,
      // A hover is a proposal and a click is a choice, so they must not look alike.
      border: `2px ${selected ? 'solid' : 'dashed'} ${p.accent}`,
      background: selected ? withAlpha(p.accent, 0.15) : 'transparent',
    } as CSSStyleDeclaration);

    readout.textContent = describeElement(el);
    const s = pickSelector(el).strength;
    strengthDot.style.background = s === 'strong' ? p.ok : s === 'ok' ? p.warn : p.err;
    strengthWord.textContent = SELECTOR_STRENGTH_TEXT[s].word;
    strength.setAttribute('aria-label', SELECTOR_STRENGTH_TEXT[s].aria);
    position.textContent = `${index + 1} / ${chain.length}`;
    setEnabled(selected);
  };

  /**
   * Unavailable is a state a control is *in*, not a control that half exists — so
   * the label goes quiet and the fill drops, and nothing is faded out whole. The
   * blocked primary de-fills for the same reason the modal's does: a translucent
   * coral reads as broken, and "nothing picked yet" is the ordinary opening state.
   */
  const setEnabled = (on: boolean): void => {
    const off = withAlpha(p.onInk, 0.06);
    const offInk = withAlpha(p.onInk, 0.45);
    for (const b of [widerBtn, deeperBtn]) {
      b.disabled = !on;
      b.style.background = on ? chip : off;
      b.style.color = on ? p.onInk : offInk;
    }
    confirmBtn.disabled = !on;
    confirmBtn.style.background = on ? p.accent : off;
    confirmBtn.style.color = on ? p.onStatus : offInk;
    // An empty readout is a stray dot and a gap where a line should be.
    meta.style.display = on || chain.length ? 'flex' : 'none';
  };

  const travelBy = (dir: 1 | -1): void => {
    if (!anchor || chain.length < 2) return;
    index = stepChain(chain.length, index, dir);
    paint();
  };

  /* ---------------- Page events ---------------- */

  const onMove = (e: PointerEvent): void => {
    if (anchor) return; // a selection is live; the highlight is no longer a preview
    const { clientX: x, clientY: y } = e;
    if (frame) return;
    frame = raf(() => {
      frame = 0;
      if (anchor) return;
      const next = chainAt(x, y);
      if (!next.length) return;
      chain = next;
      index = 0;
      paint();
    });
  };

  const onClick = (e: MouseEvent): void => {
    if (isOwn(e.target as Element)) return; // let the toolbar's own buttons work
    e.preventDefault();
    e.stopPropagation();
    const x = e.clientX;
    const y = e.clientY;
    const sameSpot = anchor
      && Math.abs(x - anchor.x) <= SAME_SPOT_PX
      && Math.abs(y - anchor.y) <= SAME_SPOT_PX;
    if (sameSpot && chain.length) {
      index = stepChain(chain.length, index, 1);
    } else {
      const next = chainAt(x, y);
      if (!next.length) return; // nothing of the page's here — only our own chrome
      chain = next;
      index = 0;
      anchor = { x, y };
    }
    paint();
  };

  /**
   * The page must not act on any part of a gesture aimed at us. A pick is several
   * presses long now, so cancelling `click` alone is not enough: a site that acts
   * on `mousedown` would act once per step of the chain.
   */
  const swallow = (e: Event): void => {
    if (isOwn(e.target as Element)) return;
    e.preventDefault();
    e.stopPropagation();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { cancel(); return; }
    if (!anchor) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); travelBy(1); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); travelBy(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); commit(); }
  };

  // The box is `position: fixed` off a rect read when the click landed, and the
  // selection now outlives the gesture that made it — so scrolling would leave the
  // outline behind on an empty patch of page.
  const reposition = (): void => { if (chain[index]) paint(); };

  const SWALLOWED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'contextmenu'];

  const cleanup = (): void => {
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    for (const type of SWALLOWED) document.removeEventListener(type, swallow, true);
    document.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
    box.remove();
    bar.remove();
  };

  const commit = (): void => {
    const el = chain[index];
    if (!anchor || !el) return;
    cleanup();
    onPick(el);
  };
  const cancel = (): void => { cleanup(); onCancel?.(); };

  const press = (b: HTMLButtonElement, run: () => void) => {
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); run(); });
  };
  press(widerBtn, () => travelBy(-1));
  press(deeperBtn, () => travelBy(1));
  press(confirmBtn, commit);
  press(cancelBtn, cancel);

  setEnabled(false);
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
  for (const type of SWALLOWED) document.addEventListener(type, swallow, true);
  document.addEventListener('scroll', reposition, { capture: true, passive: true });
  window.addEventListener('resize', reposition);

  return cancel;
}

function row(justify: string): HTMLDivElement {
  const d = document.createElement('div');
  d.setAttribute(OWN_ATTR, 'row');
  Object.assign(d.style, {
    display: 'flex', gap: '8px', alignItems: 'center', justifyContent: justify, flexWrap: 'wrap',
  } as CSSStyleDeclaration);
  return d;
}

function mkButton(
  text: string, role: string, bg: string, fg: string, coarse: boolean,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.setAttribute(OWN_ATTR, role);
  b.textContent = text;
  Object.assign(b.style, {
    background: bg, color: fg, border: 'none', borderRadius: '8px',
    padding: coarse ? '10px 18px' : '6px 12px', font: '13px system-ui, sans-serif',
    cursor: 'pointer', minHeight: coarse ? '44px' : '32px',
  } as CSSStyleDeclaration);
  return b;
}

/** rAF where there is one; the picker still has to work under jsdom. */
function raf(fn: () => void): number {
  const g = globalThis as unknown as { requestAnimationFrame?: (cb: () => void) => number };
  return g.requestAnimationFrame ? g.requestAnimationFrame(fn) : (setTimeout(fn, 16) as unknown as number);
}
