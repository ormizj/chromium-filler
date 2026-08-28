/**
 * Per-page harness bootstrap. Loaded by dev/frame.html with `?page=…`:
 *
 *   popup | options  — pulls the REAL page HTML + stylesheet and runs the REAL
 *                      popup.ts / options.ts against the mocked `chrome.*`.
 *   modal | setup    — renders the REAL shadow-DOM surface (review modal, setup
 *                      panel) over a fake job posting, with representative data.
 *   picker           — runs the REAL click-to-pick toolbar over a deliberately
 *                      nested posting. It draws on the host page's own light DOM
 *                      rather than in a shadow root, so it was the one surface
 *                      with no harness state at all: every `onPick*` here is a
 *                      console stub, which renders the *button* and never the
 *                      toolbar it opens.
 *
 * The shadow surfaces are here because they are otherwise only reachable by
 * loading the built extension into a browser and driving a real site — which
 * makes iterating on them, or checking them at phone width, far too slow.
 *
 * `&state=…` picks WHICH flow the surface is showing. The redirect states in
 * particular were previously unreachable here: a two-step posting renders a
 * completely different modal body (a notice and two buttons, no report), and it
 * could only be seen by driving a real board with the extension installed.
 * `test/fixtures/scenarios.mjs` is the same list of flows, as real pages.
 */

import './mock-chrome';
import type { FieldMatch } from '../src/shared/types';
import type { SessionState } from '../src/shared/messages';
import type { JobBlock } from '../src/shared/jobText';
import { DEFAULT_MODAL_LAYOUT } from '../src/shared/modalLayout';
import {
  FillerModal, type ModalCallbacks, type ModalData, type ModalView,
} from '../src/content/modal/modal';
import { SetupPanel, type SetupData } from '../src/content/setupPanel';
import { startPicker } from '../src/content/picker';
import { describeElement } from '../src/shared/elementChain';
import { SETUP_STEP_ORDER, type SetupStepKey } from '../src/shared/setupSteps';
import { RecorderBar } from '../src/content/recorderBar';
import {
  compileRecording, type RecordFlow, type Recording, type RecordedStep,
} from '../src/shared/recording';

/**
 * A recording that is deliberately *not* perfect, because a clean one shows none of
 * what the review is for: one step the extension could only identify by its position
 * on the page, and no confirmation marked — which is the warning that matters most,
 * since Apply stays greyed out without one.
 */
function recordedState(flow: RecordFlow): Partial<SetupData> {
  const at = (n: number) => n * 900;
  const strong = (selector: string) =>
    ({ selector, strength: 'strong' as const, strategy: 'id' as const });

  const steps: RecordedStep[] = [
    { id: 's1', at: at(1), leg: 'posting', url: 'https://acme.test/job/42', action: 'click', label: 'Show full description', target: strong('#expand') },
    { id: 's2', at: at(2), leg: 'posting', url: 'https://acme.test/job/42', action: 'click', label: 'Job description', bind: 'jobDescription', bindSource: 'user', target: strong('#posting-body') },
  ];

  if (flow === 'external') {
    steps.push(
      { id: 's3', at: at(3), leg: 'posting', url: 'https://acme.test/job/42', action: 'click', label: 'Apply on company site', bind: 'applySelector', bindSource: 'user', target: strong('#apply-external') },
      { id: 's4', at: at(4), leg: 'posting', url: 'https://acme.test/job/42', action: 'navigate', label: '', to: 'https://ats.acme.test/apply' },
      { id: 's5', at: at(5), leg: 'destination', url: 'https://ats.acme.test/apply', action: 'click', label: 'Start application', target: { selector: 'main > div > div:nth-of-type(2) > button', strength: 'fragile', strategy: 'path' } },
      { id: 's6', at: at(7), leg: 'destination', url: 'https://ats.acme.test/apply', action: 'input', label: 'Email address', bind: 'field:email', bindSource: 'auto', target: strong('#email') },
      { id: 's7', at: at(8), leg: 'destination', url: 'https://ats.acme.test/apply', action: 'input', label: 'Upload CV', bind: 'field:resume', bindSource: 'auto', target: strong('#cv') },
      { id: 's8', at: at(9), leg: 'destination', url: 'https://ats.acme.test/apply', action: 'click', label: 'Submit application', bind: 'submit', bindSource: 'user', target: strong('#send') },
    );
  } else {
    steps.push(
      { id: 's3', at: at(3), leg: 'posting', url: 'https://acme.test/job/42', action: 'click', label: 'Continue', target: { selector: 'body > div > div:nth-of-type(3) > button', strength: 'fragile', strategy: 'path' } },
      { id: 's4', at: at(5), leg: 'posting', url: 'https://acme.test/job/42', action: 'input', label: 'Email address', bind: 'field:email', bindSource: 'auto', target: strong('#email') },
      { id: 's5', at: at(6), leg: 'posting', url: 'https://acme.test/job/42', action: 'input', label: 'Upload CV', bind: 'field:resume', bindSource: 'auto', target: strong('#cv') },
      { id: 's6', at: at(7), leg: 'posting', url: 'https://acme.test/job/42', action: 'click', label: 'Submit application', bind: 'submit', bindSource: 'user', target: strong('#send') },
    );
  }

  const recording: Recording = {
    flow,
    startedAt: 0,
    postingUrl: 'https://acme.test/job/42',
    ...(flow === 'external' ? { destinationUrl: 'https://ats.acme.test/apply' } : {}),
    steps,
  };
  return { recording, compiled: compileRecording(recording) };
}

