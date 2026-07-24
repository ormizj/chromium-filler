/**
 * The one place the extension explains itself.
 *
 * Every surface that answers "what is this?" — the on-page Setup panel's per
 * section `?`, the options Sites reference, the Settings toggles, the Help tab,
 * the review modal's legend — renders from this catalog. Written once, so the
 * words cannot drift apart between the panel and the page that documents it.
 *
 * The `Record<keyof …>` types are load-bearing: adding a key to `SiteConfig`,
 * `RedirectConfig`, `Settings` or `PrepAction` fails `npm run typecheck` until
 * it has an explanation here. That is the mechanism that stops this file going
 * stale the way the doc comments in `types.ts` did — they were correct, but
 * nobody using the extension could read them.
 *
 * Style rules for the copy: address the user ("you"), say what the thing does
 * before what it is called, and prefer a concrete example to a definition.
 */

import type { PrepAction, RedirectConfig, Settings, SiteConfig } from './types';

export interface HelpEntry {
  /** Heading shown above the explanation. */
  title: string;
  /** Plain-English "what this is", one to three sentences. */
  body: string;
  /**
   * A one-line form, for places that are a key rather than an explanation — the
   * setup panel's legend, which is read at a glance above the work itself. The
   * full `body` stays one tap away behind that section's `?`.
   */
  short?: string;
  /** "You need this when …" — whether to bother with it at all. */
  when?: string;
  /** A concrete value, shown in monospace. */
  example?: string;
}

/**
 * A setup-panel section. `rows` documents the rows inside it, because a `?` on
 * each of sixteen field rows would be noise — one explanation covers the group.
 */
export interface GroupHelp extends HelpEntry {
  rows?: Array<{ label: string; body: string }>;
}

/* ---------------- Site config keys ---------------- */

export const CONFIG_HELP: Record<keyof SiteConfig, HelpEntry> = {
  id: {
    title: 'id',
    body: 'A unique name for this config, used internally. Any short slug will do; '
      + 'two configs must not share one.',
    example: 'acme-careers',
  },
  name: {
    title: 'name',
    body: 'The label you see — in the setup panel header, the review modal, and the '
      + 'chips above this box. It has no effect on matching.',
    example: 'Acme Careers',
  },
  urlPatterns: {
    title: 'urlPatterns',
    body: 'Which pages this config applies to. Either a match pattern, where `*` '
      + 'stands for any run of characters, or a regular expression wrapped in slashes. '
      + 'The whole URL is tested, so a pattern needs a trailing `*` to survive a '
      + '`?job=…` query string.',
    when: 'Always — a config with no matching pattern never runs.',
    example: '*://boards.acme.com/jobs/*',
  },
  waitFor: {
    title: 'waitFor',
    body: 'A CSS selector to wait for before doing anything else. Application forms '
      + 'are often injected a second or two after the page loads, and filling before '
      + 'they exist fills nothing.',
    when: 'The form is not in the HTML on first paint.',
    example: 'form#application',
  },
  waitTimeoutMs: {
    title: 'waitTimeoutMs',
    body: 'How long to wait for `waitFor` before giving up and carrying on anyway. '
      + 'Defaults to 15000 (15 seconds).',
    example: '15000',
  },
  prep: {
    title: 'prep',
    body: 'Steps run automatically, in order, before filling — clicking an "Apply" '
      + 'button that reveals the form, waiting for what it opens, scrolling something '
      + 'into view. Build these visually with "Setup steps" in the on-page panel.',
    when: 'The form is behind a button, a tab, or a modal.',
    example: '[{ "action": "click", "selector": "#apply", "optional": true }]',
  },
  extract: {
    title: 'extract',
    body: 'Selectors for the job title, description and requirements. These are read '
      + 'into the review modal so you can decide whether you want the job without '
      + 'leaving it. They never affect filling.',
    when: 'Optional. Without them the modal simply shows less.',
    example: '{ "jobTitle": "h1.posting-title", "jobDescription": ".posting-body" }',
  },
  fieldOverrides: {
    title: 'fieldOverrides',
    body: 'An exact selector per profile field, which always beats the built-in '
      + 'guessing. Each one you save with Pick in the setup panel lands here.',
    when: 'A field is left grey (not found) or is matched to the wrong input.',
    example: '{ "city": "#candidate_location" }',
  },
  cvUpload: {
    title: 'cvUpload',
    body: 'The file input your CV is attached to, when the automatic search finds the '
      + 'wrong one or none at all.',
    when: 'The CV row stays grey on a page that clearly takes a file.',
    example: 'input[type=file][name=resume]',
  },
  submitCv: {
    title: 'submitCv',
    body: 'Steps run first, whenever you press Apply — for sites where attaching the CV '
      + 'is a separate dialog that has to be re-opened and confirmed before the form '
      + 'will accept it.',
    when: 'The CV attaches but the site needs an extra confirmation click.',
    example: '[{ "action": "click", "selector": "#attach-confirm" }]',
  },
  submitSelector: {
    title: 'submitSelector',
    body: 'The site\'s own Send button — the control Apply presses for you. Leave it '
      + 'unset and the button is found by its label; save one to settle it for good.',
    when: 'Apply is greyed out because nothing was found, or the page has several '
      + 'buttons and you want to be certain which one is pressed.',
    example: 'button[data-qa="submit-application"]',
  },
  autoDetect: {
    title: 'autoDetect',
    body: 'Whether the keyword heuristics run at all. Set it to false and only your '
      + 'own `fieldOverrides` are used — nothing is guessed.',
    when: 'A site is so unusual that guessing does more harm than good. Rare.',
    example: 'true',
  },
  redirect: {
    title: 'redirect',
    body: 'Tells the classifier whether a posting applies here or hands off to the '
      + 'employer\'s own site, and what to do on the way out. See the individual '
      + 'redirect keys below.',
    when: 'The board mixes quick-apply postings with external ones and gets it wrong.',
  },
  successSelector: {
    title: 'successSelector',
    body: 'The element that only appears once the application really went through — a '
      + 'thank-you banner or confirmation panel. This is what marks the posting '
      + 'applied and triggers auto-close; it has to become *visible*, not merely '
      + 'exist, because sites ship hidden success nodes.',
    when: 'Anywhere you want "applied" to be trustworthy. Omit it only for sites that '
      + 'navigate away on submit, where no confirmation can render in time.',
    example: '.application-success',
  },
};

