import { describe, it, expect } from 'vitest';
import { isExternalUrl, looksLikeExternalApply, resolveHref } from './redirect';

const PAGE = 'https://jobs.example.com/postings/123';

describe('isExternalUrl', () => {
  it('is true for a different host', () => {
    expect(isExternalUrl(PAGE, 'https://boards.greenhouse.io/acme/jobs/7')).toBe(true);
  });

  it('is false for the same host, whatever the path or scheme', () => {
    expect(isExternalUrl(PAGE, 'https://jobs.example.com/apply/123')).toBe(false);
    expect(isExternalUrl(PAGE, 'http://jobs.example.com/apply/123')).toBe(false);
  });

  it('is false for relative and fragment hrefs (they stay on this page)', () => {
    expect(isExternalUrl(PAGE, '/apply/123')).toBe(false);
    expect(isExternalUrl(PAGE, 'apply')).toBe(false);
    expect(isExternalUrl(PAGE, '#apply')).toBe(false);
  });

  it('ignores a leading www. when comparing hosts', () => {
    expect(isExternalUrl('https://example.com/j/1', 'https://www.example.com/apply')).toBe(false);
    expect(isExternalUrl('https://www.example.com/j/1', 'https://example.com/apply')).toBe(false);
  });

  it('treats a different subdomain as external (boards hand off to careers.*)', () => {
    expect(isExternalUrl(PAGE, 'https://careers.example.com/apply')).toBe(true);
  });

  it('is false for non-navigational schemes and junk', () => {
    expect(isExternalUrl(PAGE, 'mailto:jobs@acme.com')).toBe(false);
    expect(isExternalUrl(PAGE, 'javascript:void(0)')).toBe(false);
    expect(isExternalUrl(PAGE, '')).toBe(false);
    expect(isExternalUrl(PAGE, undefined)).toBe(false);
  });

  it('distinguishes hosts that differ only by port-less localhost aliasing', () => {
    // The E2E fixtures rely on this: localhost and 127.0.0.1 are different hosts.
    expect(isExternalUrl('http://localhost:5199/sites/a.html', 'http://127.0.0.1:5199/sites/b.html')).toBe(true);
  });
});

describe('resolveHref', () => {
  it('absolutizes against the page URL', () => {
    expect(resolveHref(PAGE, '/apply/9')).toBe('https://jobs.example.com/apply/9');
  });

  it('returns undefined for missing or non-navigational hrefs', () => {
    expect(resolveHref(PAGE, undefined)).toBeUndefined();
    expect(resolveHref(PAGE, 'javascript:void(0)')).toBeUndefined();
    expect(resolveHref(PAGE, '#')).toBeUndefined();
  });
});

describe('looksLikeExternalApply', () => {
  it('matches the common "leaves this site" apply labels', () => {
    const yes = [
      'Apply on company website',
      'Apply on company site',
      'Apply on the company website',
      'Apply externally',
      'External application',
      'Apply on employer site',
      'Apply via Greenhouse',
      'Continue to company site',
      'Apply on Company Website ',
    ];
    for (const text of yes) expect(looksLikeExternalApply(text), text).toBe(true);
  });

  it('does not match plain in-page apply labels', () => {
    const no = ['Apply', 'Apply now', 'Quick apply', 'Easy Apply', 'Submit application', 'Save job', ''];
    for (const text of no) expect(looksLikeExternalApply(text), text).toBe(false);
  });

  it('normalizes diacritics and separators like the field matcher does', () => {
    expect(looksLikeExternalApply('APPLY_ON_COMPANY_WEBSITE')).toBe(true);
  });
});
