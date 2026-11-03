/**
 * Chrome Web Store screenshots — 1280x800 PNGs, generated, never hand-taken.
 *
 * The store rejects a listing with no screenshot, and hand-taken ones drift from
 * the UI the moment a surface changes. This drives the *built* extension in a
 * real Chromium against the same fixture sites the E2E suite uses, so what the
 * listing shows is what the code does.
 *
 *   npm run build && npm run screenshots
 *
 * Output: design/store/screenshot-*.png. The store wants exactly 1280x800 (or
 * 640x400), PNG or JPEG, 24-bit and no alpha — `omitBackground` is therefore
 * left off, and the viewport is the frame.
 */
import { chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'design/store');

const SIZE = { width: 1280, height: 800 };

const PROFILE = {
  values: {
    firstName: 'Ada', lastName: 'Lovelace', fullName: 'Ada Lovelace',
    email: 'ada@example.com', phone: '+1 555 123 4567', city: 'London',
    coverLetter: 'I have shipped platform tooling for eight years, most recently the build system behind a 400-engineer monorepo.',
  },
  keywords: {},
  customFields: [
    { id: 'c_years', label: 'Years of experience', kind: 'text', value: '8', keywords: ['experience in years'] },
    { id: 'c_visa', label: 'Visa sponsorship', kind: 'yesNo', value: 'No', keywords: ['right to work'] },
  ],
};

/** Postings for the Queue tab, so the stat cards and the list are not empty. */
const now = Date.now();
const day = 86_400_000;
// slow-boards and questions are deliberately NOT `done`: they are the postings
// the card screenshots are taken on, and a done posting leads with that record.
const JOB_URLS = [
  ['http://localhost:5199/sites/slow-boards.html', 'new', 0],
  ['http://localhost:5199/sites/cv-confirm.html', 'done', 3],
  ['http://localhost:5199/sites/chaos-form.html', 'done', 2],
  ['http://localhost:5199/sites/modal-lever.html', 'done', 2],
  ['http://localhost:5199/sites/quick-board.html?job=uploads', 'done', 1],
  ['http://localhost:5199/sites/questions.html', 'new', 1],
  ['http://localhost:5199/sites/ats-form.html', 'new', 0],
  ['http://localhost:5199/sites/quick-board.html?job=plain', 'new', 0],
  ['http://localhost:5199/sites/embedded.html', 'new', 0],
].map(([url, status, ago]) => ({
  url,
  status,
  addedAt: now - (ago + 1) * day,
  history: [
    { status: 'new', at: now - (ago + 1) * day },
    ...(status === 'new' ? [] : [{ status, at: now - ago * day }]),
  ],
}));

/** Options → Profile → Answers you've typed, as a few weeks of applying leave it. */
const TYPED_ANSWERS = [
  ['Software developer', 'text', 14, ['Current title', 'Job title', 'Position'], 20],
  ['Immediately', 'select', 6, ['When can you start?', 'Notice period'], 12],
  ['Acme Corp', 'text', 3, ['Current employer', 'Most recent company'], 5],
  ['LinkedIn', 'select', 2, ['How did you hear about us?'], 2],
].map(([value, kind, count, questions, ago]) => ({
  key: value.toLowerCase(), value, kind, count, questions,
  firstAt: now - ago * day, lastAt: now - day,
}));

if (!fs.existsSync(path.join(DIST, 'manifest.json'))) {
  throw new Error(`No built extension at ${DIST}. Run \`npm run build\` first.`);
}
fs.mkdirSync(OUT, { recursive: true });

/* ---------------- Fixture server ---------------- */

const server = spawn('node', [path.join(ROOT, 'e2e/server.mjs')], {
  cwd: ROOT,
  env: { ...process.env, PORT: '5199', PORT2: '5200', NO_COLOR: '1' },
  stdio: 'ignore',
});
const stopServer = () => server.kill();
process.on('exit', stopServer);

/** The server binds two ports before it serves anything; poll rather than sleep. */
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch('http://localhost:5199/sites/slow-boards.html');
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('fixture server did not start');
}
await waitForServer();

