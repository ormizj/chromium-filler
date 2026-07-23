/**
 * Per-page harness bootstrap. Loaded by dev/frame.html with `?page=…`:
 *
 *   popup | options  — pulls the REAL page HTML + stylesheet and runs the REAL
 *                      popup.ts / options.ts against the mocked `chrome.*`.
 *   modal | setup    — renders the REAL shadow-DOM surface (review modal, setup
 *                      panel) over a fake job posting, with representative data.
 *
 * The shadow surfaces are here because they are otherwise only reachable by
 * loading the built extension into a browser and driving a real site — which
 * makes iterating on them, or checking them at phone width, far too slow.
 */

import './mock-chrome';
import type { FieldMatch } from '../src/shared/types';
import type { SessionState } from '../src/shared/messages';
import { FillerModal } from '../src/content/modal/modal';
import { SetupPanel } from '../src/content/setupPanel';

type Page = 'popup' | 'options' | 'modal' | 'setup';

const params = new URLSearchParams(location.search);
const page = (params.get('page') as Page) || 'popup';

/* ---------------- Real extension pages ---------------- */

async function bootPage(name: 'popup' | 'options'): Promise<void> {
  const base = `/src/${name}`;
  const html = await (await fetch(`${base}/${name}.html`)).text();
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Re-attach the page's own stylesheet(s) with absolute hrefs.
  for (const link of Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))) {
    const href = link.getAttribute('href') || '';
    const abs = href.startsWith('.') ? `${base}/${href.replace(/^\.\//, '')}` : href;
    const el = document.createElement('link');
    el.rel = 'stylesheet';
    el.href = abs;
    document.head.appendChild(el);
  }

  // Inject the markup (innerHTML does NOT run the page's <script>, so popup.ts /
  // options.ts run exactly once — via the dynamic import below).
  document.body.innerHTML = doc.body.innerHTML;

  await import(/* @vite-ignore */ `${base}/${name}.ts`);
}

/* ---------------- Shadow-DOM surfaces ---------------- */

/** A plausible posting behind the sheet, so it is judged in context. */
function fakePosting(): void {
  document.body.style.cssText =
    'margin:0;padding:20px;font:15px/1.6 system-ui,sans-serif;background:#fff;color:#111827';
  document.body.innerHTML = `
    <h1 style="font-size:24px;margin:0 0 12px">Staff Platform Engineer</h1>
    <p style="color:#4b5563">Acme is hiring a Staff Platform Engineer to own the
    deployment pipeline end to end. You will work across infrastructure, developer
    tooling, and release engineering.</p>
    <label style="display:block;margin:16px 0 4px;font-weight:600">Full name</label>
    <input style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px" value="Ada Lovelace" />
    <label style="display:block;margin:16px 0 4px;font-weight:600">Email</label>
    <input style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px" value="ada@example.com" />
    <label style="display:block;margin:16px 0 4px;font-weight:600">Cover letter</label>
    <textarea rows="4" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px">I love building widgets.</textarea>
  `;
}

const match = (
  field: FieldMatch['field'],
  confidence: FieldMatch['confidence'],
  filled: boolean,
  extra: Partial<FieldMatch> = {},
): FieldMatch => ({
  field, confidence, filled, source: confidence === 'none' ? 'none' : 'heuristic',
  required: false, ...extra,
});

const SESSION: SessionState = {
  active: true,
  batchSize: 5,
  progress: { total: 60, queued: 46, inFlight: 5, applied: 8, skipped: 1, done: 9, ratio: 9 / 60 },
};

