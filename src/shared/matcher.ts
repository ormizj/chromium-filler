/**
 * Matches a page URL against a SiteConfig's patterns.
 *
 * Two pattern syntaxes are supported:
 *  - Match-pattern globs like `*://boards.greenhouse.io/*` where `*` is a
 *    wildcard and everything else is literal (regex-special chars escaped).
 *  - `/regex/` strings, tested as a RegExp against the whole URL.
 */

import type { SiteConfig } from './types';

function globToRegExp(pattern: string): RegExp {
  // Escape everything regex-special, then turn the escaped `*` back into `.*`.
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = escaped.replace(/\\\*/g, '.*');
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