export const REDIRECT_HELP: Record<keyof RedirectConfig, HelpEntry> = {
  applySelector: {
    title: 'applySelector',
    body: 'The control that leaves for the external application — usually the "Apply '
      + 'on company website" link, but a button with no href works too.',
    example: 'a.external-apply',
  },
  quickApplySelector: {
    title: 'quickApplySelector',
    body: 'If this exists on the page, the posting applies right here and is filled '
      + 'normally. Checked first, so it beats everything else — including a stray '
      + '"apply on the employer site" link elsewhere on the page.',
    when: 'A quick-apply posting is being mistaken for an external one.',
    example: 'form.quick-apply',
  },
  markerSelector: {
    title: 'markerSelector',
    body: 'A badge or label that means "this one is external", for boards whose apply '
      + 'link looks internal until you click it.',
    example: '.badge--external',
  },
  beforeFollow: {
    title: 'beforeFollow',
    body: 'Steps run on the posting before following the link out — typically clicking '
      + 'the board\'s own "Save job" so its tracking records the application. Always '
      + 'optional: a failure here never blocks the handoff.',
    example: '[{ "action": "click", "selector": "#save-job" }]',
  },
  autoDetect: {
    title: 'redirect.autoDetect',
    body: 'Whether the built-in label and cross-origin heuristic runs. Turn it off to '
      + 'rely only on the selectors above.',
    example: 'true',
  },
};

export const PREP_HELP: Record<PrepAction, HelpEntry> = {
  click: {
    title: 'Click',
    body: 'Clicks the element you pick — the "Apply" button, a "Show more" toggle, a '
      + 'consent banner\'s Accept.',
  },
  waitFor: {
    title: 'Wait for',
    body: 'Pauses until the element you pick appears, or until the timeout runs out. '
      + 'Use it after a click that loads something.',
  },
  scrollIntoView: {
    title: 'Scroll to',
    body: 'Scrolls the element into view. Some forms only render their fields once '
      + 'they are on screen.',
  },
  delay: {
    title: 'Delay',
    body: 'Waits a fixed number of milliseconds. The blunt instrument — prefer "Wait '
      + 'for" when there is something specific to wait for.',
  },
};

