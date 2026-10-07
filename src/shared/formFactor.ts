/**
 * Which half of a site's setup this device uses — see `FormFactor` in types.ts.
 *
 * The user agent, not the viewport: a board that sends a phone a different page
 * decides on the UA, so that is what tracks the DOM actually on screen. Kiwi's
 * "Desktop site" mode sends a desktop UA and gets the desktop page, and reading
 * it as desktop is therefore right. A narrowed desktop window is still desktop.
 *
 * Works in a service worker too (`WorkerNavigator` carries both fields).
 */

import type { FormFactor } from './types';

interface NavigatorLike {
  userAgentData?: { mobile?: boolean };
  userAgent?: string;
}

const MOBILE_UA = /Mobi|Android|iPhone|iPad|iPod/i;

export function currentFormFactor(
  nav: NavigatorLike | undefined = typeof navigator === 'undefined'
    ? undefined
    : (navigator as unknown as NavigatorLike),
): FormFactor {
  const reported = nav?.userAgentData?.mobile;
  if (typeof reported === 'boolean') return reported ? 'mobile' : 'desktop';
  return MOBILE_UA.test(nav?.userAgent ?? '') ? 'mobile' : 'desktop';
}

export const FORM_FACTORS: readonly FormFactor[] = ['desktop', 'mobile'];
