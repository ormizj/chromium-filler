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
import type { JobDetailsMap } from '../src/shared/jobDetails';
import type { ExportedJob } from '../src/shared/jobExport';
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
  await opts.waitForFunction(() => document.body.dataset.ready === '1');
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
  // The other document. Both are seeded through the real file inputs rather than
  // written to storage, so the options page's own encode path is exercised too.
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
 * is still awaiting, and the last thing it does is a read-modify-write of the
 * capture map — so a helper that writes storage the instant the page loads is
 * racing that write, and half the time loses to a snapshot taken before it ran.
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

async function readJobDetails(): Promise<JobDetailsMap> {
  return onExtensionPage((page) => page.evaluate(
    async () => ((await chrome.storage.local.get('jobDetails')).jobDetails ?? {}) as JobDetailsMap,
  ));
}

/**
 * Press the real Export button on the options page and read back the file it
 * would have downloaded, by intercepting the object URL rather than letting
 * Chromium write to disk.
 */
async function exportedText(page: Page): Promise<string> {
  return page.evaluate(async () => {
    let blob: Blob | null = null;
    const realCreate = URL.createObjectURL;
    const realClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (b: Blob | MediaSource) => { blob = b as Blob; return realCreate.call(URL, b); };
    HTMLAnchorElement.prototype.click = function () { /* don't actually download */ };
    try {
      document.getElementById('export-jobs')!.click();
      await new Promise((r) => setTimeout(r, 500));
      return blob ? await (blob as Blob).text() : '';
    } finally {
      URL.createObjectURL = realCreate;
      HTMLAnchorElement.prototype.click = realClick;
    }
  });
}

async function exportedJobs(): Promise<ExportedJob[]> {
  const json = await onExtensionPage(exportedText);
  return json ? (JSON.parse(json) as ExportedJob[]) : [];
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

  // And the meta chips under it, read from the posting's own JobPosting block:
  // company, remote-with-place, and the employment code spelled as a word.
  const chips = page.locator('.cf-jobmeta .chip');
  await expect(chips).toHaveCount(3);
  await expect(chips.nth(0)).toHaveText('SlowBoards');
  await expect(chips.nth(1)).toHaveText('Remote (Berlin, DE)');
  await expect(chips.nth(2)).toHaveText('Full-time');
  await page.close();
});

/**
 * The description fallbacks match on substrings of `id`/`class`, and slow-boards'
 * "Show full description" **button** carries `id="expand-description"` — so it
 * matches `[id*="description" i]` earlier in the document than the description
 * it expands. The modal showed a posting whose entire body was the words "Show
 * full description".
 *
 * This is the shape every auto-created config has (a handoff destination gets one
 * with no `extract` selectors at all), so it is not an exotic case — it is what a
 * site looks like before anyone has set it up.
 */
