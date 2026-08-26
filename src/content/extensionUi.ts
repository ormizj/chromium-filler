/**
 * Is this element ours?
 *
 * Three things this extension draws sit on the host page — the two shadow sheets,
 * the picker's toolbar and the recorder's bar — and every one of them has to be
 * invisible to the machinery that reads the page. The picker needs it because
 * `document.elementFromPoint` happily lands on our own card; the recorder needs it
 * because pressing "Done" on the bar is not a step in an application.
 *
 * Events raised inside a shadow root are retargeted to the host before they reach
 * `document`, so a `closest()` on the host id is enough for the sheets; the two
 * light-DOM toolbars mark themselves with an attribute instead.
 */

export const PICKER_ATTR = 'data-cf-picker';
export const RECORDER_ATTR = 'data-cf-recorder';

export const MODAL_HOST_ID = 'chromium-filler-modal-host';
export const SETUP_HOST_ID = 'chromium-filler-setup-host';
export const RECORDER_HOST_ID = 'chromium-filler-recorder-host';

const OWN_SELECTOR = [
  `[${PICKER_ATTR}]`,
  `[${RECORDER_ATTR}]`,
  `#${MODAL_HOST_ID}`,
  `#${SETUP_HOST_ID}`,
  `#${RECORDER_HOST_ID}`,
].join(', ');

export function isExtensionUi(el: Element | null | undefined): boolean {
  return !!el?.closest?.(OWN_SELECTOR);
}