/* ---------------- Behavior settings ---------------- */

export const SETTINGS_HELP: Record<keyof Settings, HelpEntry> = {
  autoRunOnLoad: {
    title: 'Auto-run when a matching page loads',
    body: 'Fill automatically as soon as a page matching one of your site configs '
      + 'finishes loading. Turn it off to fill only when you press Fill in the popup.',
  },
  autoFillLowConfidence: {
    title: 'Fill low-confidence matches too',
    body: 'By default only confident matches are typed in; anything uncertain is '
      + 'reported in yellow for you to confirm. Enabling this fills those as well — '
      + 'faster, but you have to check the result.',
  },
  closeTabOnSubmit: {
    title: 'Auto-close the tab after I submit',
    body: 'Closes the posting once the application is confirmed sent, which also frees '
      + 'a slot for the next posting in a queue session.',
    when: '"Sent" is detected by that site\'s successSelector. Without one, a plain '
      + 'form submit is the fallback, and that only fits sites that navigate away.',
  },
  closeTabOnSkip: {
    title: 'Auto-close the tab after I skip',
    body: 'Closes the posting when you press Skip in the review modal, which also frees '
      + 'a slot for the next posting in a queue session. Uses the same close delay as '
      + 'the setting above.',
    when: 'Turn it off to keep skipped postings open for a second look. The queue moves '
      + 'on either way — a skip frees its slot whether or not the tab goes.',
  },
  closeTabDelayMs: {
    title: 'Close delay',
    body: 'How long to leave the page on screen before closing the tab, in milliseconds. '
      + 'Used by both auto-close settings above; set it high enough to actually read a '
      + 'confirmation.',
    example: '1500',
  },
  redirectTarget: {
    title: 'When following an external application',
    body: 'Where the employer\'s application opens once a two-step posting is followed: '
      + 'in a new tab replacing the posting, in a new tab beside it, or in place.',
  },
  sessionBatchSize: {
    title: 'Tabs at once',
    body: 'How many job tabs a queue session keeps open. Finishing one — submit, skip '
      + 'or close — opens the next, so 60 imported links never become 60 tabs.',
    when: 'Drop it to 1–2 on a phone, where five job pages will not fit in memory.',
  },
  modalLayout: {
    title: 'Review modal size & position',
    body: 'Where the review modal sits on screen and how big it is, set by dragging the '
      + 'card in the simulator below. Desktop only: under 640px the modal is always a '
      + 'full-width bottom sheet.',
  },
  helpSeen: {
    title: 'Help seen',
    body: 'Records that you have dismissed the setup panel\'s legend, so the basics are '
      + 'not re-explained on every posting. Set for you; there is nothing to configure.',
  },
};

/* ---------------- Setup panel sections ---------------- */

export type SetupGroupKey = 'site' | 'steps' | 'kind' | 'info' | 'fields';

/** The panel's section titles, so the `?` and the heading cannot disagree. */
export const SETUP_GROUP_TITLES: Record<SetupGroupKey, string> = {
  site: 'Site',
  steps: 'Setup steps',
  kind: 'Application type',
  info: 'Job info',
  fields: 'Form fields',
};

