/**
 * End-to-end: load the real built extension into Chromium and run it against the
 * fixture scenarios. If these pass, the fill engine works on genuinely nasty
 * markup — late forms, modal forms, hashed ids — teaching carries across sites,
 * nothing is ever filled where it must not be, and the queue knows its tabs.
 *
 * There are no site configs: every page is filled by the same engine. URLs come
 * from `test/fixtures/scenarios.mjs` (via `urlFor`), the same catalog the fixture
 * server prints and indexes.
 *
 * Prereq: `npm run build` (loads dist/). Extensions require a persistent context.
 */
import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import type { JobUrlEntry } from '../src/shared/types';
import { MSG } from '../src/shared/messages';
import { ACTION_LABELS } from '../src/shared/labels';
import { HOSTS, queueSeedUrls, urlFor } from '../test/fixtures/scenarios.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(DIR, '../dist');
const HEADED = process.env.PW_HEADED === '1';

const PROFILE = {
  values: {
    firstName: 'Ada', lastName: 'Lovelace', fullName: 'Ada Lovelace',
    email: 'ada@example.com', phone: '+1 555 123 4567', city: 'London',
    coverLetter: 'I love building widgets.',
  },
  keywords: {},
  customFields: [
    { id: 'c_years', label: 'Years of experience', kind: 'text', value: '7', keywords: [] },
    { id: 'c_visa', label: 'Visa sponsorship', kind: 'yesNo', value: 'No', keywords: [] },
  ],
};

let context: BrowserContext;
let extId: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  // Loudly, not `test.skip`: a run with no `dist/` must not report success.
  if (!fs.existsSync(path.join(DIST, 'manifest.json'))) {
    throw new Error(
      `No built extension at ${DIST}. Run \`npm run build\` before \`npm run test:e2e\`.`,
    );
  }

  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: !HEADED,
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
    ],
  });

  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  extId = new URL(sw.url()).host;

  // Seed profile / settings (+ a CV via the real options file input).
  const opts = await context.newPage();
  await opts.goto(`chrome-extension://${extId}/src/options/options.html`);
  await opts.waitForFunction(() => document.body.dataset.ready === '1');
  await opts.evaluate(async ({ profile }) => {
    await chrome.storage.local.set({ profile, lessons: [], settings: {} });
  }, { profile: PROFILE });
  await opts.setInputFiles('#cv-input', {
    name: 'cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test cv'),
  });
  await opts.setInputFiles('#cover-input', {
    name: 'cover.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test cover'),
  });
  await opts.waitForTimeout(400);
  await opts.close();
});

test.afterAll(async () => {
  await context?.close();
});

/* ---------------- Extension-storage helpers ---------------- */

/**
 * Run something on an extension page, where the `chrome.*` APIs are available.
 *
 * Waits for the options page to finish booting first. `load` fires while `main`
 * is still awaiting its reads — so a helper that writes storage the instant the
 * page loads can be overtaken by a render of the state from before it ran.
 */
