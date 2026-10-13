/**
 * Is this element ours?
 *
 * Everything this extension draws sits on the host page — the review card, the
 * queue chip, the picker's toolbar and the name chips beside each mark — and every
 * one of them has to be invisible to the machinery that reads the page. The engine
 * must never offer one of our own controls as an input to fill; the picker needs
 * it because `document.elementFromPoint` happily lands on our own card.
 *
 * Events raised inside a shadow root are retargeted to the host before they reach
 * `document`, so a `closest()` on the host id is enough for the shadow hosts; the
 * light-DOM marks carry an attribute instead.
 */

export const PICKER_ATTR = 'data-cf-picker';
/**
 * The name chips drawn beside each mark on the page (`fieldTags.ts`). They are
 * `pointer-events: none`, so hit-testing skips them anyway — but "never ours" is
 * not a rule to leave resting on a style.
 */
export const TAG_ATTR = 'data-cf-tag';

export const MODAL_HOST_ID = 'chromium-filler-modal-host';
export const QUEUE_CHIP_HOST_ID = 'chromium-filler-queue-chip';

export const OWN_SELECTOR = [
  `[${PICKER_ATTR}]`,
  `[${TAG_ATTR}]`,
  `#${MODAL_HOST_ID}`,
  `#${QUEUE_CHIP_HOST_ID}`,
].join(', ');

export function isExtensionUi(el: Element | null | undefined): boolean {
  return !!el?.closest?.(OWN_SELECTOR);
}
