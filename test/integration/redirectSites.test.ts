/**
 * Integration tests for the fixture sites that exercise the *classification*
 * flow — quick apply here, hand off to an employer, or refuse to guess.
 *
 * Like `hardSites.test.ts`, these reconstruct each posting's *loaded* DOM (the
 * fixtures build their markup from `?job=…` in an inline script, which jsdom
 * does not run) and pair it with the site's REAL config from
 * `test-site-configs.json`. That is the point: the verdict depends on the
 * fixture markup and the shipped config agreeing, and either one drifting is
 * exactly the regression worth catching. The tab/window choreography that
 * follows a verdict is covered by the Playwright suite.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { detectRedirect } from '../../src/content/redirectDetect';
import { findMatchingConfig } from '../../src/shared/matcher';
import type { SiteConfig } from '../../src/shared/types';
import configsJson from '../fixtures/test-site-configs.json';

const CONFIGS = configsJson as SiteConfig[];

/** The three fixture origins — different ports are different hosts. */
const BOARD = 'http://localhost:5199';
const EMPLOYER = 'http://127.0.0.1:5199';
const TRACKER = 'http://127.0.0.1:5200';

const ATS = `${EMPLOYER}/sites/ats-form.html`;

function mount(html: string): void {
  document.body.innerHTML = html;
}

