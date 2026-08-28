import { describe, it, expect, afterEach } from 'vitest';
import { swallowPageInput } from './inertPage';

let detach: (() => void) | null = null;

afterEach(() => {
  detach?.();
  detach = null;
  document.body.innerHTML = '';
});

/** A click that reports back both halves of what suppression has to do. */
function fire(el: Element, type: string, init: EventInit = {}): { seen: boolean; defaultPrevented: boolean } {
  let seen = false;
  const spy = () => { seen = true; };
  el.addEventListener(type, spy);
  const e = new Event(type, { bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  el.removeEventListener(type, spy);
  return { seen, defaultPrevented: e.defaultPrevented };
}

describe('making the page inert', () => {
  it('stops the page seeing a click, and the browser acting on it', () => {
    const link = document.createElement('a');
    link.href = '#x';
    document.body.append(link);
    detach = swallowPageInput({ isExempt: () => false });

    const { seen, defaultPrevented } = fire(link, 'click');
    expect(seen).toBe(false);
    expect(defaultPrevented).toBe(true);
  });

  it('leaves the browser free to scroll — pointerdown is stopped, not cancelled', () => {
    const box = document.createElement('div');
    document.body.append(box);
    detach = swallowPageInput({ isExempt: () => false });

    const { seen, defaultPrevented } = fire(box, 'pointerdown');
    expect(seen).toBe(false);
    // A cancelled pointerdown or touchstart is a page that cannot be panned, and a
    // recording lasts as long as it takes to read the posting.
    expect(defaultPrevented).toBe(false);
  });

  it('cancels the pointer events too when asked — the picker wants no selection', () => {
    const box = document.createElement('div');
    document.body.append(box);
    detach = swallowPageInput({ isExempt: () => false, hard: true });

    expect(fire(box, 'pointerdown').defaultPrevented).toBe(true);
    expect(fire(box, 'mousedown').defaultPrevented).toBe(true);
  });

  it('swallows typing, so a page cannot be driven from the keyboard either', () => {
    const input = document.createElement('input');
    document.body.append(input);
    detach = swallowPageInput({ isExempt: () => false });

    const { seen, defaultPrevented } = fire(input, 'keydown');
    expect(seen).toBe(false);
    expect(defaultPrevented).toBe(true);
  });

  it('never touches scrolling', () => {
    const box = document.createElement('div');
    document.body.append(box);
    detach = swallowPageInput({ isExempt: () => false });

    expect(fire(box, 'wheel').seen).toBe(true);
    expect(fire(box, 'scroll').seen).toBe(true);
  });

  it('leaves our own chrome alone — its buttons are the way out', () => {
    const ours = document.createElement('button');
    ours.setAttribute('data-mine', '');
    document.body.append(ours);
    detach = swallowPageInput({ isExempt: (el) => !!el?.closest?.('[data-mine]') });

    const { seen, defaultPrevented } = fire(ours, 'click');
    expect(seen).toBe(true);
    expect(defaultPrevented).toBe(false);
  });

  it('lets an event through when the caller says this one passes', () => {
    const box = document.createElement('div');
    document.body.append(box);
    let open = false;
    detach = swallowPageInput({ isExempt: () => false, passes: () => open });

    expect(fire(box, 'click').seen).toBe(false);
    open = true;
    // Read per event, not at attach time: the mode changes while this is attached.
    expect(fire(box, 'click').seen).toBe(true);
  });

  it('stops when detached', () => {
    const box = document.createElement('div');
    document.body.append(box);
    const off = swallowPageInput({ isExempt: () => false });
    off();
    expect(fire(box, 'click').seen).toBe(true);
  });
});
