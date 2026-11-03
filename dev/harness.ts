/**
 * Per-page harness bootstrap. Loaded by dev/frame.html with `?page=…`:
 *
 *   popup | options  — pulls the REAL page HTML + stylesheet and runs the REAL
 *                      popup.ts / options.ts against the mocked `chrome.*`.
 *   modal            — renders the REAL shadow-DOM review card over a fake job
 *                      posting, with representative data.
 *   chip             — the REAL queue chip over a fake posting, beside the card's
 *                      folded pill — the two things in the page's corners.
 *
 * The shadow surfaces are here because they are otherwise only reachable by
 * loading the built extension into a browser and driving a real site — which
 * makes iterating on them, or checking them at phone width, far too slow.
 *
 * `&state=…` picks WHICH rendering the surface is showing — most of them are
 * otherwise reachable only by driving a real site, or by pressing something a
 * screenshot cannot press. `test/fixtures/scenarios.mjs` is the same list of
 * flows, as real pages.
 */

import './mock-chrome';
import type { FieldMatch } from '../src/shared/types';
import type { SessionState } from '../src/shared/messages';
import { DEFAULT_MODAL_LAYOUT } from '../src/shared/modalLayout';
import {
  FillerModal, type ModalCallbacks, type ModalData,
} from '../src/content/modal/modal';
import { QueueChip } from '../src/content/queueChip';

type Page = 'popup' | 'options' | 'modal' | 'chip';
/** Which flow the surface is rendering — see `MODAL_STATES`. */
type State = string;

const params = new URLSearchParams(location.search);
const page = (params.get('page') as Page) || 'popup';
const state: State = params.get('state') || 'default';

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

  // The Profile tab's newer sections, by deep link — the same `#tab&at=` routes the
  // extension itself uses, so the harness lands where a real link would.
  const deepLinks: Record<string, string> = {
    profile: 'profile',
    'custom-fields': 'profile&at=custom-section',
    learned: 'profile&at=learned-section',
    typed: 'profile&at=typed-section',
    wordings: 'profile&at=wordings',
    // The Sync tab, at its "What syncs" lists.
    sync: 'sync&at=sync-scope-heading',
  };
  if (name === 'options' && deepLinks[state]) history.replaceState(null, '', `#${deepLinks[state]}`);

  await import(/* @vite-ignore */ `${base}/${name}.ts`);

  // A closed <details> is a state a screenshot cannot reach: opening it takes a
  // click, and the whole point of the harness is that it does not.
  if (state === 'wordings') {
    const panel = document.getElementById('wordings') as HTMLDetailsElement | null;
    if (panel) panel.open = true;
  }

  // Help → Setting up sync, reached the way a user reaches it: the Sync tab's
  // button, pressed once options.ts has finished booting and wired it.
  if (state === 'sync-guide') {
    const press = () => document.getElementById('sync-guide-open')?.click();
    if (document.body.dataset.ready) press();
    else new MutationObserver((_, obs) => {
      if (!document.body.dataset.ready) return;
      obs.disconnect();
      press();
    }).observe(document.body, { attributes: true, attributeFilter: ['data-ready'] });
  }
}

/* ---------------- Shadow-DOM surfaces ---------------- */

/** A plausible posting behind the sheet, so it is judged in context. */
function fakePosting(): void {
  document.body.style.cssText =
    'margin:0;padding:20px;font:15px/1.6 system-ui,sans-serif;background:#fff;color:#111827';
  // The controls carry real handles — `for`/`id`, a `name`, a file input — so it is
  // a fair stand-in for a job form: a posting whose fields nothing can identify is not one.
  const field = 'width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px';
  const lbl = 'display:block;margin:16px 0 4px;font-weight:600';
  document.body.innerHTML = `
    <h1 style="font-size:24px;margin:0 0 12px">Staff Platform Engineer</h1>
    <p style="color:#4b5563">Acme is hiring a Staff Platform Engineer to own the
    deployment pipeline end to end. You will work across infrastructure, developer
    tooling, and release engineering.</p>
    <label for="full_name" style="${lbl}">Full name</label>
    <input id="full_name" name="full_name" style="${field}" value="Ada Lovelace" />
    <label for="email" style="${lbl}">Email</label>
    <input id="email" name="email" type="email" style="${field}" value="ada@example.com" />
    <label for="phone" style="${lbl}">Phone</label>
    <input id="phone" name="phone" style="${field}" />
    <label for="cover_letter" style="${lbl}">Cover letter</label>
    <textarea id="cover_letter" name="cover_letter" rows="4" style="${field}">I love building widgets.</textarea>
    <label for="resume" style="${lbl}">Résumé / CV</label>
    <input id="resume" name="resume" type="file" style="margin-top:4px" />
  `;
}