type Page = 'popup' | 'options' | 'modal' | 'setup' | 'picker';
/** Which flow the surface is rendering — see `MODAL_STATES` / `SETUP_STATES`. */
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

  await import(/* @vite-ignore */ `${base}/${name}.ts`);

  // A closed <details> is a state a screenshot cannot reach: opening the archive
  // panel takes a click, and the whole point of the harness is that it does not.
  if (state === 'export') {
    const panel = document.getElementById('export-options') as HTMLDetailsElement | null;
    if (panel) panel.open = true;
  }
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

/**
 * The report a filled quick-apply posting produces — one row of every shape, in
 * the order `orderReport` leaves them: unmatched, then to check, then filled,
 * `FIELD_ORDER` within each band. The modal renders this verbatim now, so writing
 * it sorted is what makes the harness show what a real fill looks like.
 */
const REPORT: FieldMatch[] = [
  match('city', 'none', false),
  // A low-confidence row: the only shape with two actions (Confirm + Pick).
  match('phone', 'low', false, { valueToFill: '+1 555 123 4567', selectorUsed: '.field input:nth-of-type(3)' }),
  match('resume', 'high', true, { selectorUsed: 'input[type=file]' }),
  match('coverLetter', 'high', true, { valueToFill: 'I love building widgets.', selectorUsed: 'textarea' }),
  match('email', 'high', true, { valueToFill: 'ada@example.com', selectorUsed: '#email' }),
  match('fullName', 'high', true, { valueToFill: 'Ada Lovelace', selectorUsed: '#name' }),
];

const BASE_MODAL: ModalData = {
  siteName: 'Acme Careers',
  jobTitle: 'Staff Platform Engineer',
  jobDescription: [
    { kind: 'para', text: 'Acme is hiring a Staff Platform Engineer to own the deployment pipeline end to end. You will work across infrastructure, developer tooling, and release engineering.' },
  ],
  jobRequirements: [
    { kind: 'list', items: ['8+ years', 'Kubernetes', 'Go or Rust', 'On-call experience'] },
  ],
  // Invented fixture values, like everything else on this fake posting — the
  // extension never derives these. `shared/jobMeta.ts` reads all three off the
  // page's own `JobPosting` JSON-LD or a configured selector, and renders nothing
  // where the posting states nothing (see `state=listing`, whose chip row is
  // absent). `Remote (Berlin, DE)` is the one composed value, and both halves are
  // still stated facts: `jobLocationType: TELECOMMUTE` plus the `jobLocation`.
  meta: { company: 'Acme', location: 'Remote (Berlin, DE)', employmentType: 'Full-time' },
  matches: REPORT,
  applyState: 'ready',
  // What a fresh install gets. Without it the card falls back to the CSS
  // defaults, which is a size no real user would ever see.
  layout: DEFAULT_MODAL_LAYOUT,
};

