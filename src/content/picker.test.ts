import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startPicker } from './picker';
import { PICKER_ATTR } from './extensionUi';

/**
 * The picker is DOM plumbing over `shared/elementChain`, so what is worth testing
 * here is the *flow*: a click proposes, repeat clicks travel inward, and only
 * Confirm commits. jsdom has neither `elementsFromPoint` nor layout, so both are
 * stubbed — the hit-test stack by hand, and a rect per element derived from its
 * depth so nothing is pruned as a same-box wrapper.
 */

const POINT = { clientX: 40, clientY: 40 };

function stub(el: Element): void {
  const stack: Element[] = [];
  for (let cur: Element | null = el; cur; cur = cur.parentElement) stack.push(cur);
  (document as unknown as { elementsFromPoint: (x: number, y: number) => Element[] })
    .elementsFromPoint = () => stack;
}

function depthRects(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(
    this: Element,
  ) {
    let d = 0;
    for (let cur: Element | null = this; cur; cur = cur.parentElement) d += 1;
    return { x: d, y: d, width: 200 - d, height: 200 - d, top: d, left: d,
      right: 200, bottom: 200, toJSON: () => ({}) } as DOMRect;
  });
}

const bar = () => document.querySelector(`[${PICKER_ATTR}="bar"]`);
const btn = (role: string) =>
  document.querySelector<HTMLButtonElement>(`[${PICKER_ATTR}="${role}"]`)!;
const readout = () =>
  document.querySelector(`[${PICKER_ATTR}="readout"]`)!.textContent!;

function clickPage(el: Element, at = POINT): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...at }));
}

let stop: (() => void) | undefined;

beforeEach(() => {
  document.body.innerHTML = `
    <article id="posting">
      <div class="job-header">
        <h2 class="job-title"><span>Senior Engineer</span></h2>
      </div>
      <button id="send">Send</button>
    </article>`;
  depthRects();
});

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('picker — one click never commits', () => {
  it('proposes on a mouse click instead of saving what you happened to hit', () => {
    const onPick = vi.fn();
    const span = document.querySelector('span')!;
    stub(span);
    stop = startPicker(onPick, 'Description');

    clickPage(span);

    expect(onPick).not.toHaveBeenCalled();
    expect(bar()).not.toBeNull();
  });

  it('commits on Confirm, and only then', () => {
    const onPick = vi.fn();
    const span = document.querySelector('span')!;
    stub(span);
    stop = startPicker(onPick, 'Description');

    clickPage(span);
    btn('confirm').click();

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(bar()).toBeNull();
  });

  it('lets the page have none of it — the click is cancelled', () => {
    const span = document.querySelector('span')!;
    stub(span);
    const seen = vi.fn();
    document.getElementById('posting')!.addEventListener('click', seen);
    stop = startPicker(vi.fn(), 'Description');

    clickPage(span);

    expect(seen).not.toHaveBeenCalled();
  });
});

describe('picker — travelling through the elements at one point', () => {
  it('starts on the box around the thing, not on the node under the pointer', () => {
    const onPick = vi.fn();
    const span = document.querySelector('span')!;
    stub(span);
    stop = startPicker(onPick, 'Description');

    clickPage(span);
    btn('confirm').click();

    expect(onPick).toHaveBeenCalledWith(document.getElementById('posting'));
  });

  it('steps inward when the same spot is clicked again', () => {
    const onPick = vi.fn();
    const span = document.querySelector('span')!;
    stub(span);
    stop = startPicker(onPick, 'Description');

    clickPage(span);
    clickPage(span);
    btn('confirm').click();

    expect(onPick).toHaveBeenCalledWith(document.querySelector('.job-header'));
  });

  it('wraps back to the outermost rather than dead-ending on the innermost', () => {
    const onPick = vi.fn();
    const span = document.querySelector('span')!;
    stub(span);
    stop = startPicker(onPick, 'Description');

    for (let i = 0; i < 5; i += 1) clickPage(span); // 4 deep, so the 5th wraps
    btn('confirm').click();

    expect(onPick).toHaveBeenCalledWith(document.getElementById('posting'));
  });

  it('starts over at the outermost when a different spot is clicked', () => {
    const onPick = vi.fn();
    const span = document.querySelector('span')!;
    stub(span);
    stop = startPicker(onPick, 'Description');

    clickPage(span);
    clickPage(span); // now on .job-header
    clickPage(span, { clientX: 300, clientY: 300 });
    btn('confirm').click();

    expect(onPick).toHaveBeenCalledWith(document.getElementById('posting'));
  });

  it('says which element is highlighted, and where it is in the run', () => {
    const span = document.querySelector('span')!;
    stub(span);
    stop = startPicker(vi.fn(), 'Description');

    clickPage(span);
    expect(readout()).toContain('article#posting');
    expect(bar()!.textContent).toContain('1 / 4');

    clickPage(span);
    expect(readout()).toContain('div.job-header');
    expect(bar()!.textContent).toContain('2 / 4');
  });

  it('walks the run from the keyboard too', () => {
    const onPick = vi.fn();
    const span = document.querySelector('span')!;
    stub(span);
    stop = startPicker(onPick, 'Description');

    clickPage(span);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onPick).toHaveBeenCalledWith(document.querySelector('.job-header'));
  });

  it('ignores a click on its own toolbar rather than proposing a button of ours', () => {
    const onPick = vi.fn();
    stop = startPicker(onPick, 'Description');
    const confirm = btn('confirm');
    stub(confirm);

    clickPage(confirm);

    expect(onPick).not.toHaveBeenCalled();
  });
});

describe('picker — getting out', () => {
  it('cancels on Escape without picking anything', () => {
    const onPick = vi.fn();
    const onCancel = vi.fn();
    stop = startPicker(onPick, 'Description', onCancel);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
    expect(bar()).toBeNull();
  });

  it('restores the caller through the disposer it returns', () => {
    const onCancel = vi.fn();
    startPicker(vi.fn(), 'Description', onCancel)();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  /**
   * `recorder.ts` stands down while `[data-cf-picker]` is in the DOM. The pick is
   * several gestures long now, so the marker has to survive every one of them —
   * otherwise the recorder logs the user aiming at the confirmation banner as a
   * step in the application.
   */
  it('keeps its marker in the DOM for the whole of a multi-click pick', () => {
    const span = document.querySelector('span')!;
    stub(span);
    stop = startPicker(vi.fn(), 'Description');

    expect(document.querySelector(`[${PICKER_ATTR}]`)).not.toBeNull();
    clickPage(span);
    expect(document.querySelector(`[${PICKER_ATTR}]`)).not.toBeNull();
    clickPage(span);
    expect(document.querySelector(`[${PICKER_ATTR}]`)).not.toBeNull();
  });
});
