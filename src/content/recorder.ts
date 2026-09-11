/**
 * The page while a recording is running, and the two ways the user may act on it.
 *
 * This used to be the inverse of `picker.ts` — a passive observer that cancelled
 * nothing and recorded everything the user did. That put the cost the wrong way
 * round. `prep` runs automatically on every later visit to the site, so every
 * incidental click — a cookie banner, a stray press while reading, a tab in the
 * sidebar — became a step replayed for ever, and the one decision that matters
 * (*what is this element*) was asked afterwards, about whatever had just happened.
 *
 * So the page is **inert by default** and the user picks an action first:
 *
 * - **Interact** arms one gesture. The next click reaches the page, and is
 *   recorded as a step to replay. Then the arm is spent.
 * - **Declare** is `picker.ts`, started from the bar, and produces a *bound* step
 *   rather than a replayed one.
 * - Neither: clicking does nothing at all, and nothing is recorded.
 *
 * Two things follow that are not obvious and both have tests.
 *
 * **The first pass cannot send.** An armed click that lands on something whose label
 * reads like a send is *held*: the arm is not spent, so the suppression below cancels
 * it, and the control is recorded as `submit` instead. This is the seam the two-pass
 * setup is built on — the only moment the Send button can be pointed at is before it
 * is pressed, and pressing it is what ends the page it lives on.
 *
 * Two things keep the hold from swallowing gestures it has no business refusing. It
 * only ever applies to a control `submitDetect` could nominate (`isSubmitCandidate`),
 * so the `<a>` labelled "Apply on company website" — the apply link of every two-step
 * posting — passes straight through, and the first pass can still cross a handoff.
 * And it is escapable in one press (`arm({ force: true })`), which it has to be:
 * `looksLikeSend` matches "apply" and "finish", and on plenty of boards the *button*
 * that opens the application form says "Apply now".
 *
 * **An arm covers an interaction, not an event.** Pressing a `<label>` makes the
 * browser raise a second click on the control it names; disarming on the first
 * would leave the second to be cancelled, and the checkbox would not tick. And an
 * armed click that lands in a text box has to be followed by typing, or the user
 * could never fill in the form they are recording — and so could never reach the
 * Send button or the confirmation, which is the whole point. `armed` therefore
 * decays into `live` for that one control, until it is done with.
 *
 * **A step is stamped when the arm was pressed, not when the click landed.** The
 * compiler turns the gap between steps into a `waitForSelector` timeout, meaning
 * "the page was still loading here" — and arming puts a tap between every pair of
 * actions, which would have read as a pause on every one of them.
 *
 * What it still never records is **what was typed**. The user is entering their
 * real name, address and salary expectation; where those went is the site config,
 * and what they were is not. `RecordedStep` has no value field and two tests hold
 * that line.
 */

import type { RecordLeg, RecordedStep } from '../shared/recording';
import { pickSelector } from '../shared/selector';
import { isSubmitCandidate, looksLikeSend } from '../shared/submitDetect';
import { normalizeText } from '../shared/query';
import { clip } from '../shared/jobText';
import { guessField } from './fieldDetect';
import { PICKER_ATTR, isExtensionUi } from './extensionUi';
import { swallowPageInput } from './inertPage';

/**
 * What a click is *about*. A press inside a button is a press of the button; a
 * press on a paragraph is about that paragraph.
 */
const INTERACTIVE = [
  'a[href]', 'button', 'input', 'select', 'textarea', 'label', 'summary',
  '[role="button"]', '[role="tab"]', '[role="link"]', '[onclick]', '[tabindex]',
].join(', ');

/** Controls whose whole use is typing into them, so an arm has to outlast the click. */
const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** The tail of one gesture: the click a label raises on the control it names. */
const SAME_GESTURE_MS = 300;

/** A label long enough to be prose is not a name; the review shows this much. */
const MAX_LABEL = 80;

/**
 * `idle` — the page is inert. `armed` — one gesture is allowed through and will be
 * recorded. `live` — that gesture landed in a control, and the keys that finish it
 * are allowed through too.
 */
export type RecorderMode = 'idle' | 'armed' | 'live';

export interface RecorderOptions {
  leg: RecordLeg;
  /**
   * Epoch ms the recording began. Passed in rather than read here so the two legs
   * of a handoff — which run in different content scripts, and sometimes different
   * tabs — measure `at` against the same zero.
   */
  startedAt: number;
  onStep(step: RecordedStep): void;
  /** The bar is the only thing that says which mode this is in, so it must know. */
  onMode(mode: RecorderMode): void;
  /**
   * A press that looked like a send was held rather than passed on.
   *
   * Reported rather than merely done, because a button that does nothing is the
   * failure this whole mechanism could produce: without a line on screen saying what
   * happened and offering the way past it, the user presses Send four more times and
   * concludes the extension is broken. The element is passed so the bar can name it.
   */
  onHeldSend?(el: Element): void;
  /**
   * Whether the recording already carries a Send button. Asked rather than
   * remembered, because the answer changes from three places this cannot see — a
   * Declare, an Undo, and the refusal that follows a hold.
   */
  sendMarked?(): boolean;
}