test('SlowBoards: an unconfigured description falls back to the posting, not to the button that opens it', async () => {
  const strip = (drop: boolean) => onExtensionPage((opts) => opts.evaluate(async (dropIt) => {
    const { siteConfigs } = await chrome.storage.local.get('siteConfigs');
    for (const c of siteConfigs) {
      if (c.id !== 'slow-boards') continue;
      if (dropIt) delete c.extract.jobDescription;
      else c.extract.jobDescription = '#job-description';
    }
    await chrome.storage.local.set({ siteConfigs });
  }, drop));

  await strip(true);
  const page = await context.newPage();
  await page.goto(urlFor('slow-boards'));
  await expect(page.locator('.cf-card')).toBeVisible({ timeout: 20_000 });

  const body = page.locator('.cf-body');
  await expect(body).toContainText(/SlowBoards is hiring/i);
  await expect(body).not.toContainText(/Show full description/i);

  await page.close();
  await strip(false);
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

  // And what the posting SAID is kept, not just that it was applied to. The tab
  // is about to close and the page is then unreadable forever.
  const captured = (await readJobDetails())[url];
  expect(captured.title).toContain('Infrastructure Engineer');
  expect(captured.description.length).toBeGreaterThan(0);

  const [exported] = (await exportedJobs()).filter((j) => j.url === url);
  expect(exported.status).toBe('applied');
  expect(exported.appliedAt).toBeTruthy();
  expect(exported.description.map((b) => b.text).join(' ')).toContain('Infrastructure Engineer');
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
  // Stated up front now, in the flow banner, rather than only after a press.
  await expect(page.locator('.cf-flow.warn')).toContainText(/confirmation element/i);
  await apply.click({ force: true });
  await expect(page.locator('.cf-flow .cf-help')).toContainText(/confirmation element/i);

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
  // The reason is on screen without being asked for; only the long form is behind
  // the disclosure, so that is what must be absent until the button is pressed.
  await expect(page.locator('.cf-flow.warn')).toContainText(/Send button/i);
  await expect(page.locator('.cf-flow .cf-help')).toHaveCount(0);

  // `force` because Playwright's actionability check honours `aria-disabled`
  // and refuses the click. That attribute is the truth about the *action* — it
  // cannot run here — while a real press still lands and is answered, which is
  // the whole behaviour under test.
  await apply.click({ force: true });
  const note = page.locator('.cf-flow .cf-help');
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

/**
 * The three ways out share one row, and it has to stay a row: the labels are
 * one or two words and `.links a` is `flex: 1 1 0` with no `flex-wrap`, so the
 * failure mode is a silent column rather than an overflow. Measured rather than
 * asserted on the DOM, because that is the only thing that can see it.
 *
 * The Queue button's destination is checked here too. It is the reason Queue is
 * not a duplicate of Options — it opens the *importer*, a section three down the
 * queue tab — and it is the only place that deep link is still reached from now
 * that the modal's overflow no longer carries it.
 */
test('Popup: Site setup, Queue and Options share one row, and Queue opens the importer', async () => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 360, height: 600 });
  await page.goto(`chrome-extension://${extId}/src/popup/popup.html`);
  await expect(page.locator('.links')).toBeVisible();

  const tops: number[] = [];
  for (const id of ['#reconfigure', '#open-queue', '#open-options']) {
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
  // Focused *and* on screen. The tab alone was never the destination: the
  // importer is the third section of it. (Not asserted as a scroll distance — a
  // tall enough window has the section in view without moving, and that is a
  // correct outcome, not a missing one.)
  await expect(importPage.locator('#urls-paste')).toBeFocused();
  await expect(importPage.locator('#import-section')).toBeInViewport();
  await importPage.close();
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

  // The archive's hard case. Both ends are applied, but this was one application
  // and the two halves hold different things: the board has the description, the
  // ATS has the outcome. It exports once, as the page it was sent from, carrying
  // the board's text — not twice, and not without a description.
  const rows = (await exportedJobs()).filter((j) => j.url === atsUrl || j.url === boardUrl);
  expect(rows.map((j) => j.url)).toEqual([atsUrl]);
  expect(rows[0].sourceUrl).toBe(boardUrl);
  expect(rows[0].title).toContain('Senior Widget Engineer');
  expect(rows[0].description.length).toBeGreaterThan(0);

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

test('MixedBoard: an intent:// apply link is followed at the web address it carries', async () => {
  test.setTimeout(90_000);
  await patchSettings({ redirectTarget: 'newTab', closeTabOnSubmit: false });

  const boardUrl = urlFor('mixed-applink');
  const { board, dest } = await followHandoff(boardUrl);

  // The whole point: the tab went to the fallback URL, over http, and not to the
  // `intent://acme.example/…` the link actually said. The posting carries no
  // `scheme=`, so nothing but the fallback could have produced this.
  expect(dest.url()).toBe(`${ALT}/sites/ats-form.html?src=applink`);
  await expect(dest.locator('#ats-first')).toHaveValue('Ada', { timeout: 30_000 });

  // And it is an ordinary handoff from there on — both ends linked, as recorded
  // for any two-step posting.
  const source = await waitForJobUrl(boardUrl, (e) => e.status === 'redirected');
  expect(source.redirectUrl).toBe(dest.url());

  await dest.close();
  await board.close();
});

test('MixedBoard: a linkedin:// apply link opens nothing and says why', async () => {
  const board = await context.newPage();
  // Armed after our own tab exists, so only a handoff would register here.
  let newTabs = 0;
  const countTab = () => { newTabs++; };
  context.on('page', countTab);

  await board.goto(urlFor('mixed-appscheme'));

  // No web address to reach, so the extension stays put. This is the assertion
  // that matters: nothing was ever handed to the browser that could leave it.
  await expect(board.locator('.cf-card')).toBeVisible({ timeout: 20_000 });
  await expect(board.locator('.cf-flow')).toContainText('applies in an app');
  expect(newTabs, 'an app-scheme apply link must never open a tab').toBe(0);

  // Still on the board: the same-tab variant of the leak would show up here.
  expect(board.url()).toBe(urlFor('mixed-appscheme'));

  context.off('page', countTab);
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

/* ---------------- The archive ---------------- */

test('Options: the archive exports what was ticked, and the ticks survive a reload', async () => {
  // The whole feature in one pass: the checkboxes drive the file, and the choice
  // is a *setting* rather than page state — a selection that lasted only as long
  // as the tab was open would have to be re-made before every export.
  const saved = await onExtensionPage((p) => p.evaluate(
    () => chrome.storage.local.get(['jobUrls', 'jobDetails', 'settings']),
  ));
  const applied = 'https://board.test/kept';
  const skipped = 'https://board.test/passed';
  const page = await context.newPage();
  try {
    // Seeded from this page and then reloaded, deliberately: an options page
    // collects captures whose posting has gone (`pruneDetails`) once per load,
    // reading the URL list *before* this evaluate could set it. Writing the two
    // together and reloading is what keeps the seed self-consistent.
    //
    // Waiting for `data-ready` is the other half. That prune is a
    // read-modify-write, and `load` fires while it is still in flight — so a seed
    // written before it finishes is overwritten by a map read before the seed
    // existed, and the captures vanish. Nothing a user does looks like this; it
    // is an artifact of writing storage underneath a page that is still booting.
    await page.goto(`chrome-extension://${extId}/src/options/options.html`);
    await page.waitForFunction(() => document.body.dataset.ready === '1');
    await page.evaluate(async ([a, s]) => {
      const now = Date.now();
      const entry = (id: string, url: string, status: string) => ({
        id, url, status, addedAt: now, updatedAt: now, history: [{ status, at: now }],
        ...(status === 'applied' ? { appliedAt: now } : {}),
      });
      const details = (url: string, title: string) => ({
        url, title, description: [{ kind: 'para', text: 'Body text' }],
        requirements: [], meta: { company: 'Acme' }, capturedAt: now,
      });
      await chrome.storage.local.set({
        jobUrls: [entry('k1', a, 'applied'), entry('k2', s, 'skipped')],
        jobDetails: { [a]: details(a, 'Engineer, Senior'), [s]: details(s, 'Passed over') },
        settings: {
          ...(await chrome.storage.local.get('settings')).settings,
          exportOptions: {},
        },
      });
    }, [applied, skipped]);
    await page.reload();
    const openPanel = async () => {
      if (!await page.locator('#export-options').evaluate((d: HTMLDetailsElement) => d.open)) {
        await page.locator('#export-options > summary').click();
      }
    };
    await openPanel();

    // Everything off except the two columns wanted, plus the skipped postings
    // and CSV. Each tick is its own storage write, which is why they are
    // serialized — twelve of them in a row used to be where a lost update hid.
    for (const field of [
      'url', 'site', 'company', 'location', 'employmentType', 'addedAt', 'appliedAt',
      'capturedAt', 'sourceUrl', 'redirectUrl', 'description', 'requirements',
    ]) {
      await page.locator(`#export-field-${field}`).uncheck();
    }
    await page.locator('#export-status-skipped').check();
    await page.locator('#export-format-csv').check();

    await page.reload();
    await openPanel();
    await expect(page.locator('#export-field-title')).toBeChecked();
    await expect(page.locator('#export-field-description')).not.toBeChecked();
    await expect(page.locator('#export-status-skipped')).toBeChecked();
    await expect(page.locator('#export-format-csv')).toBeChecked();

    const csv = await exportedText(page);
    const lines = csv.replace(/^﻿/, '').split('\r\n');
    // The header is the chosen columns, in the catalog's order — and a title
    // holding a comma is quoted, or every row after it shifts by a column.
    expect(lines[0]).toBe('title,status');
    expect(lines.slice(1).sort()).toEqual(['"Engineer, Senior",applied', 'Passed over,skipped']);
  } finally {
    await page.close();
    await onExtensionPage((p) => p.evaluate((prev) => chrome.storage.local.set(prev), saved));
  }
});

/* ---------------- Getting-started checklist ---------------- */

test('Options: a checklist “Go →” lands on the section it names, not just its tab', async () => {
  // Switching tab is not an answer on its own: the CV upload is the second
  // section of the Profile tab, and both queue steps point at the tab the
  // checklist is already on — those two used to be visible no-ops. The sticky
  // topbar is the other half of it, so the assertion is not "in the viewport"
  // but "below the bar", which is the part a bare scrollIntoView gets wrong.
  const KEYS = ['profile', 'cv', 'jobUrls', 'settings'];
  const saved = await onExtensionPage((p) => p.evaluate(
    (keys) => chrome.storage.local.get(keys), KEYS,
  ));

  const page = await context.newPage();
  try {
    // A first-run store: every step undone, so every Go button renders.
    await onExtensionPage((p) => p.evaluate(async (keys) => {
      await chrome.storage.local.remove(keys);
      await chrome.storage.local.set({ settings: { helpSeen: false } });
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

test('Options: a settings row keeps its disclosure inside the card, on either shape of row', async () => {
  // `.setrow.stacked` turns the row's flex axis vertical but every length in it
  // was written for a row: with `flex-wrap: wrap` still on, `.setrow-help`'s
  // `flex-basis: 100%` — of the card's *height*, in a column — could not fit
  // beside its siblings and wrapped into a second **column**, so the explanation
  // left the card entirely and hung off its right-hand edge over the page.
  //
  // jsdom evaluates neither the cascade nor layout, so nothing but a real browser
  // can see this. Both shapes of row are checked: the bug only ever hit the
  // stacked one, and a fix that broke the ordinary one would be no fix.
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`chrome-extension://${extId}/src/options/options.html`);
    await page.waitForFunction(() => document.body.dataset.ready === '1');
    await page.locator('#tab-settings').click();

    for (const id of ['redirect-target', 'auto-run']) {
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

    const row = page.locator('#auto-run').locator('xpath=ancestor::*[contains(@class,"setrow")][1]');
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

/**
 * The review modal used to be a dead end. Everything it offered acted on the
 * posting, so a site that filled the wrong field could only be fixed by closing
 * the card (losing the report), opening the toolbar popup and finding Site setup
 * there. The two ways out now ride in the overflow beside Re-run and Reset.
 */
test('Modal: the overflow menu reaches setup and the options page', async () => {
  const page = await context.newPage();
  try {
    await page.goto(urlFor('quick-plain'));
    await expect(page.locator('.cf-card')).toBeVisible({ timeout: 20_000 });

    const openMenu = () => page.locator('.cf-more button').first().click();

    // Site setup runs in *this* tab — the panel is in the same content script,
    // and taking the user to a new page to configure the one they are looking at
    // would defeat a picker that works by tapping the real element.
    await openMenu();
    await page.getByRole('button', { name: 'Site setup', exact: true }).click();
    await expect(page.locator('.cf-card[data-sheet="setup"]')).toBeVisible({ timeout: 20_000 });
    // One slot, two sheets: opening the panel folds the review card away — and
    // folds it, never destroys it, so the report it holds survives the trip.
    await expect(page.locator('.cf-card[data-sheet="review"]')).toHaveCount(0);

    // Bring the review card back. Minimize first: while a card is expanded no
    // pill shows at all, because both pills dock where the expanded card is.
    await page.locator('.cf-card[data-sheet="setup"] .cf-close').click();
    await page.locator('.cf-pill[data-sheet="review"]').click();
    await expect(page.locator('.cf-card[data-sheet="review"]')).toBeVisible({ timeout: 10_000 });

    // The other exit. Queueing up more postings is not one of them: it is the one
    // errand here with nothing to do with the posting on screen, and the popup's
    // Queue button reaches the importer without a job page open at all.
    await openMenu();
    await expect(page.getByRole('button', { name: 'Add links', exact: true }))
      .toHaveCount(0);

    const opts = context.waitForEvent('page');
    await page.getByRole('button', { name: 'Options', exact: true }).click();
    const optsPage = await opts;
    await optsPage.waitForLoadState();
    await expect(optsPage.locator('.topbar')).toBeVisible();
    await optsPage.close();
  } finally {
    await page.close();
  }
});

/**
 * "Advanced (JSON)" is about the config the wizard is editing, so it has to land
 * on the editor holding it. With no hash at all it opened the options page on the
 * default tab — the queue — and left the user to go and find the JSON.
 */
test('Setup: “Advanced (JSON)” lands on the Sites tab, at the config editor', async () => {
  const page = await context.newPage();
  try {
    await page.goto(urlFor('quick-plain'));
    await expect(page.locator('.cf-card')).toBeVisible({ timeout: 20_000 });

    await page.locator('.cf-more button').first().click();
    await page.getByRole('button', { name: 'Site setup', exact: true }).click();
    await expect(page.locator('.cf-rail')).toBeVisible({ timeout: 10_000 });
    // Step 1 is where the raw config lives; the rail is how to get there without
    // pressing Next five times.
    await page.locator('.cf-rail-node').first().click();

    const opened = context.waitForEvent('page');
    await page.getByRole('button', { name: 'Advanced (JSON)' }).click();
    const optsPage = await opened;
    await optsPage.waitForLoadState();

    await expect(optsPage.locator('#tab-sites')).toHaveAttribute('aria-selected', 'true');
    await expect(optsPage.locator('#configs-json')).toBeFocused();
    await optsPage.close();
  } finally {
    await page.close();
  }
});

test('Modal: fullscreen fills the window and stays on for the next posting', async () => {
  // The promise the button makes is "until you cancel it", so the test that
  // matters is not the first click — it is the *second posting*, which is a fresh
  // content script in a fresh tab that has to read the choice back out of storage.
  // And the configured card has to survive being overridden, or there is nothing
  // to come back to.
  const chosen = { right: 40, bottom: 40, width: 420, height: 520 };
  await patchSettings({ modalLayout: chosen, modalFullscreen: false });

  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(urlFor('quick-plain'));
    const card = page.locator('.cf-card');
    await expect(card).toBeVisible({ timeout: 20_000 });

    const box = async () => (await card.boundingBox())!;
    expect((await box()).width, 'starts at the configured size').toBeCloseTo(420, 0);

    await page.locator('.cf-fullscreen').click();
    await expect.poll(async () => (await box()).width).toBeCloseTo(1280, 0);
    const filled = await box();
    expect(filled.height).toBeCloseTo(900, 0);
    expect(filled.x).toBeCloseTo(0, 0);
    expect(filled.y).toBeCloseTo(0, 0);

    const settings = async () => await onExtensionPage((p) => p.evaluate(
      async () => (await chrome.storage.local.get('settings')).settings,
    ));
    expect((await settings()).modalFullscreen, 'the choice is persisted').toBe(true);
    expect((await settings()).modalLayout, 'fullscreen overrides the layout, it does not overwrite it')
      .toEqual(chosen);

    // Re-run rebuilds `ModalData` from controller state — the path a per-instance
    // flag would be thrown away by.
    await page.locator('.cf-more button').first().click();
    await page.getByRole('button', { name: 'Re-run' }).click();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await box()).width).toBeCloseTo(1280, 0);
  } finally {
    await page.close();
  }

  // A different posting, in a tab that never saw the click.
  const next = await context.newPage();
  try {
    await next.setViewportSize({ width: 1280, height: 900 });
    await next.goto(urlFor('quick-nolink'));
    const card = next.locator('.cf-card');
    await expect(card).toBeVisible({ timeout: 20_000 });
    const box = async () => (await card.boundingBox())!;
    await expect.poll(async () => (await box()).width, {
      message: 'the next posting opens fullscreen without being asked',
    }).toBeCloseTo(1280, 0);

    // And cancelling gives back exactly the card the simulator configured.
    await next.locator('.cf-fullscreen').click();
    await expect.poll(async () => (await box()).width).toBeCloseTo(420, 0);
    const back = await box();
    expect(back.height).toBeCloseTo(520, 0);
    expect(back.x, 'right: 40 on a 1280 viewport').toBeCloseTo(1280 - 40 - 420, 0);

    const stored = await onExtensionPage((p) => p.evaluate(
      async () => (await chrome.storage.local.get('settings')).settings?.modalFullscreen,
    ));
    expect(stored, 'cancelling persists too').toBe(false);
  } finally {
    await next.close();
  }
});

/* ---------------- One slot, two sheets ---------------- */

/**
 * Open the on-page setup panel on `page`, the way the popup does — `MSG.SETUP`
 * addressed at that tab. There is no other entry point, and driving the real
 * popup would need a extension-page → tab hop for one message.
 */
async function openSetupPanel(page: Page): Promise<void> {
  const url = page.url();
  await onExtensionPage((ext) => ext.evaluate(async ([type, target]) => {
    const [tab] = await chrome.tabs.query({ url: target });
    await chrome.tabs.sendMessage(tab.id!, { type });
  }, [MSG.SETUP, url] as [string, string]));
}

test('Sheets: only one is expanded at a time, and both open in the same place', async () => {
  // The two used to be unrelated products sharing a stylesheet: the modal at the
  // user's rectangle bottom-right, the panel hardcoded top-right at 400px. Under
  // 640px they were the same rectangle with nothing but DOM order deciding which
  // one you could see.
  const chosen = { right: 40, bottom: 40, width: 420, height: 520 };
  await patchSettings({ modalLayout: chosen, modalFullscreen: false });

  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(urlFor('quick-plain'));

    const review = page.locator('.cf-card[data-sheet="review"]');
    const setup = page.locator('.cf-card[data-sheet="setup"]');
    await expect(review).toBeVisible({ timeout: 20_000 });
    const reviewBox = (await review.boundingBox())!;

    await openSetupPanel(page);
    await expect(setup).toBeVisible({ timeout: 20_000 });

    // The slot is exclusive: the review card folds away rather than sitting
    // underneath, and no pill shows while a card is expanded — both pills dock
    // where the expanded card already is.
    await expect(review).toHaveCount(0);
    await expect(page.locator('.cf-pill')).toHaveCount(0);

    const setupBox = (await setup.boundingBox())!;
    expect(setupBox, 'both sheets render the one configured rectangle').toEqual(reviewBox);

    // Minimizing frees the slot, so both sheets show a pill — stacked, not on top
    // of each other. Two pills on one pixel is the failure this rail prevents.
    await page.locator('.cf-card[data-sheet="setup"] .cf-close').click();
    await expect(page.locator('.cf-pill')).toHaveCount(2);
    const pills = await page.locator('.cf-pill').all();
    const boxes = await Promise.all(pills.map(async (p) => (await p.boundingBox())!));
    expect(Math.abs(boxes[0].y - boxes[1].y), 'the pills stack').toBeGreaterThan(20);

    // The report is intact behind its pill — never destroyed, so no fill is lost.
    await page.locator('.cf-pill[data-sheet="review"]').click();
    await expect(review).toBeVisible();
    await expect(page.locator('.cf-pill')).toHaveCount(0);
    expect((await review.boundingBox())!).toEqual(reviewBox);
  } finally {
    await page.close();
  }
});

/**
 * The wizard's one load-bearing piece of state, tested against the real thing.
 *
 * `refreshSetup` re-renders the whole panel after every edit — a Pick, a prep
 * change, a rename — and the step lives on the `SetupPanel` instance rather than
 * in the data precisely so that survives. A unit test can assert two `render`
 * calls in a row; only this can assert it across a genuine storage round-trip
 * through the background, which is the path a real edit actually takes.
 */
test('Setup: an edit re-renders the panel without losing your place in the wizard', async () => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto(urlFor('quick-plain'));
    await expect(page.locator('.cf-card[data-sheet="review"]')).toBeVisible({ timeout: 20_000 });

    await openSetupPanel(page);
    const setup = page.locator('.cf-card[data-sheet="setup"]');
    await expect(setup).toBeVisible({ timeout: 20_000 });

    // Walk to "Page actions" — step 2 of 6 — whatever the panel opened on.
    await setup.locator('.cf-rail-node').nth(1).click();
    await expect(setup.locator('.cf-step-count')).toHaveText('Step 2 of 6');

    // A real edit: "+ Delay" writes a prep step to the site config and comes
    // back through `refreshSetup`, rebuilding the card from scratch. The step
    // carries two prep lists, so this is the first list's add bar — the one that
    // runs before filling.
    const steps = () => setup.locator('.cf-step-body .cf-row');
    const before = await steps().count();
    await setup.getByRole('button', { name: '+ Delay' }).first().click();
    await expect(steps()).toHaveCount(before + 1);

    // Still on step 2. Before the step lived on the instance this would have
    // been step 1, and every Pick would have thrown the user back to the start.
    await expect(setup.locator('.cf-step-count')).toHaveText('Step 2 of 6');
  } finally {
    await page.close();
  }
});

/**
 * The rest of "an edit does not start fresh", and the half only a real browser
 * can see: jsdom does no layout, so `scrollTop` there never leaves 0.
 *
 * Two things destroy it and both happen on one Pick. `paint` replaces the whole
 * `.cf-card`, and the picker sets the host to `display: none` to keep itself
 * from picking the panel — which throws the layout box away with the scroll
 * offset in it. So picking the last of a dozen field rows used to land you back
 * at the first one, every single time, on the step where the list is longest.
 */
test('Setup: picking a field leaves you where you were in the list', async () => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto(urlFor('quick-plain'));
    await expect(page.locator('.cf-card[data-sheet="review"]')).toBeVisible({ timeout: 20_000 });

    await openSetupPanel(page);
    const setup = page.locator('.cf-card[data-sheet="setup"]');
    await expect(setup).toBeVisible({ timeout: 20_000 });

    // "Form fields" — the long step, and the reason this matters at all.
    await setup.locator('.cf-rail-node').nth(4).click();
    await expect(setup.locator('.cf-step-count')).toHaveText('Step 5 of 6');

    const body = setup.locator('.cf-body');
    await body.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const before = await body.evaluate((el) => el.scrollTop);
    // A step with nothing to scroll would pass this test without testing it.
    expect(before).toBeGreaterThan(0);

    // A real edit through the picker: the panel hides, the page is clicked, the
    // selector is saved, and the panel comes back rebuilt from storage.
    const lastPick = setup.locator('.cf-step-body .cf-row [data-k^="field:"]').last();
    await lastPick.click();
    await page.locator('input').first().click();
    await expect(setup).toBeVisible();
    await expect(setup.locator('.cf-step-count')).toHaveText('Step 5 of 6');

    // Same place in the list. Allow a row of slack: the picked row gains a
    // "Clear" button, which can change the content height slightly.
    const after = await body.evaluate((el) => el.scrollTop);
    expect(Math.abs(after - before)).toBeLessThan(60);
  } finally {
    await page.close();
  }
});

test('Sheets: the setup panel is a bottom sheet on a phone, like the modal', async () => {
  // The regression that hid in the cascade: `setupPanel.css` is inlined after
  // `primitives.css` at equal specificity, so its own `.cf-card { top; width }`
  // beat the narrow media query and the panel came out a 400px column hanging
  // off the top of a 390px screen. No DOM assertion could see it — jsdom does not
  // evaluate media queries — so it has to be measured in a real browser.
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto(urlFor('quick-plain'));
    await expect(page.locator('.cf-card[data-sheet="review"]')).toBeVisible({ timeout: 20_000 });

    await openSetupPanel(page);
    const setup = page.locator('.cf-card[data-sheet="setup"]');
    await expect(setup).toBeVisible({ timeout: 20_000 });

    const box = (await setup.boundingBox())!;
    expect(box.width, 'full width').toBeCloseTo(390, 0);
    expect(box.x, 'flush left').toBeCloseTo(0, 0);
    expect(box.y + box.height, 'anchored to the bottom, not hanging from the top').toBeCloseTo(780, 0);
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

test('Modal: the two view segments are the same width, at one tap size', async () => {
  // Content-sized segments measured Job 45px against Fields 74px, so the white
  // active pill changed size as you switched — and the control resized whenever
  // the Fields dot appeared or cleared, moving the header under a re-render.
  // Both are layout facts, so only a real browser can see either.
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(urlFor('quick-plain'));
    await expect(page.locator('.cf-card')).toBeVisible({ timeout: 20_000 });

    const views = page.locator('.cf-view');
    const job = (await views.nth(0).boundingBox())!;
    const fields = (await views.nth(1).boundingBox())!;
    expect(fields.width, 'equal segments').toBeCloseTo(job.width, 0);

    // `--tap` on every pointer, like every other button — these two and the
    // header's icon buttons kept the pre-reskin 32/26px on a mouse.
    for (const sel of ['.cf-view', '.cf-fullscreen', '.cf-close']) {
      const box = (await page.locator(sel).first().boundingBox())!;
      expect(box.height, `${sel} is one tap tall`).toBeGreaterThanOrEqual(44);
    }
  } finally {
    await page.close();
  }
});