/* ---------------- Browser ---------------- */

// Extensions need the full Chrome-for-Testing binary; the headless *shell*
// cannot load them. Same launch the E2E suite uses, plus a `CHROME_PATH` escape
// hatch (as `scripts/generate-icons.mjs` has) for environments that already ship
// a Chromium at a version this Playwright would otherwise want to re-download.
const context = await chromium.launchPersistentContext('', {
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: 'chromium' }),
  headless: true,
  viewport: SIZE,
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
});

let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 30_000 });
const extId = new URL(sw.url()).host;

/** Open an extension page and wait for its own ready flag. */
async function extensionPage(file) {
  const page = await context.newPage();
  await page.setViewportSize(SIZE);
  await page.goto(`chrome-extension://${extId}/${file}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1');
  return page;
}

/* ---------------- Seed ---------------- */

const seed = await extensionPage('src/options/options.html');
await seed.evaluate(
  async ({ profile, jobUrls, typedAnswers }) => {
    await chrome.storage.local.set({ profile, jobUrls, lessons: [], typedAnswers });
  },
  { profile: PROFILE, jobUrls: JOB_URLS, typedAnswers: TYPED_ANSWERS },
);
// Through the real file input, so the options page's own encode path runs.
await seed.setInputFiles('#cv-input', {
  name: 'ada-lovelace-cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 cv'),
});
await seed.waitForTimeout(400);
await seed.close();

const shots = [];
async function shot(page, name) {
  const file = path.join(OUT, `screenshot-${name}.png`);
  await page.screenshot({ path: file });
  shots.push(file);
  console.log(`  ${path.relative(ROOT, file)}`);
}

/** Off the queue the card starts folded, so it is opened the way a user opens it. */
async function openCard(page) {
  await page.locator('.cf-pill').click({ timeout: 30_000 });
  await page.locator('.cf-card').waitFor({ state: 'visible', timeout: 30_000 });
}

/* ---------------- 1: the review card on a filled posting ---------------- */

const job = await context.newPage();
await job.setViewportSize(SIZE);
await job.goto('http://localhost:5199/sites/slow-boards.html');
// The fixture injects its form ~2s in; wait for the fill before opening the card.
await job.waitForFunction(() => !!document.querySelector('#email')?.value, null, { timeout: 30_000 });
await openCard(job);
await job.waitForTimeout(1200);
await shot(job, '1-review');
await job.close();

/* ---------------- 2: a question learned from the answer typed ---------------- */

// "Preferred name" is no built-in wording; typing the first name into it and
// leaving the box (the `change` learning listens for) teaches it, as in the E2E.
const learn = await context.newPage();
await learn.setViewportSize(SIZE);
await learn.goto('http://localhost:5199/sites/questions.html');
await learn.locator('.cf-pill').waitFor({ timeout: 30_000 });
await learn.locator('#q-preferred').fill(PROFILE.values.firstName);
await learn.locator('#q-preferred').press('Tab');
await learn.waitForTimeout(800);
await openCard(learn);
await learn.waitForTimeout(800);
await shot(learn, '2-learned');
await learn.close();

/* ---------------- 3-7: the options page ---------------- */

const opts = await extensionPage('src/options/options.html');
await opts.waitForTimeout(600);
await shot(opts, '3-queue');

await opts.locator('#tab-profile').click();
await opts.waitForTimeout(400);
await shot(opts, '4-profile');

await opts.locator('#typed-section').scrollIntoViewIfNeeded();
await opts.waitForTimeout(400);
await shot(opts, '5-typed');

await opts.locator('#custom-section').scrollIntoViewIfNeeded();
await opts.waitForTimeout(400);
await shot(opts, '6-own-fields');

await opts.locator('#tab-help').click();
await opts.waitForTimeout(400);
await shot(opts, '7-help');

await opts.close();

await context.close();
stopServer();

console.log(`\n${shots.length} screenshots in ${path.relative(ROOT, OUT)} (1280x800).`);
