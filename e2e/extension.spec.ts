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
import { test, expect, chromium, type BrowserContext, type Locator, type Page } from '@playwright/test';
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
  // Loudly, not `test.skip`. Skipping meant a run with no `dist/` reported
  // "0 passed" as success — a green E2E that executed nothing, which is the one
  // failure mode this suite must never have, since it *is* the confidence signal.
  if (!fs.existsSync(path.join(DIST, 'manifest.json'))) {
    throw new Error(
      `No built extension at ${DIST}. Run \`npm run build\` before \`npm run test:e2e\`.`,
    );
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
          autoRunOnLoad: true,
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
  await expect(page.locator('.cf-view .cf-dot.none').first()).toBeVisible();
  await page.close();
});

/**
 * The report is the record of one fill and holds still.
 *
 * ChaosForm's phone input is named by its placeholder alone, which scores below
 * the threshold: it comes back yellow, unfilled, with a Confirm. Pressing that
 * used to rewrite the row's `filled` — which turned the dot green, re-counted the
 * summary line and re-sorted the report, dropping the row out from under the
 * finger that had just pressed it and moving every row below it.
 *
 * Now the page answers and the card does not: the field fills, the button
 * retires, and the dots, the counts and the order are exactly what the fill left.
 * Only a fresh fill rebuilds them, which is what Re-run is checked for here.
 */
