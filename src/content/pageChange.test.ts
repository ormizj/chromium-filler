/**
 * The one answer to "the page moved".
 *
 * jsdom raises no layout, so the `ResizeObserver` half is unobservable here (it is
 * stubbed inert in `test/setup.ts`) and the geometry that follows from any of this
 * lives in the E2E. What is testable is the part that would go wrong silently: that
 * a burst of changes is one call rather than fifty, that our own chrome cannot wake
 * the watcher it is drawn by, and that detaching really detaches.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { watchPageChange } from './pageChange';
import { TAG_ATTR } from './extensionUi';

const detachers: Array<() => void> = [];

/** Subscribe, and make sure the test cannot leave a live observer behind. */
function watch(cb: () => void, settleMs?: number): void {
  detachers.push(watchPageChange(cb, settleMs));
}

/** One animation frame, plus the microtask a MutationObserver delivers on. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await Promise.resolve();
}

afterEach(() => {
  for (const off of detachers.splice(0)) off();
  document.body.innerHTML = '';
});

describe('watching the page for movement', () => {
  it('collapses a burst of changes into a single call', async () => {
    const moved = vi.fn();
    watch(moved);

    for (let i = 0; i < 20; i += 1) document.body.append(document.createElement('div'));
    await settle();

    expect(moved).toHaveBeenCalledTimes(1);
  });

  it('is woken by a change anywhere, not only by the element that moved', async () => {
    const moved = vi.fn();
    const field = document.createElement('input');
    document.body.append(field);
    watch(moved);

    // Exactly the reported case: something *above* the field opens, and the field
    // itself is untouched. Nothing scrolls and nothing resizes.
    document.body.prepend(document.createElement('section'));
    await settle();

    expect(moved).toHaveBeenCalled();
  });

  it('ignores what the extension itself draws', async () => {
    const moved = vi.fn();
    const chip = document.createElement('span');
    chip.setAttribute(TAG_ATTR, 'name');
    document.body.append(chip);
    await settle();
    moved.mockClear();

    // The pass this watcher schedules ends in writing exactly this, so a watcher
    // that noticed it would schedule itself forever.
    chip.style.top = '40px';
    await settle();

    expect(moved).not.toHaveBeenCalled();
  });

  it('stops when it is detached', async () => {
    const moved = vi.fn();
    const off = watchPageChange(moved);
    off();

    document.body.append(document.createElement('div'));
    await settle();

    expect(moved).not.toHaveBeenCalled();
  });

  it('waits for quiet when it is given a settle time', async () => {
    vi.useFakeTimers();
    try {
      const moved = vi.fn();
      watch(moved, 300);

      document.body.append(document.createElement('div'));
      // A MutationObserver delivers on a microtask, which fake timers do not hold.
      await Promise.resolve();
      vi.advanceTimersByTime(200);
      document.body.append(document.createElement('div'));
      await Promise.resolve();
      vi.advanceTimersByTime(200);
      // 400ms in, but never 300ms of quiet: the second change restarted the clock.
      expect(moved).not.toHaveBeenCalled();

      vi.advanceTimersByTime(150);
      expect(moved).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
