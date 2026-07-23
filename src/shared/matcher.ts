/**
 * Matches a page URL against a SiteConfig's patterns.
 *
 * Two pattern syntaxes are supported:
 *  - Match-pattern globs like `*://boards.greenhouse.io/*` where `*` is a
 *    wildcard and everything else is literal (regex-special chars escaped).
 *  - `/regex/` strings, tested as a RegExp against the whole URL.
 */

import type { SiteConfig } from './types';

/** Escape everything regex-special, then turn the escaped `*` back into `.*`. */
function globBody(part: string): string {
  return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
}

function globToRegExp(pattern: string): RegExp {
  // The `*` before `://` is the SCHEME wildcard, so it may not itself contain a
  // scheme separator or a path — otherwise `*://site/*` also matches any URL
  // that merely carries `https://site/` in its query string or path, and that
  // page would then be filled with a foreign site's config.
  const scheme = pattern.indexOf('://');
  const body = scheme < 0
    ? globBody(pattern)
    : `${globBody(pattern.slice(0, scheme)).replace(/\.\*/g, '[^:/]*')}://${globBody(pattern.slice(scheme + 3))}`;
  return new RegExp(`^${body}$`);
}

export function urlMatchesPattern(url: string, pattern: string): boolean {
  try {
    if (pattern.length >= 2 && pattern.startsWith('/') && pattern.endsWith('/')) {
      const re = new RegExp(pattern.slice(1, -1));
      return re.test(url);
    }
    return globToRegExp(pattern).test(url);
  } catch {
    return false;
  }
}

export function findMatchingConfig(
  url: string,
  configs: SiteConfig[],
): SiteConfig | undefined {
  return configs.find((c) => c.urlPatterns.some((p) => urlMatchesPattern(url, p)));
}