async function onExtensionPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/src/options/options.html`);
  await page.waitForFunction(() => document.body.dataset.ready === '1');
  try {
    return await fn(page);
  } finally {
    await page.close();
  }
}

async function readJobUrls(): Promise<JobUrlEntry[]> {
  return onExtensionPage((page) => page.evaluate(
    async () => ((await chrome.storage.local.get('jobUrls')).jobUrls ?? []) as JobUrlEntry[],
  ));
}

/** What the database says about one URL, or nothing if it has never heard of it. */
async function statusOf(url: string): Promise<string | undefined> {
  return (await readJobUrls()).find((e) => e.url === url)?.status;
}

async function patchSettings(patch: Record<string, unknown>): Promise<void> {
  await onExtensionPage((page) => page.evaluate(async (p) => {
    const current = (await chrome.storage.local.get('settings')).settings ?? {};
    await chrome.storage.local.set({ settings: { ...current, ...p } });
  }, patch));
}

/** Poll the job-URL database until `check` passes (the link is written async). */
async function waitForJobUrl(
  url: string,
  check: (entry: JobUrlEntry) => boolean,
  timeoutMs = 20_000,
): Promise<JobUrlEntry> {
  const deadline = Date.now() + timeoutMs;
  let last: JobUrlEntry | undefined;
  while (Date.now() < deadline) {
    last = (await readJobUrls()).find((e) => e.url === url);
    if (last && check(last)) return last;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`job URL never matched: ${url} (last seen: ${JSON.stringify(last)})`);
}

/**
 * Open the review card. Off the queue it starts folded to its pill — it only
 * appears at all because something was filled — so a test that reads the card
 * presses the pill first, the way a user does.
 */
async function openCard(page: Page): Promise<void> {
  const card = page.locator('.cf-card');
  if (await card.count()) return;
  await page.locator('.cf-pill').click({ timeout: 20_000 });
  await expect(card).toBeVisible();
}

/** The report row whose question is `question`. */
function row(page: Page, question: string | RegExp) {
  return page.locator('.cf-report .cf-row', { has: page.locator('.cf-field b', { hasText: question }) });
}

/** Teach a row from the card: open its chooser, pick `choice`, Save. */
async function teach(page: Page, question: string | RegExp, choice: string): Promise<void> {
  await openCard(page);
  const r = row(page, question);
  await r.getByRole('button', { name: /^(Teach|Not this)$/ }).click();
  await page.locator('.cf-teach select').selectOption(choice);
  await page.locator('.cf-teach').getByRole('button', { name: ACTION_LABELS.save }).click();
}

async function setLessons(lessons: unknown[]): Promise<void> {
  await onExtensionPage((p) => p.evaluate(async (l) => { await chrome.storage.local.set({ lessons: l }); }, lessons));
}

async function readLessons(): Promise<Array<{ label: string; target: unknown; signature: Record<string, unknown> }>> {
  return onExtensionPage((p) => p.evaluate(async () => (await chrome.storage.local.get('lessons')).lessons ?? []));
}

const filesIn = (page: Page, sel: string) => page.locator(sel).evaluate(
  (el) => [...((el as HTMLInputElement).files ?? [])].map((f) => f.name),
);

/* ---------------- Filling ---------------- */

test('SlowBoards: fills the late-injected form + attaches CV, with no config at all', async () => {
  const page = await context.newPage();
  await page.goto(urlFor('slow-boards'));

  await expect(page.locator('#first_name')).toHaveValue('Ada', { timeout: 20_000 });
  await expect(page.locator('#last_name')).toHaveValue('Lovelace');
  await expect(page.locator('#email')).toHaveValue('ada@example.com');
  await expect(page.locator('#phone')).toHaveValue('+1 555 123 4567');
  expect(await filesIn(page, '#resume-file')).toEqual(['cv.pdf']);

  await page.close();
});

test('ModalLever: fields that appear only after "Apply" are filled as they appear', async () => {
  const page = await context.newPage();
  await page.goto(urlFor('modal-lever'));
  // Nothing to fill yet: the form does not exist until the button is pressed.
  await page.waitForTimeout(800);
  await expect(page.locator('#modal-form')).toHaveCount(0);

  await page.click('#apply-btn');
  await expect(page.getByLabel('Full name')).toHaveValue('Ada Lovelace', { timeout: 10_000 });
  await expect(page.getByLabel('Email address')).toHaveValue('ada@example.com');

  // And a second wave: the upload is injected by its own button.
  await page.click('#add-resume');
  await expect.poll(() => filesIn(page, '#resume-hidden'), { timeout: 10_000 }).toEqual(['cv.pdf']);
  await page.close();
});

/**
 * The cover letter is two things, and the page decides which. Most sites give
 * you a box to type into; some want a document. Both are held in the profile,
 * and neither is any use on the site that asks for the other.
 *
 * Two uploads side by side is the case that matters: the CV's "fall back to the
 * first file input" is what makes an unlabelled upload work at all, and it must
 * not reach across and take a control the page has clearly named.
 */
test('QuickBoard: a cover-letter upload takes the cover letter, not the CV', async () => {
  const page = await context.newPage();
  try {
    await page.goto(urlFor('quick-uploads'));
    await expect(page.locator('#email')).toHaveValue('ada@example.com');

    const attached = (sel: string) => page.locator(sel).evaluate(
      (el) => [...((el as HTMLInputElement).files ?? [])].map((f) => f.name),
    );
    expect(await attached('#resume-file')).toEqual(['cv.pdf']);
    expect(await attached('#cover')).toEqual(['cover.pdf']);
  } finally {
    await page.close();
  }
});

test('ChaosForm: hashed ids are no obstacle; the disguised city is listed to teach', async () => {
  const page = await context.newPage();
  await page.goto(urlFor('chaos-form'));

  await expect(page.getByLabel('Given name')).toHaveValue('Ada', { timeout: 20_000 });
  await expect(page.getByLabel('Family name')).toHaveValue('Lovelace');
  await expect(page.getByLabel('Email address')).toHaveValue('ada@example.com');
  // Step 2 is only shown once "Next" is pressed — a class flip, not new markup —
  // and its fields are filled as it appears.
  await page.click('#next-btn');
  await expect(page.getByLabel('Cover letter')).toHaveValue('I love building widgets.', { timeout: 10_000 });
  expect((await filesIn(page, 'input[type=file]')).length).toBe(1);

  await expect(page.getByLabel('Where are you located?')).toHaveValue('');
  await openCard(page);
  const city = row(page, 'Where are you located?');
  await expect(city.locator('.cf-dot.none')).toBeVisible();
  await expect(city.getByRole('button', { name: ACTION_LABELS.teach })).toBeVisible();

  // Taught once, it fills in place — and the row does not move.
  const before = await page.locator('.cf-report .cf-row .cf-field b').allTextContents();
  await teach(page, 'Where are you located?', 'city');
  await expect(page.getByLabel('Where are you located?')).toHaveValue('London');
  await expect(city.getByRole('button', { name: ACTION_LABELS.taught })).toBeVisible();
  expect(await page.locator('.cf-report .cf-row .cf-field b').allTextContents()).toEqual(before);

  const lessons = await readLessons();
  expect(lessons.map((l) => l.label)).toContain('Where are you located?');
  await setLessons([]);
  await page.close();
});

test('ChaosForm: Confirm fills a guess in place, without moving any row', async () => {
  const page = await context.newPage();
  await page.goto(urlFor('chaos-form'));
  await expect(page.getByLabel('Email address')).toHaveValue('ada@example.com', { timeout: 20_000 });
  const phone = page.locator('input[placeholder="Phone"]');
  await expect(phone).toHaveValue('');

  await openCard(page);
  const order = () => page.locator('.cf-report .cf-row .cf-field b').allTextContents();
  const before = await order();
  const r = row(page, 'Phone');
  await r.getByRole('button', { name: ACTION_LABELS.confirm, exact: true }).click();
  await expect(phone).toHaveValue('+1 555 123 4567');
  await expect(r.getByRole('button', { name: ACTION_LABELS.confirmed })).toBeVisible();
  expect(await order()).toEqual(before);
  await page.close();
});

/* ---------------- Teaching ---------------- */

test('Questions: your own fields answer a box, and a yes/no radio group', async () => {
  const page = await context.newPage();
  await page.goto(urlFor('questions'));
  await expect(page.locator('#q-years')).toHaveValue('7', { timeout: 20_000 });
  await expect(page.locator('#visa-no')).toBeChecked();
  await expect(page.locator('#q-given')).toHaveValue('Ada');
  await page.close();
});

test('Questions: a lesson taught on one site fills the same question on another', async () => {
  await setLessons([]);
  const board = await context.newPage();
  await board.goto(urlFor('questions'));
  await expect(board.locator('#q-email')).toHaveValue('ada@example.com', { timeout: 20_000 });
  await expect(board.locator('#q-preferred')).toHaveValue('');
  await teach(board, 'Preferred name', 'firstName');
  await expect(board.locator('#q-preferred')).toHaveValue('Ada');
  await board.close();

  // The same page from a different origin: a different site to the extension.
  const ats = await context.newPage();
  await ats.goto(`${HOSTS.employer}/sites/questions.html`);
  await expect(ats.locator('#q-preferred')).toHaveValue('Ada', { timeout: 20_000 });
  await ats.close();
  await setLessons([]);
});

test('Questions: "Name" taught under Reference 1 never fills Reference 2', async () => {
  await setLessons([]);
  const page = await context.newPage();
  await page.goto(urlFor('questions'));
  // A bare "Name" reads as your full name, so the first one is filled with it —
  // and here that is wrong: it is a referee's name.
  await expect(page.locator('#ref1-name')).toHaveValue('Ada Lovelace', { timeout: 20_000 });

  await openCard(page);
  const filledName = page.locator('.cf-report .cf-row', { has: page.locator('.cf-field b', { hasText: /^Name$/ }) })
    .filter({ has: page.getByRole('button', { name: ACTION_LABELS.notThis }) });
  await filledName.getByRole('button', { name: ACTION_LABELS.notThis }).click();
  await page.locator('.cf-teach select').selectOption('__new');
  const [label, value] = [page.locator('.cf-teach input').nth(0), page.locator('.cf-teach input').nth(1)];
  await label.fill('Referee name');
  await value.fill('Grace Hopper');
  await page.locator('.cf-teach').getByRole('button', { name: ACTION_LABELS.save }).click();

  await expect(page.locator('#ref1-name')).toHaveValue('Grace Hopper');
  await expect(page.locator('#ref2-name')).not.toHaveValue('Grace Hopper');
  const lessons = await readLessons();
  expect(lessons.at(-1)!.signature.section).toBe('reference 1');
  await page.close();

  // On the next visit the lesson still names only its own box.
  const again = await context.newPage();
  await again.goto(urlFor('questions'));
  await expect(again.locator('#ref1-name')).toHaveValue('Grace Hopper', { timeout: 20_000 });
  await again.waitForTimeout(500);
  await expect(again.locator('#ref2-name')).not.toHaveValue('Grace Hopper');
  await again.close();

  // Put the profile and the lessons back.
  await setLessons([]);
  await onExtensionPage((p) => p.evaluate(async () => {
    const { profile } = await chrome.storage.local.get('profile');
    profile.customFields = profile.customFields.filter((f: { label: string }) => f.label !== 'Referee name');
    await chrome.storage.local.set({ profile });
  }));
});

test('Questions: a box you typed in is never written over, even by a new lesson', async () => {
  await setLessons([]);
  const page = await context.newPage();
  await page.goto(urlFor('questions'));
  await expect(page.locator('#q-email')).toHaveValue('ada@example.com', { timeout: 20_000 });
  await page.locator('#q-preferred').fill('Countess');

  // A lesson for that question arrives — as if taught on another tab.
  await setLessons([{
    id: 'l1', signature: { question: 'preferred name', kind: 'text' }, target: { field: 'firstName' },
    label: 'Preferred name', createdAt: Date.now(), hits: 0,
  }]);
  await page.waitForTimeout(800);
  await expect(page.locator('#q-preferred')).toHaveValue('Countess');
  await page.close();
  await setLessons([]);
});

/* ---------------- Left alone ---------------- */

test('Login: a login form, a search box and a card number are never touched', async () => {
  const page = await context.newPage();
  await page.goto(urlFor('login'));
  await page.waitForTimeout(1500);
  for (const sel of ['#s-q', '#l-email', '#l-pass', '#cc']) await expect(page.locator(sel)).toHaveValue('');
  // Nothing filled, so nothing is put on the page either.
  await expect(page.locator('.cf-pill')).toHaveCount(0);
  await expect(page.locator('.cf-card')).toHaveCount(0);
  await page.close();
});

/* ---------------- Popup ---------------- */

test('Popup: opens at a usable width (no vw sliver) and renders cleanly', async () => {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));

  // Mimic the toolbar popup's constrained initial layout viewport: a vw-based
  // width collapses the panel to a blank sliver here (the original bug).
  await page.setViewportSize({ width: 40, height: 300 });
  await page.goto(`chrome-extension://${extId}/src/popup/popup.html`);
  await expect(page.locator('.wrap')).toBeVisible();

  const box = await page.locator('.wrap').boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(300); // regression guard for the sliver
  await expect(page.locator('#primary')).toBeVisible();
  expect(errors).toEqual([]);
  await page.close();
});