export const SETUP_GROUP_HELP: Record<SetupGroupKey, GroupHelp> = {
  site: {
    title: 'Which pages this applies to',
    body: 'A config is matched to a page by its URL pattern. The name is only a label '
      + 'for you; the pattern is what decides whether the extension acts here at all.',
    when: 'Widen the pattern if a sister page on the same board is not recognised.',
    example: '*://boards.acme.com/jobs/*',
    rows: [
      { label: 'Name', body: 'What this site is called in the popup and the review modal.' },
      {
        label: 'URL pattern',
        body: '`*` matches any run of characters. Keep the trailing `*` — without it a '
          + 'posting URL ending in `?job=123` stops matching.',
      },
    ],
  },
  steps: {
    title: 'Things to do before filling',
    body: 'Some forms are not on the page yet when it loads — they are behind an '
      + '"Apply" button, or a tab, or they arrive a second late. These steps run '
      + 'automatically, top to bottom, every time, before anything is filled.',
    when: 'Leave this empty if the form is simply there on load.',
    rows: [
      { label: 'Click', body: PREP_HELP.click.body },
      { label: 'Wait for', body: PREP_HELP.waitFor.body },
      { label: 'Delay', body: PREP_HELP.delay.body },
      {
        label: 'The number box',
        body: 'A timeout for "Wait for", or the length of a "Delay" — milliseconds, so '
          + '1000 is one second.',
      },
      {
        label: 'Run steps ▶',
        body: 'Runs the list now so you can watch it work, without reloading the page.',
      },
    ],
  },
  kind: {
    title: 'Does this posting apply here, or somewhere else?',
    body: 'Some postings have the form on the page. Others hand off to the employer\'s '
      + 'own site, which the extension follows and then fills there instead. One board '
      + 'usually mixes both, so this is judged per posting, not per site — and it is '
      + 'guessed automatically. These selectors are only for correcting a wrong guess.',
    when: 'The verdict shown here is wrong. "Not set" everywhere is the normal, healthy '
      + 'state.',
    rows: [
      { label: 'External apply link', body: REDIRECT_HELP.applySelector.body },
      { label: 'Quick-apply marker', body: REDIRECT_HELP.quickApplySelector.body },
      { label: 'External marker', body: REDIRECT_HELP.markerSelector.body },
      { label: 'Before leaving', body: REDIRECT_HELP.beforeFollow.body },
    ],
  },
  info: {
    title: 'What the review modal shows you',
    body: 'These point at the posting\'s title, description and requirements so the '
      + 'review modal can show the job itself — the thing you actually need in order to '
      + 'decide whether to send it. They have no effect on filling.',
    when: 'Optional. Unset just means the modal shows less.',
    rows: [
      { label: 'Job title', body: 'The heading — usually the page\'s `h1`.' },
      {
        label: 'Description',
        body: 'Pick the container that holds the whole body text, not one paragraph of it.',
      },
      {
        label: 'Requirements',
        body: 'A separate requirements or qualifications block, if the site has one.',
      },
    ],
  },
  fields: {
    title: 'Where your details go',
    body: 'Each row is one field of your profile and where it was found on this page. '
      + 'Green rows are already handled — leave them alone. Pick the grey ones: tap '
      + 'Pick, then tap the real input on the page, and that selector is saved for this '
      + 'site so it is right every time from now on.',
    when: 'A row is grey (nothing found) or points at the wrong input.',
    rows: [
      {
        label: 'auto ·',
        body: 'Found by the built-in guessing this run. Nothing is stored — if the site '
          + 'changes, it is guessed again.',
      },
      {
        label: 'saved ·',
        body: 'Your own selector, stored in this config. It always wins over guessing.',
      },
      { label: 'Clear', body: 'Forgets your saved selector and goes back to guessing.' },
      {
        label: 'CV / Résumé',
        body: 'Picks the file input your stored CV is attached to. Pick the input '
          + 'itself, not the button that opens the file dialog, if you can reach it.',
      },
      {
        label: 'After attaching',
        body: CONFIG_HELP.submitCv.body,
      },
      {
        label: 'Send button',
        body: CONFIG_HELP.submitSelector.body,
      },
    ],
  },
};

/* ---------------- Concepts ---------------- */

export type ConceptKey =
  | 'dots' | 'autoVsSaved' | 'todoChip' | 'picker' | 'neverSubmits'
  | 'twoStep' | 'sessions' | 'urlPattern' | 'successSelector' | 'howItWorks'
  | 'apply' | 'applyUnverified';

