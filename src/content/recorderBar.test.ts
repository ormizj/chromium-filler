/**
 * The bar's clock, and what it is allowed to touch.
 *
 * A recording runs for minutes, so the elapsed time has to advance on its own —
 * but it used to do that by repainting the whole bar once a second. The Declare
 * menu is a scrolling list of ~28 marks that deliberately survives a repaint, so
 * every tick threw it back to the top: reaching a profile field, or the
 * description, meant racing a one-second timer. These pin the tick to the one
 * thing that changed, and pin the repaints that *are* real to keeping the user's
 * place in the menu.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { RecorderBar, type RecorderBarCallbacks, type RecorderBarState } from './recorderBar';
import { ACTION_LABELS } from '../shared/labels';
import { RECORDER_HOST_ID } from './extensionUi';

const noop = () => {};

function callbacks(over: Partial<RecorderBarCallbacks> = {}): RecorderBarCallbacks {
  return { onInteract: noop, onDeclare: noop, onReset: noop, onUndo: noop, onDone: noop, ...over };
}

function state(over: Partial<RecorderBarState> = {}): RecorderBarState {
  return { flow: 'internal', leg: 'posting', stepCount: 2, mode: 'idle', bound: [], ...over };
}

let bar: RecorderBar | undefined;

function render(d = state(), cb = callbacks()): ShadowRoot {
  bar = new RecorderBar(cb);
  bar.render(d);
  return (document.getElementById(RECORDER_HOST_ID) as HTMLElement).shadowRoot!;
}

const card = (s: ShadowRoot) => s.querySelector('.cf-bar')!;
const menu = (s: ShadowRoot) => s.querySelector('.cf-rec-menu');
const confirm = (s: ShadowRoot) => s.querySelector('.cf-rec-confirm');
const readout = (s: ShadowRoot) => s.querySelector('.cf-rec-count')!.textContent ?? '';

/** Any button in the bar, found the way a user finds one: by what it says. */
function button(s: ShadowRoot, label: string): HTMLButtonElement {
  return [...s.querySelectorAll<HTMLButtonElement>('.cf-btn')]
    .find((b) => b.textContent === label)!;
}

/** Open the Declare menu the way a user does. */
function openMenu(s: ShadowRoot): void {
  const toggle = [...s.querySelectorAll<HTMLButtonElement>('.cf-rec-options .cf-btn')]
    .find((b) => b.textContent === ACTION_LABELS.declare)!;
  toggle.click();
}

const openConfirm = (s: ShadowRoot) => button(s, ACTION_LABELS.resetRecording).click();

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  bar?.destroy();
  bar = undefined;
  vi.useRealTimers();
});

describe('the recording clock', () => {
  it('advances without rebuilding the bar', () => {
    const shadow = render();
    const before = card(shadow);
    expect(readout(shadow)).toBe('0:00 · 2 steps');

    vi.advanceTimersByTime(2000);

    expect(readout(shadow)).toBe('0:02 · 2 steps');
    // Node identity, not just text: everything below hangs off this.
    expect(card(shadow)).toBe(before);
  });

  it('leaves an open Declare menu exactly where it was', () => {
    const shadow = render();
    openMenu(shadow);
    const list = menu(shadow);
    expect(list).toBeTruthy();

    vi.advanceTimersByTime(2000);

    // The same element, so whatever the user scrolled to is still on screen.
    expect(menu(shadow)).toBe(list);
  });

  it('keeps the readout one string, clock then steps', () => {
    // The E2E's `stepCount()` helper reads `.cf-rec-count` whole; splitting the
    // clock out of it must not change what that reads.
    const shadow = render(state({ stepCount: 1 }));
    expect(readout(shadow)).toMatch(/^\d+:\d{2} · \d+ steps?$/);
    expect(readout(shadow)).toBe('0:00 · 1 step');
  });

  it('is not announced, unlike the step count it sits beside', () => {
    // A `role="status"` region whose text changes every second reads the whole bar
    // out every second. The count is worth announcing; the clock is not.
    const shadow = render();
    expect(shadow.querySelector('.cf-rec-clock')!.getAttribute('aria-hidden')).toBe('true');
    expect(shadow.querySelector('.cf-rec-state')!.getAttribute('role')).toBe('status');
  });
});