function bootModal(): void {
  fakePosting();
  const modal = new FillerModal({
    onRerun: () => console.log('[harness] re-run'),
    onReset: () => console.log('[harness] reset'),
    onSubmitCv: () => console.log('[harness] submit CV'),
    onConfirm: (f) => console.log('[harness] confirm', f),
    onPick: (f) => console.log('[harness] pick', f),
    onFollow: () => console.log('[harness] follow'),
    onFillAnyway: () => console.log('[harness] fill anyway'),
    onSkip: () => console.log('[harness] skip'),
    onClose: () => modal.minimize(),
  });

  modal.render({
    siteName: 'Acme Careers',
    jobTitle: 'Staff Platform Engineer',
    jobDescription: 'Acme is hiring a Staff Platform Engineer to own the deployment '
      + 'pipeline end to end. You will work across infrastructure, developer tooling, '
      + 'and release engineering.',
    jobRequirements: '8+ years, Kubernetes, Go or Rust, on-call experience.',
    matches: [
      match('fullName', 'high', true, { valueToFill: 'Ada Lovelace', selectorUsed: '#name' }),
      match('email', 'high', true, { valueToFill: 'ada@example.com', selectorUsed: '#email' }),
      // A low-confidence row: the only shape with two actions (Confirm + Pick).
      match('phone', 'low', false, { valueToFill: '+1 555 123 4567', selectorUsed: '.field input:nth-of-type(3)' }),
      match('coverLetter', 'high', true, { valueToFill: 'I love building widgets.', selectorUsed: 'textarea' }),
      match('city', 'none', false),
      match('resume', 'high', true, { selectorUsed: 'input[type=file]' }),
    ],
    canSubmitCv: true,
    // `?session=1` shows the queue strip and the overflow menu that holds
    // Submit CV / Re-run / Reset while a session is running.
    session: params.get('session') === '1' ? SESSION : undefined,
    via: params.get('via') === '1' ? 'boards.example' : undefined,
  });
}

function bootSetup(): void {
  fakePosting();
  const panel = new SetupPanel({
    onAddPrep: (a, l) => console.log('[harness] add prep', a, l),
    onPickPrepTarget: (i, l) => console.log('[harness] pick prep', i, l),
    onMovePrep: (i, d, l) => console.log('[harness] move prep', i, d, l),
    onRemovePrep: (i, l) => console.log('[harness] remove prep', i, l),
    onSetPrepMs: (i, ms, l) => console.log('[harness] prep ms', i, ms, l),
    onRunPrep: () => console.log('[harness] run prep'),
    onPickContainer: (k) => console.log('[harness] pick container', k),
    onClearContainer: (k) => console.log('[harness] clear container', k),
    onPickField: (f) => console.log('[harness] pick field', f),
    onClearField: (f) => console.log('[harness] clear field', f),
    onPickRedirect: (k) => console.log('[harness] pick redirect', k),
    onClearRedirect: (k) => console.log('[harness] clear redirect', k),
    onRename: (n, p) => console.log('[harness] rename', n, p),
    onOpenOptions: () => console.log('[harness] open options'),
    onClose: () => console.log('[harness] close setup'),
  });

  panel.render({
    name: 'Acme Careers',
    urlPattern: '*://careers.acme.test/*',
    prep: [
      { action: 'click', selector: '#expand-description', resolves: true },
      { action: 'waitFor', selector: '#application_form', ms: 10000, resolves: false },
      { action: 'delay', ms: 500 },
    ],
    containers: [
      { key: 'jobTitle', label: 'Job title', status: 'high', note: 'auto · Staff Platform Engineer', hasSave: false },
      { key: 'jobDescription', label: 'Description', status: 'high', note: 'saved · Acme is hiring a Staff…', hasSave: true },
      { key: 'jobRequirements', label: 'Requirements', status: 'none', note: 'not set', hasSave: false },
    ],
    fields: [
      { key: 'fullName', label: 'Full name', status: 'high', note: 'auto · #name', hasSave: false },
      { key: 'email', label: 'Email', status: 'high', note: 'auto · #email', hasSave: false },
      { key: 'phone', label: 'Phone', status: 'low', note: 'auto (low) · .field input:nth-of-type(3)', hasSave: false },
      { key: 'city', label: 'City', status: 'none', note: 'not found', hasSave: false },
      { key: 'resume', label: 'Résumé / CV', status: 'high', note: 'saved · input[type=file]', hasSave: true },
    ],
    verdict: 'Quick apply (assumed) — no external apply link found on this page',
    redirect: [
      { key: 'applySelector', label: 'External apply link', status: 'none', note: 'not set', hasSave: false },
      { key: 'quickApplySelector', label: 'Quick-apply marker', status: 'high', note: 'saved · #application_form', hasSave: true },
      { key: 'markerSelector', label: 'External marker', status: 'none', note: 'not set', hasSave: false },
    ],
    beforeFollow: [{ action: 'click', selector: '#save-job', resolves: true }],
  });
}

const BOOT: Record<Page, () => void | Promise<void>> = {
  popup: () => bootPage('popup'),
  options: () => bootPage('options'),
  modal: bootModal,
  setup: bootSetup,
};

// Resolve the booter BEFORE calling it: `BOOT[page]?.() ?? bootPage('popup')`
// falls through for every void booter, since they return undefined too.
const boot = BOOT[page] ?? BOOT.popup;
Promise.resolve(boot()).catch((e) => console.error('[harness] failed to boot', page, e));