test('Popup: Teach, Queue and Options share one row, and Queue opens the importer', async () => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 360, height: 600 });
  await page.goto(`chrome-extension://${extId}/src/popup/popup.html`);
  await expect(page.locator('.links')).toBeVisible();

  const tops: number[] = [];
  for (const id of ['#teach', '#open-queue', '#open-options']) {
    const box = await page.locator(id).boundingBox();
    expect(box, id).not.toBeNull();
    tops.push(Math.round(box!.y));
  }
  expect(new Set(tops).size, 'the row wrapped into a column').toBe(1);

  const importer = context.waitForEvent('page');
  await page.locator('#open-queue').click();
  const importPage = await importer;
  await importPage.waitForLoadState();
  await expect(importPage.locator('#tab-queue')).toHaveAttribute('aria-selected', 'true');
  await expect(importPage.locator('#urls-paste')).toBeFocused();
  await expect(importPage.locator('#import-section')).toBeInViewport();
  await importPage.close();
  await page.close();
});

/* ---------------- Queue ---------------- */

test('Session: the queue marks its tabs, and closing one finishes it and opens the next', async () => {
  test.setTimeout(120_000);
  const BATCH = 2;
  const urls = queueSeedUrls();
  await onExtensionPage((page) => page.evaluate(async (list) => {
    const now = Date.now();
    await chrome.storage.local.set({
      jobUrls: list.map((url, i) => ({
        id: `seed-${i}`, url, status: 'new', addedAt: now, updatedAt: now,
        history: [{ status: 'new', at: now }],
      })),
    });
  }, urls));

  const jobTabs = (): Page[] => context.pages().filter((p) => p.url().includes('quick-board.html?job=plain&n='));
  const waitFor = async (predicate: () => boolean, what: string, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`timed out waiting for ${what}`);
  };

  try {
    await onExtensionPage((page) => page.evaluate(
      ([type, batchSize]) => chrome.runtime.sendMessage({ type, batchSize }),
      [MSG.SESSION_START, BATCH] as [string, number],
    ));
    await waitFor(() => jobTabs().length === BATCH, `${BATCH} job tabs`);

    // A queue tab carries the chip, and the card folded to its pill — it opens
    // by itself only with "Open the review when a page is filled" on.
    const first = jobTabs()[0];
    await first.waitForLoadState();
    await expect(first.locator('#chromium-filler-queue-chip .cf-qchip')).toContainText('Queue', { timeout: 20_000 });
    await expect(first.locator('#email')).toHaveValue('ada@example.com');
    await expect(first.locator('.cf-pill')).toBeVisible({ timeout: 20_000 });
    await expect(first.locator('.cf-card')).toHaveCount(0);

    // Closing it finishes the posting and opens the next.
    const closedUrl = first.url();
    await first.close();
    await waitFor(() => jobTabs().length === BATCH && !jobTabs().some((p) => p.url() === closedUrl), 'a replacement posting');
    await waitForJobUrl(closedUrl, (e) => e.status === 'done');
  } finally {
    await onExtensionPage((page) => page.evaluate(
      (type) => chrome.runtime.sendMessage({ type }), MSG.SESSION_STOP as string,
    ));
    await Promise.all(jobTabs().map((p) => p.close()));
  }

  // A page the queue did not open has no chip.
  const plain = await context.newPage();
  await plain.goto(urlFor('quick-uploads'));
  await expect(plain.locator('#email')).toHaveValue('ada@example.com', { timeout: 20_000 });
  await expect(plain.locator('#chromium-filler-queue-chip')).toHaveCount(0);
  await plain.close();
});