/**
 * A posting of realistic length and shape. The typography is the whole point of
 * the Job view, and a three-line description proves nothing about it: paragraph
 * rhythm, heading spacing and bullet indents only misbehave at length.
 */
const LONG_DESCRIPTION: JobBlock[] = [
  { kind: 'para', text: 'Acme runs the deployment pipeline for every product team in the company. Roughly four hundred engineers ship through it each week, and when it is slow or unreliable, all of them feel it at once.' },
  { kind: 'heading', text: 'About the role' },
  { kind: 'para', text: 'You will own that pipeline end to end: the build system, the release tooling, and the guardrails that keep a bad change from reaching production. This is a hands-on staff role — you will spend most of your time in code, and the rest making sure the people around you do not have to.' },
  { kind: 'para', text: 'The team is eight engineers across three time zones. We work asynchronously by default, with two hours of overlap each day and no expectation of being online outside them.' },
  { kind: 'heading', text: 'What you will do' },
  { kind: 'list', items: [
    'Own the build and release pipeline, from commit to production rollout',
    'Cut the median deploy time, which is currently just over eleven minutes',
    'Design the guardrails — progressive rollout, automated rollback, change budgets',
    'Mentor engineers on the team and review the designs that touch delivery',
    'Carry the on-call pager for the pipeline, roughly one week in eight',
  ] },
  { kind: 'heading', text: 'What we are looking for' },
  { kind: 'list', items: [
    'Eight or more years building and operating developer infrastructure at scale',
    'Deep familiarity with Kubernetes, and with what goes wrong in it',
    'Strong Go or Rust — the tooling is Go, the agent is Rust',
    'Experience owning a system that other engineers depend on hourly',
  ] },
  { kind: 'heading', text: 'Nice to have' },
  { kind: 'list', items: [
    'Bazel, Buck, or another build system you have had to make fast',
    'Public writing or speaking about delivery engineering',
  ] },
  { kind: 'heading', text: 'How we hire' },
  { kind: 'para', text: 'Four conversations over two weeks: an intro call, a systems design discussion, a practical session on a real problem from our backlog, and a conversation with the team you would join. We pay for the practical session.' },
  { kind: 'para', text: 'Acme is an equal opportunity employer. We are happy to make adjustments to the process — tell us what you need.' },
];

/**
 * One entry per flow the modal can be in. `redirect`/`redirect-followed` are the
 * two-step posting (no report at all — a notice and "Fill this page instead"),
 * `landed` is the destination of a handoff, `empty` is the empty-profile banner
 * and `listing` is a results page whose fields all went unrecognised.
 */
