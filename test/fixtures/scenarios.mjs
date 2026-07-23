/**
 * The fixture scenario catalog — one entry per *addressable* test scenario, not
 * per file. A board serves several postings from one HTML page (that is the shape
 * the redirect classifier exists for: quick-apply and hand-off postings mixed on
 * one site), so the posting, not the page, is what gets a URL here.
 *
 * Plain ESM with no imports so `e2e/server.mjs` can load it under bare node; the
 * Playwright spec imports the same file, so no URL is written down twice.
 *
 * `expect` is the one-line outcome a human should see — it is what the generated
 * index page shows next to each link, and what the E2E spec asserts.
 */

/**
 * Three origins on one server. `isExternalUrl` compares `URL.host`, which
 * includes the port, so a second port is a genuinely different site to the
 * extension — that is what makes the cross-origin handoff real without DNS.
 */
export const HOSTS = {
  /** The job board the user browses. */
  board: 'http://localhost:5199',
  /** The employer's own ATS — the destination of a two-step posting. */
  employer: 'http://127.0.0.1:5199',
  /** A tracker/second employer, so a redirect chain crosses more than one host. */
  tracker: 'http://127.0.0.1:5200',
};

/** Flow groups, in the order the index page and the printed summary show them. */
export const FLOWS = [
  { id: 'quick-apply', title: 'Quick apply — the form is on this page' },
  { id: 'two-step', title: 'Two-step — the posting hands off to an employer ATS' },
  { id: 'ambiguity', title: 'Ambiguity — must NOT follow anything' },
  { id: 'destination', title: 'Destinations — reached by a handoff, no config of their own' },
  { id: 'submit-detection', title: 'Submit detection — what counts as "actually sent"' },
  { id: 'session', title: 'Queue session' },
];

const site = (host, file, query = '') => `${host}/sites/${file}.html${query}`;

/** The ATS a handoff lands on, and the tracker chain that reaches it the long way. */
export const ATS_URL = site(HOSTS.employer, 'ats-form');
export const ATS_NAV_URL = site(HOSTS.tracker, 'ats-nav');
export const HOP_URL = site(HOSTS.tracker, 'redirect-hop', `?ms=700&to=${encodeURIComponent(`${ATS_URL}?via=chain`)}`);
export const TRACKED_URL = `${HOSTS.tracker}/r/302?to=${encodeURIComponent(HOP_URL)}`;