/* ---------------- Getting-started checklist ---------------- */

test('Options: a checklist “Go →” lands on the section it names, not just its tab', async () => {
  // Switching tab is not an answer on its own: the CV upload is the second
  // section of the Profile tab, and both queue steps point at the tab the
  // checklist is already on — those two used to be visible no-ops. The sticky
  // topbar is the other half of it, so the assertion is not "in the viewport"
  // but "below the bar", which is the part a bare scrollIntoView gets wrong.
  const KEYS = ['profile', 'cv', 'jobUrls', 'gettingStartedDismissed'];
  const saved = await onExtensionPage((p) => p.evaluate(
    (keys) => chrome.storage.local.get(keys), KEYS,
  ));

  const page = await context.newPage();
  try {
    // A first-run store: every step undone, so every Go button renders.
    await onExtensionPage((p) => p.evaluate(async (keys) => {
      await chrome.storage.local.remove(keys);
    }, KEYS));

    await page.setViewportSize({ width: 1100, height: 720 });
    await page.goto(`chrome-extension://${extId}/src/options/options.html`);
    await expect(page.locator('#start-steps .startstep')).toHaveCount(5);

    /** Distance from the bottom of the sticky topbar to the top of `id`. */
    const gapUnderBar = (id: string) => page.evaluate((target) => {
      const bar = document.querySelector('.topbar')!.getBoundingClientRect();
      return document.getElementById(target)!.getBoundingClientRect().top - bar.bottom;
    }, id);

    const go = (step: number) => page.locator(`#start-steps li:nth-child(${step}) .startstep-go`);

    // Step 2 — a different tab, and the second section on it.
    await go(2).click();
    await expect(page.locator('#tab-profile')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#cv-section')).toBeInViewport();
    expect(await gapUnderBar('cv-section'), 'not behind the topbar').toBeGreaterThanOrEqual(0);
    await expect(page.locator('#cv-input')).toBeFocused();

    // Step 3 — same tab. The scroll is the entire effect, so assert it moved.
    await page.locator('#tab-queue').click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await go(3).click();
    await expect(page.locator('#urls-paste')).toBeFocused();
    await expect(page.locator('#tab-queue')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#import-section')).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY), 'the page moved').toBeGreaterThan(0);
  } finally {
    await page.close();
    await onExtensionPage((p) => p.evaluate(async ({ keys, prev }) => {
      await chrome.storage.local.remove(keys);
      await chrome.storage.local.set(prev);
    }, { keys: KEYS, prev: saved }));
  }
});

/* ---------------- Settings rows ---------------- */

test('Options: a settings row keeps its disclosure inside the card', async () => {
  // `.setrow.stacked` turns the row's flex axis vertical but every length in it
  // was written for a row: with `flex-wrap: wrap` still on, `.setrow-help`'s
  // `flex-basis: 100%` — of the card's *height*, in a column — could not fit
  // beside its siblings and wrapped into a second **column**, so the explanation
  // left the card entirely and hung off its right-hand edge over the page.
  //
  // jsdom evaluates neither the cascade nor layout, so nothing but a real browser
  // can see this. Both columns of the settings grid are checked.
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`chrome-extension://${extId}/src/options/options.html`);
    await page.waitForFunction(() => document.body.dataset.ready === '1');
    await page.locator('#tab-settings').click();

    for (const id of ['open-card-filled', 'keep-in-browser']) {
      const row = page.locator(`#${id}`).locator('xpath=ancestor::*[contains(@class,"setrow")][1]');
      await row.locator('.cf-help-btn').click();
      const panel = row.locator('.cf-help');
      await expect(panel).toBeVisible();

      const [outer, inner] = await Promise.all([row.boundingBox(), panel.boundingBox()]);
      expect(inner!.x, `${id}: the panel starts inside its row`)
        .toBeGreaterThanOrEqual(outer!.x - 1);
      expect(inner!.x + inner!.width, `${id}: and ends inside it`)
        .toBeLessThanOrEqual(outer!.x + outer!.width + 1);
      expect(inner!.y + inner!.height, `${id}: the row grew to hold it`)
        .toBeLessThanOrEqual(outer!.y + outer!.height + 1);
    }
  } finally {
    await page.close();
  }
});

test('Options: a switch sits on its title line, not below it', async () => {
  // The caption used to live *inside* the row's text block, which made that block
  // two lines tall — and `align-items: center` then centred the control against
  // both of them, so every toggle on this page rode half a line below the title
  // it belongs to. The caption is a line of the row now. Geometry, so this is
  // only visible here.
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`chrome-extension://${extId}/src/options/options.html`);
    await page.waitForFunction(() => document.body.dataset.ready === '1');
    await page.locator('#tab-settings').click();

    const row = page.locator('#fill-auto').locator('xpath=ancestor::*[contains(@class,"setrow")][1]');
    await expect(row.locator('.setrow-caption')).toBeVisible();
    const [title, control] = await Promise.all([
      row.locator('.setrow-text').boundingBox(),
      row.locator('.switch').boundingBox(),
    ]);
    const centre = (b: { y: number; height: number }) => b.y + b.height / 2;
    expect(Math.abs(centre(control!) - centre(title!)), 'switch centred on the title')
      .toBeLessThanOrEqual(2);
  } finally {
    await page.close();
  }
});

/* ---------------- Review-modal layout simulator ---------------- */

test('Options: resizing the window leaves the configured layout and its ratios alone', async () => {
  // The simulator's frame is a scale model of the user's screen, and the card is a
  // fraction of it. Neither is a fact about the options window — so dragging that
  // window to a new size must move nothing. It used to write the clamped layout
  // back on every repaint, so one short window permanently shrank a card that had
  // been configured on a big screen.
  const chosen = { right: 24, bottom: 32, width: 520, height: 700 };
  await patchSettings({ modalLayout: chosen });

  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`chrome-extension://${extId}/src/options/options.html`);
    await page.locator('#tab-settings').click();
    // A visible card is not a measured frame. `paint` runs at the initial
    // `scale = 1`, so the card carries a full-size inline box — and passes
    // `toBeVisible()` — while `measure` has still not given the frame a height:
    // it bails on a hidden panel, and the ResizeObserver that re-runs it lands a
    // frame after the tab is shown. Sampling the baseline in that gap reads `#sim`
    // as its two border pixels, i.e. a "ratio" of 640/2, which every later
    // measurement then fails to match.
    await expect
      .poll(() => page.evaluate(() => document.getElementById('sim')!.getBoundingClientRect().height))
      .toBeGreaterThan(100);

    const shape = () => page.evaluate(() => {
      const f = document.getElementById('sim')!.getBoundingClientRect();
      const c = document.getElementById('sim-card')!.getBoundingClientRect();
      return {
        frame: f.width / f.height,
        cardW: c.width / f.width,
        cardH: c.height / f.height,
      };
    });
    const before = await shape();

    for (const [w, h] of [[1100, 900], [820, 620], [1600, 1000], [1440, 900]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(250);
      const now = await shape();
      // 3 decimal places would be asking the browser for sub-pixel identity; 2 is
      // still far tighter than the swings this test was written for.
      expect(now.frame, `frame ratio at ${w}×${h}`).toBeCloseTo(before.frame, 2);
      expect(now.cardW, `card width fraction at ${w}×${h}`).toBeCloseTo(before.cardW, 2);
      expect(now.cardH, `card height fraction at ${w}×${h}`).toBeCloseTo(before.cardH, 2);
    }

    const stored = await page.evaluate(
      async () => (await chrome.storage.local.get('settings')).settings?.modalLayout,
    );
    expect(stored, 'a resize is not a decision, so nothing may be saved').toEqual(chosen);
  } finally {
    await page.close();
  }
});

