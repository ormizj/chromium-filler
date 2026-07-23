import { describe, it, expect, beforeEach } from 'vitest';
import { detectRedirect } from './redirectDetect';
import type { RedirectConfig } from '../shared/types';

const PAGE = 'https://board.com/jobs/123';
const ATS = 'https://boards.greenhouse.io/acme/jobs/7';

function mount(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('detectRedirect — configured selectors win', () => {
  it('classifies quick-apply when the quick-apply marker resolves', () => {
    mount(`
      <a id="ext" href="${ATS}">Apply on company website</a>
      <form id="inline"><input name="email"></form>`);
    const config: RedirectConfig = { applySelector: '#ext', quickApplySelector: '#inline' };
    const det = detectRedirect({ root: document, pageUrl: PAGE, config });
    expect(det.kind).toBe('quickApply');
    expect(det.source).toBe('override');
  });

  it('classifies redirect from the configured apply link and reports its href', () => {
    mount(`<a id="ext" href="${ATS}">Apply</a>`);
    const det = detectRedirect({ root: document, pageUrl: PAGE, config: { applySelector: '#ext' } });
    expect(det.kind).toBe('redirect');
    expect(det.source).toBe('override');
    expect(det.href).toBe(ATS);
    expect(det.element?.id).toBe('ext');
  });

  it('trusts a configured apply link even with no href (JS button)', () => {
    mount(`<button id="ext">Apply</button>`);
    const det = detectRedirect({ root: document, pageUrl: PAGE, config: { applySelector: '#ext' } });
    expect(det.kind).toBe('redirect');
    expect(det.href).toBeUndefined();
    expect(det.element?.id).toBe('ext');
  });

  it('classifies redirect from a marker even when the apply link looks internal', () => {
    mount(`
      <span id="badge">External</span>
      <a id="ext" href="/out/123">Apply</a>`);
    const config: RedirectConfig = { markerSelector: '#badge', applySelector: '#ext' };
    const det = detectRedirect({ root: document, pageUrl: PAGE, config });
    expect(det.kind).toBe('redirect');
    expect(det.href).toBe('https://board.com/out/123');
  });

  it('falls through when configured selectors resolve to nothing', () => {
    mount(`<form><input name="email"></form>`);
    const config: RedirectConfig = { applySelector: '#nope', quickApplySelector: '#alsoNope' };
    expect(detectRedirect({ root: document, pageUrl: PAGE, config }).kind).toBe('unknown');
  });

  it('ignores invalid selectors instead of throwing', () => {
    mount(`<form><input name="email"></form>`);
    const config: RedirectConfig = { applySelector: '#(bad', quickApplySelector: ':::' };
    expect(() => detectRedirect({ root: document, pageUrl: PAGE, config })).not.toThrow();
  });
});

describe('detectRedirect — heuristic', () => {
  it('detects an external apply link by its label', () => {
    mount(`
      <h1>Senior Widget Engineer</h1>
      <a class="btn" href="${ATS}">Apply on company website</a>`);
    const det = detectRedirect({ root: document, pageUrl: PAGE });
    expect(det.kind).toBe('redirect');
    expect(det.source).toBe('heuristic');
    expect(det.href).toBe(ATS);
  });

  it('detects a plain "Apply" link that opens a cross-origin tab', () => {
    mount(`<a href="${ATS}" target="_blank">Apply now</a>`);
    const det = detectRedirect({ root: document, pageUrl: PAGE });
    expect(det.kind).toBe('redirect');
    expect(det.href).toBe(ATS);
  });

  it('uses aria-label when the control has no text', () => {
    mount(`<a href="${ATS}" aria-label="Apply externally"><svg></svg></a>`);
    expect(detectRedirect({ root: document, pageUrl: PAGE }).kind).toBe('redirect');
  });

  it('does not divert a same-host apply link', () => {
    mount(`<a href="https://board.com/apply/123">Apply on company website</a>`);
    expect(detectRedirect({ root: document, pageUrl: PAGE }).kind).toBe('unknown');
  });

  it('does not divert an ordinary in-page application form', () => {
    mount(`
      <form>
        <input name="email"><input type="file" name="resume">
        <button type="submit">Apply now</button>
      </form>`);
    expect(detectRedirect({ root: document, pageUrl: PAGE }).kind).toBe('unknown');
  });

  it('does not divert on a listing page with several external apply links', () => {
    mount(`
      <a href="${ATS}">Apply on company website</a>
      <a href="https://jobs.lever.co/other/9">Apply on company website</a>`);
    const det = detectRedirect({ root: document, pageUrl: PAGE });
    expect(det.kind).toBe('unknown');
    expect(det.reason).toMatch(/ambiguous/i);
  });

  it('treats repeated links to the same destination as one candidate', () => {
    mount(`
      <a href="${ATS}">Apply on company website</a>
      <a href="${ATS}">Apply on company website</a>`);
    expect(detectRedirect({ root: document, pageUrl: PAGE }).kind).toBe('redirect');
  });

  it('skips hidden apply links', () => {
    mount(`<a href="${ATS}" hidden>Apply on company website</a>`);
    expect(detectRedirect({ root: document, pageUrl: PAGE }).kind).toBe('unknown');
  });

  it('is disabled by redirect.autoDetect === false', () => {
    mount(`<a href="${ATS}">Apply on company website</a>`);
    const det = detectRedirect({ root: document, pageUrl: PAGE, config: { autoDetect: false } });
    expect(det.kind).toBe('unknown');
  });
});
