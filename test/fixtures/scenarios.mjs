/**
 * The fixture scenario catalog — one entry per *addressable* test scenario, not
 * per file. A board serves several postings from one HTML page, so the posting,
 * not the page, is what gets a URL here.
 *
 * Plain ESM with no imports so `e2e/server.mjs` can load it under bare node; the
 * Playwright spec imports the same file, so no URL is written down twice.
 *
 * `expect` is the one-line outcome a human should see — it is what the generated
 * index page shows next to each link, and what the E2E spec asserts.
 *
 * Nothing here has a site config: there are none any more. Every page is filled by
 * the same engine, on the strength of what its inputs ask.
 */

/**
 * Three origins on one server. A lesson is global, so the second origin is what
 * proves it: a question taught on the board fills on the employer's ATS.
 */
export const HOSTS = {
  /** The job board the user browses. */
  board: 'http://localhost:5199',
  /** The employer's own ATS — a different site to the extension. */
  employer: 'http://127.0.0.1:5199',
  /** A third origin, for anything that needs one more. */
  tracker: 'http://127.0.0.1:5200',
};

/** Flow groups, in the order the index page and the printed summary show them. */
export const FLOWS = [
  { id: 'fill', title: 'Filling — every input that is recognised, as it appears' },
  { id: 'teach', title: 'Teaching — questions the extension does not know yet' },
  { id: 'safety', title: 'Left alone — forms that are none of its business' },
  { id: 'session', title: 'Queue session' },
];

const site = (host, file, query = '') => `${host}/sites/${file}.html${query}`;

export const ATS_URL = site(HOSTS.employer, 'ats-form');

export const SCENARIOS = [
  /* ---------------- Filling ---------------- */
  {
    id: 'slow-boards',
    flow: 'fill',
    title: 'SlowBoards — form injected ~2s after load',
    url: site(HOSTS.board, 'slow-boards'),
    expect: 'every field is filled as the form appears, CV attached',
  },
  {
    id: 'modal-lever',
    flow: 'fill',
    title: 'ModalLever — the form exists only once "Apply" is pressed, no ids',
    url: site(HOSTS.board, 'modal-lever'),
    expect: 'press Apply: the fields are filled as the modal opens; press "Add résumé": the CV goes in',
  },
  {
    id: 'cv-confirm',
    flow: 'fill',
    title: 'DialogATS — the CV upload lives in a dialog',
    url: site(HOSTS.board, 'cv-confirm'),
    expect: 'fills the form and drops the CV in the dialog; nothing is sent',
  },
  {
    id: 'chaos-form',
    flow: 'fill',
    title: 'ChaosForm — hashed ids, multi-step, one disguised field, one guessed',
    url: site(HOSTS.board, 'chaos-form'),
    expect: '"Where are you located?" is listed to teach; the placeholder-only phone is to check',
  },
  {
    id: 'quick-plain',
    flow: 'fill',
    title: 'QuickBoard — a plain posting',
    url: site(HOSTS.board, 'quick-board', '?job=plain'),
    expect: 'fills in place; never follows the sidebar link',
  },
  {
    id: 'quick-uploads',
    flow: 'fill',
    title: 'QuickBoard — the cover letter is an upload, not a textarea',
    url: site(HOSTS.board, 'quick-board', '?job=uploads'),
    expect: 'each upload takes its own document: the CV to "Résumé", the cover letter to "Cover letter"',
  },
  {
    id: 'ats-form',
    flow: 'fill',
    title: 'AcmeATS — an employer form on another origin',
    url: ATS_URL,
    expect: 'filled by the same engine, and by any lesson taught on the board',
  },

  /* ---------------- Teaching ---------------- */
  {
    id: 'questions',
    flow: 'teach',
    title: 'QuestionBoard — questions outside the built-in fields',
    url: site(HOSTS.board, 'questions'),
    expect: 'your own fields answer the years and the visa radio; "Name" taught under Reference 1 never fills Reference 2',
  },

  /* ---------------- Left alone ---------------- */
  {
    id: 'login',
    flow: 'safety',
    title: 'SomeShop — a login form, a search box, a card number',
    url: site(HOSTS.board, 'login'),
    expect: 'nothing is filled, and no card or pill appears',
  },

  /* ---------------- Session ---------------- */
  {
    id: 'queue-seed',
    flow: 'session',
    title: 'Queue seed — 12 postings, one per line',
    url: `${HOSTS.board}/queue-seed.txt`,
    expect: 'paste into Options → Queue → Import to drive a real session',
  },
];

/** How many postings `/queue-seed.txt` serves. */
export const QUEUE_SEED_SIZE = 12;

/** The seeded session URLs — distinct postings of one plain board. */
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
