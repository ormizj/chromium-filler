/**
 * End-to-end: load the real built extension into Chromium and run it against the
 * three hard fixture sites. If these pass, the fill/prep/wait/CV/close pipeline
 * works against genuinely nasty markup — the confidence signal for real sites.
 *
 * Prereq: `npm run build` (loads dist/). Extensions require a persistent context.
 */
import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import type { JobUrlEntry } from '../src/shared/types';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(DIR, '../dist');
const CONFIGS = path.resolve(DIR, '../test/fixtures/test-site-configs.json');
const BASE = 'http://localhost:5199';
/** Same fixture server, different host — a genuinely cross-origin ATS destination. */
const ALT = 'http://127.0.0.1:5199';
const HEADED = process.env.PW_HEADED === '1';

const PROFILE = {
  values: {
    firstName: 'Ada', lastName: 'Lovelace', fullName: 'Ada Lovelace',
    email: 'ada@example.com', phone: '+1 555 123 4567', city: 'London',
    coverLetter: 'I love building widgets.',
  },
  custom: {},
};

let context: BrowserContext;
let extId: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  if (!fs.existsSync(path.join(DIST, 'manifest.json'))) {
    test.skip(true, 'Build first: `npm run build`');
  }

  // Extensions need the full Chrome-for-Testing binary (the headless *shell*
  // cannot load them). `channel: 'chromium'` selects it and supports extensions
  // in new-headless mode.
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

  // Seed profile / configs / settings (+ a CV via the real options file input).
  const opts = await context.newPage();
  await opts.goto(`chrome-extension://${extId}/src/options/options.html`);
  const siteConfigs = JSON.parse(fs.readFileSync(CONFIGS, 'utf8'));
  await opts.evaluate(
    async ({ profile, configs }) => {
      await chrome.storage.local.set({
        profile,
        siteConfigs: configs,
        settings: {
          autoRunOnLoad: true, autoFillLowConfidence: false,
          closeTabOnSubmit: true, closeTabDelayMs: 200,
          redirectTarget: 'newTabCloseSource',
        },
      });
    },
    { profile: PROFILE, configs: siteConfigs },
  );
  await opts.setInputFiles('#cv-input', {
    name: 'cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test cv'),
  });
  await opts.waitForTimeout(400);
  await opts.close();
});

test.afterAll(async () => {
  await context?.close();
});

/* ---------------- Extension-storage helpers ---------------- */