test('Modal: dragging the card on a posting moves it for that page only', async () => {
  // The simulator in Options is the only thing that sets the default. Nudging the
  // card aside to read the field underneath it is a one-off gesture, and while it
  // wrote storage it silently redefined where the modal opened on every posting
  // afterwards. It must still stay where it was dropped, though, including across
  // a controller re-render — a card that snaps back reads as a bug.
  const chosen = { right: 40, bottom: 40, width: 420, height: 520 };
  await patchSettings({ modalLayout: chosen });

  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(urlFor('quick-plain'));
    const card = page.locator('.cf-card');
    await openCard(page);

    const box = async () => (await card.boundingBox())!;
    const before = await box();

    // Press the site name: it is part of the header (the drag handle), and
    // `onDown` ignores the close button and the view toggle sharing that row. The
    // grip is not an option — it is display:none above 640px.
    const site = (await page.locator('.cf-site').boundingBox())!;
    await page.mouse.move(site.x + site.width / 2, site.y + site.height / 2);
    await page.mouse.down();
    // Several moves, not one: the drag is driven by `pointermove`.
    await page.mouse.move(site.x - 200, site.y - 100, { steps: 10 });
    await page.mouse.up();

    const dragged = await box();
    expect(dragged.x, 'the card follows the pointer').toBeLessThan(before.x - 150);
    expect(dragged.y).toBeLessThan(before.y - 50);

    // Re-run rebuilds `ModalData` in the controller — the path that used to read
    // the stored default back and throw the drag away.
    await page.getByRole('button', { name: ACTION_LABELS.fillAgain }).click();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(500);

    const after = await box();
    expect(after.x, 'a re-render must not snap the card back').toBeCloseTo(dragged.x, 0);
    expect(after.y).toBeCloseTo(dragged.y, 0);

    const stored = await onExtensionPage((p) => p.evaluate(
      async () => (await chrome.storage.local.get('settings')).settings?.modalLayout,
    ));
    expect(stored, 'only the Options simulator may write the default').toEqual(chosen);
  } finally {
    await page.close();
  }
});

test('Modal: the footer is Fill again and Teach, and no overflow menu', async () => {
  const page = await context.newPage();
  try {
    await page.goto(urlFor('quick-plain'));
    await openCard(page);
    await expect(page.locator('.cf-footer-actions > button')).toHaveText(['Fill again', 'Teach']);
    await expect(page.locator('.cf-more')).toHaveCount(0);
    await expect(page.locator('.cf-fullscreen')).toHaveCount(0);
    await expect(page.locator('.cf-view')).toHaveCount(0);

    // Fill again is the footer's main action: three quarters of the row, Teach the
    // last quarter. Layout, so only a browser can measure it.
    const [fill, teach] = await Promise.all(
      ['Fill again', 'Teach'].map(async (name) =>
        (await page.locator('.cf-footer-actions > button', { hasText: name }).boundingBox())!.width),
    );
    expect(fill / teach, 'Fill again is three times Teach').toBeCloseTo(3, 0);
  } finally {
    await page.close();
  }
});

/**
 * "Open the review when a page is filled": off, a filled page gets the pill; on,
 * the card opens by itself — once, so a × afterwards is respected.
 */
test('Modal: the card opens by itself on a filled page only when asked to', async () => {
  const page = await context.newPage();
  try {
    await page.goto(urlFor('quick-plain'));
    await expect(page.locator('#email')).toHaveValue('ada@example.com', { timeout: 20_000 });
    await expect(page.locator('.cf-pill')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.cf-card')).toHaveCount(0);
  } finally {
    await page.close();
  }

  await patchSettings({ openCardWhenFilled: true });
  const opened = await context.newPage();
  try {
    await opened.goto(urlFor('quick-plain'));
    await expect(opened.locator('.cf-card')).toBeVisible({ timeout: 20_000 });
    await expect(opened.locator('.cf-report')).toContainText('Email');
    await opened.locator('.cf-close').click();
    await expect(opened.locator('.cf-pill')).toBeVisible();
    await opened.locator('.cf-footer-actions').waitFor({ state: 'detached' });
  } finally {
    await patchSettings({ openCardWhenFilled: false });
    await opened.close();
  }
});

/**
 * Pointing at a field: a click selects, clicking the same spot again goes one
 * level in, and Confirm opens the card on that input's Teach chooser.
 */
test('Modal: pointing at a field selects, steps in, and opens its chooser', async () => {
  const page = await context.newPage();
  try {
    await page.goto(urlFor('quick-plain'));
    await openCard(page);
    await page.locator('.cf-footer-actions').getByRole('button', { name: 'Teach', exact: true }).click();

    const bar = page.locator('[data-cf-picker="bar"]');
    const readout = page.locator('[data-cf-picker="readout"]');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('field to teach');

    await page.click('#email');
    await expect(bar).toBeVisible();
    await expect(readout).toHaveText('form#application-form');
    await page.click('#email');
    await expect(readout).toHaveText('input#email');

    await bar.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(bar).toHaveCount(0);
    await expect(page.locator('.cf-teach select')).toHaveValue('email');
  } finally {
    await page.close();
  }
});

test('Options: the `?` is a circle on a mouse, not a 28×44 pill', async () => {
  // `options.css` styles every `button` on the page as a secondary button,
  // `min-height: var(--tap)` included — and `min-height` beats `height`, so
  // `.cf-help-btn`'s 28×28 came out **28×44**: a tall rounded rectangle wherever
  // the disc paints (hover, and while its panel is open).
  //
  // Nothing could catch it but a browser at a fine pointer. jsdom evaluates
  // neither the cascade nor `@media (pointer: coarse)`, the shadow surfaces have
  // no bare `button` rule so they were always correct, and on a coarse pointer the
  // button grows to 44×44 and is square again — so the mobile pass was clean too.
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto(`chrome-extension://${extId}/src/options/options.html#settings`);
    const help = page.locator('#panel-settings .cf-help-btn');
    await expect(help.first()).toBeVisible({ timeout: 20_000 });

    for (let i = 0; i < await help.count(); i++) {
      const box = (await help.nth(i).boundingBox())!;
      expect(box.height, `help button ${i} is square`).toBeCloseTo(box.width, 0);
    }
  } finally {
    await page.close();
  }
});