export const CONCEPT_HELP: Record<ConceptKey, HelpEntry> = {
  dots: {
    title: 'What the dots mean',
    short: 'Green is done, yellow is worth a look, grey means nothing was found.',
    body: 'Green: matched and handled. Yellow: found something, but it is a guess worth '
      + 'checking — or a selector you saved that no longer resolves on this page. Grey '
      + 'or red: nothing found, so nothing was filled. The glyph inside the dot carries '
      + 'the same meaning as the colour, so it still reads if colour does not.',
  },
  autoVsSaved: {
    title: '“auto ·” versus “saved ·”',
    short: '“auto” was guessed just now; “saved” is your own selector, stored for this site.',
    body: '“auto” means the built-in keyword guessing found it this run and stored '
      + 'nothing. “saved” means a selector is stored in this site\'s config — yours, '
      + 'from Pick — and it beats the guessing every time. “not set” means neither, '
      + 'which for an optional row is perfectly fine.',
  },
  todoChip: {
    title: 'The “N to do” chip',
    short: 'How many rows in a section still need you. No chip means you can skip it.',
    body: 'How many rows in that section still need a decision from you: nothing was '
      + 'found, or what was found is only a guess. A section with no chip can be '
      + 'ignored.',
  },
  picker: {
    title: 'Pick / Re-pick / Clear',
    short: 'Pick, then tap the real thing on the page. Clear forgets it again.',
    body: 'Pick hides the panel and lets you tap the real element on the page; the '
      + 'selector for whatever you tap is saved to this site\'s config. On a touch '
      + 'screen the tap only proposes a target and you press Confirm, because a finger '
      + 'has no hover and would otherwise commit to whatever it landed on. Clear throws '
      + 'the saved selector away.',
  },
  /**
   * What the review modal's greyed-out Apply button says when pressed. It has to
   * answer both halves of the user's question — what the button would do, and
   * why it is grey here — or a dead control has simply learned to talk.
   */
  apply: {
    title: 'Apply',
    short: 'Presses the site’s own Send button for you, once you press this one.',
    body: 'Apply confirms the CV if this site needs that, then presses the site\'s own '
      + 'Send button. It is greyed out here because no such button could be found on the '
      + 'page — usually because the form is behind a step that has not opened yet, or '
      + 'because the button is unusually named. Point it at the right one with “Set up '
      + 'this site” → Send button, and it goes live.',
    when: 'Apply is grey on a page that clearly has a submit button.',
  },
  /**
   * The other reason Apply is grey, and the one nobody would guess: the site has
   * no confirmation element configured, so there would be no way to tell whether
   * the application was accepted. Kept separate from `apply` because the user's
   * next action is completely different — teach it the confirmation, not the
   * button.
   */
  applyUnverified: {
    title: 'Apply needs a confirmation element',
    short: 'Nothing is sent to a site that cannot tell us it worked.',
    body: 'This site has no confirmation element set, so there would be no way to know '
      + 'whether the application was accepted — a form can be rejected after it is sent, '
      + 'and recording that as applied is worse than not sending at all. Open “Set up '
      + 'this site” → Confirmation element and Pick the “thank you” or “application '
      + 'received” message the site shows after a successful send. Then Apply goes live, '
      + 'and that same element is what marks the posting applied.',
    when: 'Apply is grey on a site you have not finished setting up.',
  },
  neverSubmits: {
    title: 'Nothing is sent until you say so',
    body: 'The extension fills and reports; it never sends anything by itself, however '
      + 'confident it is. The one thing that submits is Apply, and Apply only runs '
      + 'because you pressed it. Read the review, fix what it flagged, then press Apply '
      + '— or ignore it and press the site\'s own button yourself.',
  },
  twoStep: {
    title: 'Two-step (external) postings',
    body: 'A posting that applies on the employer\'s own site rather than on the board. '
      + 'The extension follows the link, waits out any tracker redirects, records both '
      + 'ends against each other, and fills the form it lands on. Submitting there marks '
      + 'the original posting applied too.',
  },
  sessions: {
    title: 'Queue sessions',
    body: 'A session keeps a fixed number of job tabs open — not all of them. Each one '
      + 'you finish, by submitting, skipping or closing it, opens the next posting that '
      + 'is waiting. Stop and resume whenever; it survives a browser restart.',
  },
  urlPattern: {
    title: 'URL patterns',
    body: 'A whole-URL glob where `*` matches any run of characters, or a regular '
      + 'expression between slashes. Because the whole URL is tested, a pattern without '
      + 'a trailing `*` stops matching the moment a posting adds `?job=123`.',
    example: '*://boards.acme.com/jobs/*',
  },
  successSelector: {
    title: 'How “applied” is decided',
    body: 'Pressing Send proves nothing — the server can still reject the form, and a '
      + 'site that checks your answers in JavaScript rejects it after the browser has '
      + 'already announced the submission. So a posting counts as applied only when the '
      + 'site\'s own confirmation element becomes *visible*, which is what '
      + '`successSelector` points at. Nothing else counts, which is why Apply stays grey '
      + 'until a site has one. The confirmation may be on a different page — many boards '
      + 'land on their own “thank you” URL — and that still counts for the posting you '
      + 'were applying to.',
  },
  howItWorks: {
    title: 'How it works',
    body: 'On a page one of your site configs matches: wait for the form to exist, run '
      + 'the setup steps, work out whether the posting applies here or on the employer\'s '
      + 'site, read the job text, find each field, fill the confident ones — CV '
      + 'included — and show you the review. Then you press Apply, or Skip.',
  },
};