const MODAL_STATES: Record<string, Partial<ModalData>> = {
  default: {},
  // A full-length posting: the only state that exercises the reading typography
  // and the body scroll the Job view exists for.
  long: {
    jobDescription: LONG_DESCRIPTION,
    jobRequirements: [],
  },
  redirect: {
    siteName: 'MixedBoard',
    matches: [],
    redirect: {
      host: 'ats.acme.test',
      reason: 'matched “Apply on company website” → ats.acme.test',
      followed: false,
    },
  },
  'redirect-followed': {
    siteName: 'MixedBoard',
    matches: [],
    redirect: { host: 'ats.acme.test', reason: 'configured external apply link', followed: true },
  },
  // The apply control is an app link (`linkedin://…`) with no web address inside
  // it, so nothing was followed and nothing can be. Deliberately *not* a
  // `redirect` state: the footer's redirect branch leads with "Open application"
  // and there is nothing here to open. The fields are the ones that were on the
  // board page, which are still filled — the banner has to say both halves.
  'app-link': {
    siteName: 'MixedBoard',
    appLink: true,
    applyState: 'noButton',
  },
  landed: { siteName: 'ats.acme.test', via: 'boards.example' },
  // Dragged into the right-hand edge, and tall enough that `clampLayout` pins it
  // top and bottom too: the two right corners come out square and lose their
  // border while the left ones stay rounded — the whole flush rule in one
  // screenshot. Only visible at desktop width; the phone panel is a bottom sheet.
  flush: {
    jobDescription: LONG_DESCRIPTION,
    jobRequirements: [],
    layout: { right: 0, bottom: 0, width: 460, height: 4000 },
  },
  // Fullscreen, with a real posting in it — the state the button exists for, and
  // the one place to check that the header still holds a site name, the segmented
  // control and two icon buttons at 390px. Renders differently at each width: a
  // squared, borderless card on desktop, a full-height sheet on the phone panel.
  fullscreen: {
    jobDescription: LONG_DESCRIPTION,
    jobRequirements: [],
    fullscreen: true,
  },
  // A confident match that could not take the value — a <select> with no
  // matching option, or an override pointing at a wrapper. It reads as "needs
  // review" with a Confirm, never as filled: the dot is the user's only signal
  // that a field still needs them.
  'failed-fill': {
    matches: [
      match('fullName', 'high', true, { valueToFill: 'Ada Lovelace', selectorUsed: '#name' }),
      match('country', 'high', false, { valueToFill: 'US', selectorUsed: 'select[name=country]' }),
      match('city', 'high', false, { valueToFill: 'London', selectorUsed: '.city-wrapper' }),
      match('resume', 'high', false, { selectorUsed: '.dropzone' }),
    ],
  },
  // Confirm has been pressed on one row. The dot, the tag and the count line are
  // deliberately identical to `default` — the report is the record of the fill and
  // does not re-colour itself — so the retired `Confirmed ✓` is the only thing on
  // the card saying the press landed. Reachable otherwise only by pressing it.
  confirmed: { confirmed: ['phone'] },
  // A page where no Send button could be found, so the footer's Apply is greyed
  // out. `&note=apply` opens the note that says why — the whole point of the
  // state, and only reachable by pressing the button.
  'apply-unset': { applyState: 'noButton' },
  // The *other* reason Apply is grey, and the one a user cannot guess: the site
  // has no confirmation element, so a submission's outcome could not be read
  // back. A different note entirely — pair it with `&note=apply`.
  'apply-unverified': { applyState: 'noConfirmation' },
  // Sent and confirmed. The banner, the retired Apply, and the pill all change,
  // and none of it is reachable without actually submitting a real application.
  applied: { applied: true },
  // The same posting opened again later — the record read back rather than a
  // confirmation seen. Both decisions are retired here too, so this is where to
  // check that a de-emphasised Skip still reads as a button and not as a gap.
  // Otherwise reachable only by applying for a job and then revisiting it.
  'already-applied': { alreadyApplied: true, appliedAt: Date.UTC(2026, 4, 12) },
  // The two-step version, and the reason the footer's applied branch has to come
  // before its redirect branch: without that, this state leads with a live
  // "Open application" primary on a job that is already applied for.
  'already-applied-redirect': {
    alreadyApplied: true,
    appliedAt: Date.UTC(2026, 4, 12),
    redirect: { host: 'ats.acme.test', reason: 'Apply link leaves for ats.acme.test', followed: false },
  },
  /**
   * The `empty` flow banner, which nothing here used to reach: this state was a
   * listing page with six unmatched rows and `noConfirmation`, so it rendered the
   * *blocked* banner and the one it is named after was unscreenshottable.
   *
   * `empty` fires on an empty **report**, and `main.ts` builds one row per field
   * it has something to fill with — so the only way to get here is an empty
   * profile. Hence a perfectly ordinary posting with no rows at all.
   */
  empty: {
    matches: [],
    applyState: 'ready',
  },
  /**
   * The listing page the state above used to be. Worth keeping on its own: it is
   * the posting that states none of the three meta facts, so the chip row is
   * absent entirely — the case that proves the row is never rendered empty — and
   * it is the shape `noConfirmation` really appears on.
   */
  listing: {
    siteName: 'ListingBoard',
    jobTitle: 'Platform engineering jobs',
    jobDescription: [
      { kind: 'para', text: '3 results. Each employer takes applications on its own site.' },
    ],
    jobRequirements: undefined,
    meta: undefined,
    matches: ['fullName', 'email', 'phone', 'coverLetter', 'city', 'resume']
      .map((f) => match(f as FieldMatch['field'], 'none', false)),
    applyState: 'noConfirmation',
  },
};