test('Modal: the header\'s close button is one tap tall', async () => {
  // `--tap` on every pointer, like every other button — the header's icon button
  // kept the pre-reskin 26px on a mouse once. Layout, so only a browser sees it.
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(urlFor('quick-plain'));
    await openCard(page);
    const box = (await page.locator('.cf-close').boundingBox())!;
    expect(box.height, '.cf-close is one tap tall').toBeGreaterThanOrEqual(44);
  } finally {
    await page.close();
  }
});

/** Press an anchor-download button and read the blob instead of writing a file. */
async function downloadedText(page: Page, buttonId: string): Promise<string> {
  return page.evaluate(async (id) => {
    let blob: Blob | null = null;
    const realCreate = URL.createObjectURL;
    const realClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (b: Blob | MediaSource) => { blob = b as Blob; return realCreate.call(URL, b); };
    HTMLAnchorElement.prototype.click = function () { /* don't actually download */ };
    try {
      document.getElementById(id)!.click();
      await new Promise((r) => setTimeout(r, 500));
      return blob ? await (blob as Blob).text() : '';
    } finally {
      URL.createObjectURL = realCreate;
      HTMLAnchorElement.prototype.click = realClick;
    }
  }, buttonId);
}

/** Replace the job database outright. */
async function seedJobUrls(entries: JobUrlEntry[]): Promise<void> {
  await onExtensionPage((page) => page.evaluate(
    async (list) => { await chrome.storage.local.set({ jobUrls: list }); },
    entries,
  ));
}

function jobEntry(url: string, over: Partial<JobUrlEntry> = {}): JobUrlEntry {
  const at = Date.now();
  return {
    id: url, url, status: 'new', addedAt: at, updatedAt: at,
    history: [{ status: 'new', at }], ...over,
  };
}

test('Sync: the redirect URI is this browser\'s, and Connect waits for a client', async () => {
  await onExtensionPage(async (page) => {
    await page.click('#tab-sync');

    // Derived from the extension ID, so it cannot be printed in the help text —
    // which is exactly why the field exists.
    await expect(page.locator('#sync-redirect-uri')).toHaveValue(
      new RegExp(`^https://${extId}\\.chromiumapp\\.org/?$`),
    );

    // Nothing to authorize against yet, and the account line says where to go
    // rather than letting Connect fail at Google.
    await expect(page.locator('#sync-connect')).toBeDisabled();
    await expect(page.locator('#sync-account')).toContainText('OAuth client');
    // Never connected, so neither of these can do anything.
    await expect(page.locator('#sync-now')).toBeDisabled();
    await expect(page.locator('#sync-disconnect')).toBeDisabled();
  });
});

test('Sync: the setup guide is Help\'s last section, and carries this browser\'s redirect URI', async () => {
  await onExtensionPage(async (page) => {
    await page.click('#tab-sync');
    await page.click('#sync-guide-open');

    // The Sync tab hands over to Help rather than carrying a second copy.
    await expect(page.locator('#panel-help')).toBeVisible();
    await expect(page.locator('#sync-guide-section')).toBeInViewport();
    const last = await page.locator('#panel-help > section').last().getAttribute('id');
    expect(last).toBe('sync-guide-section');

    // The one value the user carries to Google: the same string the Sync tab
    // shows, inside the step that tells them which box it goes in.
    const uri = await page.locator('#sync-redirect-uri').inputValue();
    await expect(page.locator('#sync-guide-uri')).toHaveValue(uri);

    // Every step that happens on a Google page opens that page, in a new tab.
    const links = page.locator('#sync-guide-steps a.guide-link');
    expect(await links.count()).toBeGreaterThan(0);
    for (const href of await links.evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href))) {
      expect(href).toMatch(/^https:\/\/console\.cloud\.google\.com\//);
    }
    await expect(links.first()).toHaveAttribute('target', '_blank');

    await expect(page.locator('#sync-guide-trouble')).toContainText('request is invalid');
  });
});

test('Sync: saving a client enables Connect, and clearing the id takes the secret with it', async () => {
  await onExtensionPage(async (page) => {
    await page.click('#tab-sync');

    await page.fill('#sync-client-id', 'not-a-client');
    await page.fill('#sync-client-secret', 'GOCSPX-secret');
    await page.click('#sync-client-save');
    // Checked here rather than at Google, where every one of these comes back
    // as an indistinguishable `invalid_client`.
    await expect(page.locator('#sync-client-status')).toContainText('client ID');
    await expect(page.locator('#sync-connect')).toBeDisabled();

    await page.fill('#sync-client-id', '1234.apps.googleusercontent.com');
    await page.fill('#sync-client-secret', 'GOCSPX-secret');
    await page.click('#sync-client-save');
    await expect(page.locator('#sync-client-status')).toContainText('Press Connect');
    await expect(page.locator('#sync-connect')).toBeEnabled();

    // The secret is write-only: it never comes back into the field, so a
    // screen-share does not carry it.
    await expect(page.locator('#sync-client-secret')).toHaveValue('');
    await expect(page.locator('#sync-client-secret')).toHaveAttribute('placeholder', /Stored/);

    const stored = await page.evaluate(async () =>
      (await chrome.storage.local.get('syncClient')).syncClient);
    expect(stored).toMatchObject({ clientId: '1234.apps.googleusercontent.com' });

    // Emptying the id is how the credential comes off this machine — leaving the
    // secret behind would read as a configured-but-broken client.
    await page.fill('#sync-client-id', '');
    await page.click('#sync-client-save');
    await expect(page.locator('#sync-client-status')).toContainText('removed');
    expect(await page.evaluate(async () =>
      (await chrome.storage.local.get('syncClient')).syncClient)).toBeUndefined();
  });
});

