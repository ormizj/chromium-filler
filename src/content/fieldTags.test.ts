/**
 * The chips that name each mark on the page.
 *
 * Geometry is not testable here — jsdom evaluates neither the cascade nor layout, so
 * every rect is 0×0 and `place()` hides everything it is given. That half lives in
 * the E2E. What is testable is the part that would go wrong silently: which chips
 * exist, what they say, that they identify themselves as ours, and that clearing
 * really clears.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { tagElement, retintTag, clearTags } from './fieldTags';
import { isExtensionUi, TAG_ATTR } from './extensionUi';
import { SETUP_STATUS_TEXT } from '../shared/labels';

const tags = () => [...document.querySelectorAll(`[${TAG_ATTR}]`)];

function input(): HTMLElement {
  const el = document.createElement('input');
  document.body.append(el);
  return el;
}

afterEach(() => {
  clearTags();
  document.body.innerHTML = '';
});

describe('naming a mark on the page', () => {
  it('draws one chip per marked element, saying what the caller called it', () => {
    tagElement(input(), 'Email', 'high');
    tagElement(input(), 'Phone', 'low');
    expect(tags().map((t) => t.textContent)).toEqual(['Email', 'Phone']);
  });

  /**
   * A page whose every mark is invisible to the picker and the recorder. The chips
   * are `pointer-events: none` so hit-testing skips them anyway, but "the page is
   * inert and every click is a step" is not a rule to leave resting on a style —
   * `isExtensionUi` is what both surfaces actually ask.
   */
  it('is ours, so nothing that reads the page can pick it or record it', () => {
    tagElement(input(), 'Email', 'high');
    expect(isExtensionUi(tags()[0])).toBe(true);
  });

  /**
   * The same element marked twice is one mark, not two stacked chips. `refreshSetup`
   * re-runs on every edit and `clearHighlights` normally goes first — but a caller
   * that marks the same control twice in one sweep must not leave a stale label
   * underneath the current one.
   */
  it('replaces a chip rather than stacking a second one on the same element', () => {
    const el = input();
    tagElement(el, 'Email', 'high');
    tagElement(el, 'Full name', 'high');
    expect(tags().map((t) => t.textContent)).toEqual(['Full name']);
  });

  /**
   * The chips are part of the mark and die with it — `clearHighlights` calls this,
   * so there is exactly one teardown rather than four call sites each remembering a
   * second one.
   */
  it('clears every chip at once', () => {
    tagElement(input(), 'Email', 'high');
    tagElement(input(), 'Phone', 'low');
    clearTags();
    expect(tags()).toHaveLength(0);
  });

  /**
   * `confirmField` re-colours a field's outline after a Confirm and passes no label,
   * because nothing has been renamed — only whether the value went in has changed.
   * Dropping the chip there would take the name off the one field the user has just
   * acted on; leaving the stripe alone would leave a yellow chip on a green mark.
   */
  it('re-colours a chip without a label, and keeps what it says', () => {
    const el = input();
    tagElement(el, 'Email', 'low');
    retintTag(el, 'high');
    expect(tags()).toHaveLength(1);
    expect(tags()[0].textContent).toBe('Email');
  });

  /** A fill draws no chips, so a re-colour with nothing to re-colour is ordinary. */
  it('does not invent a chip for an element that never had one', () => {
    retintTag(input(), 'high');
    expect(tags()).toHaveLength(0);
  });

  /**
   * They sit in the *page's* DOM, so without this a screen reader reads them in the
   * form's own reading order — a second, worse copy of every label the page has.
   */
  it('is not read out, being a sighted shortcut to rows that are', () => {
    tagElement(input(), 'Email', 'high');
    expect(tags()[0].getAttribute('aria-hidden')).toBe('true');
  });

  /**
   * Status is never colour alone. `high` says it by being there at all; `low` — found
   * but not to be relied on — is the one that needs a word, and the word comes from
   * the catalog rather than from a literal here.
   */
  it('has a word for the outcome that is not self-evident', () => {
    expect(SETUP_STATUS_TEXT.low.chip.trim()).not.toBe('');
    expect(SETUP_STATUS_TEXT.high.chip).toBe('');
  });
});

/**
 * Following the page.
 *
 * Real geometry still belongs to the E2E — jsdom raises no layout, so every
 * rectangle here is one this test wrote. What that is enough to prove is the part
 * the bug was in: *when* a chip is re-placed. It used to be on `scroll` and
 * `resize` and nothing else, so a page that moved under a chip — a description
 * opening, content injected above a field — left the name behind until the user
 * happened to scroll.
 */
function rectOf(el: HTMLElement, top: number): void {
  el.getBoundingClientRect = () => ({
    top, bottom: top + 30, left: 10, right: 210, width: 200, height: 30,
    x: 10, y: top, toJSON: () => ({}),
  }) as DOMRect;
}

/** One animation frame, and the microtask a MutationObserver delivers on. */
async function frame(): Promise<void> {
  await Promise.resolve();
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await Promise.resolve();
}

/** Frames enough to outlast the follow loop's tail. */
async function settled(): Promise<void> {
  await new Promise((r) => setTimeout(r, 420));
}

describe('a chip following the field it names', () => {
  it('moves when the page moves under it, with nothing scrolling', async () => {
    const el = input();
    rectOf(el, 100);
    tagElement(el, 'Email', 'high');
    const [tag] = tags() as HTMLElement[];
    expect(tag.style.top).toBe('98px');

    // Exactly the reported gesture: something above the field opens. No scroll
    // event, no resize — the two things this used to wait for.
    rectOf(el, 300);
    document.body.prepend(document.createElement('section'));
    await frame();

    expect(tag.style.top).toBe('298px');
  });

  it('keeps looking for a beat, so it can ride an animation out', async () => {
    const el = input();
    rectOf(el, 100);
    tagElement(el, 'Email', 'high');
    const [tag] = tags() as HTMLElement[];
    await frame();

    // A transition reports the class flip and then moves for 300ms in silence. The
    // chip has to follow that, not land where the first frame of it happened to be.
    document.body.prepend(document.createElement('section'));
    await frame();
    rectOf(el, 260);
    await frame();

    expect(tag.style.top).toBe('258px');
  });

  it('stops once the page holds still', async () => {
    const el = input();
    rectOf(el, 100);
    let reads = 0;
    const measured = el.getBoundingClientRect.bind(el);
    el.getBoundingClientRect = () => { reads += 1; return measured(); };
    tagElement(el, 'Email', 'high');

    await settled();
    const resting = reads;
    await settled();

    // A loop that never ended would be reading this rectangle sixty times a second
    // for the length of a recording.
    expect(reads).toBe(resting);
  });
});