/**
 * Everything the real controller does, as a log line. Shared with the `pills`
 * state below, which needs a second modal purely to have a second pill.
 */
function modalCallbacks(self: () => FillerModal | undefined): ModalCallbacks {
  return {
    onRerun: () => console.log('[harness] re-run'),
    onApply: () => console.log('[harness] apply'),
    onConfirm: (f) => console.log('[harness] confirm', f),
    onPick: (f) => console.log('[harness] pick', f),
    onFollow: () => console.log('[harness] follow'),
    onFillAnyway: () => console.log('[harness] fill anyway'),
    onSkip: () => console.log('[harness] skip'),
    // The overflow's two ways out of a posting. Both open another surface for
    // real, so here they are only logged — but they have to exist, or the menu
    // in the harness is two dead items.
    onOpenSetup: () => console.log('[harness] open setup'),
    onOpenOptions: () => console.log('[harness] open options'),
    onClose: () => self()?.minimize(),
    onFold: (c) => console.log('[harness] modal folded', c),
    onLayoutChange: (l) => console.log('[harness] layout', l),
    onFullscreen: (on) => console.log('[harness] fullscreen', on),
  };
}

function bootModal(): void {
  fakePosting();
  let modal: FillerModal;
  modal = new FillerModal(modalCallbacks(() => modal));

  modal.render({
    ...BASE_MODAL,
    ...(MODAL_STATES[state] ?? {}),
    // `?session=1` shows the queue strip, and turns Skip into "Skip → next".
    session: params.get('session') === '1' ? SESSION : undefined,
    // Kept alongside `state=landed` because the README links `?via=1`.
    via: params.get('via') === '1' ? 'boards.example' : MODAL_STATES[state]?.via,
  });

  // `&view=fields` opens on the report. The Job view is the default everywhere
  // else, so without this the report is only reachable by clicking — which a
  // screenshot cannot do.
  const view = params.get('view');
  if (view === 'fields' || view === 'job') modal.setView(view as ModalView);

  // `&note=apply` opens the explanation behind the greyed-out Apply button, for
  // the same reason `&view=` exists: a click is not reachable from a screenshot,
  // and an unpressed button looks identical to a broken one.
  if (params.get('note') === 'apply') modal.setApplyHelp(true);
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
    onPickSubmit: () => console.log('[harness] pick send button'),
    onClearSubmit: () => console.log('[harness] clear send button'),
    onPickSuccess: () => console.log('[harness] pick confirmation'),
    onClearSuccess: () => console.log('[harness] clear confirmation'),
    onRename: (n, p) => console.log('[harness] rename', n, p),
    onStartRecording: (f) => console.log('[harness] start recording', f),
    onRebindStep: (id, b) => console.log('[harness] rebind step', id, b),
    onRepickStep: (id) => console.log('[harness] re-pick step', id),
    onRemoveStep: (id) => console.log('[harness] remove step', id),
    onSaveRecording: () => console.log('[harness] save recording'),
    onDiscardRecording: () => console.log('[harness] discard recording'),
    onOpenOptions: () => console.log('[harness] open options'),
    onDismissHelp: () => console.log('[harness] legend dismissed'),
    onClose: () => console.log('[harness] close setup'),
    onFold: (c) => console.log('[harness] setup folded', c),
    onLayoutChange: (l) => console.log('[harness] setup layout', l),
    onFullscreen: (on) => console.log('[harness] setup fullscreen', on),
  });

  const BASE_SETUP: SetupData = {
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
    // In `FIELD_ORDER`, because that is what `refreshSetup` now sorts these rows
    // into before rendering — the CV first, then the cover letter, then contact
    // details. Written in the sorted order rather than sorted here: the panel is
    // the thing under test, and a harness that re-derives its fixture would hide
    // a controller that stopped sorting.
    fields: [
      { key: 'resume', label: 'Résumé / CV', status: 'high', note: 'saved · input[type=file]', hasSave: true },
      { key: 'coverLetter', label: 'Cover letter', status: 'low', note: 'auto (low) · textarea#msg', hasSave: false },
      { key: 'email', label: 'Email', status: 'high', note: 'auto · #email', hasSave: false },
      { key: 'phone', label: 'Phone', status: 'low', note: 'auto (low) · .field input:nth-of-type(3)', hasSave: false },
      { key: 'fullName', label: 'Full name', status: 'high', note: 'auto · #name', hasSave: false },
      { key: 'city', label: 'City', status: 'none', note: 'not found', hasSave: false },
    ],
    verdict: {
      title: 'Quick apply (assumed)',
      detail: 'no external apply link found on this page',
      kind: 'unknown',
    },
    redirect: [
      { key: 'applySelector', label: 'External apply link', status: 'none', note: 'not set', hasSave: false },
      { key: 'quickApplySelector', label: 'Quick-apply marker', status: 'high', note: 'saved · #application_form', hasSave: true },
      { key: 'markerSelector', label: 'External marker', status: 'none', note: 'not set', hasSave: false },
    ],
    beforeFollow: [{ action: 'click', selector: '#save-job', resolves: true }],
    // Empty is the normal state: most sites take the CV the moment it is
    // attached. `state=cv-steps` is the site that needs the extra clicks.
    submitCv: [],
    // Found by its label rather than saved — the ordinary case, and the one that
    // shows the row still offering Pick when it already resolved something.
    submit: { key: 'submitSelector', label: 'Send button', status: 'low', note: 'auto · Submit application', hasSave: false },
    // Green while merely saved: there is nothing to verify until an application
    // has actually been sent, so absence here is not a fault.
    success: { key: 'successSelector', label: 'Confirmation element', status: 'high', note: 'saved · #app-success', hasSave: true },
    // The returning user, whose legend is folded away. `state=help` is the
    // first-run view.
    helpSeen: true,
    // The panel shares the review modal's slot and rectangle, so it needs the
    // same default here for the same reason `BASE_MODAL` does: without it the
    // card falls back to the CSS, which is a size no real user would ever see.
    layout: DEFAULT_MODAL_LAYOUT,
  };

  /**
   * Setting up a two-step posting is a different job: there is no form to map,
   * so the panel is all verdict and redirect selectors, and every form-field row
   * is legitimately grey. That is what `state=external` shows.
   */
  const SETUP_STATES: Record<string, Partial<SetupData>> = {
    default: {},
    /**
     * What a first-time user actually meets: the legend open, before any of the
     * vocabulary on the rows below it has been explained. This is the state the
     * whole help layer exists for, and it is the one nobody can reach twice —
     * dismissing it is persistent.
     */
    help: { helpSeen: false },
    /**
     * A site whose CV only counts once a dialog is confirmed — the one shape
     * that fills the middle of Page actions' three lists, which Apply then runs
     * before it presses Send. Pair it with `&step=prep`.
     */
    'cv-steps': {
      name: 'DialogATS',
      submitCv: [
        { action: 'click', selector: '#cv-attach', resolves: true },
        { action: 'waitFor', selector: '#cv-attached', ms: 4000, resolves: false },
      ],
    },
    /**
     * The page where nothing reads as a Send button, so the row is grey and the
     * modal's Apply is greyed with it. Pair with `?page=modal&state=apply-unset`.
     */
    'submit-unset': {
      submit: { key: 'submitSelector', label: 'Send button', status: 'none', note: 'not found — Apply is greyed out', hasSave: false },
    },
    /**
     * The site nobody has finished setting up: no confirmation element, so
     * nothing here can ever be recorded as applied and Apply refuses to send.
     * Pair with `?page=modal&state=apply-unverified&note=apply`.
     */
    'success-unset': {
      success: {
        key: 'successSelector',
        label: 'Confirmation element',
        status: 'none',
        note: 'not set — Apply is greyed out',
        hasSave: false,
      },
    },
    /**
     * The panel filling the window, and the panel pressed into the screen corner.
     * Both are geometry the setup panel never had before it joined the review
     * modal's slot, and both are otherwise reachable only by dragging a real one.
     */
    fullscreen: { fullscreen: true },
    flush: { layout: { right: 0, bottom: 0, width: 460, height: 4000 } },
    /**
     * A finished recording, waiting to be looked at. The review is a whole second
     * rendering of this panel and the only way to reach it on a real page is to
     * apply to a job — so without this nobody would ever see it in a screenshot.
     *
     * It carries a deliberately imperfect recording: one step the extension could
     * only identify by its position (the red dot and the Pick beside it), and no
     * confirmation marked, which is the warning that matters most.
     */
    /**
     * What Site setup opens on for a site nobody has configured — which is the state
     * every new site is in, and so the most-seen screen in the whole panel.
     */
    offer: {
      prep: [],
      submitCv: [],
      beforeFollow: [],
      fields: BASE_SETUP.fields.map((f) => ({ ...f, hasSave: false })),
      containers: BASE_SETUP.containers.map((c) => ({ ...c, hasSave: false })),
      redirect: BASE_SETUP.redirect.map((r) => ({ ...r, hasSave: false })),
      submit: { ...BASE_SETUP.submit, hasSave: false },
      success: { ...BASE_SETUP.success, status: 'none' as const, note: 'not set', hasSave: false },
    },
    review: recordedState('internal'),
    recording: recordedState('internal'),
    'recording-armed': recordedState('internal'),
    /**
     * The same review for a posting that handed off. Two configs come out of it
     * rather than one, and the lead sentence is different — which is exactly the
     * kind of thing that goes unnoticed until someone reads it on a phone.
     */
    'review-external': recordedState('external'),
    external: {
      name: 'ExternalBoard',
      urlPattern: '*://*/sites/external-board.html*',
      prep: [],
      fields: BASE_SETUP.fields.map((f) => ({ ...f, status: 'none' as const, note: 'not found', hasSave: false })),
      verdict: {
        title: 'External application',
        detail: 'configured external apply link',
        kind: 'redirect',
      },
      redirect: [
        { key: 'applySelector', label: 'External apply link', status: 'high', note: 'saved · → ats.acme.test', hasSave: true },
        { key: 'quickApplySelector', label: 'Quick-apply marker', status: 'none', note: 'not set', hasSave: false },
        { key: 'markerSelector', label: 'External marker', status: 'low', note: 'saved selector · no match', hasSave: true },
      ],
    },
  };

  panel.render({ ...BASE_SETUP, ...(SETUP_STATES[state] ?? {}) });

  // The two review states are a mode, not data — the panel decides whether it is
  // showing them, for the same reason it owns which step is open.
  if (state.startsWith('review')) panel.showReview(true);
  if (state === 'offer') panel.showOffer(true);

  /**
   * What the page looks like *during* a recording: the panel folded to its pill and
   * the bar up. The bar is its own surface and never takes a pill slot, so this is
   * also the check that it does not land on top of one.
   *
   * Two states, because the bar has two renderings and the loud one is the whole
   * point of it. `recording` is the resting bar over an inert page; `recording-armed`
   * is what Interact does — the page live under the user's finger, which is a thing
   * that has to *look* like a mode and is otherwise reachable only by pressing a
   * button, which a screenshot cannot do.
   */
  if (state === 'recording' || state === 'recording-armed') {
    panel.minimize();
    panel.setSlot(0);
    const bar = new RecorderBar({
      onInteract: () => console.log('[harness] interact'),
      onDeclare: (b) => console.log('[harness] declare', b),
      onUndo: () => console.log('[harness] undo step'),
      onDone: () => console.log('[harness] recording done'),
    });
    const { steps } = recordedState('internal').recording!;
    bar.render({
      flow: 'internal',
      leg: 'posting',
      stepCount: steps.length,
      mode: state === 'recording-armed' ? 'armed' : 'idle',
      last: steps[1],
      bound: ['field:email'],
    });
  }

  // `&step=…` opens one of the six wizard steps. Each is a distinct rendering
  // and only one is on screen at a time, so without this five of them are
  // reachable only by clicking Next — which a screenshot cannot do. The panel
  // otherwise opens on the first step with work outstanding, exactly as it does
  // on a real posting.
  const step = params.get('step');
  if (step && (SETUP_STEP_ORDER as readonly string[]).includes(step)) {
    panel.setStep(step as SetupStepKey);
  }

  // Both sheets folded, so their pills stack in the rail. The one arrangement
  // that cannot be reached by rendering a single surface — and the one that goes
  // wrong quietly, by putting two pills on the same pixel.
  if (params.get('pills') === '1') {
    let modal: FillerModal;
    modal = new FillerModal(modalCallbacks(() => modal));
    modal.render({ ...BASE_MODAL, layout: DEFAULT_MODAL_LAYOUT });
    modal.minimize();
    modal.setSlot(0);
    panel.minimize();
    panel.setSlot(1);
  }
}

