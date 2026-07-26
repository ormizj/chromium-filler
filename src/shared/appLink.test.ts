import { describe, it, expect } from 'vitest';
import { isAppLink, navigableUrl, webUrl } from './appLink';

const PAGE = 'https://jobs.example.com/postings/123';
const ATS = 'https://boards.greenhouse.io/acme/jobs/7';

/** An `intent:` URL of the shape Android's own docs describe. */
function intent(host: string, opts: { fallback?: string; scheme?: string; pkg?: string } = {}): string {
  const parts = ['Intent'];
  if (opts.scheme) parts.push(`scheme=${opts.scheme}`);
  parts.push(`package=${opts.pkg ?? 'com.example.app'}`);
  if (opts.fallback) parts.push(`S.browser_fallback_url=${encodeURIComponent(opts.fallback)}`);
  parts.push('end');
  return `intent://${host}#${parts.join(';')}`;
}

describe('webUrl', () => {
  it('passes http and https through, absolutized against the base', () => {
    expect(webUrl(ATS, PAGE)).toBe(ATS);
    expect(webUrl('/apply/9', PAGE)).toBe('https://jobs.example.com/apply/9');
    expect(webUrl('http://plain.example.com/x', PAGE)).toBe('http://plain.example.com/x');
  });

  it('rewrites an intent: URL to its browser_fallback_url', () => {
    expect(webUrl(intent('acme.com/jobs/7', { fallback: ATS }), PAGE)).toBe(ATS);
  });

  it('rebuilds an intent: URL from scheme= when there is no fallback', () => {
    // The commonest real shape: the app link and the web link are the same
    // host and path, and only the scheme differs.
    expect(webUrl(intent('acme.com/jobs/7?src=li', { scheme: 'https' }), PAGE))
      .toBe('https://acme.com/jobs/7?src=li');
    expect(webUrl(intent('acme.com/jobs/7', { scheme: 'http' }), PAGE))
      .toBe('http://acme.com/jobs/7');
  });

  it('prefers the fallback over scheme= when both are present', () => {
    expect(webUrl(intent('acme.com/app-only', { scheme: 'https', fallback: ATS }), PAGE)).toBe(ATS);
  });

  it('rejects an intent: URL whose fallback is itself an app link', () => {
    // Recursing once and re-checking is the point: a fallback is not trusted
    // just because the key it arrived under promises a browser URL.
    expect(webUrl(intent('acme.com/x', { fallback: 'linkedin://jobs/7' }), PAGE)).toBeUndefined();
    expect(webUrl(intent('acme.com/x', { fallback: intent('b.com', { scheme: 'https' }) }), PAGE))
      .toBeUndefined();
  });

  it('rejects an intent: URL with neither a fallback nor a web scheme=', () => {
    expect(webUrl(intent('acme.com/x'), PAGE)).toBeUndefined();
    expect(webUrl(intent('acme.com/x', { scheme: 'linkedin' }), PAGE)).toBeUndefined();
  });

  it('maps android-app: to the https URL it wraps', () => {
    expect(webUrl('android-app://com.acme.jobs/https/acme.com/jobs/7', PAGE))
      .toBe('https://acme.com/jobs/7');
    expect(webUrl('android-app://com.acme.jobs/http/acme.com/jobs/7', PAGE))
      .toBe('http://acme.com/jobs/7');
  });

  it('rejects an android-app: URL that names no web scheme', () => {
    expect(webUrl('android-app://com.acme.jobs', PAGE)).toBeUndefined();
    expect(webUrl('android-app://com.acme.jobs/acme.com/jobs/7', PAGE)).toBeUndefined();
  });

  it('rejects bare app schemes, which have no web form at all', () => {
    for (const href of ['linkedin://jobs/7', 'market://details?id=com.x', 'fb://page/1', 'whatsapp://send']) {
      expect(webUrl(href, PAGE), href).toBeUndefined();
    }
  });

  it('rejects the schemes the old blocklist rejected', () => {
    for (const href of [
      'mailto:jobs@acme.com',
      'tel:+441234',
      'javascript:void(0)',
      'data:text/html,hi',
      'blob:https://x/1',
      'about:blank',
    ]) {
      expect(webUrl(href, PAGE), href).toBeUndefined();
    }
  });

  it('rejects nothing-hrefs and junk', () => {
    expect(webUrl(undefined, PAGE)).toBeUndefined();
    expect(webUrl(null, PAGE)).toBeUndefined();
    expect(webUrl('', PAGE)).toBeUndefined();
    expect(webUrl('   ', PAGE)).toBeUndefined();
    expect(webUrl('#', PAGE)).toBeUndefined();
    expect(webUrl('#apply', PAGE)).toBeUndefined();
    expect(webUrl('http://', PAGE)).toBeUndefined();
  });

  it('resolves a relative href even with no base, or refuses cleanly', () => {
    expect(webUrl('/apply/9')).toBeUndefined();
    expect(webUrl(ATS)).toBe(ATS);
  });
});

describe('isAppLink', () => {
  it('is true for schemes that hand off to a native app', () => {
    for (const href of [
      'linkedin://jobs/7',
      'intent://acme.com/x#Intent;package=com.x;end',
      'android-app://com.acme.jobs',
      'market://details?id=com.x',
      'fb://page/1',
    ]) {
      expect(isAppLink(href), href).toBe(true);
    }
  });

  it('is false for web URLs, so an ordinary link is never explained away', () => {
    expect(isAppLink(ATS)).toBe(false);
    expect(isAppLink('/apply/9')).toBe(false);
    expect(isAppLink('apply')).toBe(false);
    expect(isAppLink('#apply')).toBe(false);
  });

  it('is false for the mundane non-navigational schemes', () => {
    // These are ignored today and must stay silently ignored: a `mailto:` on a
    // posting is a recruiter's address, not a broken handoff worth a banner.
    for (const href of [
      'mailto:jobs@acme.com',
      'tel:+441234',
      'javascript:void(0)',
      'data:text/html,hi',
      'blob:https://x/1',
      'about:blank',
      '',
      undefined,
    ]) {
      expect(isAppLink(href), String(href)).toBe(false);
    }
  });
});

describe('navigableUrl', () => {
  it('with keepInBrowser on, is exactly webUrl', () => {
    expect(navigableUrl(intent('acme.com/x', { fallback: ATS }), PAGE, true)).toBe(ATS);
    expect(navigableUrl('linkedin://jobs/7', PAGE, true)).toBeUndefined();
    expect(navigableUrl('/apply/9', PAGE, true)).toBe('https://jobs.example.com/apply/9');
  });

  it('with keepInBrowser off, lets an app scheme through unchanged', () => {
    // The setting exists for someone who would rather finish in the app, so off
    // has to mean "hand the link over as the page wrote it".
    expect(navigableUrl('linkedin://jobs/7', PAGE, false)).toBe('linkedin://jobs/7');
    const raw = intent('acme.com/x', { fallback: ATS });
    expect(navigableUrl(raw, PAGE, false)).toBe(raw);
  });

  it('with keepInBrowser off, still refuses what can never navigate', () => {
    for (const href of ['mailto:jobs@acme.com', 'javascript:void(0)', '#', '', undefined]) {
      expect(navigableUrl(href, PAGE, false), String(href)).toBeUndefined();
    }
  });

  it('with keepInBrowser off, web URLs behave identically', () => {
    expect(navigableUrl('/apply/9', PAGE, false)).toBe('https://jobs.example.com/apply/9');
    expect(navigableUrl(ATS, PAGE, false)).toBe(ATS);
  });
});