/** Run something on an extension page, where the `chrome.*` APIs are available. */
async function onExtensionPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/src/options/options.html`);
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

test('SlowBoards: fills the late-injected form + attaches CV', async () => {
  const page = await context.newPage();
  await page.goto(`${BASE}/sites/slow-boards.html`);

  await expect(page.locator('#first_name')).toHaveValue('Ada');
  await expect(page.locator('#last_name')).toHaveValue('Lovelace');
  await expect(page.locator('#email')).toHaveValue('ada@example.com');
  await expect(page.locator('#phone')).toHaveValue('+1 555 123 4567');
  const cvCount = await page.locator('#resume-file').evaluate((el) => (el as HTMLInputElement).files?.length ?? 0);
  expect(cvCount).toBe(1);

  // Review modal is present (pierced shadow DOM) and shows the title.
  await expect(page.locator('.cf-title')).toContainText('Staff Platform Engineer');
  await page.close();
});

test('ModalLever: opens modal (prep), fills accessible-name fields, attaches injected CV', async () => {
  const page = await context.newPage();
  await page.goto(`${BASE}/sites/modal-lever.html`);

  await expect(page.getByLabel('Full name')).toHaveValue('Ada Lovelace');
  await expect(page.getByLabel('Email address')).toHaveValue('ada@example.com');
  const cvCount = await page.locator('#resume-hidden').evaluate((el) => (el as HTMLInputElement).files?.length ?? 0);
  expect(cvCount).toBe(1);
  await page.close();
});

test('ChaosForm: hashed ids + multi-step; disguised city stays unmatched', async () => {
  const page = await context.newPage();
  await page.goto(`${BASE}/sites/chaos-form.html`);

  await expect(page.getByLabel('Given name')).toHaveValue('Ada');
  await expect(page.getByLabel('Family name')).toHaveValue('Lovelace');
  await expect(page.getByLabel('Email address')).toHaveValue('ada@example.com');
  await expect(page.getByLabel('Cover letter')).toHaveValue('I love building widgets.');
  const cvCount = await page.getByLabel('Attach CV').evaluate((el) => (el as HTMLInputElement).files?.length ?? 0);
  expect(cvCount).toBe(1);

  // The disguised city field is NOT auto-filled, and the modal flags it red.
  await expect(page.getByLabel('Where are you located?')).toHaveValue('');
  await expect(page.locator('.cf-dot.none').first()).toBeVisible();
  await page.close();
});

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

test('Auto-close: tab closes once the success selector appears', async () => {
  const page = await context.newPage();
  await page.goto(`${BASE}/sites/slow-boards.html`);
  await expect(page.locator('#first_name')).toHaveValue('Ada');

  const closed = page.waitForEvent('close', { timeout: 10_000 });
  await page.locator('#submit').click({ force: true }); // reveals #app-success -> detected -> close
  await closed;
});

/* ---------------- Two-step (redirect) postings ---------------- */

test('MixedBoard: external posting saves on the board, hands off, and links both URLs', async () => {
  test.setTimeout(90_000);
  // Keep the posting tab open so its "Save job" state can be asserted, and let
  // the ATS tab survive its own submit.
  await patchSettings({ redirectTarget: 'newTab', closeTabOnSubmit: false });

  const boardUrl = `${BASE}/sites/redirect-board.html?job=external`;
  const atsUrl = `${ALT}/sites/ats-form.html`;

  const board = await context.newPage();
  const opened = context.waitForEvent('page', { timeout: 30_000 });
  await board.goto(boardUrl);

  // The board's own bookkeeping ran before leaving.
  await expect(board.locator('#save-job')).toHaveAttribute('data-saved', '1');

  const dest = await opened;
  await dest.waitForLoadState();
  expect(dest.url()).toBe(atsUrl);

  // The ATS had no site config: one is created on landing, then it fills.
  await expect(dest.locator('#ats-first')).toHaveValue('Ada', { timeout: 30_000 });
  await expect(dest.locator('#ats-email')).toHaveValue('ada@example.com');
  const cvCount = await dest.locator('#ats-resume').evaluate((el) => (el as HTMLInputElement).files?.length ?? 0);
  expect(cvCount).toBe(1);
  await expect(dest.locator('.cf-site')).toContainText('via localhost:5199');

  // Both ends are in the database, pointing at each other.
  const source = await waitForJobUrl(boardUrl, (e) => e.status === 'redirected');
  expect(source.redirectUrl).toBe(atsUrl);
  const landed = await waitForJobUrl(atsUrl, (e) => !!e.sourceUrl);
  expect(landed.sourceUrl).toBe(boardUrl);
  expect(landed.status).toBe('opened');

  // Submitting on the ATS marks the application AND the posting it came from.
  await dest.locator('#ats-submit').click();
  await waitForJobUrl(atsUrl, (e) => e.status === 'applied');
  await waitForJobUrl(boardUrl, (e) => e.status === 'applied');

  await dest.close();
  await board.close();
});

test('MixedBoard: the posting tab closes once the handoff lands (default setting)', async () => {
  test.setTimeout(60_000);
  await patchSettings({ redirectTarget: 'newTabCloseSource' });

  const board = await context.newPage();
  const opened = context.waitForEvent('page', { timeout: 30_000 });
  const closed = board.waitForEvent('close', { timeout: 30_000 });
  await board.goto(`${BASE}/sites/redirect-board.html?job=external&posting=2`);

  const dest = await opened;
  await dest.waitForLoadState();
  await closed;
  await dest.close();
});

test('MixedBoard: the quick-apply posting on the same site still fills in place', async () => {
  const board = await context.newPage();
  // Armed after our own tab exists, so only a handoff would register here.
  let newTabs = 0;
  const countTab = () => { newTabs++; };
  context.on('page', countTab);

  await board.goto(`${BASE}/sites/redirect-board.html?job=quick`);

  await expect(board.locator('#first_name')).toHaveValue('Ada');
  await expect(board.locator('#email')).toHaveValue('ada@example.com');
  expect(newTabs, 'a quick-apply posting must not hand off anywhere').toBe(0);

  context.off('page', countTab);
  await board.close();
});