describe('a real state change', () => {
  it('does repaint, and reports the new count', () => {
    const shadow = render();
    const before = card(shadow);
    bar!.render(state({ stepCount: 3 }));
    expect(card(shadow)).not.toBe(before);
    expect(readout(shadow)).toBe('0:00 · 3 steps');
  });

  it('keeps the menu open and restores where it was scrolled to', () => {
    const shadow = render();
    openMenu(shadow);
    // jsdom lays nothing out, so a plain `scrollTop = 200` clamps to 0; the value
    // has to be faked to assert it is carried across. What is being tested is that
    // the number is read before the rebuild and written back after it.
    const list = menu(shadow)!;
    Object.defineProperty(list, 'scrollTop', { value: 200, writable: true, configurable: true });

    let restored: number | undefined;
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: true,
      get: () => 0,
      set(v: number) { restored = v; },
    });
    try {
      bar!.render(state({ stepCount: 3 }));
    } finally {
      Object.defineProperty(Element.prototype, 'scrollTop', original);
    }

    expect(menu(shadow)).toBeTruthy();
    expect(restored).toBe(200);
  });
});


/**
 * Reset. The one control on the bar that cannot be walked back — Undo is a step at a
 * time and Done ends the recording, but this throws away every step *and* takes the
 * page back to the posting — so it asks first, in a popover that follows the same
 * rules as the Declare menu it sits beside.
 */
describe('starting over', () => {
  it('is not offered while there is nothing to throw away', () => {
    // Same convention as Undo, and `aria-disabled` rather than `disabled` so the
    // press that asks why it is grey still lands.
    const shadow = render(state({ stepCount: 0 }));
    expect(button(shadow, ACTION_LABELS.resetRecording).getAttribute('aria-disabled'))
      .toBe('true');
    expect(button(shadow, ACTION_LABELS.undo).getAttribute('aria-disabled')).toBe('true');
  });

  it('is live once a step has been recorded', () => {
    const shadow = render(state({ stepCount: 2 }));
    expect(button(shadow, ACTION_LABELS.resetRecording).hasAttribute('aria-disabled'))
      .toBe(false);
  });

  it('asks before it does anything', () => {
    const onReset = vi.fn();
    const shadow = render(state(), callbacks({ onReset }));

    openConfirm(shadow);

    expect(confirm(shadow)).toBeTruthy();
    expect(onReset).not.toHaveBeenCalled();
  });

  it('counts what is about to go', () => {
    const shadow = render(state({ stepCount: 6 }));
    openConfirm(shadow);
    expect(confirm(shadow)!.textContent).toContain('6 steps');
  });

  it('takes Cancel as the answer and throws nothing away', () => {
    const onReset = vi.fn();
    const shadow = render(state(), callbacks({ onReset }));

    openConfirm(shadow);
    button(shadow, ACTION_LABELS.cancel).click();

    expect(confirm(shadow)).toBeNull();
    expect(onReset).not.toHaveBeenCalled();
  });

  it('resets once, on the second press', () => {
    const onReset = vi.fn();
    const shadow = render(state(), callbacks({ onReset }));

    openConfirm(shadow);
    button(shadow, ACTION_LABELS.resetRecordingConfirm).click();

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('and the Declare menu are never both open', () => {
    // Two popovers hanging off the same bar, one of them a 60vh list: the second to
    // open would sit on top of the first with nothing saying which press it belongs to.
    const shadow = render();

    openMenu(shadow);
    openConfirm(shadow);
    expect(menu(shadow)).toBeNull();
    expect(confirm(shadow)).toBeTruthy();

    openMenu(shadow);
    expect(confirm(shadow)).toBeNull();
    expect(menu(shadow)).toBeTruthy();
  });

  it('survives the clock, like the menu beside it', () => {
    const shadow = render();
    openConfirm(shadow);

    vi.advanceTimersByTime(2000);

    expect(confirm(shadow)).toBeTruthy();
  });
});