test('Sync: a backup file carries everything that syncs, and combines rather than replacing', async () => {
  const KEYS = [
    'jobUrls', 'profile', 'lessons', 'settings', 'cv',
    'profileStamps', 'lessonStamps', 'settingsStamps', 'docStamps',
  ];
  const saved = await onExtensionPage((p) => p.evaluate((keys) => chrome.storage.local.get(keys), KEYS));
  const lesson = {
    id: 'l-backup', signature: { question: 'notice period', kind: 'text' }, target: { field: 'c_notice' },
    label: 'Notice period', createdAt: Date.now(), hits: 2,
  };
  const field = { id: 'c_notice', label: 'Notice period', kind: 'text', value: '1 month', keywords: [] };
  const layoutA = { right: 40, bottom: 40, width: 500, height: 600 };
  const layoutB = { right: 16, bottom: 16, width: 420, height: 520 };

  try {
    await seedJobUrls([jobEntry('https://backup.example/1')]);
    await onExtensionPage((page) => page.evaluate(async ([f, l, layout]) => {
      const settings = (await chrome.storage.local.get('settings')).settings ?? {};
      await chrome.storage.local.set({
        profile: { values: { email: 'backup@example.com' }, keywords: {}, customFields: [f] },
        lessons: [l],
        settings: { ...settings, sessionBatchSize: 6, modalLayout: layout },
        cv: { name: 'cv.pdf', type: 'application/pdf', dataBase64: 'JVBERi0=' },
      });
    }, [field, lesson, layoutA] as const));

    const text = await onExtensionPage(async (page) => {
      await page.click('#tab-sync');
      return downloadedText(page, 'sync-export');
    });
    const snapshot = JSON.parse(text);
    expect(snapshot.jobUrls.map((e: JobUrlEntry) => e.url)).toEqual(['https://backup.example/1']);

    // A wiped browser with a different posting and its own card layout.
    await seedJobUrls([jobEntry('https://backup.example/2')]);
    await onExtensionPage((page) => page.evaluate(async (layout) => {
      const settings = (await chrome.storage.local.get('settings')).settings ?? {};
      // Stamps too: a fresh browser has never dated anything.
      await chrome.storage.local.remove(['profile', 'lessons', 'cv', 'profileStamps', 'lessonStamps', 'docStamps']);
      await chrome.storage.local.set({ settings: { ...settings, sessionBatchSize: 2, modalLayout: layout } });
    }, layoutB));

    await onExtensionPage(async (page) => {
      await page.click('#tab-sync');
      await page.setInputFiles('#sync-import-input', {
        name: 'job-filler-backup-test.json', mimeType: 'application/json', buffer: Buffer.from(text),
      });
      // The page reloads to show what arrived, carrying its status line across.
      await expect(page.locator('#sync-file-status')).toContainText('Combined', { timeout: 10_000 });
    });

    const after = await onExtensionPage((p) => p.evaluate((keys) => chrome.storage.local.get(keys), KEYS));
    // Combined, not replaced: both postings.
    expect((after.jobUrls as JobUrlEntry[]).map((e) => e.url).sort())
      .toEqual(['https://backup.example/1', 'https://backup.example/2']);
    expect(after.profile.values.email).toBe('backup@example.com');
    expect(after.profile.customFields).toEqual([field]);
    expect(after.lessons).toEqual([lesson]);
    expect(after.cv.name).toBe('cv.pdf');
    expect(after.settings.sessionBatchSize).toBe(6);
    // Measured against one screen, so it never travels.
    expect(after.settings.modalLayout).toEqual(layoutB);
  } finally {
    await onExtensionPage((p) => p.evaluate(async ([keys, prev]) => {
      await chrome.storage.local.remove(keys as string[]);
      await chrome.storage.local.set(prev as Record<string, unknown>);
    }, [KEYS, saved] as const));
  }
});

test('Sync: the tab lists what syncs and what stays on this browser', async () => {
  await onExtensionPage(async (page) => {
    await page.click('#tab-sync');
    const synced = page.locator('#sync-scope-synced');
    const local = page.locator('#sync-scope-local');
    // Folded until asked, and folds again.
    await expect(synced).toBeHidden();
    await page.click('#sync-scope-heading');
    await expect(page.locator('#sync-scope-synced-title')).toHaveText('Synced between your browsers');
    await expect(page.locator('#sync-scope-local-title')).toHaveText('Stays on this browser');
    await expect(synced).toBeVisible();
    await expect(local).toBeVisible();
    for (const text of ['Your job list', 'Your details', 'Your own fields', 'What it has learned', 'Your CV']) {
      await expect(synced).toContainText(text);
    }
    await expect(synced).toContainText('Fill automatically');
    await expect(local).toContainText('Where the card sits');
    await expect(local).toContainText('OAuth client');
    await expect(synced).not.toContainText('Where the card sits');
    await page.click('#sync-scope-heading');
    await expect(synced).toBeHidden();
  });
});

test('Sync: turning the switch off hides the Google controls, not the list or the backup', async () => {
  await onExtensionPage(async (page) => {
    await page.click('#tab-sync');
    await expect(page.locator('#sync-now')).toBeVisible();
    await expect(page.locator('#sync-client-id')).toBeVisible();

    await page.locator('#sync-enabled + .switch-track').click();
    await expect(page.locator('#sync-enabled')).not.toBeChecked();
    for (const id of ['#sync-account', '#sync-connect', '#sync-now', '#sync-disconnect', '#sync-client-heading', '#sync-client-id']) {
      await expect(page.locator(id), id).toBeHidden();
    }
    await expect(page.locator('#sync-scope-heading')).toBeVisible();
    await expect(page.locator('#sync-export')).toBeVisible();

    // A reload reads the stored switch, and back on brings it all back.
    await page.reload();
    await page.click('#tab-sync');
    await expect(page.locator('#sync-now')).toBeHidden();
    await page.locator('#sync-enabled + .switch-track').click();
    await expect(page.locator('#sync-now')).toBeVisible();
    await expect(page.locator('#sync-client-id')).toBeVisible();
  });
});

test('Sync: an unreadable backup is refused without touching the database', async () => {
  await seedJobUrls([jobEntry('https://keep.example/1')]);

  await onExtensionPage(async (page) => {
    await page.click('#tab-sync');
    await page.setInputFiles('#sync-import-input', {
      name: 'holiday-photo.json', mimeType: 'application/json', buffer: Buffer.from('not json at all'),
    });
    await expect(page.locator('#sync-file-status')).toContainText('not a backup from this extension');
  });

  // Refusing is the safe failure: merging is all-or-nothing.
  expect((await readJobUrls()).map((e) => e.url)).toEqual(['https://keep.example/1']);
});

