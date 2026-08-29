/**
 * The recorder's contract, inverted.
 *
 * It used to watch everything and cancel nothing. Now the page is inert until the
 * user asks for it, and the assertions that matter are the pair: an unarmed click
 * reaches neither the page nor the recording, and an armed one reaches both.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { startRecording, type RecorderHandle, type RecorderMode } from './recorder';
import type { RecordedStep } from '../shared/recording';

let handle: RecorderHandle | null = null;

afterEach(() => {
  handle?.stop();
  handle = null;
  document.body.innerHTML = '';
});

function start(): { steps: RecordedStep[]; modes: RecorderMode[]; held: Element[] } {
  const steps: RecordedStep[] = [];
  const modes: RecorderMode[] = [];
  const held: Element[] = [];
  handle = startRecording({
    leg: 'posting',
    startedAt: Date.now(),
    onStep: (s) => steps.push(s),
    onMode: (m) => modes.push(m),
    onHeldSend: (el) => held.push(el),
    // The real controller answers this from the recording; here the steps are it.
    sendMarked: () => steps.some((s) => s.bind === 'submit'),
  });
  return { steps, modes, held };
}

/** Dispatch a real, cancelable click and report whether the page got it. */
function click(el: Element): { seen: boolean; defaultPrevented: boolean } {
  let seen = false;
  const spy = () => { seen = true; };
  el.addEventListener('click', spy);
  const e = new MouseEvent('click', { bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  el.removeEventListener('click', spy);
  return { seen, defaultPrevented: e.defaultPrevented };
}

function key(el: Element, k = 'a'): boolean {
  let seen = false;
  const spy = () => { seen = true; };
  el.addEventListener('keydown', spy);
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  el.removeEventListener('keydown', spy);
  return seen;
}

const change = (el: Element) => el.dispatchEvent(new Event('change', { bubbles: true }));

function button(id: string, label = 'Go'): HTMLButtonElement {
  const b = document.createElement('button');
  b.id = id;
  b.textContent = label;
  document.body.append(b);
  return b;
}

function field(id: string, over: Partial<HTMLInputElement> = {}): HTMLInputElement {
  const input = document.createElement('input');
  input.id = id;
  Object.assign(input, over);
  document.body.append(input);
  return input;
}

/* ---------------- The page is inert ---------------- */

describe('a page nobody has asked to use', () => {
  it('does not act on a click, and does not record one', () => {
    const { steps } = start();
    const b = button('go');

    const { seen, defaultPrevented } = click(b);
    expect(seen).toBe(false);
    expect(defaultPrevented).toBe(true);
    expect(steps).toEqual([]);
  });

  /**
   * The whole reason this changed. Reading a posting means pressing things — a
   * "Show more", a cookie banner, a tab — and `prep` runs automatically on every
   * later visit, so an idle press used to become a step replayed for ever.
   */
  it('leaves nothing behind when the user is only reading', () => {
    const { steps } = start();
    for (const id of ['a', 'b', 'c']) click(button(id));
    expect(steps).toEqual([]);
  });

  it('swallows typing too, so the page cannot be driven from the keyboard', () => {
    start();
    expect(key(field('email'))).toBe(false);
  });

  it('never touches scrolling — a recording lasts as long as reading the posting', () => {
    start();
    const box = document.createElement('div');
    document.body.append(box);
    let scrolled = false;
    box.addEventListener('wheel', () => { scrolled = true; });
    box.dispatchEvent(new Event('wheel', { bubbles: true, cancelable: true }));
    expect(scrolled).toBe(true);
  });

  it('leaves our own chrome alone — the bar is the only way out', () => {
    const { steps } = start();
    const host = document.createElement('div');
    host.setAttribute('data-cf-recorder', 'host');
    const b = document.createElement('button');
    host.append(b);
    document.body.append(host);

    expect(click(b).seen).toBe(true);
    expect(steps).toEqual([]);
  });
});

/* ---------------- Interact ---------------- */

describe('interacting with the page, one action at a time', () => {
  it('hands the page back for the armed click, and keeps it as a step', () => {
    const { steps } = start();
    const b = button('more', 'Show more');
    handle!.arm();

    const { seen, defaultPrevented } = click(b);
    expect(seen).toBe(true);
    expect(defaultPrevented).toBe(false);
    expect(steps).toHaveLength(1);
    expect(steps[0].action).toBe('click');
    expect(steps[0].target?.selector).toBe('#more');
    expect(steps[0].label).toBe('Show more');
  });

  it('spends the arm on one click — the next one is inert again', () => {
    const { steps } = start();
    const b = button('more');
    handle!.arm();
    click(b);
    expect(handle!.mode()).toBe('idle');

    expect(click(b).seen).toBe(false);
    expect(steps).toHaveLength(1);
  });

  it('can be disarmed without being spent', () => {
    const { steps } = start();
    handle!.arm();
    handle!.disarm();
    expect(click(button('more')).seen).toBe(false);
    expect(steps).toEqual([]);
  });

  it('reports every mode change, because only the bar can say which one it is in', () => {
    const { modes } = start();
    handle!.arm();
    click(button('more'));
    expect(modes).toEqual(['armed', 'idle']);
  });

  it('names the control, not the span the click landed on', () => {
    const { steps } = start();
    const b = button('send', '');
    const span = document.createElement('span');
    span.textContent = 'Submit application';
    b.append(span);
    handle!.arm();

    click(span);
    expect(steps[0].target?.selector).toBe('#send');
    expect(steps[0].label).toBe('Submit application');
  });

  /**
   * Pressing a label makes the browser raise a second click on the control it
   * names. One gesture, one step — and the second click must still reach the page,
   * or the box the label names never ticks.
   */
  it('lets a label and the control it names be one gesture', () => {
    const { steps } = start();
    const label = document.createElement('label');
    label.textContent = 'I agree';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = 'agree';
    label.append(box);
    document.body.append(label);

    handle!.arm();
    click(label);
    const second = click(box);

    expect(second.seen).toBe(true);
    expect(second.defaultPrevented).toBe(false);
    expect(steps).toHaveLength(1);
  });
});

/* ---------------- Filling in a field ---------------- */

describe('an armed click that lands in something to type in', () => {
  it('keeps the page live for that control, so the field can be filled', () => {
    start();
    const input = field('email');
    handle!.arm();
    click(input);

    expect(handle!.mode()).toBe('live');
    expect(key(input)).toBe(true);
  });

  it('does not let the rest of the page in with it', () => {
    start();
    const input = field('email');
    const elsewhere = button('other');
    handle!.arm();
    click(input);

    expect(click(elsewhere).seen).toBe(false);
  });

  it('records the field, with the extension’s own guess already made', () => {
    const { steps } = start();
    const input = field('email', { name: 'email', type: 'email' });
    handle!.arm();
    click(input);
    input.value = 'someone@example.com';
    change(input);

    const filled = steps.find((s) => s.action === 'input');
    expect(filled?.bind).toBe('field:email');
    expect(filled?.bindSource).toBe('auto');
    expect(handle!.mode()).toBe('idle');
  });

  it('leaves a field it cannot name unbound', () => {
    const { steps } = start();
    const input = field('q7');
    handle!.arm();
    click(input);
    change(input);

    expect(steps.find((s) => s.action === 'input')?.bind).toBeUndefined();
  });

  /**
   * A checkbox is toggled *by clicking it*, so the armed click already recorded it.
   * The second copy would arrive as an unbound `input` step, which the compiler
   * drops — and "I agree to the terms" would silently not be in the config.
   */
  it('does not record a ticked box twice', () => {
    const { steps } = start();
    const box = field('agree', { type: 'checkbox' });
    handle!.arm();
    click(box);
    change(box);

    expect(steps).toHaveLength(1);
    expect(steps[0].action).toBe('click');
  });

  /**
   * A form being submitted is the consequence of a press this recorder allowed —
   * there is no other way to reach one. Cancelling it would eat the page turn the
   * user is in the middle of, on every multi-page application form.
   *
   * The button is labelled "Continue" and not "Send application" on purpose: a
   * send-shaped press is held now (see the held-send block below), so the only
   * `submit` that can still be reached from an allowed press is one like this.
   */
  it('lets the form the armed button sits in actually submit', () => {
    start();
    const form = document.createElement('form');
    const send = document.createElement('button');
    send.type = 'submit';
    send.textContent = 'Continue';
    form.append(send);
    document.body.append(form);

    handle!.arm();
    click(send);

    let submitted = false;
    form.addEventListener('submit', () => { submitted = true; });
    const e = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(e);
    expect(submitted).toBe(true);
    expect(e.defaultPrevented).toBe(false);
  });

  it('spends the arm when the user types nothing and moves on', () => {
    start();
    const input = field('email');
    handle!.arm();
    click(input);
    input.dispatchEvent(new Event('focusout', { bubbles: true }));

    expect(handle!.mode()).toBe('idle');
  });

  it('ignores a control changing itself, which is the page and not the user', () => {
    const { steps } = start();
    change(field('hidden-thing'));
    expect(steps).toEqual([]);
  });
});

/* ---------------- What a recording must never carry ---------------- */

describe('what the recorder must not do', () => {
  it('never stores what was typed', () => {
    const { steps } = start();
    const input = field('email', { name: 'email' });
    handle!.arm();
    click(input);
    input.value = 'private@example.com';
    change(input);

    expect(JSON.stringify(steps)).not.toContain('private@example.com');
  });

  it('reads an input’s value only where it is a label', () => {
    const { steps } = start();
    const send = field('send', { type: 'submit', value: 'Send application' });
    handle!.arm();
    click(send);

    expect(steps[0].label).toBe('Send application');
  });

  it('stands down entirely while something is being pointed at', () => {
    const { steps } = start();
    const marker = document.createElement('div');
    marker.setAttribute('data-cf-picker', 'bar');
    document.body.append(marker);
    const b = button('banner');

    handle!.arm();
    // The picker has its own suppression and its own reading of the click; ours
    // would record the user aiming at the confirmation as a step in the application.
    expect(click(b).defaultPrevented).toBe(false);
    expect(steps).toEqual([]);

    marker.remove();
    click(b);
    expect(steps).toHaveLength(1);
  });

  it('stops when told to', () => {
    const { steps } = start();
    handle!.stop();
    handle = null;

    const b = button('go');
    expect(click(b).seen).toBe(true);
    expect(steps).toEqual([]);
  });
});

/* ---------------- The shape of a step ---------------- */

describe('the shape of a step', () => {
  /**
   * Stamped when Interact was pressed, not when the click landed. The compiler
   * turns the gap between steps into a `waitForSelector` timeout meaning "the page
   * was still loading" — and arming puts a tap between every pair of actions, which
   * would otherwise read as a pause on every one of them.
   */
  it('is stamped from the moment the user asked to act', () => {
    vi.useFakeTimers();
    try {
      const startedAt = Date.now();
      const steps: RecordedStep[] = [];
      handle = startRecording({ leg: 'posting', startedAt, onStep: (s) => steps.push(s), onMode: () => {} });

      vi.advanceTimersByTime(4000);
      handle.arm();
      vi.advanceTimersByTime(3000); // the user takes their time finding the button
      click(button('go'));

      expect(steps[0].at).toBe(4000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stamps the leg and the page it happened on', () => {
    const { steps } = start();
    handle!.arm();
    click(button('go'));

    expect(steps[0].leg).toBe('posting');
    expect(steps[0].url).toBe(location.href);
  });

  it('gives every step its own id', () => {
    const { steps } = start();
    handle!.arm();
    click(button('a'));
    handle!.arm();
    click(button('b'));

    expect(new Set(steps.map((s) => s.id)).size).toBe(2);
  });
});

/* ---------------- The first pass cannot send ---------------- */

/**
 * The seam the two-pass setup is built on. The only moment the Send button can be
 * pointed at is *before* it is pressed, and pressing it is what ends the page it
 * lives on — so an armed press that reads like a send is held and marked instead.
 */
describe('a press that would send the application', () => {
  it('is cancelled, and the control is marked as the Send button', () => {
    const { steps, held } = start();
    const b = button('send', 'Submit application');

    handle!.arm();
    const { seen, defaultPrevented } = click(b);

    expect(seen).toBe(false);
    expect(defaultPrevented).toBe(true);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ action: 'click', bind: 'submit', bindSource: 'auto' });
    // Reported, because a button that does nothing and says nothing reads as broken.
    expect(held).toEqual([b]);
  });

  /**
   * A `<label>` press raises a second click on the control it names, and the
   * `SAME_GESTURE_MS` tail lets that one through. Leaving the tail armed after a hold
   * would send the application the hold exists to stop.
   */
  it('leaves no tail for a second click to ride through on', () => {
    start();
    const label = document.createElement('label');
    label.textContent = 'Submit application';
    const inner = document.createElement('span');
    label.append(inner);
    document.body.append(label);
    const other = button('real-send', 'Send');

    handle!.arm();
    click(label);
    expect(click(other).seen).toBe(false);
  });

  /** The arm is not spent by a hold, but the mode is: nothing stays live. */
  it('does not leave the page armed behind it', () => {
    start();
    const b = button('send', 'Submit application');
    handle!.arm();
    click(b);
    expect(handle!.mode()).toBe('idle');
  });

  /**
   * `looksLikeSend` matches "apply" and "finish", and on most boards the button that
   * *opens* the application form says "Apply now". Without a way past the guess, the
   * first pass could not be run on those sites at all.
   */
  it('lets a forced arm through, once', () => {
    const { steps } = start();
    const b = button('open', 'Apply now');

    handle!.arm();
    expect(click(b).seen).toBe(false);

    handle!.arm({ force: true });
    expect(click(b).seen).toBe(true);
    expect(steps[steps.length - 1]).toMatchObject({ action: 'click' });
    expect(steps[steps.length - 1].bind).toBeUndefined();

    // Once. The user said that one control was not the Send button, which is not a
    // standing permission to submit.
    handle!.arm();
    expect(click(button('send', 'Submit application')).seen).toBe(false);
  });

  it('holds a second press without marking a second Send button', () => {
    const { steps, held } = start();
    const b = button('send', 'Submit application');
    handle!.arm();
    click(b);
    handle!.arm();
    click(b);
    expect(steps.filter((step) => step.bind === 'submit')).toHaveLength(1);
    expect(held).toHaveLength(2);
  });

  /**
   * The other half of holding the press: a site that validates in JS and then calls
   * `requestSubmit()` itself would otherwise send the application a moment after the
   * click was refused, which is the hold doing nothing at all.
   */
  it('takes the form submit down with the press it held', () => {
    start();
    const form = document.createElement('form');
    const send = document.createElement('button');
    send.type = 'submit';
    send.textContent = 'Submit application';
    form.append(send);
    document.body.append(form);

    handle!.arm();
    click(send);

    const e = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  /**
   * The apply link of every two-step posting on every board reads like a send, and
   * holding it would mean the first pass could never cross a handoff — the exact
   * flow the second half of a recording exists for. So a label is not enough: the
   * control has to be one `submitDetect` could nominate in the first place.
   */
  it('lets an apply link through, however much it reads like a send', () => {
    const { steps, held } = start();
    const a = document.createElement('a');
    a.href = 'https://ats.example.com/apply';
    a.textContent = 'Apply on company website';
    document.body.append(a);

    handle!.arm();
    expect(click(a).seen).toBe(true);
    expect(held).toEqual([]);
    expect(steps[0].bind).toBeUndefined();
  });

  /** The veto list is `submitDetect`'s, so "Save job" is an ordinary step as ever. */
  it('is not fooled by a Save button', () => {
    const { steps, held } = start();
    const b = button('save', 'Save job');
    handle!.arm();
    expect(click(b).seen).toBe(true);
    expect(held).toEqual([]);
    expect(steps[0].bind).toBeUndefined();
  });
});