/** Classify a posting the way the content script does: real config, real page URL. */
function classify(configId: string, pageUrl: string) {
  const config = CONFIGS.find((c) => c.id === configId);
  expect(config, `missing config: ${configId}`).toBeDefined();
  expect(findMatchingConfig(pageUrl, CONFIGS)?.id).toBe(configId);
  return detectRedirect({ root: document, pageUrl, config: config!.redirect });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('config patterns survive a query string', () => {
  it('matches every posting URL to its own site config', () => {
    const url = (file: string, q = '') => `${BOARD}/sites/${file}.html${q}`;
    expect(findMatchingConfig(url('quick-board', '?job=plain&n=7'), CONFIGS)?.id).toBe('quick-board');
    expect(findMatchingConfig(url('external-board', '?job=js'), CONFIGS)?.id).toBe('external-board');
    expect(findMatchingConfig(url('redirect-board', '?job=blank'), CONFIGS)?.id).toBe('redirect-board');
    expect(findMatchingConfig(url('listing-board'), CONFIGS)?.id).toBe('listing-board');
    expect(findMatchingConfig(url('hidden-success'), CONFIGS)?.id).toBe('hidden-success');
    // The destinations deliberately have none until a handoff creates one.
    expect(findMatchingConfig(`${EMPLOYER}/sites/ats-form.html`, CONFIGS)).toBeUndefined();
    expect(findMatchingConfig(`${TRACKER}/sites/ats-nav.html`, CONFIGS)).toBeUndefined();
  });
});

describe('QuickBoard — the site that must never hand off', () => {
  const DECOY = `<aside><a id="decoy-apply" href="${ATS}?src=decoy">Apply on company website</a></aside>`;
  const FORM = '<form id="application-form"><input name="email" /></form>';

  it('the quick-apply marker beats a decoy the heuristic would have followed', () => {
    mount(FORM + DECOY);
    const det = classify('quick-board', `${BOARD}/sites/quick-board.html?job=plain`);
    expect(det.kind).toBe('quickApply');
    expect(det.source).toBe('override');
  });

  it('and the decoy really is tempting — without the marker it would be followed', () => {
    mount(FORM + DECOY);
    const det = detectRedirect({ root: document, pageUrl: `${BOARD}/sites/quick-board.html`, config: {} });
    expect(det.kind).toBe('redirect');
    expect(det.source).toBe('heuristic');
  });

  it('the posting with nothing external is a plain fall-through', () => {
    mount(FORM);
    const det = classify('quick-board', `${BOARD}/sites/quick-board.html?job=nolink`);
    expect(det.kind).toBe('quickApply');
  });
});

describe('ListingBoard — several postings, no way to choose', () => {
  it('refuses to follow any of three different apply links', () => {
    mount(`
      <div class="card"><a id="apply-1" href="${ATS}?job=1">Apply on company website</a></div>
      <div class="card"><a id="apply-2" href="${ATS}?job=2">Apply on company website</a></div>
      <div class="card"><a id="apply-3" href="${ATS}?job=3">Apply on company website</a></div>`);
    const det = classify('listing-board', `${BOARD}/sites/listing-board.html`);
    expect(det.kind).toBe('unknown');
    expect(det.reason).toContain('ambiguous');
    expect(det.reason).toContain('3 external apply links');
  });
});

describe('MixedBoard — one board, both kinds of posting, heuristic only', () => {
  it('?job=quick fills in place', () => {
    mount(`
      <form id="board-form"><input name="email" /></form>
      <div id="board-success"></div>`);
    const det = classify('redirect-board', `${BOARD}/sites/redirect-board.html?job=quick`);
    expect(det.kind).toBe('unknown'); // nothing external -> ordinary fill path
    expect(det.reason).toBe('no external apply link found');
  });

  it('?job=external is followed on its label', () => {
    mount(`
      <button id="save-job">Save job</button>
      <a id="apply-external" href="${ATS}">Apply on company website</a>`);
    const det = classify('redirect-board', `${BOARD}/sites/redirect-board.html?job=external`);
    expect(det.kind).toBe('redirect');
    expect(det.source).toBe('heuristic');
    expect(det.href).toBe(ATS);
  });

  it('?job=blank is followed on target=_blank + cross-origin, with no matching label', () => {
    mount(`
      <button id="save-job">Save job</button>
      <a id="apply-external" target="_blank" href="${ATS}?src=blank">Apply now</a>`);
    const det = classify('redirect-board', `${BOARD}/sites/redirect-board.html?job=blank`);
    expect(det.kind).toBe('redirect');
    expect(det.source).toBe('heuristic');
    expect(det.href).toBe(`${ATS}?src=blank`);
  });

  it('?job=tracked hands off to the first hop of the chain, not the final ATS', () => {
    const hop = `${TRACKER}/r/302?to=${encodeURIComponent(`${TRACKER}/sites/redirect-hop.html`)}`;
    mount(`
      <button id="save-job">Save job</button>
      <a id="apply-external" href="${hop}">Apply on company website</a>`);
    const det = classify('redirect-board', `${BOARD}/sites/redirect-board.html?job=tracked`);
    expect(det.kind).toBe('redirect');
    expect(det.href).toBe(hop);
  });
});

describe('ExternalBoard — every posting hands off, by configured selector', () => {
  const page = (job: string) => `${BOARD}/sites/external-board.html?job=${job}`;

  it('?job=link uses the configured apply link, not the label', () => {
    mount(`
      <button id="save-job">Save job</button>
      <a id="apply-external" href="${ATS}?src=link">Apply for this role</a>`);
    const det = classify('external-board', page('link'));
    expect(det.kind).toBe('redirect');
    expect(det.source).toBe('override');
    expect(det.reason).toBe('configured external apply link');
    expect(det.href).toBe(`${ATS}?src=link`);
    // The label alone would never have matched — this is the override's own work.
    const bare = detectRedirect({ root: document, pageUrl: page('link'), config: {} });
    expect(bare.kind).toBe('unknown');
  });

  it('?job=js resolves to a control with no href, so following means clicking', () => {
    mount(`
      <button id="save-job">Save job</button>
      <button id="apply-js">Apply for this role</button>`);
    const det = classify('external-board', page('js'));
    expect(det.kind).toBe('redirect');
    expect(det.source).toBe('override');
    expect(det.element?.id).toBe('apply-js');
    expect(det.href).toBeUndefined();
  });

  it('?job=marker is classified by the badge, and still knows where to go', () => {
    mount(`
      <p><span id="external-badge">External posting</span></p>
      <button id="save-job">Save job</button>
      <a id="continue-link" href="${ATS}?src=marker">Continue</a>`);
    const det = classify('external-board', page('marker'));
    expect(det.kind).toBe('redirect');
    expect(det.reason).toBe('external marker on the page');
    expect(det.href).toBe(`${ATS}?src=marker`);
  });

  it('?job=nav hands off to the third origin', () => {
    mount(`
      <button id="save-job">Save job</button>
      <a id="apply-external" href="${TRACKER}/sites/ats-nav.html">Apply for this role</a>`);
    const det = classify('external-board', page('nav'));
    expect(det.kind).toBe('redirect');
    expect(det.href).toBe(`${TRACKER}/sites/ats-nav.html`);
  });

  it('every posting runs the board’s own "Save job" before leaving', () => {
    const config = CONFIGS.find((c) => c.id === 'external-board')!;
    expect(config.redirect?.beforeFollow).toEqual([{ action: 'click', selector: '#save-job' }]);
  });
});
