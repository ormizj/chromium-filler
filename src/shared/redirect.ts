/**
 * Pure helpers for classifying two-step ("redirect") postings — the bits that
 * need no DOM, so they can be unit-tested directly. The DOM walk that uses them
 * lives in `src/content/redirectDetect.ts`.
 */

import { normalizeAttr } from './fieldKeys';

/** Schemes that never navigate to another application page. */
const NON_NAVIGATIONAL = /^(mailto|tel|javascript|data|blob|about):/i;

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

/** Absolutize `href` against `pageUrl`; undefined when it can't navigate anywhere. */
export function resolveHref(pageUrl: string, href: string | null | undefined): string | undefined {
  if (!href) return undefined;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || NON_NAVIGATIONAL.test(trimmed)) return undefined;
  try {
    return new URL(trimmed, pageUrl).href;
  } catch {
    return undefined;
  }
}

function bareHost(url: string): string {
  return new URL(url).host.replace(/^www\./i, '').toLowerCase();
}

/** True when `href` points at a different host than the page it appears on. */
export function isExternalUrl(pageUrl: string, href: string | null | undefined): boolean {
  const target = resolveHref(pageUrl, href);
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
