/**
 * Pure helpers for classifying two-step ("redirect") postings — the bits that
 * need no DOM, so they can be unit-tested directly. The DOM walk that uses them
 * lives in `src/content/redirectDetect.ts`.
 */

import { normalizeAttr } from './fieldKeys';
import { navigableUrl } from './appLink';

/**
 * What a posting turned out to be: the form is on this page, it hands off to the
 * employer's own site, or the classifier is not confident enough to say — which
 * takes the ordinary fill path, because a false positive navigates away from a
 * page that could have been filled.
 *
 * Here rather than beside the DOM walk that produces it because the setup
 * wizard's snapshot carries it (`SetupVerdict`), and `shared/` never imports
 * from `content/`.
 */
export type PostingKind = 'quickApply' | 'redirect' | 'unknown';

/**
 * Labels that mean "this button leaves the board for the employer's own form".
 * Tested against `normalizeAttr` output (lower-cased, separators -> spaces), so
 * patterns are space-based. Deliberately narrow: a false positive here would
 * navigate away from a page the user could have filled in place.
 */
const EXTERNAL_APPLY_PATTERNS: RegExp[] = [
  /\bapply (?:on|at|via|through|to) (?:the )?(?:company|employer)\b/,
  /\bapply (?:via|through) \w+/,
  /\bapply on \w+(?: web)? ?site\b/,
  /\bapply externally\b/,
  /\bexternal (?:application|apply)\b/,
  /\bcontinue to (?:the )?(?:company|employer|application)\b/,
];

/**
 * Absolutize `href` against `pageUrl`; undefined when it can't navigate anywhere.
 *
 * `keepInBrowser` defaults to **on** — fail closed, like `findSubmitControl`. It
 * is the whole of `settings.keepInBrowser` reaching the detector, and it lands
 * here rather than in the four callers because `hrefOf` in
 * `content/redirectDetect.ts` is the only href reader in the classifier: every
 * path through it (marker, configured apply control, heuristic) comes here, so
 * both the new-tab and same-tab handoffs are covered by this one line.
 */
export function resolveHref(
  pageUrl: string,
  href: string | null | undefined,
  keepInBrowser = true,
): string | undefined {
  return navigableUrl(href, pageUrl, keepInBrowser);
}

function bareHost(url: string): string {
  return new URL(url).host.replace(/^www\./i, '').toLowerCase();
}

/**
 * True when `href` points at a different host than the page it appears on.
 *
 * Judged on the *resolved* URL, so an `intent://` link rewritten to its
 * `browser_fallback_url` is compared on the host the browser will really reach.
 */
export function isExternalUrl(
  pageUrl: string,
  href: string | null | undefined,
  keepInBrowser = true,
): boolean {
  const target = resolveHref(pageUrl, href, keepInBrowser);
  if (!target) return false;
  try {
    return bareHost(target) !== bareHost(pageUrl);
  } catch {
    return false;
  }
}

/** True when a control's label reads as "apply on the employer's own site". */
export function looksLikeExternalApply(text: string | null | undefined): boolean {
  const normalized = normalizeAttr(text);
  if (!normalized) return false;
  return EXTERNAL_APPLY_PATTERNS.some((re) => re.test(normalized));
}
