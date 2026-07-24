/**
 * End-to-end: load the real built extension into Chromium and run it against the
 * fixture scenarios. If these pass, the fill/prep/wait/CV/close pipeline and the
 * two-step handoff work against genuinely nasty markup — the confidence signal
 * for real sites.
 *
 * URLs come from `test/fixtures/scenarios.mjs` (via `urlFor`), the same catalog
 * the fixture server prints and indexes, so a scenario cannot exist in one place
 * and not the other.
 *
 * Prereq: `npm run build` (loads dist/). Extensions require a persistent context.
 */
import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import type { JobUrlEntry } from '../src/shared/types';
import { MSG } from '../src/shared/messages';
import { ATS_URL, HOSTS, queueSeedUrls, urlFor } from '../test/fixtures/scenarios.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(DIR, '../dist');
const CONFIGS = path.resolve(DIR, '../test/fixtures/test-site-configs.json');
/** Same fixture server, different host — a genuinely cross-origin ATS destination. */
const ALT = HOSTS.employer;
/** A third origin (second port), so a redirect chain crosses more than one host. */
const TRACKER = HOSTS.tracker;
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

/**
 * Teach the config that matches `url` what this site's confirmation looks like —
 * what the user does with the setup panel's "Confirmation element" row.
 *
 * Auto-created destination configs have no `successSelector`, and nothing is
 * ever recorded as applied without one, so a handoff destination needs this step
 * before it can be finished. Simulated here rather than driven through the
 * picker: the picker has its own coverage, and this is about what happens after.
 */
async function teachConfirmation(url: string, selector: string): Promise<void> {
  await onExtensionPage((page) => page.evaluate(async ({ u, sel }) => {
    const { siteConfigs } = await chrome.storage.local.get('siteConfigs');
    const glob = (p: string) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')}$`).test(u);
    for (const c of siteConfigs) {
      if (c.urlPatterns.some(glob)) c.successSelector = sel;
    }
    await chrome.storage.local.set({ siteConfigs });
  }, { u: url, sel: selector }));
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
  await page.goto(urlFor('slow-boards'));

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
  await page.goto(urlFor('modal-lever'));

  await expect(page.getByLabel('Full name')).toHaveValue('Ada Lovelace');
  await expect(page.getByLabel('Email address')).toHaveValue('ada@example.com');
  const cvCount = await page.locator('#resume-hidden').evaluate((el) => (el as HTMLInputElement).files?.length ?? 0);
  expect(cvCount).toBe(1);
  await page.close();
});

