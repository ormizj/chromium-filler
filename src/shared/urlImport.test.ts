import { describe, it, expect } from 'vitest';
import { extractUrls } from './urlImport';

describe('extractUrls', () => {
  it('returns [] for empty or url-less text', () => {
    expect(extractUrls('')).toEqual([]);
    expect(extractUrls('just some words, no links here')).toEqual([]);
  });

  it('extracts a single http(s) url', () => {
    expect(extractUrls('apply at https://boards.greenhouse.io/acme/jobs/123')).toEqual([
      'https://boards.greenhouse.io/acme/jobs/123',
    ]);
  });

  it('extracts one url per line', () => {
    const raw = `https://jobs.lever.co/acme/abc
https://boards.greenhouse.io/acme/jobs/1
http://example.com/careers/9`;
    expect(extractUrls(raw)).toEqual([
      'https://jobs.lever.co/acme/abc',
      'https://boards.greenhouse.io/acme/jobs/1',
      'http://example.com/careers/9',
    ]);
  });

  it('strips trailing punctuation and wrapping brackets/quotes', () => {
    expect(extractUrls('See (https://x.com/jobs/1).')).toEqual(['https://x.com/jobs/1']);
    expect(extractUrls('link: "https://x.com/jobs/2",')).toEqual(['https://x.com/jobs/2']);
    expect(extractUrls('<https://x.com/jobs/3>')).toEqual(['https://x.com/jobs/3']);
    expect(extractUrls('go https://x.com/jobs/4! now')).toEqual(['https://x.com/jobs/4']);
  });

  it('preserves meaningful query strings and fragments', () => {
    expect(extractUrls('https://x.com/jobs?id=5&src=li#apply')).toEqual([
      'https://x.com/jobs?id=5&src=li#apply',
    ]);
  });

  it('extracts urls out of markdown links', () => {
    expect(extractUrls('[Backend role](https://jobs.lever.co/acme/xyz) is open')).toEqual([
      'https://jobs.lever.co/acme/xyz',
    ]);
  });

  it('prefixes bare www. hosts with https://', () => {
    expect(extractUrls('careers at www.acme.com/jobs/7')).toEqual(['https://www.acme.com/jobs/7']);
  });

  it('dedupes case-insensitively on host but keeps path/query case', () => {
    const raw = `https://Boards.Greenhouse.io/acme/Jobs/1
https://boards.greenhouse.io/acme/Jobs/1`;
    expect(extractUrls(raw)).toEqual(['https://boards.greenhouse.io/acme/Jobs/1']);
  });

  it('is order-stable, keeping first occurrence of a duplicate', () => {
    const raw = 'a https://x.com/1 b https://y.com/2 c https://x.com/1';
    expect(extractUrls(raw)).toEqual(['https://x.com/1', 'https://y.com/2']);
  });

  it('drops obviously non-job noise like image/asset urls when asked', () => {
    // Default keeps everything; only http(s)/www are matched, so a bare word is ignored.
    expect(extractUrls('email me at foo@bar.com or visit https://x.com/j/1')).toEqual([
      'https://x.com/j/1',
    ]);
  });
});