test('ChaosForm: Confirm fills the field and leaves the report exactly as the fill left it', async () => {
  const page = await context.newPage();
  await page.goto(urlFor('chaos-form'));
  await expect(page.getByLabel('Email address')).toHaveValue('ada@example.com');

  const phone = page.locator('input[placeholder="Phone"]');
  await expect(phone).toHaveValue('');

  await page.locator('.cf-view', { hasText: 'Fields' }).click();
  const report = page.locator('.cf-report');
  // The whole overview in two reads: every row's name+dot, and the count line.
  const overview = async () => [
    await report.locator('.cf-row').evaluateAll(
      (rows) => rows.map((r) => `${r.querySelector('.cf-field b')?.textContent}:${r.querySelector('.cf-dot')?.className}`),
    ),
    await page.locator('.cf-summary').textContent(),
  ];
  const before = await overview();

  const row = report.locator('.cf-row', { hasText: 'Phone' });
  await row.locator('button', { hasText: /^Confirm$/ }).click();

  // The page took the value...
  await expect(phone).toHaveValue('+1 555 123 4567');
  // ...the button says the press landed...
  await expect(row.locator('button', { hasText: 'Confirmed ✓' })).toBeVisible();
  await expect(row.locator('button', { hasText: /^Confirm$/ })).toHaveCount(0);
  // ...and nothing else about the report moved.
  expect(await overview()).toEqual(before);

  // A fill is the one thing that re-establishes any of it. Re-run detects the
  // same placeholder-only control at the same low confidence and still declines
  // to fill it — so the report comes back identical, and the acknowledgement does
  // not: a new record carries no memory of a press against the old one.
  await page.locator('.cf-more button').first().click();
  await page.locator('.cf-more-menu button', { hasText: 'Re-run' }).click();
  await page.locator('.cf-view', { hasText: 'Fields' }).click();
  await expect(row.locator('button', { hasText: /^Confirm$/ })).toBeVisible();
  await expect(row.locator('button', { hasText: 'Confirmed ✓' })).toHaveCount(0);
  expect(await overview()).toEqual(before);

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
  //
  // Asserted here and not after the storage reads below: this suite runs with
  // `closeTabOnSubmit` on and a 200ms delay, so the tab is about to go.
  await expect(page.locator('.cf-applied')).toContainText(/sent/i);
  await expect(page.locator('.cf-footer button.cf-btn', { hasText: 'Applied' })).toBeVisible();
  // Skip retires beside Apply the moment the application lands. Pressing it would
  // reach `recordStatus`, which overwrites rather than promotes — filing "skipped"
  // over the application that just went through.
  await expect(page.locator('.cf-footer button.cf-btn', { hasText: 'Skip' }))
    .toHaveAttribute('aria-disabled', 'true');

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
 * The gap this closes: the `applied` record was write-only from the page's point
 * of view. Nothing in the content script read it back, so re-opening a posting
 * you had already applied to handed you a live coral Apply — and pressing it
 * pressed the site's own Send button a second time.
 *
 * A fresh page-load, so `Controller.applied` is false and the only thing that can
 * possibly retire these two controls is the database.
 */
test('DialogATS: re-opening an applied posting retires both decisions', async () => {
  const url = urlFor('cv-confirm');
  // Ordered after the apply spec above, which is what puts this URL on record.
  await waitForJobUrl(url, (e) => e.status === 'applied');

  const page = await context.newPage();
  await page.goto(url);
  await expect(page.locator('.cf-card')).toBeVisible({ timeout: 20_000 });

  // The card is a receipt, on a page where nothing has happened.
  await expect(page.locator('.cf-applied')).toContainText(/already applied/i);
  await expect(page.locator('.cf-footer button.cf-btn', { hasText: 'Apply' })).toHaveCount(0);
  const done = page.locator('.cf-footer button.cf-btn', { hasText: 'Applied' });
  await expect(done).toBeVisible();
  await expect(done).toHaveAttribute('aria-disabled', 'true');

  const skip = page.locator('.cf-footer button.cf-btn', { hasText: 'Skip' });
  await expect(skip).toHaveAttribute('aria-disabled', 'true');

  // `force: true` because Playwright's actionability check honours `aria-disabled`
  // — and pressing them is exactly what has to stay harmless. The press answers
  // with the note instead of the action.
  await done.click({ force: true });
  await skip.click({ force: true });
  await expect(page.locator('.cf-flow .cf-help')).toContainText(/second application|already applied/i);

  // The site's own form was never submitted again, and the record still stands.
  await expect(page.locator('#dialog-success')).toBeHidden();
  const entry = await waitForJobUrl(url, (e) => e.status === 'applied');
  expect(entry.status).toBe('applied');
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

/**
 * The other half of the re-apply guard, and the one with a side effect: following
 * is automatic, so without a check on the stored status, re-opening an applied
 * board posting would open the employer's form all over again — and under the
 * default `newTabCloseSource` it would close the posting the user just opened.
 *
 * Runs straight after the spec above, which is what leaves this URL applied.
 */
test('MixedBoard: an applied two-step posting is not handed off a second time', async () => {
  test.setTimeout(60_000);
  await patchSettings({ redirectTarget: 'newTab' });

  const boardUrl = urlFor('mixed-external');
  await waitForJobUrl(boardUrl, (e) => e.status === 'applied');

  const before = context.pages().length;
  const board = await context.newPage();
  await board.goto(boardUrl);
  await expect(board.locator('.cf-card')).toBeVisible({ timeout: 20_000 });

  // Still on the board, with the receipt rather than the handoff notice.
  expect(board.url()).toBe(boardUrl);
  await expect(board.locator('.cf-applied')).toContainText(/already applied/i);
  await expect(board.locator('.cf-footer button.cf-btn', { hasText: 'Applied' })).toBeVisible();
  // "Open application" is still reachable, just no longer the thing being done
  // for you — it moves into the overflow.
  await expect(board.locator('.cf-footer-actions > button.cf-btn', { hasText: 'Open application' }))
    .toHaveCount(0);

  // Nothing was opened. The handoff would have produced a page by now — the spec
  // above sees one within 30s, and the board's own prep steps have already run.
  await board.waitForTimeout(2_000);
  expect(context.pages().length).toBe(before + 1);

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
  await expect(page.locator('.cf-view .cf-dot.none').first()).toBeVisible();
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
 * there. The two ways out now lead the overflow, ahead of Re-run.
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
 * The Send row must say which selector actually found the button.
 *
 * `findSubmitControl` falls through to the label heuristic when a saved
 * `submitSelector` stops resolving — a site changing its markup under a
 * selector the user picked months ago is the ordinary way there. The row used
 * to key its note off whether a selector was *saved* rather than whether it was
 * *used*, so it read `saved · button.gone` — naming a selector that had matched
 * nothing and crediting it with a button the guessing had found. Nothing in the
 * panel then said the save had stopped applying.
 *
 * Only a real browser can see it: the note is built in `refreshSetup` against a
 * live document, and it takes a page whose heuristic genuinely finds a Send
 * button for the fall-through to have anything to fall through to.
 */
test('Setup: a saved Send selector that stopped matching says so, and credits the guess', async () => {
  const setSubmitSelector = (selector: string | null) =>
    onExtensionPage((opts) => opts.evaluate(async (sel) => {
      const { siteConfigs } = await chrome.storage.local.get('siteConfigs');
      for (const c of siteConfigs) {
        if (c.id !== 'quick-board') continue;
        if (sel) c.submitSelector = sel;
        else delete c.submitSelector;
      }
      await chrome.storage.local.set({ siteConfigs });
    }, selector));

  const page = await context.newPage();
  try {
    await setSubmitSelector('#a-button-this-page-does-not-have');
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto(urlFor('quick-plain'));
    await expect(page.locator('.cf-card[data-sheet="review"]')).toBeVisible({ timeout: 20_000 });

    await openSetupPanel(page);
    const setup = page.locator('.cf-card[data-sheet="setup"]');
    await expect(setup).toBeVisible({ timeout: 20_000 });

    // Step 6 — "Sending" — whatever the panel opened on.
    await setup.locator('.cf-rail-node').nth(5).click();
    await expect(setup.locator('.cf-step-count')).toHaveText('Step 6 of 6');

    // By its Pick button's key, not by its position: `send:submitSelector` is
    // what the row *is*, and the step carries two rows of the same shape.
    const row = setup.locator('.cf-row', { has: page.locator('[data-k="send:submitSelector"]') });
    const note = row.locator('.cf-field small');

    await expect(note).toContainText('saved selector · no match');
    // The heuristic found the real button, and the row credits it rather than
    // the selector that missed.
    await expect(note).toContainText('auto ·');
    expect(await note.textContent()).not.toMatch(/^saved · /);
    // Yellow, as it already was — found, but not settled.
    await expect(row.locator('.cf-dot')).toHaveClass(/warn/);
  } finally {
    await setSubmitSelector(null);
    await page.close();
  }
});

/**
 * Drive the click-to-pick toolbar the way a person does now: a click *selects*
 * and Confirm saves, and because the run of elements at a point starts on the box
 * around the thing, reaching the element itself means stepping inward until the
 * toolbar names it. Reads the toolbar's own readout rather than counting presses,
 * so a fixture growing a wrapper does not silently pick the wrapper.
 */
async function pickOnPage(page: Page, target: Locator): Promise<void> {
  const bar = page.locator('[data-cf-picker="bar"]');
  const readout = page.locator('[data-cf-picker="readout"]');
  await expect(bar).toBeVisible({ timeout: 10_000 });

  const want = await target.evaluate((el) =>
    (el.id ? `${el.tagName.toLowerCase()}#${el.id}` : el.tagName.toLowerCase()));
  await target.click();
  for (let i = 0; i < 6; i += 1) {
    if (((await readout.textContent()) ?? '').trim() === want) break;
    await bar.getByRole('button', { name: 'Deeper', exact: true }).click();
  }
  await expect(readout).toHaveText(want);
  await bar.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(bar).toHaveCount(0);
}

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
    await pickOnPage(page, page.locator('input').first());
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

/**
 * The picker's toolbar has to name the field the way the row that launched it
 * does. The review modal's Pick passed the bare `FieldKey`, so the one surface
 * the user is looking at while they aim at an input read `Click the
 * "coverLetter" field` — the storage key, in the only place in the extension
 * that ever spelled a field that way. The setup panel's Pick has always used
 * `FIELD_LABELS`; the two are the same gesture and must read the same.
 *
 * Asserted against the row's own label rather than a literal, so renaming a
 * field in `FIELD_LABELS` cannot make this pass while the two disagree.
 */
test('Modal: the picker names the field the way the report row does', async () => {
  const page = await context.newPage();
  try {
    await page.goto(urlFor('quick-plain'));
    const card = page.locator('.cf-card[data-sheet="review"]');
    await expect(card).toBeVisible({ timeout: 20_000 });

    // The report lives behind the Fields tab; Job is the default.
    await card.locator('.cf-view').nth(1).click();
    const row = card.locator('.cf-report .cf-row').first();
    const label = (await row.locator('.cf-field b').textContent())!.trim();
    // A key would be one lower-case word; every real label is capitalised.
    expect(label).toMatch(/^[A-ZÉ]/);

    await row.getByRole('button', { name: 'Pick', exact: true }).click();

    // The toolbar is drawn on the host page's own light DOM, not in the sheet.
    const bar = page.locator('[data-cf-picker="bar"]');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText(`"${label}"`);

    await bar.getByRole('button', { name: 'Cancel' }).click();
  } finally {
    await page.close();
  }
});

/**
 * The two halves of what a pick is now, and neither is visible to jsdom.
 *
 * A click used to commit outright on a mouse, so a stray press wrote a selector
 * into the site config with nothing in between. And it could only ever offer one
 * element per point — `elementFromPoint` hands back a single node, and on a real
 * board the thing the user means is the box around it. So a point gives a run of
 * elements, outermost first, and clicking the same spot again steps inward.
 *
 * `#email` sits directly in `#application-form` on this fixture, so the run is
 * exactly two long: the form, then the input. That is the shape being asserted —
 * the first click naming something that is *not* what was clicked.
 */
test('Modal: a click selects, clicking again goes one level in, and Confirm saves', async () => {
  const page = await context.newPage();
  try {
    await page.goto(urlFor('quick-plain'));
    const card = page.locator('.cf-card[data-sheet="review"]');
    await expect(card).toBeVisible({ timeout: 20_000 });

    await card.locator('.cf-view').nth(1).click();
    await card.locator('.cf-report .cf-row').first()
      .getByRole('button', { name: 'Pick', exact: true }).click();

    const bar = page.locator('[data-cf-picker="bar"]');
    const readout = page.locator('[data-cf-picker="readout"]');
    await expect(bar).toBeVisible();

    // One click on the page commits nothing: the toolbar is still up, waiting.
    await page.click('#email');
    await expect(bar).toBeVisible();
    // And what it proposes is the form around the input, not the input.
    await expect(readout).toHaveText('form#application-form');
    await expect(bar).toContainText('1 / 2');

    // The same spot again steps in. This is the whole feature: the element under
    // the pointer is reachable, and so is every box around it.
    await page.click('#email');
    await expect(readout).toHaveText('input#email');
    await expect(bar).toContainText('2 / 2');

    // Back out again, so the run is walkable in both directions.
    await bar.getByRole('button', { name: 'Wider', exact: true }).click();
    await expect(readout).toHaveText('form#application-form');

    await bar.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(bar).toHaveCount(0);
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

test("Setup: the verdict's dot lines up with the rows it argues about", async () => {
  // The `kind` step is a verdict banner and, directly beneath it, the rows that
  // verdict is drawn from — the same 14px dot against the same two-line block.
  // `.cf-flow-head` centres the dot on the *title's* row, which is right in the
  // modal (the `?` on that line changes height with the pointer) and wrong here,
  // where there is no `?` and the mark sat ~10px above every other one in the
  // section. Only a browser can see it: jsdom lays nothing out.
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto(urlFor('quick-plain'));
    await expect(page.locator('.cf-card[data-sheet="review"]')).toBeVisible({ timeout: 20_000 });

    await openSetupPanel(page);
    const setup = page.locator('.cf-card[data-sheet="setup"]');
    await expect(setup).toBeVisible({ timeout: 20_000 });

    // "Application type" — step 3 of 6, the one step that states a conclusion.
    await setup.locator('.cf-rail-node').nth(2).click();
    await expect(setup.locator('.cf-step-count')).toHaveText('Step 3 of 6');

    const banner = setup.locator('.cf-verdict');
    await expect(banner).toBeVisible();
    const head = (await banner.locator('.cf-flow-head').boundingBox())!;
    const dot = (await banner.locator('.cf-dot').boundingBox())!;
    expect(dot.y + dot.height / 2, 'the dot centres on the whole banner').toBeCloseTo(
      head.y + head.height / 2,
      0,
    );
  } finally {
    await page.close();
  }
});

/* ==================================================================
 * Surfaces that had no coverage at all.
 *
 * The Sync tab's network half is proved against a fake Google in
 * `src/background/*.test.ts`; what belongs here is everything reachable
 * *without* Google — which is the whole of the setup the user has to get right
 * before Connect will work, and the backup file that exists for people who
 * would rather not connect anything.
 * ================================================================== */

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

test('Sync: a backup file round-trips, and combines rather than replacing', async () => {
  await seedJobUrls([jobEntry('https://backup.example/1')]);

  const text = await onExtensionPage(async (page) => {
    await page.click('#tab-sync');
    return downloadedText(page, 'sync-export');
  });

  const snapshot = JSON.parse(text);
  expect(snapshot.jobUrls.map((e: JobUrlEntry) => e.url)).toEqual(['https://backup.example/1']);

  // A different posting is here now. Importing must not put the machine back to
  // how it was — the file is combined in, exactly as syncing would.
  await seedJobUrls([jobEntry('https://backup.example/2')]);

  await onExtensionPage(async (page) => {
    await page.click('#tab-sync');
    await page.setInputFiles('#sync-import-input', {
      name: 'job-database-test.json', mimeType: 'application/json', buffer: Buffer.from(text),
    });
    await expect(page.locator('#sync-file-status')).toContainText('Combined');
  });

  expect((await readJobUrls()).map((e) => e.url).sort())
    .toEqual(['https://backup.example/1', 'https://backup.example/2']);
});

test('Sync: an unreadable backup is refused without touching the database', async () => {
  await seedJobUrls([jobEntry('https://keep.example/1')]);

  await onExtensionPage(async (page) => {
    await page.click('#tab-sync');
    await page.setInputFiles('#sync-import-input', {
      name: 'holiday-photo.json', mimeType: 'application/json', buffer: Buffer.from('not json at all'),
    });
    await expect(page.locator('#sync-file-status')).toContainText('not a job database backup');
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
    jobEntry('https://beta.example/jobs/2', { status: 'applied' }),
  ]);

  await onExtensionPage(async (page) => {
    await page.click('#tab-queue');
    await expect(page.locator('#urls-list li')).toHaveCount(2);

    // Filter chips carry their own counts, so the filter is legible before it
    // is pressed.
    await page.click('#url-filters button:has-text("Applied")');
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
    // Named count, and a warning that the archive goes too — this one is not undoable.
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

test('Options: a broken site config is named and refused, not saved', async () => {
  await onExtensionPage(async (page) => {
    await page.click('#tab-sites');
    const before = await page.evaluate(async () =>
      (await chrome.storage.local.get('siteConfigs')).siteConfigs.length);

    await page.fill('#configs-json', '[{ "urlPatterns": ["*://x/*"], "extract": {} }]');
    await page.click('#save-configs');
    // A config with no id cannot be matched, saved against, or explained.
    await expect(page.locator('#configs-status')).toContainText('id');

    await page.fill('#configs-json', 'not json');
    await page.click('#save-configs');
    await expect(page.locator('#configs-status')).not.toHaveText('Saved');

    const after = await page.evaluate(async () =>
      (await chrome.storage.local.get('siteConfigs')).siteConfigs.length);
    expect(after).toBe(before);
  });
});

/* ---------------- Recording a site by applying to one job ---------------- */

/**
 * Read the site config that matches a URL — what a recording is judged by. The whole
 * point of the feature is the config that comes out, so these assert that and not
 * what the panel looked like on the way.
 */
async function configFor(url: string): Promise<Record<string, unknown> | undefined> {
  return onExtensionPage((ext) => ext.evaluate(async (u) => {
    const { siteConfigs = [] } = await chrome.storage.local.get('siteConfigs');
    const glob = (p: string) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')}$`).test(u);
    return siteConfigs.find((c: { urlPatterns: string[] }) => c.urlPatterns.some(glob));
  }, url));
}

/** Forget every config, so a recording is judged on what it wrote and nothing else. */
async function clearConfigs(): Promise<void> {
  await onExtensionPage((ext) => ext.evaluate(async () => {
    await chrome.storage.local.set({ siteConfigs: [] });
  }));
}

const bar = (page: Page) => page.locator('[data-cf-recorder="host"] .cf-bar');

/**
 * The chips naming each mark on the page. They are `aria-hidden` — the panel's rows
 * are the accessible surface and these are the sighted shortcut to them — so they are
 * found by attribute and text rather than by role.
 */
const mark = (page: Page, name: string) =>
  page.locator('[data-cf-tag]').filter({ hasText: new RegExp(`^${name}`) });

/**
 * Arm one page action. The page is inert while a recording runs, so *every* gesture
 * in these specs has to be paid for first — which is the feature, and what makes an
 * unarmed click below a real assertion rather than a formality.
 */
async function interact(page: Page): Promise<void> {
  await bar(page).getByRole('button', { name: 'Interact', exact: true }).click();
}

/** Arm, then press something on the page. */
async function press(page: Page, selector: string): Promise<void> {
  await interact(page);
  await page.click(selector);
}

/**
 * Arm, click into a field, type, and tab out. `fill()` cannot be used here: it sets
 * the value without a click, so the arm is never spent on the control and the page
 * never goes live for it — which is exactly the protection being tested.
 */
async function type(page: Page, selector: string, value: string): Promise<void> {
  await interact(page);
  await page.click(selector);
  await page.keyboard.type(value);
  await page.keyboard.press('Tab');
}

/** Say what something on the page is, then point at it. */
async function declare(page: Page, item: string): Promise<void> {
  await bar(page).getByRole('button', { name: 'Declare…', exact: true }).click();
  await bar(page).getByRole('menuitem', { name: item, exact: true }).click();
}

/** How many steps the bar says it is holding. */
async function stepCount(page: Page): Promise<string> {
  return (await bar(page).locator('.cf-rec-count').textContent()) ?? '';
}

/** Throw the recording away: press Reset, then answer the warning behind it. */
async function startOver(page: Page): Promise<void> {
  await bar(page).getByRole('button', { name: 'Reset', exact: true }).click();
  await bar(page).getByRole('button', { name: 'Start over', exact: true }).click();
}

test('Recording: one application on this site becomes the whole config', async () => {
  await clearConfigs();
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(urlFor('record-internal'));
    await openSetupPanel(page);

    const setup = page.locator('.cf-card[data-sheet="setup"]');
    await expect(setup).toBeVisible({ timeout: 20_000 });

    // The offer has no footer, so recording is the only way on. It carried "Set up by
    // hand ›" — which pointed at the six-step wizard from the one screen built to
    // avoid it — and a "Done" that closed the panel having taught the extension
    // nothing. The header × still minimizes, which is the way to get it out of the way.
    await expect(setup.locator('.cf-footer')).toHaveCount(0);
    await expect(setup.locator('.cf-rail')).toHaveCount(0);
    // And it says what it can already read, so "teach me this site" is a concrete ask
    // rather than a blank one. `not on this page` and never "unmatched": detection
    // returns a row per *wanted* field, so most of the sixteen are grey on any form.
    await expect(setup.locator('.cf-detected .cf-summary')).toContainText('not on this page');
    await expect(setup.locator('.cf-detected .cf-summary')).not.toContainText('unmatched');
    await expect(setup.locator('.cf-detected-chips .chip').filter({ hasText: 'Email' }))
      .toBeVisible();

    await setup.getByRole('button', { name: 'Apply on this site' }).click();
    await expect(bar(page)).toBeVisible({ timeout: 10_000 });

    // The page is marked up by name for the whole recording. The panel is a pill by
    // now, so this is the only thing on screen saying which control is which — and a
    // coloured outline alone never could.
    await expect(mark(page, 'Email')).toBeVisible();
    const chip = (await mark(page, 'Email').boundingBox())!;
    const field = (await page.locator('#email').boundingBox())!;
    // Above the control and aligned to its right-hand edge. Right, because the gap
    // above a form control is where the form's own <label> lives — a chip pinned
    // above-left sits on top of the very words it is echoing, on every field of
    // every form. Labels are short and controls are wide, so the right end is free.
    expect(chip.y + chip.height).toBeLessThanOrEqual(field.y + 1);
    expect(Math.abs((chip.x + chip.width) - (field.x + field.width))).toBeLessThan(4);

    // The page is held still until something is armed. Reading a posting means
    // pressing things, and `prep` replays on every later visit — so a press nobody
    // asked to record must leave nothing behind and do nothing.
    const before = await stepCount(page);
    await page.click('#first_name');
    await page.click('#submit');
    await expect(page.locator('#quick-success')).toBeHidden();
    expect(await stepCount(page)).toBe(before);

    // Apply the way a person would, saying so each time.
    await type(page, '#email', 'ada@example.com');
    await type(page, '#first_name', 'Ada');
    await press(page, '#submit');
    await expect(page.locator('#quick-success')).toBeVisible();

    // The confirmation is the one thing that cannot be what you just pressed — it
    // appears *because* the application went in — so it is declared and pointed at.
    await declare(page, 'Confirmation');
    await pickOnPage(page, page.locator('#quick-success'));

    await bar(page).getByRole('button', { name: 'Done' }).click();
    await expect(setup.getByText('Check what was recorded')).toBeVisible({ timeout: 10_000 });
    await setup.getByRole('button', { name: 'Save setup' }).click();

    // Save reports, it does not become the wizard. This used to drop the user four
    // steps into the manual surface with nothing saying the recording had worked —
    // and this recording marked everything, so the wizard is a detour and Done is
    // the coral one.
    await expect(setup.getByText('Site setup saved')).toBeVisible({ timeout: 10_000 });
    await expect(setup.locator('.cf-rail')).toHaveCount(0);
    await expect(setup.getByRole('button', { name: 'Review configuration' })).toBeVisible();

    const config = await configFor(urlFor('record-internal'));
    // The two rows that gate Apply, which the wizard buried at the end of a queue of
    // twenty-five and which almost nobody ever set.
    expect(config?.submitSelector).toBeTruthy();
    expect(config?.successSelector).toBeTruthy();
    expect(config?.fieldOverrides).toMatchObject({ email: expect.any(String) });

    // The rule the whole compiler is built around: `prep` runs automatically on every
    // later visit, so the click that sent this application must not be in it.
    const prep = JSON.stringify(config?.prep ?? []);
    expect(prep).not.toContain(config?.submitSelector as string);
    expect(prep).not.toContain('#submit');

    // …and Done is the way out of the panel, not a way further into it.
    await setup.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('.cf-card[data-sheet="setup"]')).toHaveCount(0);

    // Done destroys the panel, so Site setup has to be able to build a new one —
    // the sequence the saved screen created and the one nothing else covers. It
    // opens on the wizard now, because the recording configured the site.
    await openSetupPanel(page);
    await expect(page.locator('.cf-card[data-sheet="setup"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.cf-rail')).toBeVisible();
  } finally {
    await page.close();
  }
});

test('Recording: a handoff is saved as two configs, one per site', async () => {
  await clearConfigs();
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(urlFor('record-external'));
    await openSetupPanel(page);

    const setup = page.locator('.cf-card[data-sheet="setup"]');
    await expect(setup).toBeVisible({ timeout: 20_000 });
    await setup.getByRole('button', { name: 'Apply on the employer’s site' }).click();
    await expect(bar(page)).toBeVisible({ timeout: 10_000 });

    // The board's own courtesy first, then the handoff the user performs themselves —
    // `run()` stands down while recording, so nothing follows this on our behalf.
    await press(page, '#save-job');
    await press(page, '#apply-external');
    await page.waitForURL(/ats-form/, { timeout: 15_000 });

    // The recording survived the navigation to another origin, where the content
    // script is a brand-new one that has never heard of the posting.
    await expect(bar(page)).toBeVisible({ timeout: 15_000 });

    // And the employer's form is marked up too — the leg that used to have nothing at
    // all, because nothing here had ever run detection. It is also the leg with no
    // site config: `findMatchingConfig` finds none on this origin and
    // `ensureConfigForUrl` deliberately does not run until Save, so the sweep has to
    // mean "the heuristics, and nothing saved" rather than throw.
    await expect(mark(page, 'Email')).toBeVisible({ timeout: 10_000 });

    await type(page, '#ats-email', 'ada@example.com');
    await press(page, '#ats-submit');
    await expect(page.locator('#ats-success')).toBeVisible({ timeout: 10_000 });
    await declare(page, 'Confirmation');
    await pickOnPage(page, page.locator('#ats-success'));

    await bar(page).getByRole('button', { name: 'Done' }).click();
    const atsSetup = page.locator('.cf-card[data-sheet="setup"]');
    await expect(atsSetup.getByText('Check what was recorded')).toBeVisible({ timeout: 10_000 });
    await atsSetup.getByRole('button', { name: 'Save setup' }).click();

    // The board learns how to leave; the employer learns how to be filled and sent.
    const board = await configFor(urlFor('record-external'));
    expect((board?.redirect as { applySelector?: string })?.applySelector).toBeTruthy();
    expect(board?.submitSelector).toBeFalsy();

    const employer = await configFor(ATS_URL);
    expect(employer?.submitSelector).toBeTruthy();
    expect(employer?.successSelector).toBeTruthy();
    expect(employer?.fieldOverrides).toMatchObject({ email: expect.any(String) });
  } finally {
    await page.close();
  }
});

test('Recording: the Declare menu holds its place while the clock ticks', async () => {
  // The bar repainted itself once a second to advance the elapsed time, which
  // rebuilt the open menu with it — so scrolling down to a profile field, or to
  // the description, was a race against a one-second timer. Scroll is layout, and
  // layout is invisible to vitest; this is the half that has to be measured in a
  // real browser.
  await clearConfigs();
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(urlFor('record-internal'));
    await openSetupPanel(page);

    const setup = page.locator('.cf-card[data-sheet="setup"]');
    await expect(setup).toBeVisible({ timeout: 20_000 });

    // The offer has no footer, so recording is the only way on. It carried "Set up by
    // hand ›" — which pointed at the six-step wizard from the one screen built to
    // avoid it — and a "Done" that closed the panel having taught the extension
    // nothing. The header × still minimizes, which is the way to get it out of the way.
    await expect(setup.locator('.cf-footer')).toHaveCount(0);
    await expect(setup.locator('.cf-rail')).toHaveCount(0);
    // And it says what it can already read, so "teach me this site" is a concrete ask
    // rather than a blank one. `not on this page` and never "unmatched": detection
    // returns a row per *wanted* field, so most of the sixteen are grey on any form.
    await expect(setup.locator('.cf-detected .cf-summary')).toContainText('not on this page');
    await expect(setup.locator('.cf-detected .cf-summary')).not.toContainText('unmatched');
    await expect(setup.locator('.cf-detected-chips .chip').filter({ hasText: 'Email' }))
      .toBeVisible();

    await setup.getByRole('button', { name: 'Apply on this site' }).click();
    await expect(bar(page)).toBeVisible({ timeout: 10_000 });

    // The page is marked up by name for the whole recording. The panel is a pill by
    // now, so this is the only thing on screen saying which control is which — and a
    // coloured outline alone never could.
    await expect(mark(page, 'Email')).toBeVisible();
    const chip = (await mark(page, 'Email').boundingBox())!;
    const field = (await page.locator('#email').boundingBox())!;
    // Above the control and aligned to its right-hand edge. Right, because the gap
    // above a form control is where the form's own <label> lives — a chip pinned
    // above-left sits on top of the very words it is echoing, on every field of
    // every form. Labels are short and controls are wide, so the right end is free.
    expect(chip.y + chip.height).toBeLessThanOrEqual(field.y + 1);
    expect(Math.abs((chip.x + chip.width) - (field.x + field.width))).toBeLessThan(4);

    await bar(page).getByRole('button', { name: 'Declare…', exact: true }).click();
    const menu = bar(page).locator('.cf-rec-menu');
    await expect(menu).toBeVisible();

    // The list is ~28 marks in a 60vh box, so there is genuinely somewhere to go.
    const scrolled = await menu.evaluate((el) => {
      el.scrollTop = 200;
      return el.scrollTop;
    });
    expect(scrolled).toBeGreaterThan(0);

    // A mark on the element itself, so "the same list" is a fact about the node and
    // not just about what it happens to be showing. A repaint would leave it behind.
    await menu.evaluate((el) => el.setAttribute('data-probe', '1'));

    const clock = await bar(page).locator('.cf-rec-clock').textContent();
    await page.waitForTimeout(2200);

    expect(await bar(page).locator('.cf-rec-clock').textContent()).not.toBe(clock);
    expect(await menu.getAttribute('data-probe')).toBe('1');
    expect(await menu.evaluate((el) => el.scrollTop)).toBe(scrolled);
  } finally {
    await page.close();
  }
});


test('Recording: Reset throws the steps away and puts the page back', async () => {
  // Undo can only take a step out of the *list*; it cannot take back what the step
  // did. So Reset reloads — a clean list against a page still carrying the effects of
  // six recorded clicks is the half-fix, and the one that quietly compiles a `prep`
  // list for a state no later visit ever reaches. The reload is the assertion.
  await clearConfigs();
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(urlFor('record-internal'));
    await openSetupPanel(page);

    const setup = page.locator('.cf-card[data-sheet="setup"]');
    await expect(setup).toBeVisible({ timeout: 20_000 });

    // The offer has no footer, so recording is the only way on. It carried "Set up by
    // hand ›" — which pointed at the six-step wizard from the one screen built to
    // avoid it — and a "Done" that closed the panel having taught the extension
    // nothing. The header × still minimizes, which is the way to get it out of the way.
    await expect(setup.locator('.cf-footer')).toHaveCount(0);
    await expect(setup.locator('.cf-rail')).toHaveCount(0);
    // And it says what it can already read, so "teach me this site" is a concrete ask
    // rather than a blank one. `not on this page` and never "unmatched": detection
    // returns a row per *wanted* field, so most of the sixteen are grey on any form.
    await expect(setup.locator('.cf-detected .cf-summary')).toContainText('not on this page');
    await expect(setup.locator('.cf-detected .cf-summary')).not.toContainText('unmatched');
    await expect(setup.locator('.cf-detected-chips .chip').filter({ hasText: 'Email' }))
      .toBeVisible();

    await setup.getByRole('button', { name: 'Apply on this site' }).click();
    await expect(bar(page)).toBeVisible({ timeout: 10_000 });

    // The page is marked up by name for the whole recording. The panel is a pill by
    // now, so this is the only thing on screen saying which control is which — and a
    // coloured outline alone never could.
    await expect(mark(page, 'Email')).toBeVisible();
    const chip = (await mark(page, 'Email').boundingBox())!;
    const field = (await page.locator('#email').boundingBox())!;
    // Above the control and aligned to its right-hand edge. Right, because the gap
    // above a form control is where the form's own <label> lives — a chip pinned
    // above-left sits on top of the very words it is echoing, on every field of
    // every form. Labels are short and controls are wide, so the right end is free.
    expect(chip.y + chip.height).toBeLessThanOrEqual(field.y + 1);
    expect(Math.abs((chip.x + chip.width) - (field.x + field.width))).toBeLessThan(4);

    await type(page, '#email', 'ada@example.com');
    await press(page, '#submit');
    await expect(page.locator('#quick-success')).toBeVisible();
    expect(await stepCount(page)).not.toContain('0 steps');

    await startOver(page);

    // A fresh content script on a fresh page, holding a recording with nothing in it.
    await expect(bar(page)).toBeVisible({ timeout: 15_000 });
    await expect(bar(page).locator('.cf-rec-count')).toContainText('0 steps');
    expect(page.url()).toBe(urlFor('record-internal'));
    // The page really was reloaded, so what the discarded steps did to it is gone too.
    await expect(page.locator('#quick-success')).toBeHidden();
    await expect(page.locator('#email')).toHaveValue('');
  } finally {
    await page.close();
  }
});

test('Recording: Reset from the employer’s site goes back to the posting', async () => {
  // The half that cannot be seen on one page: on the destination leg "start again"
  // means leaving the page you are looking at. `RECORD_START` is re-sent with the
  // recording's *own* postingUrl rather than `location.href`, or resetting here would
  // quietly redefine the posting as the employer's form and the handoff could never
  // be recorded again. The synthesized `navigate` step going with it is what says
  // `destinationUrl` was really cleared.
  await clearConfigs();
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(urlFor('record-external'));
    await openSetupPanel(page);

    const setup = page.locator('.cf-card[data-sheet="setup"]');
    await expect(setup).toBeVisible({ timeout: 20_000 });
    await setup.getByRole('button', { name: 'Apply on the employer’s site' }).click();
    await expect(bar(page)).toBeVisible({ timeout: 10_000 });

    await press(page, '#apply-external');
    await page.waitForURL(/ats-form/, { timeout: 15_000 });
    await expect(bar(page)).toBeVisible({ timeout: 15_000 });
    await type(page, '#ats-email', 'ada@example.com');

    await startOver(page);

    await page.waitForURL(urlFor('record-external'), { timeout: 15_000 });
    await expect(bar(page)).toBeVisible({ timeout: 15_000 });
    // Zero, not one: the `navigate` step a resumed recording synthesizes on arrival
    // would still be here if `destinationUrl` had survived the reset.
    await expect(bar(page).locator('.cf-rec-count')).toContainText('0 steps');
  } finally {
    await page.close();
  }
});