/* ---------------- The click-to-pick toolbar ---------------- */

/**
 * A posting whose text is buried on purpose. The picker's whole subject is depth —
 * a click lands on the `<span>` and the thing worth saving is the `<section>` three
 * levels out — so a flat page would show the toolbar and none of what it is for.
 */
function bootPicker(): void {
  document.body.style.cssText =
    'margin:0;padding:20px 20px 140px;font:15px/1.6 system-ui,sans-serif;background:#fff;color:#111827';
  document.body.innerHTML = `
    <article id="posting">
      <section class="job-header">
        <div class="stack">
          <h1 class="job-title" style="font-size:24px;margin:0"><span>Staff Platform Engineer</span></h1>
          <p class="job-company" style="color:#4b5563;margin:4px 0 0"><span>Acme</span> · <span>Remote</span></p>
        </div>
      </section>
      <section class="job-description" style="margin:16px 0">
        <div class="prose">
          <p>Own the deployment pipeline end to end, across infrastructure,
          developer tooling and release engineering.</p>
          <ul><li><span>Five years of production Kubernetes</span></li></ul>
        </div>
      </section>
      <div class="actions" style="margin-top:16px">
        <button id="send" style="padding:10px 16px;border-radius:8px;border:1px solid #d1d5db;background:#f9fafb">
          <span class="btn-label">Send application</span>
        </button>
      </div>
      <p id="picked" role="status" style="margin-top:16px;color:#4b5563"></p>
    </article>`;

  const said = document.getElementById('picked')!;
  // Restart it, or the surface being iterated on vanishes the first time anything
  // is confirmed and the page has to be reloaded to see it again.
  const again = (note: string) => {
    said.textContent = note;
    setTimeout(() => run(), 150);
  };
  const run = () => startPicker(
    (el) => again(`picked ${describeElement(el)}`),
    params.get('label') || 'Description',
    () => again('cancelled'),
  );
  run();
}

const BOOT: Record<Page, () => void | Promise<void>> = {
  popup: () => bootPage('popup'),
  options: () => bootPage('options'),
  modal: bootModal,
  setup: bootSetup,
  picker: bootPicker,
};

// Resolve the booter BEFORE calling it: `BOOT[page]?.() ?? bootPage('popup')`
// falls through for every void booter, since they return undefined too.
const boot = BOOT[page] ?? BOOT.popup;
Promise.resolve(boot()).catch((e) => console.error('[harness] failed to boot', page, e));