export const SCENARIOS = [
  /* ---------------- Quick apply ---------------- */
  {
    id: 'slow-boards',
    flow: 'quick-apply',
    title: 'SlowBoards — form injected ~2s after load',
    url: site(HOSTS.board, 'slow-boards'),
    config: 'slow-boards',
    expect: 'waits for #application-form, then fills every field + attaches the CV',
  },
  {
    id: 'modal-lever',
    flow: 'quick-apply',
    title: 'ModalLever — form behind an Apply modal, no ids',
    url: site(HOSTS.board, 'modal-lever'),
    config: 'modal-lever',
    expect: 'prep opens the modal and reveals the CV input; fields match by accessible name',
  },
  {
    id: 'chaos-form',
    flow: 'quick-apply',
    title: 'ChaosForm — hashed ids, multi-step, one disguised field',
    url: site(HOSTS.board, 'chaos-form'),
    config: 'chaos-form',
    expect: 'fills everything except "Where are you located?", which stays red for Pick',
  },
  {
    id: 'quick-plain',
    flow: 'quick-apply',
    title: 'QuickBoard — never redirects, but carries a decoy external link',
    url: site(HOSTS.board, 'quick-board', '?job=plain'),
    config: 'quick-board',
    expect: 'quick-apply marker wins: fills in place and never follows the sidebar decoy',
  },
  {
    id: 'quick-nolink',
    flow: 'quick-apply',
    title: 'QuickBoard — plain posting, nothing external on the page',
    url: site(HOSTS.board, 'quick-board', '?job=nolink'),
    config: 'quick-board',
    expect: 'verdict is "unknown" and it falls through to the ordinary fill path',
  },
  {
    id: 'mixed-quick',
    flow: 'quick-apply',
    title: 'MixedBoard — the quick-apply posting on a board that also hands off',
    url: site(HOSTS.board, 'redirect-board', '?job=quick'),
    config: 'redirect-board',
    expect: 'fills in place — the same site as mixed-external, classified per posting',
  },

  /* ---------------- Two-step ---------------- */
  {
    id: 'mixed-external',
    flow: 'two-step',
    title: 'MixedBoard — the hand-off posting on the same board',
    url: site(HOSTS.board, 'redirect-board', '?job=external'),
    config: 'redirect-board',
    expect: 'clicks "Save job", hands off to the employer ATS, links both URLs',
  },
  {
    id: 'mixed-blank',
    flow: 'two-step',
    title: 'MixedBoard — bare "Apply now" opening in a new tab',
    url: site(HOSTS.board, 'redirect-board', '?job=blank'),
    config: 'redirect-board',
    expect: 'heuristic follows it on target=_blank + cross-origin alone, without an "external" label',
  },
  {
    id: 'mixed-tracked',
    flow: 'two-step',
    title: 'MixedBoard — handoff through a tracker chain',
    url: site(HOSTS.board, 'redirect-board', '?job=tracked'),
    config: 'redirect-board',
    expect: '302 → interstitial hop → ATS; the FINAL url is what gets recorded',
  },
  {
    id: 'external-link',
    flow: 'two-step',
    title: 'ExternalBoard — every posting hands off (configured apply link)',
    url: site(HOSTS.board, 'external-board', '?job=link'),
    config: 'external-board',
    expect: 'applySelector override + beforeFollow "Save job", then hands off',
  },
  {
    id: 'external-js',
    flow: 'two-step',
    title: 'ExternalBoard — apply is a JS button with no href',
    url: site(HOSTS.board, 'external-board', '?job=js'),
    config: 'external-board',
    expect: 'the page clicks its own button, the tab IT opens is adopted and tracked',
  },
  {
    id: 'external-marker',
    flow: 'two-step',
    title: 'ExternalBoard — only a badge says the posting is external',
    url: site(HOSTS.board, 'external-board', '?job=marker'),
    config: 'external-board',
    expect: 'markerSelector classifies it even though the link reads "Continue"',
  },
  {
    id: 'external-nav',
    flow: 'two-step',
    title: 'ExternalBoard — hands off to the navigation-submit ATS',
    url: site(HOSTS.board, 'external-board', '?job=nav'),
    config: 'external-board',
    expect: 'lands on ats-nav.html on a third origin, which gets a config created for it',
  },

  /* ---------------- Ambiguity ---------------- */
  {
    id: 'listing',
    flow: 'ambiguity',
    title: 'ListingBoard — three postings, three different apply links',
    url: site(HOSTS.board, 'listing-board'),
    config: 'listing-board',
    expect: 'verdict is ambiguous → stays put; nothing is followed and no tab opens',
  },

  /* ---------------- Destinations ---------------- */
  {
    id: 'ats-form',
    flow: 'destination',
    title: 'AcmeATS — the employer form a handoff lands on',
    url: ATS_URL,
    expect: 'no config until a handoff creates one; then the heuristics fill it',
  },
  {
    id: 'ats-nav',
    flow: 'destination',
    title: 'NavATS — submits by full-page navigation',
    url: ATS_NAV_URL,
    expect: 'no successSelector, so the submit event is the "sent" signal',
  },
  {
    id: 'hop',
    flow: 'destination',
    title: 'The interstitial hop, on its own',
    url: HOP_URL,
    expect: 'shows "Redirecting…" then location.replace()s to the ATS after 700ms',
  },

  /* ---------------- Submit detection ---------------- */
  {
    id: 'hidden-success',
    flow: 'submit-detection',
    title: 'HiddenSuccess — the confirmation exists before it is true',
    url: site(HOSTS.board, 'hidden-success'),
    config: 'hidden-success',
    expect: 'Send alone must NOT count as applied; only revealing the banner does',
  },

  /* ---------------- Session ---------------- */
  {
    id: 'queue-seed',
    flow: 'session',
    title: 'Queue seed — 12 quick-apply postings, one per line',
    url: `${HOSTS.board}/queue-seed.txt`,
    expect: 'paste into Options → Queue → Import to drive a real session',
  },
];

/** How many postings `/queue-seed.txt` serves. */
export const QUEUE_SEED_SIZE = 12;

/** The seeded session URLs — distinct postings of the site that never hands off. */
export function queueSeedUrls() {
  return Array.from(
    { length: QUEUE_SEED_SIZE },
    (_, i) => site(HOSTS.board, 'quick-board', `?job=plain&n=${i + 1}`),
  );
}

/** Look a scenario URL up by id. Throws rather than returning undefined: a typo'd id is a bug. */
export function urlFor(id) {
  const found = SCENARIOS.find((s) => s.id === id);
  if (!found) throw new Error(`unknown scenario: ${id}`);
  return found.url;
}

/** Scenarios of one flow, in catalog order. */
export function byFlow(flow) {
  return SCENARIOS.filter((s) => s.flow === flow);
}