let nextRow = 1;
const match = (
  question: string,
  field: string | undefined,
  confidence: FieldMatch['confidence'],
  filled: boolean,
  extra: Partial<FieldMatch> = {},
): FieldMatch => ({
  id: `r${nextRow++}`,
  question,
  kind: 'text',
  field,
  fieldLabel: field ? (LABELS[field] ?? field) : undefined,
  confidence,
  filled,
  source: confidence === 'none' ? 'none' : 'heuristic',
  required: false,
  ...extra,
});

const LABELS: Record<string, string> = {
  fullName: 'Full name', email: 'Email', phone: 'Phone', city: 'City', country: 'Country',
  coverLetter: 'Cover letter', resume: 'Résumé / CV', firstName: 'First name', c_exp: 'Years of experience',
};

const SESSION: SessionState = {
  active: true,
  batchSize: 5,
  progress: { total: 60, queued: 46, inFlight: 5, done: 9, ratio: 9 / 60 },
};

/**
 * The report a filled posting produces — one row of every shape, in the order
 * the engine settles them at the first sweep: new, then to check, then filled.
 * The card renders this verbatim.
 */
const REPORT: FieldMatch[] = [
  match('How did you hear about us?', undefined, 'none', false, { required: true }),
  match('Where are you based?', undefined, 'none', false),
  // A guess with something to fill it with — left for the user to type.
  match('Mobile', 'phone', 'low', false, { kind: 'tel', valueToFill: '+1 555 123 4567' }),
  match('Résumé / CV', 'resume', 'high', true, { kind: 'file', valueToFill: 'ada-lovelace-cv.pdf' }),
  match('Cover letter', 'coverLetter', 'high', true, { kind: 'textarea', valueToFill: 'I love building widgets.' }),
  match('Email', 'email', 'high', true, { kind: 'email', valueToFill: 'ada@example.com' }),
  match('Full name', 'fullName', 'high', true, { valueToFill: 'Ada Lovelace' }),
  match('Years of experience', 'c_exp', 'high', true, { source: 'keyword', valueToFill: '7' }),
];

const BASE_MODAL: ModalData = {
  siteName: 'jobs.acme.test',
  matches: REPORT,
  on: true,
  // What a fresh install gets. Without it the card falls back to the CSS
  // defaults, which is a size no real user would ever see.
  layout: DEFAULT_MODAL_LAYOUT,
};

/**
 * A report of realistic length: a long application form. The body scroll and the
 * row rhythm only misbehave at length, and a nine-row report proves nothing.
 */
const LONG_REPORT: FieldMatch[] = [
  ...REPORT,
  match('Phone', 'phone', 'high', true, { kind: 'tel', valueToFill: '+1 555 123 4567' }),
  match('LinkedIn profile', 'linkedin', 'high', true, { kind: 'url', valueToFill: 'linkedin.com/in/ada' }),
  match('Portfolio', 'website', 'low', false, { kind: 'url', valueToFill: 'ada.dev' }),
  match('City', 'city', 'high', true, { valueToFill: 'London' }),
  match('Notice period', undefined, 'none', false),
  match('Salary expectation', undefined, 'none', false, { kind: 'number' }),
  match('Do you need visa sponsorship?', 'c_visa', 'high', true, { kind: 'radio', source: 'keyword', valueToFill: 'No' }),
  match('Pronouns', undefined, 'none', false, { kind: 'select' }),
  match('Anything else we should know?', undefined, 'none', false, { kind: 'textarea' }),
];

/**
 * One entry per rendering the card can be in — most of them reachable on a real
 * page only by typing into it, which a screenshot cannot do.
 */