export interface RecorderHandle {
  stop(): void;
  /**
   * Interact: let the next gesture through, and record it.
   *
   * `force` is the way past a held send, and covers exactly one gesture — the user
   * has said "that was not the Send button", which is a fact about that one control
   * and not a standing permission to submit.
   */
  arm(opts?: { force?: boolean }): void;
  disarm(): void;
  mode(): RecorderMode;
}

let seq = 0;

export function startRecording(opts: RecorderOptions): RecorderHandle {
  let mode: RecorderMode = 'idle';
  /** When Interact was pressed — the step's `at`, not the moment of the click. */
  let armedAt = 0;
  /** The control an armed click landed in; keys aimed at it still reach the page. */
  let liveEl: Element | null = null;
  /** The armed gesture's target and time, for the label→control tail. */
  let gestureEl: Element | null = null;
  let gestureAt = 0;
  /**
   * The very event the arm was spent on. Our reader runs *before* the suppression
   * — it has to, or `stopImmediatePropagation` would eat it — and it spends the arm
   * as it goes, so by the time the suppression asks, the mode already says `idle`.
   * Identity is what carries the permission across those two listeners.
   */
  let gestureEvent: Event | null = null;
  /** This arm was granted after a held send was refused, so it skips the send check. */
  let forced = false;

  const setMode = (next: RecorderMode): void => {
    if (mode === next) return;
    mode = next;
    opts.onMode(mode);
  };

  /**
   * A click-to-pick is running, so the user is pointing at something rather than
   * using the site. `picker.ts` has its own suppression and its own reading of the
   * click, so this stands down completely — both halves, or marking the
   * confirmation banner would also record a click on it.
   *
   * Read off the picker's own marker element rather than a flag, so it is right for
   * every way a picker can be started, including the review's re-pick.
   */
  const picking = (): boolean => !!document.querySelector(`[${PICKER_ATTR}]`);

  const base = (el: Element, action: RecordedStep['action']): RecordedStep => {
    seq += 1;
    return {
      id: `r${Date.now().toString(36)}-${seq}`,
      at: Math.max(0, (armedAt || Date.now()) - opts.startedAt),
      leg: opts.leg,
      url: location.href,
      action,
      target: pickSelector(el),
      label: labelFor(el),
    };
  };

  /** Is this event part of a gesture the user has actually asked for? */
  const passes = (e: Event): boolean => {
    if (picking()) return true; // the picker is in charge; do not suppress twice
    if (e === gestureEvent) return true;
    const target = e.target as Element | null;

    /*
     * A form being submitted is the consequence of a press this recorder allowed —
     * there is no other way to reach one, since every click and every key is dead
     * unless armed. So it passes on containment alone, with no time limit: a site
     * that validates in JS and calls `requestSubmit()` after a round trip does it
     * seconds later, and cancelling *that* would silently eat the application the
     * user is in the middle of sending.
     */
    if (e.type === 'submit' && gestureEl && target?.contains(gestureEl)) return true;

    // The tail of the armed gesture. Pressing a label raises a second click on the
    // control it names, and cancelling that would leave the tick unticked.
    //
    // A *different* element, though. The same element again is a second press of
    // the same button, and one arm is one press — otherwise a double-tap on "Next"
    // would go through twice on one Interact.
    if (gestureEl && gestureEl !== target && Date.now() - gestureAt < SAME_GESTURE_MS
      && target && (gestureEl.contains(target) || target.contains(gestureEl))) return true;

    if (mode === 'armed') return true;
    // `live` is one control's worth of permission, and only for finishing it off.
    if (mode === 'live' && liveEl && target && (liveEl === target || liveEl.contains(target))) return true;
    return false;
  };

  const endLive = (): void => {
    liveEl = null;
    if (mode === 'live') setMode('idle');
  };

  const onClick = (e: Event): void => {
    const hit = e.target as Element | null;
    if (!hit || isExtensionUi(hit) || picking()) return;
    // Everything else on the page is inert, so an unarmed click is already dead by
    // the time it gets here — but the tail of a spent gesture still arrives, and
    // recording it would be the double step the old dedupe existed to stop.
    if (mode !== 'armed') return;

    const el = hit.closest(INTERACTIVE) ?? hit;

    /*
     * The seam. The arm is deliberately *not* spent here — no `gestureEvent`, no
     * `gestureEl` — so `passes()` sees a mode that is no longer `armed` and the
     * suppression below cancels this very event. Nothing reaches the page, and the
     * control the user aimed at is recorded as the thing they aimed at it for.
     *
     * The tail rule matters as much as the click: a held `<label>` press would
     * otherwise raise a second click on the control it names, and that one would go
     * through — sending the application the hold exists to stop.
     */
    if (!forced && isSubmitCandidate(el) && looksLikeSend(labelFor(el))) {
      gestureEl = null;
      setMode('idle');
      // Held either way — the first pass cannot send, full stop — but marked only
      // once. Asking the recording rather than remembering locally is what keeps a
      // Declare, an Undo and the escape hatch below from disagreeing with this.
      if (!opts.sendMarked?.()) {
        opts.onStep({ ...base(el, 'click'), bind: 'submit', bindSource: 'auto' });
      }
      opts.onHeldSend?.(el);
      return;
    }

    gestureEl = el;
    gestureAt = Date.now();
    gestureEvent = e;
    // Whether this press got through *because* the user refused the hold. Read before
    // it is spent, and carried on the step: the compiler's send veto has to know that
    // this one was asked about, or it drops the step the refusal was paid for.
    const refused = forced;
    forced = false;

    emitClick(el, refused);

    // An arm covers an interaction, not an event: if this one opened a box to type
    // in, the typing belongs to it.
    const editable = el.closest?.(EDITABLE) ?? null;
    if (editable) {
      liveEl = editable;
      setMode('live');
    } else {
      setMode('idle');
    }
  };

  const emitClick = (el: Element, refused = false): void => {
    opts.onStep({ ...base(el, 'click'), ...(refused ? { sendRefused: true as const } : {}) });
  };

  const onChange = (e: Event): void => {
    const el = e.target as HTMLElement | null;
    if (!el || isExtensionUi(el) || picking()) return;
    if (!el.matches('input, textarea, select')) return;
    // Only a control the user was given permission to use. Anything else changing
    // is the page changing itself, which is not a thing to replay.
    if (el !== liveEl) return;
    // A checkbox or radio is *toggled by clicking it*, so the armed click already
    // recorded it and this is the same gesture arriving twice. It matters more than
    // it sounds: a tick is never a profile field, so the second copy would come
    // through as an unbound `input` step, which the compiler drops — and "I agree
    // to the terms" would silently not be part of the config.
    if (el.matches('input[type="checkbox"], input[type="radio"]')) { endLive(); return; }

    const step = base(el, 'input');
    const guess = guessField(el);
    if (guess) {
      step.bind = `field:${guess.field}`;
      step.bindSource = 'auto';
    }
    opts.onStep(step);
    endLive();
  };

  const onFocusOut = (e: Event): void => {
    if (mode !== 'live') return;
    const el = e.target as Element | null;
    // A `change` fires before `blur` on most controls; this is the case where the
    // user opened a box and typed nothing, so there is no step and the arm is spent.
    if (el && liveEl && (el === liveEl || liveEl.contains(el))) endLive();
  };

  // Our own readers go on **before** the suppression, because that ends with
  // `stopImmediatePropagation` — which stops the listeners registered after it on
  // this same node, and these are the ones that make a recording.
  document.addEventListener('click', onClick, true);
  document.addEventListener('change', onChange, true);
  document.addEventListener('focusout', onFocusOut, true);
  const detachInert = swallowPageInput({ isExempt: isExtensionUi, passes });

  return {
    stop() {
      detachInert();
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('change', onChange, true);
      document.removeEventListener('focusout', onFocusOut, true);
    },
    arm(armOpts) {
      if (mode === 'armed') return;
      liveEl = null;
      gestureEvent = null;
      forced = !!armOpts?.force;
      armedAt = Date.now();
      setMode('armed');
    },
    disarm() {
      liveEl = null;
      gestureEvent = null;
      forced = false;
      setMode('idle');
    },
    mode: () => mode,
  };
}

/** `<input type=submit value="Send">` — the only inputs whose value is a label. */
const VALUE_IS_LABEL = new Set(['submit', 'button', 'reset', 'image']);

/**
 * The words the review shows for a step — and what rule 3's send veto reads.
 *
 * An `<input>`'s `value` is a label on a submit button and **the user's typed
 * answer everywhere else**, so it is read only for the four types where it is the
 * former. Reading it unconditionally put the email address someone had just typed
 * into a field into the recording, which is the one thing a recording must never
 * carry.
 */
export function labelFor(el: Element): string {
  const parts: Array<string | null> = [el.getAttribute('aria-label')];
  if (el instanceof HTMLInputElement) {
    if (VALUE_IS_LABEL.has(el.type)) parts.push(el.value);
    parts.push(el.getAttribute('placeholder'));
  } else {
    parts.push(el.textContent);
  }
  const raw = parts.find((p) => p && normalizeText(p)) ?? '';
  // `clip`, not `slice`: a bare cut at 80 characters ends mid-word with nothing
  // saying it was cut, so the review and the recorder bar both showed a label that
  // looked like the whole of a button's name and was not. Same one answer to "one
  // line, cut to n" as the picker's preview and the setup panel's snippets.
  return clip(raw, MAX_LABEL);
}
