import { describe, it, expect } from 'vitest';
import { urlMatchesPattern, findMatchingConfig } from './matcher';
import type { SiteConfig } from './types';

const cfg = (id: string, urlPatterns: string[]): SiteConfig => ({
  id,
  name: id,
  urlPatterns,
  extract: {},
});

describe('urlMatchesPattern', () => {
  it('matches a host glob with scheme + path wildcards', () => {
    expect(
      urlMatchesPattern('https://boards.greenhouse.io/acme/jobs/1', '*://boards.greenhouse.io/*'),
    ).toBe(true);
  });

  it('matches subdomain wildcards', () => {
    expect(urlMatchesPattern('https://boards.greenhouse.io/x', '*://*.greenhouse.io/*')).toBe(true);
    expect(urlMatchesPattern('https://greenhouse.io/x', '*://*.greenhouse.io/*')).toBe(false);
  });

  it('does not match a different host', () => {
    expect(
      urlMatchesPattern('https://jobs.lever.co/acme/x', '*://boards.greenhouse.io/*'),
    ).toBe(false);
  });

  it('escapes regex-special characters in the literal parts', () => {
    expect(urlMatchesPattern('https://x.com/a', '*://x.com/*')).toBe(true);
    // the dot is literal, so "xacom" must not match "x.com"
    expect(urlMatchesPattern('https://xacom/a', '*://x.com/*')).toBe(false);
  });

  it('does not match a URL that merely contains the pattern in its query or path', () => {
    // The leading `*` stands for the scheme, not "anything at all": a tracker or
    // search URL carrying another site's URL unencoded must not adopt that
    // site's config, or its prep steps and overrides run on a foreign page.
    expect(
      urlMatchesPattern(
        'https://evil.com/?next=https://boards.greenhouse.io/acme',
        '*://boards.greenhouse.io/*',
      ),
    ).toBe(false);
    expect(
      urlMatchesPattern(
        'http://127.0.0.1:5200/r/302?to=http://127.0.0.1:5199/ats-form.html',
        '*://127.0.0.1:5199/*',
      ),
    ).toBe(false);
    expect(
      urlMatchesPattern(
        'https://jobs.example.com/redirect/https://boards.greenhouse.io/acme',
        '*://boards.greenhouse.io/*',
      ),
    ).toBe(false);
  });

  it('still matches every scheme the scheme wildcard stands for', () => {
    for (const url of ['https://x.com/a', 'http://x.com/a', 'ftp://x.com/a']) {
      expect(urlMatchesPattern(url, '*://x.com/*'), url).toBe(true);
    }
  });

  it('keeps host and path wildcards permissive (the fixture configs rely on it)', () => {
    // `file://*chaos-form.html*` has to cross path separators to match.
    expect(urlMatchesPattern('file:///x/y/chaos-form.html', 'file://*chaos-form.html*')).toBe(true);
    expect(
      urlMatchesPattern('http://localhost:5199/sites/quick-board.html?job=plain', '*://*/sites/quick-board.html*'),
    ).toBe(true);
  });

  it('supports /regex/ patterns tested against the full url', () => {
    expect(urlMatchesPattern('https://x.com/careers/9?a=1', '/careers\\/\\d+/')).toBe(true);
    expect(urlMatchesPattern('https://x.com/about', '/careers\\/\\d+/')).toBe(false);
  });

  it('returns false for an invalid regex pattern instead of throwing', () => {
    expect(urlMatchesPattern('https://x.com/a', '/[/')).toBe(false);
  });
});

describe('findMatchingConfig', () => {
  const configs = [
    cfg('greenhouse', ['*://boards.greenhouse.io/*']),
    cfg('lever', ['*://jobs.lever.co/*']),
  ];

  it('returns the config whose pattern matches', () => {
    expect(findMatchingConfig('https://jobs.lever.co/acme/abc', configs)?.id).toBe('lever');
  });

  it('returns undefined when nothing matches', () => {
    expect(findMatchingConfig('https://example.com/x', configs)).toBeUndefined();
  });

  it('returns the first config in order when multiple match', () => {
    const overlapping = [
      cfg('broad', ['*://*/*']),
      cfg('specific', ['*://jobs.lever.co/*']),
    ];
    expect(findMatchingConfig('https://jobs.lever.co/x', overlapping)?.id).toBe('broad');
  });
});