/**
 * The dot key, as rows rather than prose — a colour is explained by showing the
 * colour next to its meaning, not by naming it in a paragraph. `status` matches
 * the `.cf-dot` modifier classes in primitives.css.
 */
export const DOT_LEGEND: Array<{ status: 'high' | 'low' | 'none'; label: string }> = [
  { status: 'high', label: 'matched — nothing to do' },
  { status: 'low', label: 'a guess, or a saved selector that no longer matches' },
  { status: 'none', label: 'nothing found — press Pick' },
];

/* ---------------- Config → sentence ---------------- */

/**
 * Turns a stored `SiteConfig` into a plain-English sentence, so the JSON is not
 * the only way to find out what a site will do. Pure and unit-tested; used by
 * the options Sites tab under each config's chip.
 */
export function describeConfig(config: SiteConfig): string {
  const parts: string[] = [];

  parts.push(`Runs on pages matching ${list(config.urlPatterns.map(code))}.`);

  const opening: string[] = [];
  if (config.waitFor) {
    const secs = Math.round((config.waitTimeoutMs ?? 15000) / 1000);
    opening.push(`waits up to ${secs}s for ${code(config.waitFor)}`);
  }
  const prep = config.prep ?? [];
  if (prep.length > 0) {
    opening.push(`runs ${count(prep.length, 'setup step')} (${describeStep(prep[0])}`
      + `${prep.length > 1 ? ', …' : ''})`);
  }
  if (opening.length > 0) parts.push(`${sentence(list(opening))}, then fills.`);
  else parts.push('Fills as soon as the page is ready.');

  const overrides = Object.keys(config.fieldOverrides ?? {}).length;
  if (overrides > 0) parts.push(`${count(overrides, 'field')} you picked yourself override the guessing.`);
  if (config.cvUpload) parts.push(`Your CV goes to ${code(config.cvUpload)}.`);
  const confirmCv = config.submitCv ?? [];
  if (confirmCv.length > 0) {
    parts.push(`Apply first ${describeStep(confirmCv[0])}`
      + `${confirmCv.length > 1 ? `, and ${count(confirmCv.length - 1, 'step')} more` : ''} `
      + 'to confirm the upload.');
  }
  parts.push(config.submitSelector
    ? `Apply presses ${code(config.submitSelector)}.`
    : 'Apply presses whichever button reads as the site’s own Send.');
  if (config.autoDetect === false) {
    parts.push('Automatic field guessing is off — only your own selectors are used.');
  }

  const redirectMarker = config.redirect?.markerSelector
    ?? config.redirect?.applySelector;
  if (redirectMarker) {
    parts.push(`Postings matching ${code(redirectMarker)} hand off to the employer's site.`);
  } else if (config.redirect?.quickApplySelector) {
    parts.push(`Postings with ${code(config.redirect.quickApplySelector)} are filled here `
      + 'rather than followed elsewhere.');
  }

  parts.push(config.successSelector
    ? `Counts as sent — and applied — when ${code(config.successSelector)} appears.`
    : 'Has no confirmation selector, so a submitted form is the only "sent" signal.');

  return parts.join(' ');
}

function describeStep(step: { action: PrepAction; selector?: string; ms?: number }): string {
  const verb = { click: 'clicks', waitFor: 'waits for', scrollIntoView: 'scrolls to', delay: 'waits' };
  return step.action === 'delay'
    ? `${verb.delay} ${step.ms ?? 0}ms`
    : `${verb[step.action]} ${step.selector ? code(step.selector) : 'nothing yet'}`;
}

function code(value: string): string {
  return `\`${value}\``;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** "a", "a and b", "a, b and c" — an Oxford-comma-free join. */
function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
