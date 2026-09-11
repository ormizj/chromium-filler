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
import {
  RecorderBar, bindLabel, type RecorderBarCallbacks, type RecorderBarState,
} from './recorderBar';
import type { BindKey } from '../shared/recording';
import { ACTION_LABELS, MARK_GROUP_TEXT, RECORD_PASS_TEXT, heldSendNotice } from '../shared/labels';
import { BIND_HELP } from '../shared/help';
import { RECORDER_HOST_ID } from './extensionUi';

const noop = () => {};

function callbacks(over: Partial<RecorderBarCallbacks> = {}): RecorderBarCallbacks {
  return {
    onInteract: noop, onForceSend: noop, onDeclare: noop, onMarkConfirmation: noop,
    onReset: noop, onUndo: noop, onDone: noop, ...over,
  };
}

function state(over: Partial<RecorderBarState> = {}): RecorderBarState {
  return {
    phase: 'beforeSend', flow: 'internal', leg: 'posting', stepCount: 2, mode: 'idle',
    bound: [], ...over,
  };
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

/** What a menu item is called, which is now one line of two. */
const itemLabel = (item: Element) => item.querySelector('.cf-rec-menu-label')?.textContent;

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

/**
 * Choosing a mark.
 *
 * The menu closed its *flag* and left its markup on screen: nothing repainted the
 * bar on the way to the picker, so a 240px-wide, 60vh-tall list stayed hanging over
 * the very page the picker was asking the user to point at — and on the picker's
 * cancel path nothing ever came along to take it down.
 */
describe('picking something out of the Declare menu', () => {
  it('closes the menu on the spot, before the picker starts', () => {
    let openWhenAsked: boolean | undefined;
    const shadow = render(state(), callbacks({
      // Read from inside the callback, because "before the picker starts" is the
      // whole of the fix: the pick happens on the page under this menu.
      onDeclare: () => { openWhenAsked = !!menu(shadow); },
    }));
    openMenu(shadow);
    expect(menu(shadow)).toBeTruthy();

    [...shadow.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')][0].click();

    expect(openWhenAsked).toBe(false);
    expect(menu(shadow)).toBeNull();
  });

  it('still says what was chosen', () => {
    const chosen: BindKey[] = [];
    const shadow = render(state(), callbacks({ onDeclare: (b) => chosen.push(b) }));
    openMenu(shadow);
    const first = [...shadow.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')][0];
    const label = itemLabel(first);
    first.click();

    expect(chosen).toHaveLength(1);
    expect(label).toBe(bindLabel(chosen[0]));
  });

  /**
   * Rule 11, where the user meets it. The confirmation does not exist until an
   * application has really gone in, and the first pass deliberately stops short of
   * sending one — so offering it here asked the user to point at something that is
   * not on the page, and a mark made anyway would be a `successSelector` captured
   * off a page that was never a confirmation.
   *
   * `marksFor` is the one answer and the compiler enforces the same one, so this
   * asserts the menu really is built from it rather than from a list of its own.
   */
  it('never offers the confirmation during the first pass, on either leg', () => {
    for (const leg of ['posting', 'destination'] as const) {
      const shadow = render(state({ flow: 'external', leg }));
      openMenu(shadow);
      const items = [...shadow.querySelectorAll('[role="menuitem"]')].map(itemLabel);
      expect(items).not.toContain(bindLabel('success'));
      // …and the Send button is on both, because the leg only ever re-orders. It
      // was filtered once, which left the page the application is really sent from
      // with no way to mark the one control that sends it.
      expect(items).toContain(bindLabel('submit'));
      bar?.destroy();
      bar = undefined;
    }
  });

  /**
   * The four marks that decide how an application is sent read as one undifferentiated
   * list under a head saying "This application" — and two of them are about sending
   * from this page while the other two are about handing off to the employer, which
   * are opposite answers to the same question.
   */
  it('separates sending from this page from handing off to the employer', () => {
    const shadow = render();
    openMenu(shadow);
    const heads = [...shadow.querySelectorAll('.cf-rec-menu-head')].map((h) => h.textContent);
    expect(heads).toEqual([
      MARK_GROUP_TEXT.sending, MARK_GROUP_TEXT.leaving,
      MARK_GROUP_TEXT.info, MARK_GROUP_TEXT.fields,
    ]);
  });

  /**
   * The head is a `--text-xs` line the colour of the captions under it, so with the
   * groups run together it read as a third line of the caption above rather than as
   * the start of anything. The hairline between groups and the head that holds its
   * place while the list scrolls are both drawn from this wrapper — CSS is invisible
   * to jsdom, so the structure they are keyed on is the half that can be asserted.
   */
  it('gives each group an element of its own, led by its head', () => {
    const shadow = render();
    openMenu(shadow);
    const groups = [...shadow.querySelectorAll('.cf-rec-menu-group')];
    expect(groups.map((g) => g.firstElementChild?.textContent)).toEqual([
      MARK_GROUP_TEXT.sending, MARK_GROUP_TEXT.leaving,
      MARK_GROUP_TEXT.info, MARK_GROUP_TEXT.fields,
    ]);
    for (const g of groups) {
      expect(g.firstElementChild!.className).toBe('cf-rec-menu-head');
      // A bare wrapper would take the items out of the menu's ownership: a
      // `role="menu"` owns its `menuitem`s, and only a `group` may come between.
      expect(g.getAttribute('role')).toBe('group');
      expect(g.getAttribute('aria-labelledby')).toBe(g.firstElementChild!.id);
      expect(g.querySelectorAll('[role="menuitem"]').length).toBeGreaterThan(0);
    }
    // Every item is in one, so nothing renders outside a group and above its head.
    expect(shadow.querySelectorAll('.cf-rec-menu-group [role="menuitem"]'))
      .toHaveLength(shadow.querySelectorAll('[role="menuitem"]').length);
  });

  /** The bar renders the grouping; it does not own one. */
  it('leads with the way out on the board of a two-step posting', () => {
    const shadow = render(state({ flow: 'external', leg: 'posting' }));
    openMenu(shadow);
    expect(shadow.querySelector('.cf-rec-menu-head')!.textContent).toBe(MARK_GROUP_TEXT.leaving);
  });

  /**
   * A label alone does not say what a "Quick-apply marker" is, and the menu is the
   * last place the choice is still open. The caption is drawn rather than hidden
   * behind hover: the priority target is a phone, where there is no hover.
   */
  it('explains each of the four marks that decide how an application is sent', () => {
    const shadow = render();
    openMenu(shadow);
    const hintFor = (key: 'submit' | 'quickApplySelector' | 'applySelector' | 'markerSelector') =>
      [...shadow.querySelectorAll('[role="menuitem"]')]
        .find((b) => itemLabel(b) === bindLabel(key))
        ?.querySelector('.cf-rec-menu-hint')?.textContent;
    for (const key of ['submit', 'quickApplySelector', 'applySelector', 'markerSelector'] as const) {
      expect(hintFor(key), key).toBe(BIND_HELP[key].short);
    }
  });

  /**
   * And nowhere else. Twenty-two more captions turn a 60vh list into a wall, and
   * these two groups are already explained by the head they sit under — a field's
   * name *is* its explanation.
   */
  it('leaves the posting facts and the profile fields to speak for themselves', () => {
    const shadow = render();
    openMenu(shadow);
    const hinted = [...shadow.querySelectorAll('[role="menuitem"]')]
      .filter((b) => b.querySelector('.cf-rec-menu-hint'))
      .map(itemLabel);
    expect(hinted).not.toContain(bindLabel('field:email'));
    expect(hinted).not.toContain(bindLabel('jobDescription'));
    expect(hinted).toHaveLength(4);
  });

  /**
   * The caption is the item's *description*, never part of its name. Folded into the
   * name a screen reader would announce a whole sentence where the list says "Send
   * button" — and every other surface, the compiler included, calls it that.
   */
  it('keeps a captioned mark named after the mark', () => {
    const shadow = render();
    openMenu(shadow);
    const item = [...shadow.querySelectorAll('[role="menuitem"]')]
      .find((b) => itemLabel(b) === bindLabel('submit'))!;
    expect(item.getAttribute('aria-label')).toBe(bindLabel('submit'));
    expect(shadow.getElementById(item.getAttribute('aria-describedby')!)?.textContent)
      .toBe(BIND_HELP.submit.short);
  });

  it('leaves the toggle saying the menu is shut, so pressing it opens one', () => {
    const shadow = render();
    openMenu(shadow);
    [...shadow.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')][0].click();

    const toggle = [...shadow.querySelectorAll<HTMLButtonElement>('.cf-rec-options .cf-btn')]
      .find((b) => b.textContent === ACTION_LABELS.declare)!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    expect(menu(shadow)).toBeTruthy();
  });
});

/* ---------------- The seam: a press that would send ---------------- */

/**
 * The first pass cannot send, and the bar is the only thing that can say why the
 * button the user just pressed did nothing. Without this line and the way past it,
 * the honest reading of a dead Send button is that the extension is broken.
 */
describe('a held send', () => {
  it('says what happened, and offers the way past it', () => {
    let forced = 0;
    const s = render(
      state({ notice: heldSendNotice('Submit application') }),
      callbacks({ onForceSend: () => { forced += 1; } }),
    );
    expect(s.querySelector('.cf-rec-notice')?.textContent).toContain('Submit application');

    button(s, ACTION_LABELS.notTheSendButton).click();
    expect(forced).toBe(1);
  });

  /** It replaces the readout rather than joining it: two lines fight at 390px. */
  it('takes the place of what usually happened', () => {
    const s = render(state({ notice: 'held', last: undefined }));
    expect(s.querySelector('.cf-rec-what')?.textContent).toBe('held');
  });

  /** Everything the first pass is for is still there behind it. */
  it('leaves the rest of the bar alone', () => {
    const s = render(state({ notice: 'held' }));
    expect(button(s, ACTION_LABELS.interact)).toBeTruthy();
    expect(button(s, ACTION_LABELS.stopRecording)).toBeTruthy();
  });
});

/* ---------------- The second pass ---------------- */

/**
 * One question over a page nothing is holding still. The user has just applied for
 * real and is looking at a bar they did not ask for, so what it says has to be a
 * sentence — and what it offers has to be one thing.
 */
describe('the after-sending bar', () => {
  const after = (over: Partial<RecorderBarState> = {}) =>
    render(state({ phase: 'afterSend', ...over }));

  it('asks for the one mark, and nothing else', () => {
    const s = after();
    expect(button(s, RECORD_PASS_TEXT.afterSend.action)).toBeTruthy();
    expect(button(s, ACTION_LABELS.notYet)).toBeTruthy();
    // No page to hand back, and nothing recorded to take back.
    for (const gone of [
      ACTION_LABELS.interact, ACTION_LABELS.declare,
      ACTION_LABELS.undo, ACTION_LABELS.resetRecording,
    ]) expect(button(s, gone)).toBeUndefined();
  });

  it('makes the mark the primary, and only it', () => {
    const s = after();
    const primaries = [...s.querySelectorAll('.cf-btn.primary')];
    expect(primaries).toHaveLength(1);
    expect(primaries[0].textContent).toBe(RECORD_PASS_TEXT.afterSend.action);
  });

  /**
   * No clock and no step count. This pass records nothing and lasts as long as the
   * site takes to answer, and a ticking timer over "waiting for the confirmation"
   * reads as a deadline that does not exist.
   */
  it('counts nothing, because it records nothing', () => {
    const s = after({ stepCount: 7 });
    expect(s.querySelector('.cf-rec-clock')).toBeNull();
    expect(s.querySelector('.cf-rec-count')?.textContent ?? '').not.toContain('7');
  });

  it('reaches the picker through its one button', () => {
    let marked = 0;
    const s = render(state({ phase: 'afterSend' }), callbacks({ onMarkConfirmation: () => { marked += 1; } }));
    button(s, RECORD_PASS_TEXT.afterSend.action).click();
    expect(marked).toBe(1);
  });

  /**
   * Once the mark is written the bar is only still up to report it, so the ask has to
   * go: a live "Mark the confirmation" beside "Saved" invites the user to do the
   * finished thing again, on a page where there is nothing left to point at.
   */
  it('turns into its own report once the mark lands', () => {
    const s = after({ notice: 'Saved. This site can read its own confirmations now.' });
    expect(s.querySelector('.cf-rec-what')?.textContent).toContain('Saved.');
    expect(button(s, RECORD_PASS_TEXT.afterSend.action)).toBeUndefined();
    expect(button(s, ACTION_LABELS.done)).toBeTruthy();
  });

  /**
   * The pass is over, so the live dot goes with it. A pulsing red dot beside a report
   * that the site is finished says the opposite of the sentence next to it.
   */
  it('says it is running while it waits', () => {
    expect(after().querySelector('.cf-rec-live')).not.toBeNull();
  });

  it('stops claiming to be running once it has finished', () => {
    const done = after({ notice: 'Saved.' });
    expect(done.querySelector('.cf-rec-live')).toBeNull();
    expect(done.querySelector('.cf-rec-state')?.textContent).toContain('finished');
  });
});