test('ChaosForm: hashed ids + multi-step; disguised city stays unmatched', async () => {
  const page = await context.newPage();
  await page.goto(urlFor('chaos-form'));

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

/**
 * Apply, end to end, on the fixture that makes both of its phases matter. This
 * ATS only records the CV once "Attach" is pressed (`submitCv`), and its form
 * refuses to submit without a recorded CV — so an Apply that pressed Send first,
 * or skipped the confirmation, would produce a form that silently does nothing.
 * Then the site's own confirmation appears, which is what marks it applied.
 */
test('DialogATS: Apply confirms the CV, presses Send, and the posting lands applied', async () => {
  const page = await context.newPage();
  const url = urlFor('cv-confirm');
  await page.goto(url);

  await expect(page.locator('#email')).toHaveValue('ada@example.com');
  const cvCount = await page.locator('#cv-file').evaluate((el) => (el as HTMLInputElement).files?.length ?? 0);
  expect(cvCount).toBe(1);
  // Attached, but the site has not accepted it — nothing on the page says so,
  // which is exactly why Apply runs the confirmation before sending.
  await expect(page.locator('#cv-attached')).toBeHidden();

  const apply = page.locator('.cf-footer button.cf-btn', { hasText: 'Apply' });
  await expect(apply).not.toHaveAttribute('aria-disabled', 'true');
  await apply.click();

  // Phase one: the CV is now genuinely accepted.
  await expect(page.locator('#cv-attached')).toBeVisible();
  await expect(page.locator('#cv-attached')).toContainText('cv.pdf');
  // Phase two: the site's own Send button was pressed, and it went through.
  await expect(page.locator('#dialog-success')).toBeVisible();

  // And the visible confirmation — not the click — is what records the apply.
  const entry = await waitForJobUrl(url, (e) => e.status === 'applied');
  expect(entry.appliedAt).toBeTruthy();

  // Said on screen too. The site's own banner is often below the fold or behind
  // this card, so the modal answering "did that go through?" is the point.
  await expect(page.locator('.cf-applied')).toContainText(/sent/i);
  await expect(page.locator('.cf-footer button.cf-btn', { hasText: 'Applied' })).toBeVisible();
  await page.close();
});

/**
 * Nothing is sent to a site whose outcome cannot be read back. This is the
 * second reason Apply greys out, and it needs its own answer: the user has to
 * teach the site its confirmation, not go hunting for a button.
 */
test('QuickBoard: Apply refuses to send when the site has no confirmation configured', async () => {
  const page = await context.newPage();
  await page.goto(urlFor('quick-plain'));
  await expect(page.locator('.cf-card')).toBeVisible({ timeout: 20_000 });

  // This config has a successSelector, so Apply is live — the control case.
  const apply = page.locator('.cf-footer button.cf-btn', { hasText: 'Apply' });
  await expect(apply).not.toHaveAttribute('aria-disabled', 'true');

  // Take it away and the button must go grey without the page reloading.
  await onExtensionPage((opts) => opts.evaluate(async () => {
    const { siteConfigs } = await chrome.storage.local.get('siteConfigs');
    for (const c of siteConfigs) if (c.id === 'quick-board') delete c.successSelector;
    await chrome.storage.local.set({ siteConfigs });
  }));
  await page.reload();
  await expect(page.locator('.cf-card')).toBeVisible({ timeout: 20_000 });

  await expect(apply).toHaveAttribute('aria-disabled', 'true');
  await apply.click({ force: true });
  await expect(page.locator('.cf-footer .cf-help')).toContainText(/confirmation element/i);

  await onExtensionPage((opts) => opts.evaluate(async () => {
    const { siteConfigs } = await chrome.storage.local.get('siteConfigs');
    for (const c of siteConfigs) if (c.id === 'quick-board') c.successSelector = '#quick-success';
    await chrome.storage.local.set({ siteConfigs });
  }));
  await page.close();
});

/**
 * Apply on a page with nothing that reads as a Send button. It must stay
 * pressable and say why it cannot act: a greyed control that swallows the press
 * is how a user concludes the extension is broken.
 */
test('ListingBoard: the greyed Apply explains itself instead of doing nothing', async () => {
  const page = await context.newPage();
  await page.goto(urlFor('listing'));
  await expect(page.locator('.cf-card')).toBeVisible({ timeout: 20_000 });

  const apply = page.locator('.cf-footer button.cf-btn', { hasText: 'Apply' });
  await expect(apply).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('.cf-footer .cf-help')).toHaveCount(0);

  // `force` because Playwright's actionability check honours `aria-disabled`
  // and refuses the click. That attribute is the truth about the *action* — it
  // cannot run here — while a real press still lands and is answered, which is
  // the whole behaviour under test.
  await apply.click({ force: true });
  const note = page.locator('.cf-footer .cf-help');
  await expect(note).toContainText(/Send button/i);
  // The confirmation IS configured here, so it must not send the user off to
  // fix that instead — the two grey reasons need two different answers.
  await expect(note).not.toContainText(/no confirmation element set/i);
  await page.close();
});

/**
 * Skip outside a queue session. It used not to render at all there, and the
 * status write was a no-op for a URL nobody had imported — so the one decision
 * a user makes most often, on a posting they opened themselves, was recorded
 * nowhere. Both halves are asserted here.
 */
test('QuickBoard: Skip records a posting that was never queued, and closes it', async () => {
  await patchSettings({ closeTabOnSkip: true, closeTabDelayMs: 0 });
  const page = await context.newPage();
  const url = urlFor('quick-plain');
  await page.goto(url);
  await expect(page.locator('.cf-card')).toBeVisible({ timeout: 20_000 });

  // Nothing put this URL in the database: it was opened by hand.
  expect((await readJobUrls()).find((e) => e.url === url)).toBeUndefined();

  const closed = page.waitForEvent('close', { timeout: 20_000 });
  await page.locator('.cf-footer button.cf-btn', { hasText: 'Skip' }).click();

  const entry = await waitForJobUrl(url, (e) => e.status === 'skipped');
  expect(entry.status).toBe('skipped');
  await closed;
});

/** The same press with auto-close off: still recorded, tab left alone. */
test('QuickBoard: Skip leaves the tab open when auto-close is off', async () => {
  await patchSettings({ closeTabOnSkip: false });
  const page = await context.newPage();
  const url = urlFor('quick-nolink');
  await page.goto(url);
  await expect(page.locator('.cf-card')).toBeVisible({ timeout: 20_000 });

  await page.locator('.cf-footer button.cf-btn', { hasText: 'Skip' }).click();
  await waitForJobUrl(url, (e) => e.status === 'skipped');

  // Give the close path every chance to fire before claiming it did not.
  await page.waitForTimeout(2000);
  expect(page.isClosed()).toBe(false);
  await page.close();
  await patchSettings({ closeTabOnSkip: true });
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
  await page.goto(urlFor('slow-boards'));
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

  const boardUrl = urlFor('mixed-external');
  const atsUrl = ATS_URL;

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

  // The auto-created config knows nothing about this ATS's confirmation, and
  // nothing is recorded as applied without one — so teach it, then reload so the
  // watcher arms. This is the setup step a real handoff destination now needs.
  await teachConfirmation(atsUrl, '#ats-success');
  await dest.reload();
  await expect(dest.locator('#ats-first')).toHaveValue('Ada', { timeout: 30_000 });

  // Submitting on the ATS marks the application AND the posting it came from.
  await dest.locator('#ats-submit').click();
  await expect(dest.locator('#ats-success')).toBeVisible();
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
  await board.goto(`${urlFor('mixed-external')}&posting=2`);

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

  await board.goto(urlFor('mixed-quick'));

  await expect(board.locator('#first_name')).toHaveValue('Ada');
  await expect(board.locator('#email')).toHaveValue('ada@example.com');
  expect(newTabs, 'a quick-apply posting must not hand off anywhere').toBe(0);

  context.off('page', countTab);
  await board.close();
});

/** Open a posting and return the tab the handoff lands in. */
async function followHandoff(postingUrl: string): Promise<{ board: Page; dest: Page }> {
  const board = await context.newPage();
  const opened = context.waitForEvent('page', { timeout: 30_000 });
  await board.goto(postingUrl);
  const dest = await opened;
  await dest.waitForLoadState();
  return { board, dest };
}

test('ExternalBoard: the configured apply link is followed even though its label says nothing', async () => {
  test.setTimeout(90_000);
  await patchSettings({ redirectTarget: 'newTab', closeTabOnSubmit: false });

  const boardUrl = urlFor('external-link');
  const { board, dest } = await followHandoff(boardUrl);

  // The verdict came from the config, not the text: "Apply for this role" matches
  // no label pattern, so a heuristic-only run would have stayed and filled.
  await expect(board.locator('.cf-why')).toContainText('configured external apply link');
  await expect(board.locator('#save-job')).toHaveAttribute('data-saved', '1');

  expect(dest.url()).toBe(`${ALT}/sites/ats-form.html?src=link`);
  await expect(dest.locator('#ats-first')).toHaveValue('Ada', { timeout: 30_000 });

  const source = await waitForJobUrl(boardUrl, (e) => e.status === 'redirected');
  expect(source.redirectUrl).toBe(dest.url());

  await dest.close();
  await board.close();
});

test('ExternalBoard: an apply button with no href is clicked, and the tab the PAGE opens is tracked', async () => {
  test.setTimeout(90_000);
  await patchSettings({ redirectTarget: 'newTab', closeTabOnSubmit: false });

  // Nothing to open: the background answers `click`, the posting opens its own
  // tab, and the watch has to be inherited through openerTabId — otherwise the
  // landing is attributed to nothing and the posting is never marked redirected.
  const boardUrl = urlFor('external-js');
  const { board, dest } = await followHandoff(boardUrl);

  expect(dest.url()).toBe(`${ALT}/sites/ats-form.html?src=js`);
  await expect(dest.locator('#ats-email')).toHaveValue('ada@example.com', { timeout: 30_000 });

  const source = await waitForJobUrl(boardUrl, (e) => e.status === 'redirected');
  expect(source.redirectUrl).toBe(dest.url());
  const landed = await waitForJobUrl(dest.url(), (e) => !!e.sourceUrl);
  expect(landed.sourceUrl).toBe(boardUrl);

  await dest.close();
  await board.close();
});

test('MixedBoard: a bare "Apply now" is followed on new-tab + cross-origin alone', async () => {
  test.setTimeout(90_000);
  await patchSettings({ redirectTarget: 'newTab', closeTabOnSubmit: false });

  // No label pattern matches "Apply now" — a board that words its button this
  // plainly is only recognisable by where it goes and how it opens.
  const boardUrl = urlFor('mixed-blank');
  const { board, dest } = await followHandoff(boardUrl);

  await expect(board.locator('.cf-why')).toContainText('Apply now');
  expect(dest.url()).toBe(`${ALT}/sites/ats-form.html?src=blank`);
  await expect(dest.locator('#ats-first')).toHaveValue('Ada', { timeout: 30_000 });
  await waitForJobUrl(boardUrl, (e) => e.redirectUrl === dest.url());

  await dest.close();
  await board.close();
});

test('ExternalBoard: an "External posting" badge classifies a link that reads "Continue"', async () => {
  test.setTimeout(90_000);
  await patchSettings({ redirectTarget: 'newTab', closeTabOnSubmit: false });

  const boardUrl = urlFor('external-marker');
  const { board, dest } = await followHandoff(boardUrl);

  await expect(board.locator('.cf-why')).toContainText('external marker on the page');
  expect(dest.url()).toBe(`${ALT}/sites/ats-form.html?src=marker`);
  await waitForJobUrl(boardUrl, (e) => e.redirectUrl === dest.url());

  await dest.close();
  await board.close();
});

test('MixedBoard: a tracker chain records where it LANDED, not the hop it started with', async () => {
  test.setTimeout(90_000);
  await patchSettings({ redirectTarget: 'newTab', closeTabOnSubmit: false });

  // 302 → interstitial (700ms) → the real form. The settle timer has to restart
  // on every hop, or the tracker URL is what ends up in the database.
  const boardUrl = urlFor('mixed-tracked');
  const finalUrl = `${ALT}/sites/ats-form.html?via=chain`;
  const { board, dest } = await followHandoff(boardUrl);

  await expect(async () => expect(dest.url()).toBe(finalUrl)).toPass({ timeout: 20_000 });
  await expect(dest.locator('#ats-first')).toHaveValue('Ada', { timeout: 30_000 });

  const source = await waitForJobUrl(boardUrl, (e) => e.status === 'redirected');
  expect(source.redirectUrl).toBe(finalUrl);
  expect(source.redirectUrl).not.toContain('/r/302');
  expect(source.redirectUrl).not.toContain('redirect-hop');

  await dest.close();
  await board.close();
});

test('QuickBoard: the decoy "Apply on company website" link is not followed', async () => {
  const page = await context.newPage();
  // Armed after our own tab exists, so only a handoff would register here.
  let newTabs = 0;
  const countTab = () => { newTabs++; };
  context.on('page', countTab);

  await page.goto(urlFor('quick-plain'));

  await expect(page.locator('#first_name')).toHaveValue('Ada');
  await expect(page.locator('#email')).toHaveValue('ada@example.com');
  await expect(page.locator('#cover')).toHaveValue('I love building widgets.');
  expect(newTabs, 'the quick-apply marker must beat the sidebar decoy').toBe(0);

  context.off('page', countTab);
  await page.close();
});

test('ListingBoard: several apply links are ambiguous, so nothing is followed', async () => {
  const page = await context.newPage();
  let newTabs = 0;
  const countTab = () => { newTabs++; };
  context.on('page', countTab);

  await page.goto(urlFor('listing'));

  // It stays on the page and reports honestly: no form here, so every row is red.
  await expect(page.locator('.cf-card')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.cf-dot.none').first()).toBeVisible();
  expect(newTabs, 'a listing page must never pick one of its postings').toBe(0);

  context.off('page', countTab);
  await page.close();
});

test('NavATS: a destination that submits by navigating still counts as applied', async () => {
  test.setTimeout(90_000);
  // The tab has to survive the navigation for us to see where it went.
  await patchSettings({ redirectTarget: 'newTab', closeTabOnSubmit: false });

  const { board, dest } = await followHandoff(urlFor('external-nav'));
  const navUrl = `${TRACKER}/sites/ats-nav.html`;
  expect(dest.url()).toBe(navUrl);

  // A third origin with no config of its own: one is created on landing.
  await expect(dest.locator('#nav-first')).toHaveValue('Ada', { timeout: 30_000 });
  await expect(dest.locator('#nav-email')).toHaveValue('ada@example.com');

  // The confirmation is on a *different page* — this form navigates to
  // thanks.html, exactly as Greenhouse lands on its own `/confirmation` URL. The
  // content script that sees it is a fresh one with no memory of the posting, so
  // this asserts the background attributed it to the posting rather than to the
  // page showing the message. Without that, `navUrl` would sit at "opened"
  // forever and a junk entry for thanks.html would be marked applied instead.
  await dest.locator('#nav-submit').click();
  await dest.waitForURL(/thanks\.html/, { timeout: 20_000 });
  await waitForJobUrl(navUrl, (e) => e.status === 'applied');

  const thanksUrl = `${TRACKER}/sites/thanks.html`;
  const stray = (await readJobUrls()).find((e) => e.url.startsWith(thanksUrl));
  expect(stray, 'the confirmation page must not be recorded as a posting').toBeUndefined();

  await dest.close();
  await board.close();
});

test('HiddenSuccess: a pre-rendered confirmation only counts once it is visible', async () => {
  test.setTimeout(60_000);
  // Closing on submit is exactly what must NOT happen while the request is in
  // flight: an AJAX submission fires `submit` before the server has agreed.
  await patchSettings({ closeTabOnSubmit: true, closeTabDelayMs: 200 });

  const url = urlFor('hidden-success');
  await onExtensionPage((page) => page.evaluate(async (u) => {
    const now = Date.now();
    await chrome.storage.local.set({
      jobUrls: [{
        id: 'hidden-1', url: u, status: 'opened', addedAt: now, updatedAt: now,
        history: [{ status: 'opened', at: now }],
      }],
    });
  }, url));

  const page = await context.newPage();
  await page.goto(url);
  await expect(page.locator('#first_name')).toHaveValue('Ada');

  await page.locator('#submit').click({ force: true });
  await page.waitForTimeout(3000);
  expect(page.isClosed(), 'an unconfirmed submit must not close the tab').toBe(false);
  const stillPending = (await readJobUrls()).find((e) => e.url === url);
  expect(stillPending?.status, 'presence of a hidden success node is not "sent"').toBe('opened');

  // The server answers: the banner is revealed, and NOW it is an application.
  const closed = page.waitForEvent('close', { timeout: 15_000 });
  await page.locator('#confirm-server').click();
  await waitForJobUrl(url, (e) => e.status === 'applied');
  await closed;
});

/* ---------------- Queue session ---------------- */

test('Session: holds the batch size and opens the next posting as one closes', async () => {
  test.setTimeout(120_000);
  // The point of the session is that a big import never becomes a wall of tabs:
  // at most `batchSize` exist at once, and finishing one is what opens the next.
  await patchSettings({ closeTabOnSubmit: false, redirectTarget: 'newTab' });

  const BATCH = 3;
  // The same list the fixture server hands out at /queue-seed.txt, so a session
  // driven by hand in the browser and one driven here are the same session.
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
  const seen = new Set<string>();
  let peak = 0;
  const watch = setInterval(() => {
    const open = jobTabs();
    peak = Math.max(peak, open.length);
    open.forEach((p) => seen.add(p.url()));
  }, 100);

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
    expect(peak, 'the session must never exceed its batch size').toBeLessThanOrEqual(BATCH);

    // Closing one frees a slot; the next waiting posting takes it.
    const closing = jobTabs()[0];
    const closedUrl = closing.url();
    await closing.close();

    await waitFor(() => seen.size > BATCH, 'a replacement posting to open');
    expect(peak, 'refilling must not overshoot the batch size').toBeLessThanOrEqual(BATCH);
    expect(jobTabs().length).toBe(BATCH);

    // A tab closed without submitting is not lost — it stays `opened`, so it is
    // still visible in the dashboard rather than silently dropped or re-queued.
    const closed = (await readJobUrls()).find((e) => e.url === closedUrl);
    expect(closed?.status).toBe('opened');
  } finally {
    clearInterval(watch);
    await onExtensionPage((page) => page.evaluate(
      (type) => chrome.runtime.sendMessage({ type }), MSG.SESSION_STOP as string,
    ));
    await Promise.all(jobTabs().map((p) => p.close()));
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
    await expect(page.locator('#sim-card')).toBeVisible();

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
    await expect(card).toBeVisible({ timeout: 20_000 });

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
    await page.locator('.cf-more button').first().click();
    await page.getByRole('button', { name: 'Re-run' }).click();
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
