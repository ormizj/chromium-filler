/**
 * Watches the user apply for a job, and turns what they do into `RecordedStep`s.
 *
 * The inverse of `picker.ts`, which listens to the same events and cancels every one
 * of them. Here the user is really applying — really pressing the site's own
 * buttons, really attaching their CV — so nothing may be prevented, stopped or
 * reordered. The recorder's whole contract is that the page behaves exactly as it
 * would with the extension absent.
 *
 * It records two things and infers a third:
 *
 * - a **click**, named by the control it landed on rather than the element under the
 *   finger. `closest(INTERACTIVE)` is doing real work: a click lands on whatever
 *   `<span>` a button wraps its label in, and a span has nothing to identify it by,
 *   which is exactly what forces the structural path `shared/selector.ts` exists to
 *   avoid.
 * - a **change** to a form control, as an `input` step — with the field it probably
 *   is already guessed, so the bar can say "email ✓" instead of asking. The guess is
 *   marked as one (`bindSource: 'auto'`) and the user overrides it from the bar.
 * - a **press of a label** and the click the browser then raises on the control it
 *   names, as one gesture rather than two.
 *
 * What it never records is **what was typed**. The user is entering their real name,
 * address and salary expectation; where those went is the site config, and what they
 * were is not. `RecordedStep` has no value field and two tests hold that line.
 */

import type { RecordLeg, RecordedStep } from '../shared/recording';
import { pickSelector } from '../shared/selector';
import { normalizeText } from '../shared/query';
import { guessField } from './fieldDetect';
import { PICKER_ATTR, isExtensionUi } from './extensionUi';

/**
 * What a click is *about*. A press inside a button is a press of the button; a press
 * on a paragraph is about that paragraph, which is how a description gets bound.
 */
const INTERACTIVE = [
  'a[href]', 'button', 'input', 'select', 'textarea', 'label', 'summary',
  '[role="button"]', '[role="tab"]', '[role="link"]', '[onclick]', '[tabindex]',
].join(', ');

/** Two presses this close, one inside the other, are one gesture. */
const SAME_GESTURE_MS = 300;

/** A label long enough to be prose is not a name; the review shows this much. */
const MAX_LABEL = 80;

export interface RecorderOptions {
  leg: RecordLeg;
  /**
   * Epoch ms the recording began. Passed in rather than read here so the two legs of
   * a handoff — which run in different content scripts, and sometimes different tabs
   * — measure `at` against the same zero.
   */
  startedAt: number;
  onStep(step: RecordedStep): void;
}

export interface RecorderHandle {
  stop(): void;
}

let seq = 0;

export function startRecording(opts: RecorderOptions): RecorderHandle {
  let lastEl: Element | null = null;
  let lastAt = 0;

  const emit = (step: RecordedStep) => {
    opts.onStep(step);
  };

  const base = (el: Element, action: RecordedStep['action']): RecordedStep => {
    seq += 1;
    return {
      id: `r${Date.now().toString(36)}-${seq}`,
      at: Math.max(0, Date.now() - opts.startedAt),
      leg: opts.leg,
      url: location.href,
      action,
      target: pickSelector(el),
      label: labelFor(el),
    };
  };

  const onClick = (e: Event) => {
    const hit = e.target as Element | null;
    if (!hit || isExtensionUi(hit) || picking()) return;

    const el = hit.closest(INTERACTIVE) ?? hit;
    const now = Date.now();

    // Pressing a label makes the browser raise a second click on the control it
    // names. One gesture, one step — otherwise the config replays a press nobody
    // made. Containment either way, because the pair arrives in both orders.
    if (lastEl && now - lastAt < SAME_GESTURE_MS
      && (lastEl.contains(el) || el.contains(lastEl))) {
      lastAt = now;
      return;
    }
    lastEl = el;
    lastAt = now;

    emit(base(el, 'click'));
  };

  const onChange = (e: Event) => {
    const el = e.target as HTMLElement | null;
    if (!el || isExtensionUi(el) || picking()) return;
    if (!el.matches('input, textarea, select')) return;
    // A checkbox or radio is *toggled by clicking it*, so the click already records
    // it and the change is the same gesture arriving twice. It matters more than it
    // sounds: a tick is never a profile field, so the second copy would come through
    // as an unbound `input` step, which the compiler drops — and the "I agree to the
    // terms" box would silently not be part of the config.
    if (el.matches('input[type="checkbox"], input[type="radio"]')) return;

    const step = base(el, 'input');
    const guess = guessField(el);
    if (guess) {
      step.bind = `field:${guess.field}`;
      step.bindSource = 'auto';
    }
    // A change is the user finishing with a control, so the click that focused it is
    // not a separate gesture either.
    lastEl = el;
    lastAt = Date.now();
    emit(step);
  };

  // Capture phase so a page that stops propagation cannot hide a step, and passive
  // so it is impossible for this to cancel anything even by accident.
  const listen = { capture: true, passive: true } as const;
  document.addEventListener('click', onClick, listen);
  document.addEventListener('change', onChange, listen);

  return {
    stop() {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('change', onChange, true);
    },
  };
}

/**
 * A click-to-pick is running, so this click is the user pointing at something rather
 * than using the site.
 *
 * Both listen on `document` in the capture phase, and the recorder is attached first
 * — so without this, marking the confirmation banner recorded a click on the
 * confirmation banner as well, and the compiler would faithfully replay it. Read off
 * the picker's own marker element rather than a flag, so it is automatically right
 * for every way a picker can be started, including the review's re-pick.
 */
const picking = (): boolean => !!document.querySelector(`[${PICKER_ATTR}]`);

/** `<input type=submit value="Send">` — the only inputs whose value is a label. */
const VALUE_IS_LABEL = new Set(['submit', 'button', 'reset', 'image']);

/**
 * The words the review shows for a step — and what rule 3's send veto reads.
 *
 * An `<input>`'s `value` is a label on a submit button and **the user's typed answer
 * everywhere else**, so it is read only for the four types where it is the former.
 * Reading it unconditionally put the email address someone had just typed into a
 * field into the recording, which is the one thing a recording must never carry.
 */
function labelFor(el: Element): string {
  const parts: Array<string | null> = [el.getAttribute('aria-label')];
  if (el instanceof HTMLInputElement) {
    if (VALUE_IS_LABEL.has(el.type)) parts.push(el.value);
    parts.push(el.getAttribute('placeholder'));
  } else {
    parts.push(el.textContent);
  }
  const raw = parts.find((p) => p && normalizeText(p)) ?? '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);
}