const MODAL_STATES: Record<string, Partial<ModalData>> = {
  default: {},
  // A full-length form: the state that exercises the body scroll.
  long: { matches: LONG_REPORT },
  // Dragged into the right-hand edge and tall enough to be pinned top and bottom:
  // the flush rule in one screenshot. Desktop width only.
  flush: {
    matches: LONG_REPORT,
    layout: { right: 0, bottom: 0, width: 460, height: 4000 },
  },
  // Confident matches the control would not take — a <select> with no matching
  // option. Reads as "to check", never as filled.
  'failed-fill': {
    matches: [
      match('Full name', 'fullName', 'high', true, { valueToFill: 'Ada Lovelace' }),
      match('Country', 'country', 'high', false, { kind: 'select', valueToFill: 'US' }),
      match('Phone', 'phone', 'high', false, { kind: 'tel' }),
      match('City', 'city', 'high', false, { kind: 'text', kept: true, valueToFill: 'London' }),
    ],
  },
  // What typing does to the report: a question learned from the user's answer, one
  // they answered that is not one of their details, and one set aside because they
  // typed over our fill with something unrelated.
  learned: {
    matches: [
      match('How did you hear about us?', undefined, 'none', false, { answered: true }),
      match('Where are you based?', 'city', 'high', false, { source: 'lesson', learned: true, answered: true, valueToFill: 'London' }),
      match('Last employer', undefined, 'none', false, { learned: true, ignored: true, answered: true }),
      match('First name', 'firstName', 'high', false, { answered: true, saved: true, valueToFill: 'John' }),
      ...REPORT.slice(2),
    ],
  },
  // The always-on pill on a page with nothing to fill: "On · learning". Folded,
  // because that is how every page shows it.
  watching: { matches: [] },
  // The pill naming a field it just learned, for the moment it does.
  'just-learned': { flash: { learned: 'City' } },
  // A correction just saved to the profile: the pill names it, with Undo beside it.
  // `&open=1` shows the same note in the open card's footer.
  saved: { flash: { saved: 'First name', undo: true } },
  // The card's switch just turned the extension off: the pill says so, then goes.
  paused: { on: false, flash: { paused: true } },
  // Fields that arrived after the first sweep — the form behind "Apply now".
  'appeared-later': {
    matches: [
      ...REPORT.slice(3),
      match('Do you need visa sponsorship?', 'c_visa', 'high', true, { kind: 'radio', source: 'keyword', valueToFill: 'No', later: true }),
      match('Notice period', undefined, 'none', false, { later: true }),
      match('Salary expectation', undefined, 'none', false, { later: true, kind: 'number' }),
    ],
  },
  // A posting the database already has as applied.
  'already-done': { alreadyDone: true, doneAt: Date.UTC(2026, 4, 12) },
  // A page full of questions none of which are known yet.
  nothing: {
    matches: [
      match('Preferred name', undefined, 'none', false),
      match('Pronouns', undefined, 'none', false, { kind: 'select' }),
      match('Notice period', undefined, 'none', false),
      match('', undefined, 'none', false, { kind: 'checkbox' }),
    ],
  },
  // An empty profile: the banner that blames the profile, not the page.
  empty: { matches: [match('Email', 'email', 'high', false, { kind: 'email' })], profileEmpty: true },
  // No inputs on the page yet at all.
  bare: { matches: [] },
};

/**
 * Everything the real controller does, as a log line. Shared with the `pills`
 * state below, which needs a second modal purely to have a second pill.
 */
function modalCallbacks(self: () => FillerModal | undefined): ModalCallbacks {
  return {
    onRerun: () => console.log('[harness] fill again'),
    onSkip: () => console.log('[harness] skip'),
    onToggle: (on) => console.log('[harness] switch', on),
    onClose: () => self()?.minimize(),
    onUndo: () => console.log('[harness] undo'),
    onFold: (c) => console.log('[harness] modal folded', c),
    onLayoutChange: (l) => console.log('[harness] layout', l),
  };
}

function bootModal(): void {
  fakePosting();
  let modal: FillerModal;
  modal = new FillerModal(modalCallbacks(() => modal));
  // The pill states are the folded card; the rest open on the report.
  // `saved` is a pill state too, unless `&open=1` asks for the open card's note.
  const pillStates = ['pill-only', 'watching', 'just-learned', 'paused'];
  if (pillStates.includes(state) || (state === 'saved' && params.get('open') !== '1')) modal.minimize();

  modal.render({
    ...BASE_MODAL,
    ...(MODAL_STATES[state] ?? {}),
    // `?session=1` (or `&queue=1`) is a queue tab: the strip and Skip → next.
    queue: params.get('session') === '1' || params.get('queue') === '1' ? SESSION : undefined,
  });
}

/**
 * The queue chip in its corner, and the card's pill in the other — the two things
 * the extension leaves on a page. `&open=1` expands the card, which on a phone
 * hides the chip (the sheet covers the bottom of the screen).
 */
function bootChip(): void {
  fakePosting();
  const chip = new QueueChip(() => console.log('[harness] chip pressed'));
  chip.render(SESSION.progress);
  let modal: FillerModal;
  modal = new FillerModal({
    ...modalCallbacks(() => modal),
    onFold: (collapsed) => chip.setCardOpen(!collapsed),
  });
  const open = params.get('open') === '1';
  if (!open) modal.minimize();
  modal.render({ ...BASE_MODAL, queue: SESSION });
  chip.setCardOpen(open);
}

const BOOT: Record<Page, () => void | Promise<void>> = {
  popup: () => bootPage('popup'),
  options: () => bootPage('options'),
  modal: bootModal,
  chip: bootChip,
};

// Resolve the booter BEFORE calling it: `BOOT[page]?.() ?? bootPage('popup')`
// falls through for every void booter, since they return undefined too.
const boot = BOOT[page] ?? BOOT.popup;
Promise.resolve(boot()).catch((e) => console.error('[harness] failed to boot', page, e));