test('Options: the importer extracts URLs from a mess, and counts what it already had', async () => {
  await seedJobUrls([jobEntry('https://board.example/jobs/1')]);

  await onExtensionPage(async (page) => {
    await page.click('#tab-queue');
    await page.fill('#urls-paste', [
      'Have a look at https://board.example/jobs/1 today',
      'and https://board.example/jobs/2 — plus https://board.example/jobs/2 again',
      'nothing here',
    ].join('\n'));
    await page.click('#extract-urls');

    // Deduped on the way in; the URL is the unique key.
    await expect(page.locator('#urls-preview')).toContainText('2 URL(s) found');
    await page.click('#urls-preview button');

    // One was already in the queue, and saying so is the difference between
    // "nothing happened" and "nothing needed to happen".
    await expect(page.locator('#extract-status')).toContainText('Added 1 new URL(s)');
    await expect(page.locator('#extract-status')).toContainText('1 already in the queue');
  });

  expect((await readJobUrls()).map((e) => e.url).sort()).toEqual([
    'https://board.example/jobs/1', 'https://board.example/jobs/2',
  ]);
});

test('Options: nothing link-shaped in the box says so, rather than adding nothing', async () => {
  await onExtensionPage(async (page) => {
    await page.click('#tab-queue');
    await page.fill('#urls-paste', 'just some prose with no links in it');
    await page.click('#extract-urls');
    await expect(page.locator('#extract-status')).toContainText('No URLs found');
  });
});

test('Options: the queue filters and searches, and Remove can be undone', async () => {
  await seedJobUrls([
    jobEntry('https://alpha.example/jobs/1'),
    jobEntry('https://beta.example/jobs/2', { status: 'done' }),
  ]);

  await onExtensionPage(async (page) => {
    await page.click('#tab-queue');
    await expect(page.locator('#urls-list li')).toHaveCount(2);

    // Filter chips carry their own counts, so the filter is legible before it
    // is pressed.
    await page.click('#url-filters button:has-text("Done")');
    await expect(page.locator('#urls-list li')).toHaveCount(1);
    await expect(page.locator('#urls-list')).toContainText('beta.example');

    await page.click('#url-filters button:has-text("All")');
    await page.fill('#url-search', 'alpha');
    await expect(page.locator('#urls-list li')).toHaveCount(1);
    await expect(page.locator('#urls-list')).toContainText('alpha.example');
    await page.fill('#url-search', '');

    await page.click('#urls-list li:has-text("alpha.example") button:has-text("Remove")');
    await expect(page.locator('#urls-list li')).toHaveCount(1);

    // The undo is a real re-instatement, not a re-add: the entry keeps its history.
    await page.click('#toast-action');
    await expect(page.locator('#urls-list li')).toHaveCount(2);
  });
});

test('Options: Clear all confirms, then tombstones rather than emptying the list', async () => {
  await seedJobUrls([
    jobEntry('https://gone.example/jobs/1'),
    jobEntry('https://gone.example/jobs/2'),
  ]);

  await onExtensionPage(async (page) => {
    await page.click('#tab-queue');
    await page.click('#clear-urls');
    // Named count — this one is not undoable.
    await expect(page.locator('#clear-confirm-label')).toContainText('2');

    await page.click('#clear-cancel');
    await expect(page.locator('#urls-list li')).toHaveCount(2);

    await page.click('#clear-urls');
    await page.click('#clear-really');
    // Cleared, not filtered — the tombstones left behind must not make the queue
    // claim a filter is hiding them.
    await expect(page.locator('#urls-list li.empty')).toContainText('No postings yet');
    await expect(page.locator('#urls-list li:not(.empty)')).toHaveCount(0);
  });

  // A splice would come straight back on the next sync — a union can only grow.
  const raw = await readJobUrls();
  expect(raw).toHaveLength(2);
  expect(raw.every((e) => e.status === 'deleted')).toBe(true);
});

test('Options: the profile saves, and only the fields it owns', async () => {
  await onExtensionPage(async (page) => {
    await page.click('#tab-profile');
    await page.fill('#profile-fields [data-field="city"]', 'Edinburgh');
    await expect(page.locator('#profile-savebar')).toBeVisible();
    await page.click('#save-profile');
    await expect(page.locator('#profile-status')).toContainText('Saved');

    const profile = await page.evaluate(async () =>
      (await chrome.storage.local.get('profile')).profile as { values: Record<string, string> });
    expect(profile.values.city).toBe('Edinburgh');
    // The rest of the profile is still there.
    expect(profile.values.email).toBe('ada@example.com');
  });

  // Put it back for anything that follows.
  await onExtensionPage((page) => page.evaluate(async () => {
    const { profile } = await chrome.storage.local.get('profile');
    profile.values.city = 'London';
    await chrome.storage.local.set({ profile });
  }));
});

test('Options: a field of your own is added, answered, and worded', async () => {
  await onExtensionPage(async (page) => {
    await page.click('#tab-profile');
    const before = await page.locator('.custom-card').count();
    await page.click('#custom-add');
    const card = page.locator('.custom-card').nth(before);
    await card.locator('.custom-name').fill('Notice period');
    await card.locator('.custom-name').press('Tab');
    await card.locator('.custom-value').fill('1 month');
    await card.locator('.custom-value').press('Tab');
    await card.locator('.chipedit-input').fill('availability');
    await card.locator('.chipedit-input').press('Enter');
    await expect(card.locator('.chipedit-chip')).toHaveText(['availability×']);

    const stored = await page.evaluate(async () => (await chrome.storage.local.get('profile')).profile.customFields);
    const field = stored.find((f: { label: string }) => f.label === 'Notice period');
    expect(field).toMatchObject({ value: '1 month', keywords: ['availability'] });

    // Put it back.
    await page.evaluate(async (count) => {
      const { profile } = await chrome.storage.local.get('profile');
      profile.customFields = profile.customFields.slice(0, count);
      await chrome.storage.local.set({ profile });
    }, before);
  });
});

test('Options: what it has learned is listed by field, and can be forgotten', async () => {
  await setLessons([{
    id: 'l1', signature: { question: 'given name', kind: 'text' }, target: { field: 'firstName' },
    label: 'Given name', taughtOn: 'jobs.example', createdAt: Date.now(), hits: 3,
  }]);
  await onExtensionPage(async (page) => {
    await page.click('#tab-profile');
    const group = page.locator('.learned-group', { hasText: 'First name' });
    await expect(group.locator('.learned-q')).toHaveText('“Given name”');
    await expect(group).toContainText('used 3 times');
    await group.getByRole('button', { name: /Forget/ }).click();
    await expect(page.locator('.learned-group')).toHaveCount(0);
    await expect(page.locator('#learned-empty')).toBeVisible();
  });
  expect(await readLessons()).toEqual([]);
});

