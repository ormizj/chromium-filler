/**
 * "The page moved" — asked once, for everything out here that has to answer it.
 *
 * Two surfaces need this and they need it for different reasons. The name chips
 * (`fieldTags.ts`) are `position: fixed` and read their coordinates from the
 * element they name, so anything that moves that element leaves the chip behind.
 * The recorder (`main.ts`) needs to know the *set* of fields changed: a click that
 * opens the application modal puts controls on the page that were not there when
 * the sweep ran, and nothing else is ever going to look again.
 *
 * They had `scroll` + `resize` between them, which is the half of the answer that
 * covers the viewport moving and none of the half that covers the page moving
 * under it — a description accordion, content injected above a field, a font
 * finishing loading. Same reason `inertPage.ts` exists: two copies of one list is
 * exactly how two lists drift.
 *
 * **What the extension draws cannot wake this.** The pass a chip's watcher
 * schedules ends in writing that chip's `style.top`, which is an attribute change
 * on an element in the page's own light DOM — so without the `isExtensionUi`
 * filter the watcher would schedule itself, every frame, for ever.
 *
 * **`settleMs` is what the caller does with the answer.** A chip is re-placed, so
 * it wants the next frame and nothing more. A detection sweep reads the whole
 * document, so it wants the page to have stopped changing first — and a page
 * reacting to a click is a burst, not an event.
 */

import { isExtensionUi } from './extensionUi';

/** Is this record only about our own chrome, and so not news? */
function isOwnChange(r: MutationRecord): boolean {
  if (isExtensionUi(r.target as Element)) return true;
  if (r.type !== 'childList') return false;
  // A chip being appended to `<body>` is reported against the body, which is not
  // ours — so the nodes have to be looked at, or drawing a mark would count as the
  // page moving under it.
  const nodes = [...r.addedNodes, ...r.removedNodes];
  return nodes.length > 0 && nodes.every((n) => isExtensionUi(n as Element));
}

/**
 * Call `cb` whenever the page moves. Returns the detach.
 *
 * `settleMs` of 0 coalesces into the next animation frame; anything larger waits
 * for that many milliseconds of quiet, restarting on every further change.
 */
export function watchPageChange(cb: () => void, settleMs = 0): () => void {
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (): void => {
    if (settleMs > 0) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = undefined; cb(); }, settleMs);
      return;
    }
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; cb(); });
  };

  const mutations = new MutationObserver((records) => {
    if (records.every(isOwnChange)) return;
    schedule();
  });
  mutations.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true,
  });

  // Everything a mutation cannot see: an image or a font finishing loading, a
  // textarea growing itself, a container that reflowed without its markup changing.
  const sizes = new ResizeObserver(schedule);
  sizes.observe(document.documentElement);

  // Captured, because the scroll that moves a field is often a container's rather
  // than the window's and those do not bubble.
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);

  return () => {
    mutations.disconnect();
    sizes.disconnect();
    window.removeEventListener('scroll', schedule, true);
    window.removeEventListener('resize', schedule);
    if (frame) cancelAnimationFrame(frame);
    if (timer) clearTimeout(timer);
  };
}
