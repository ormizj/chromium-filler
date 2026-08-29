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

import type { SetupStepKey } from './setupSteps';
import type { PrepAction, RedirectConfig, Settings, SiteConfig } from './types';

export interface HelpEntry {
  /** Heading shown above the explanation. */
  title: string;
  /** Plain-English "what this is", one to three sentences. */
  body: string;
  /**
   * A one-line form, for places that are a key rather than an explanation — the
   * setup panel's legend, which is read at a glance above the work itself, and the
   * options settings rows, where the reference puts a caption under every title.
   * The full `body` stays one tap away behind that section's `?`.
   */
  short?: string;
  /** "You need this when …" — whether to bother with it at all. */
  when?: string;
  /** A concrete value, shown in monospace. */
  example?: string;
}

/**
 * One setup-wizard step. `rows` documents the rows inside it, because a `?` on
 * each of sixteen field rows would be noise — one explanation covers the step.
 *
 * A row carries an `example` for the same reason an entry does: the step is
 * where the user presses Pick, so a rule with no concrete selector beside it
 * sends them to the Options reference to find one. It stays optional — the rows
 * written for the panel itself ("The number box") have nothing to quote.
 */
export interface GroupHelp extends HelpEntry {
  rows?: Array<{ label: string; body: string; example?: string }>;
}

/**
 * A row that quotes a catalog entry, rather than restating it. Copying the body
 * and the example by hand would be a second place for either to drift, which is
 * the one thing this file exists to prevent — so the rows that document a real
 * config key go through here, and only the panel's own furniture is literal.
 */
function refRow(label: string, entry: HelpEntry): { label: string; body: string; example?: string } {
  return { label, body: entry.body, example: entry.example };
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
    body: 'The label you see — in the review modal, the popup, and the chips above this '
      + 'box. It has no effect on matching.',
    example: 'Acme Careers',
  },
  urlPatterns: {
    title: 'urlPatterns',
    body: 'Which pages this config applies to. Either a match pattern, where `*` '
      + 'stands for any run of characters — except the one before `://`, which stands '
      + 'for a scheme only, so `*://acme.com/*` cannot be fooled by some other page '
      + 'carrying `https://acme.com/` in its query string — or a regular expression '
      + 'wrapped in slashes. The whole URL is tested, so a pattern needs a trailing `*` '
      + 'to survive a `?job=…` query string.',
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
      + 'into view. Build these visually under "Page actions" in the on-page panel.',
    when: 'The form is behind a button, a tab, or a modal.',
    example: '[{ "action": "click", "selector": "#apply", "optional": true }]',
  },
  extract: {
    title: 'extract',
    body: 'Selectors for the job title, description and requirements — read into the '
      + 'review modal so you can decide whether you want the job without leaving it. '
      + 'It also takes `company`, `location` and `employmentType`, the three facts '
      + 'shown as chips under the title; those are read from the posting\'s own '
      + 'JobPosting data automatically, so set one only where that is missing or '
      + 'wrong. None of these ever affect filling.',
    when: 'Optional. Without them the modal simply shows less.',
    example: '{ "jobTitle": "h1.posting-title", "jobDescription": ".posting-body" }',
  },
  fieldOverrides: {
    title: 'fieldOverrides',
    // The CV really is the exception: `saveFieldOverride` special-cases `resume`
    // into `cvUpload`, so someone looking here for the selector they just picked
    // on the one row that step counts as work would not find it.
    body: 'An exact selector per profile field, which always beats the built-in '
      + 'guessing. Each one you save with Pick in the setup panel lands here — except '
      + 'the CV\'s, which lands in `cvUpload` below.',
    when: 'A field is left grey (not found) or is matched to the wrong input.',
    example: '{ "city": "#candidate_location" }',
  },
  cvUpload: {
    title: 'cvUpload',
    body: 'The file input your CV is attached to, when the automatic search finds the '
      + 'wrong one or none at all.',
    // Not "stays grey on a page that clearly takes a file" — the one thing that
    // cannot happen. `resume` alone gets a fallback onto any unclaimed file input
    // (`fieldDetect.ts`), so a page with an upload leaves the row *yellow*, which
    // is the state `stepStates` words as "CV upload needs checking". Waiting for
    // grey is the mirror of the yellow-dot hunt `CONCEPT_HELP.dots` was fixed for.
    when: 'The CV row is yellow, or points at the wrong upload. An unlabelled file '
      + 'input is claimed as the CV on a guess, so a page with more than one needs a '
      + 'selector here to settle which.',
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
    body: 'Whether the keyword guessing runs when fields are matched. Set it to false '
      + 'and only the selectors you saved yourself fill anything — your '
      + '`fieldOverrides` and `cvUpload` — with no field guessed. It '
      + 'stops there, though: the Send button is still found by its label, the '
      + 'posting is still read for the title and description — and its own JobPosting '
      + 'data for the chips — and whether a posting applies here or elsewhere has its '
      + 'own switch, `redirect.autoDetect`.',
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
    // Not "and triggers auto-close": closing the tab is `closeTabOnSubmit`, which
    // is off by default, so the promised outcome never happened on a fresh
    // install. This body is quoted into the wizard's last step as well, where it
    // is the first thing anyone reads about the confirmation element.
    body: 'The element that only appears once the application really went through — a '
      + 'thank-you banner or confirmation panel. This is what marks the posting '
      + 'applied, and what “Auto-close the tab after I apply” waits for when that is on. '
      + 'It counts only once that element is on '
      + 'screen, never merely present in the page\'s HTML, because sites routinely '
      + 'ship a hidden success node and reveal it when the server answers.',
    // Two ways in, not one. `applyStatusChain` walks `sourceUrl`, so a board
    // whose postings apply on an employer's site has them recorded when *that*
    // site confirms — no confirmation element of its own, and nobody editing a
    // status by hand. Naming only the manual edit made that flow read as broken.
    when: 'Always. There is no second way of telling that an application went in, so a '
      + 'site without one cannot use Apply at all — it stays greyed out, and nothing '
      + 'there is ever recorded as applied on its own. Two things still are, and '
      + 'neither is this site\'s doing: a posting that applies on the employer\'s own '
      + 'site is marked applied when that site\'s own confirmation appears, and any '
      + 'posting\'s status can be set by hand in Options → Queue.',
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
      + '"apply on the employer site" link elsewhere on the page. Pick something only '
      + 'the postings that apply here have, like the form itself, and not a header '
      + 'every posting carries: a marker that matches everywhere quietly stops this '
      + 'board\'s external postings from ever handing off.',
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
      + 'consent banner\'s Accept. It waits up to five seconds for that element to '
      + 'exist first, so a control the page draws a moment late still gets pressed.',
  },
  waitFor: {
    title: 'Wait for',
    body: 'Pauses until the element you pick appears, or until the timeout runs out. '
      + 'Use it after a click that loads something.',
  },
  scrollIntoView: {
    title: 'Scroll to',
    body: 'Scrolls the element into view. Some forms only render their fields once '
      + 'they are on screen. The on-page panel offers Click, Wait for and Delay only, '
      + 'so this one is added through Options → Sites as JSON.',
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
    short: 'Fill on open, without pressing anything',
    body: 'Fill automatically as soon as a page matching one of your site configs '
      + 'finishes loading. Turn it off to fill only when you press Fill in the popup.',
    // The one page that fills with this off, and it is not an oversight: the
    // handoff the user asked for is not finished until the employer's form is
    // filled, so a landing arrives already run (`onRedirectLanded` in main.ts).
    when: 'One page ignores it: an employer\'s application the extension opened itself, '
      + 'by following a two-step posting, is filled on arrival either way — that handoff '
      + 'is not finished until it is.',
  },
  closeTabOnSubmit: {
    // "Apply" everywhere the *extension's* action is meant. The site's own
    // control stays "the Send button" — they are two different things, and this
    // row used to be the only place that called ours "submit".
    title: 'Auto-close the tab after I apply',
    short: 'Free the slot once an application is confirmed sent',
    // Not "which also frees a slot": the slot is freed by the send itself, in
    // `onSubmitted`, whatever this setting says — the sibling below already
    // words it that way and these two must not describe the queue differently.
    body: 'Closes the posting once the application is confirmed sent. The queue moves on '
      + 'either way — a confirmed send frees its slot whether or not the tab goes.',
    when: '"Sent" means that site\'s confirmation element actually appeared. A site '
      + 'with none configured never reports a send, so this never fires there.',
  },
  closeTabOnSkip: {
    title: 'Auto-close the tab after I skip',
    short: 'Free the slot when a posting is skipped',
    body: 'Closes the posting when you skip it — from the review modal, or from the '
      + 'popup\'s Skip → next during a queue session — which also frees a slot for the '
      + 'next posting. Both auto-closes wait out the “Close delay” below.',
    when: 'Turn it off to keep skipped postings open for a second look. The queue moves '
      + 'on either way — a skip frees its slot whether or not the tab goes.',
  },
  closeTabDelayMs: {
    title: 'Close delay',
    short: 'Milliseconds on screen before either auto-close',
    body: 'How long to leave the page on screen before closing the tab, in milliseconds. '
      + 'Used by both auto-close settings above; set it high enough to actually read a '
      + 'confirmation.',
    example: '1500',
  },
  redirectTarget: {
    title: 'When following an external application',
    short: 'Where the employer\'s own application opens',
    body: 'Where the employer\'s application opens once a two-step posting is followed: '
      + 'in a new tab replacing the posting, in a new tab beside it, or in place.',
  },
  keepInBrowser: {
    title: 'Keep links in the browser',
    short: 'Never let an apply link open a phone app',
    body: 'Some "Apply" buttons are app links rather than web links, and tapping one '
      + 'hands the posting to a phone app. Nothing can be filled or recorded there — '
      + 'this extension only works on a web page — so with this on, a link that has a '
      + 'web address hidden inside it is opened at that address instead, and one with '
      + 'no web address at all is left alone, with the posting saying so.',
    when: 'Turn it off only if you would rather finish those applications in the app '
      + 'yourself. Two kinds of handoff are outside any extension\'s reach: an ordinary '
      + 'https link that an installed app has claimed — Android decides that before the '
      + 'extension sees it, under Settings → Apps → that app → "Open supported links" — '
      + 'and a page that redirects itself with its own scripts.',
  },
  sessionBatchSize: {
    title: 'Tabs at once',
    body: 'How many job tabs a queue session keeps open. Finishing one — apply, skip '
      + 'or close — opens the next, so 60 imported links never become 60 tabs.',
    when: 'Drop it to 1–2 on a phone, where five job pages will not fit in memory.',
  },
  modalLayout: {
    title: 'Panel size & position',
    body: 'Where the review modal and the site setup panel sit on screen and how big they '
      + 'are, set by dragging the card in the simulator below. Both use it: only one of '
      + 'them is ever open at a time, so they share one place on the page. Dragging or '
      + 'resizing a panel on a job page moves it for that page only and leaves this '
      + 'default alone. Desktop only: at 640px wide and under, both are always a '
      + 'full-width bottom sheet.',
  },
  modalFullscreen: {
    title: 'Fullscreen panels',
    short: 'Overrides the configured size and position until you turn it off.',
    body: 'Opens the review modal — and the setup panel — filling the whole browser window '
      + 'instead of as a card in the corner: worth it for reading a long description rather '
      + 'than skimming the field report. Each panel\'s own header button toggles this same '
      + 'switch, so you can turn it on from a posting; it then stays on until you turn it '
      + 'off. Your configured size and position are kept for when you do.',
    when: 'You need this when the job description is the reason you opened the modal.',
  },
  // The one entry here with no surface, deliberately: this flag is set for the
  // user and never offered as a control, so nothing renders it. It exists to keep
  // `Record<keyof Settings>` total — which is what makes a *new* setting fail
  // `npm run typecheck` until it has been explained.
  helpSeen: {
    title: 'Help seen',
    body: 'Records that you have dismissed the setup panel\'s legend or the '
      + 'getting-started checklist on this page — they share one flag, so putting away '
      + 'either one retires both, and the basics are not re-explained on every posting. '
      + 'It also decides where the setup wizard opens: on step 1 while it is unset, and '
      + 'on the first step with work outstanding afterwards. Set for you; there is '
      + 'nothing to configure.',
  },
  syncEnabled: {
    title: 'Sync the job database',
    short: 'Share applied and skipped postings with another browser',
    body: 'Keeps the job database the same in two browsers — which postings you have '
      + 'applied to, which you skipped, and the job text that was saved with them. Both '
      + 'browsers connect to the same Google account, and the data is kept in a folder '
      + 'there that only this extension can see. Nothing else is shared: your profile, '
      + 'your CV, your site configurations and the rest of these settings stay on this '
      + 'device. Neither side overwrites the other — the two histories are combined, and '
      + 'where they disagree about a posting the most recent decision wins, whichever '
      + 'browser it was made on. It runs when you press Sync now and once when the '
      + 'browser starts, never on a timer.',
    when: 'You need this when you apply for jobs from more than one computer, and want '
      + 'to avoid applying twice to the same posting.',
  },
  exportOptions: {
    title: 'What the archive exports',
    short: 'The columns, statuses and format the Export jobs button writes',
    body: 'Which columns the archive file has, which postings go in it, and whether it '
      + 'is written as JSON or as CSV for a spreadsheet. Ticked under Queue → Archive, '
      + 'and kept for next time. Anything you leave alone keeps its default: every '
      + 'column, and the postings you applied to.',
    when: 'You only want part of what is saved — the descriptions to read back, or a '
      + 'plain list of titles and companies to sort in a spreadsheet.',
  },
};

/* ---------------- Setup wizard steps ---------------- */

/**
 * The panel's step titles, so the `?` and the heading cannot disagree.
 *
 * `prep` is called "Page actions" and not "Setup steps": the wizard's own units
 * are steps now, and "Step 2 of 6: Setup steps" reads as a stutter. It is not
 * "Before filling" either any more — the step carries two lists, the one that
 * runs before filling and the one that runs before leaving for an external
 * application, and a title naming only the first hid the second.
 */
export const SETUP_STEP_TITLES: Record<SetupStepKey, string> = {
  site: 'Site',
  prep: 'Page actions',
  kind: 'Application type',
  info: 'Job info',
  fields: 'Form fields',
  send: 'Sending',
};

/**
 * The wizard shows each step's `body` inline, above that step's rows, rather
 * than only behind the `?` — with one step on screen there is finally room for
 * it, and the whole complaint about the old panel was that it opened onto
 * jargon. The `rows` stay behind the `?`: they are a reference, not an
 * introduction.
 */
export const SETUP_STEP_HELP: Record<SetupStepKey, GroupHelp> = {
  site: {
    title: 'Which pages this applies to',
    body: 'The quickest way to set this site up is to apply to one job while the '
      + 'extension watches — everything below, and the five steps after it, is for '
      + 'correcting what that produced or for building a config by hand. A config is '
      + 'matched to a page by its URL pattern; the name is only a label for you.',
    when: 'Widen the pattern if a sister page on the same board is not recognised.',
    example: '*://boards.acme.com/jobs/*',
    rows: [
      {
        label: 'Apply on this site / on the employer’s site',
        body: 'Records one application and writes the config from it. The two differ '
          + 'only in what the bar asks you to mark; what actually happens wins either '
          + 'way, so a wrong guess here costs nothing.',
      },
      { label: 'Name', body: 'What this site is called in the popup and the review modal.' },
      {
        label: 'URL pattern',
        body: '`*` matches any run of characters. Keep the trailing `*` — without it a '
          + 'posting URL ending in `?job=123` stops matching.',
      },
      {
        label: 'Advanced (JSON)',
        body: 'Opens Options → Sites at the JSON editor, which holds every site config '
          + 'as one list — find this one by its name. It is where the keys the wizard '
          + 'does not put a row on — extra URL patterns, `waitFor`, the scroll-to page '
          + 'action — can be edited directly.',
      },
    ],
  },
  prep: {
    title: 'Clicks and waits this site needs',
    body: 'Three lists of things the extension does on the page itself, each run '
      + 'automatically and top to bottom. The first runs before every fill — for '
      + 'a form that is behind an "Apply" button, or a tab, or that arrives a second '
      + 'late. The other two are the two ways a posting ends: one runs after your CV is '
      + 'attached and before Apply presses Send, for sites that only accept the file '
      + 'once a dialog is confirmed; the other runs before leaving for an employer\'s '
      + 'own application, so the board records the apply before the handoff.',
    // The three lists fail differently, and only the first one can cost you the
    // whole run — `runPrepSteps` rethrows there and `Controller.run` never
    // reaches `detectAndFill`, so there is no fill and no review, just a console
    // warning. Nothing said so, and `todoChip` explicitly reassures the user that
    // this step never counts as work.
    when: 'Leave all three empty if the form is simply there on load and takes your CV '
      + 'the moment it is attached. What a failure costs differs by list, which is '
      + 'worth knowing before you add to the first one: a step there that never finds '
      + 'its target stops the fill outright — no review card appears at all — while a '
      + 'failure in either of the other two is logged and stepped over, so Apply still '
      + 'presses Send and a handoff still happens. A yellow dot only means the target '
      + 'is missing at this moment, which is the normal resting state of a "Wait for" '
      + 'and is why this step never reports work; on a "Click" it is worth a look.',
    rows: [
      refRow('Click', PREP_HELP.click),
      refRow('Wait for', PREP_HELP.waitFor),
      refRow('Delay', PREP_HELP.delay),
      {
        label: 'The number box',
        body: 'A timeout for "Wait for", or the length of a "Delay" — milliseconds, so '
          + '1000 is one second.',
      },
      {
        label: 'Run steps ▶',
        body: 'Runs the before-filling list now so you can watch it work, without '
          + 'reloading the page. It is the only list with a button: the CV steps act on '
          + 'a half-sent application, and running the before-leaving list ends by '
          + 'navigating away from the posting.',
      },
      refRow('After attaching the CV', CONFIG_HELP.submitCv),
      refRow('Before leaving', REDIRECT_HELP.beforeFollow),
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
    // One row per group, in the step's own order — the panel leads with quick
    // apply (`REDIRECT_GROUPS` in `setupPanel.ts`) because that is the ordinary
    // case and the only group every site has something to say about. The marker
    // and the link are one answer between them, and neither is any use alone,
    // which is why they sit together under the second head.
    rows: [
      refRow('Quick-apply marker', REDIRECT_HELP.quickApplySelector),
      refRow('External marker', REDIRECT_HELP.markerSelector),
      refRow('External apply link', REDIRECT_HELP.applySelector),
    ],
  },
  info: {
    title: 'What the review modal shows you',
    body: 'These point at the posting\'s title, description and requirements so the '
      + 'review modal can show the job itself — the thing you actually need in order to '
      + 'decide whether to send it. They have no effect on filling.',
    // Which of the three are chased, and why it is not all of them: the title and
    // the description are guessed from generic fallbacks and so are worth
    // flagging when even those find nothing, while requirements has no fallback
    // at all — counting it reported "1 to do" on every site that simply has no
    // requirements block, which is most of them.
    when: 'Optional. Unset just means the modal shows less — and the requirements row '
      + 'is never chased at all, because plenty of postings have no separate '
      + 'requirements block to point at.',
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
    // Not "one row per field of your profile": the step lists every field the
    // extension knows, so most grey rows on a short form are fields the page
    // never asked for. Saying otherwise sent people picking rows that have no
    // input to pick — and made the chip, which counts the CV alone, look broken.
    body: 'One row for every field the extension knows — not one per field this page '
      + 'asks for, so a form with four inputs still lists them all and most of the grey '
      + 'rows only mean "this posting never asked for that". Green rows are already '
      + 'handled; leave them alone. Pick a grey row when the page really does ask for '
      + 'it: tap Pick, then tap the real input, and that selector is saved for this site '
      + 'so it is right every time from now on.',
    when: 'A row is grey for something the page does ask for, or points at the wrong '
      + 'input. The CV is worth chasing on every site — it is the only row this step '
      + 'counts as work.',
    rows: [
      {
        label: 'auto ·',
        body: 'Found by the built-in guessing this run. Nothing is stored — if the site '
          + 'changes, it is guessed again.',
      },
      {
        // The panel really does render this third prefix (`main.ts` appends
        // "(low)" to a heuristic match scored below the strong threshold), and it
        // was the one row wording with nothing explaining it.
        label: 'auto (low) ·',
        body: 'Guessed, but only from a weak signal — a placeholder rather than a name '
          + 'or a label. It is reported and left yellow rather than filled, so Pick it '
          + 'if the row matters on this site.',
      },
      {
        label: 'saved ·',
        body: 'Your own selector, stored in this config. It always wins over guessing.',
      },
      {
        label: 'not a form field — re-pick ·',
        body: 'Your saved selector still resolves, but it points at something that '
          + 'cannot be typed into — usually a label or a wrapper picked instead of the '
          + 'input inside it. Pick again, a little more precisely.',
      },
      { label: 'Clear', body: 'Forgets your saved selector and goes back to guessing.' },
      {
        label: 'Résumé / CV',
        body: 'Picks the file input your stored CV is attached to. Pick the input '
          + 'itself, not the button that opens the file dialog, if you can reach it.',
      },
    ],
  },
  /**
   * Its own step, not the tail of the field list. These two rows are what Apply
   * depends on, and while they sat below sixteen field rows the confirmation
   * element went unset on almost every site — which is exactly what greys Apply
   * out and leaves the posting recorded as merely opened.
   *
   * Only those two. The CV-confirmation steps led this step for a while, which
   * put a prep list above the rows the step exists to un-bury — and under a lead
   * paragraph that describes the Send button and the confirmation and nothing
   * else. They are a prep list like the other two, so they live on `prep`.
   */
  send: {
    title: 'How this site is sent, and how you know it worked',
    body: 'Filling never sends. When you press Apply in the review modal, the extension '
      + 'presses this site\'s own Send button for you — and then waits for the site to '
      + 'say it worked. The Send button is usually found for you, by its label; the '
      + 'confirmation has to be set here, and until it is, Apply stays greyed out.',
    when: 'Always. This is the one step no site can skip, and the confirmation element '
      + 'is the one thing that cannot be guessed.',
    rows: [
      {
        label: 'Send button',
        body: CONFIG_HELP.submitSelector.body,
      },
      {
        label: 'Confirmation element',
        body: CONFIG_HELP.successSelector.body,
      },
      {
        label: 'Picking the confirmation',
        body: 'It only exists once an application has really gone through, so pick it '
          + 'with one on screen — send an application by hand, then Pick the thank-you '
          + 'message while you are looking at it.',
      },
    ],
  },
};

/* ---------------- Concepts ---------------- */

export type ConceptKey =
  | 'dots' | 'autoVsSaved' | 'todoChip' | 'picker' | 'neverSubmits'
  | 'twoStep' | 'appLink' | 'sessions' | 'urlPattern' | 'successSelector' | 'howItWorks'
  | 'apply' | 'applyUnverified' | 'alreadyApplied' | 'exportJobs' | 'syncClient' | 'coverLetter'
  | 'recording' | 'marking' | 'selectorStrength';

export const CONCEPT_HELP: Record<ConceptKey, HelpEntry> = {
  recording: {
    title: 'Setting a site up by applying once',
    short: 'Apply to one job as normal; the extension learns the site from what you do.',
    body: 'You already know how to apply to this job, so do it — and say what you are '
      + 'doing as you go. While a recording runs the page is held still: clicking does '
      + 'nothing until you press one of two buttons. "Interact" hands the page back for '
      + 'one action — open a section, go to the next step, type into a box — and keeps '
      + 'it as a step to repeat next time. "Declare" names something on the page '
      + 'instead. Nothing else is watched, so reading the posting leaves nothing behind. '
      + 'It records where things are, never what you typed, and saves nothing until you '
      + 'have read the summary at the end and pressed Save. Nothing is submitted on your '
      + 'behalf: the application that goes in during a recording is the one you send '
      + 'yourself. If it goes wrong, "Undo" takes back the last step and "Reset" throws '
      + 'the whole recording away and starts it again from the posting, with the page '
      + 'reloaded back to how it was found.',
    when: 'Any site you have not set up. The two buttons ask where the application '
      + 'actually happens — on this site, or on the employer\'s own after a handoff — '
      + 'and getting it wrong costs nothing, because what really happened wins.',
  },
  marking: {
    title: 'Declaring things while you record',
    short: 'Tell the extension what something is, and it fills or presses that itself.',
    body: 'A step is something to repeat; a declaration is something to understand. '
      + 'Declare a field and the extension fills it from your profile instead of '
      + 'repeating your typing; declare the description and it reads the posting from '
      + 'there; declare the Send button and Apply presses that one. Choose what it is '
      + 'first, and then point at it — the same click-to-pick used everywhere else, so '
      + 'you can widen the selection to the box around a thing rather than the word '
      + 'inside it. Declaring works on anything on the page, not only on what you have '
      + 'just done, which is the only way to catch something that appears by itself.',
    when: 'Two declarations are worth going out of your way for, because nothing else '
      + 'can supply them: the Send button, and the confirmation the site shows once the '
      + 'application is really in. Declare the confirmation while it is on screen — it '
      + 'is gone as soon as you leave the page, and without it Apply stays greyed out.',
  },
  selectorStrength: {
    title: 'Reliable, usable, fragile',
    short: 'How likely the extension is to still find this after the site changes.',
    body: 'Every recorded step remembers how to find its element again, and some ways '
      + 'are sturdier than others. "Reliable" means it has a name of its own — an id, a '
      + 'form field name, a label. "Usable" means it was found by where it sits inside '
      + 'something named. "Fragile" means the only thing identifying it is its position '
      + 'on the page, which stops being true the next time the site is redesigned.',
    when: 'A fragile step still works today, and the row offers a Pick so you can point '
      + 'at something better. It is worth doing for the Send button and the '
      + 'confirmation; for an ordinary click it is usually not.',
  },
  coverLetter: {
    title: 'A cover letter as text or as a file',
    short: 'Fill in either or both — whichever the site asks for is the one used.',
    body: 'Sites are split on this: some give you a box to type into, some want a '
      + 'document uploaded, and you cannot tell which until the form is in front of '
      + 'you. So both live here. The text fills a cover-letter box you would have '
      + 'typed into; the file is attached to a cover-letter upload. Fill in whichever '
      + 'you expect to need, or both — nothing is sent anywhere until you press Apply.',
    when: 'The file is only ever attached to an upload the page names as a cover '
      + 'letter. An unlabelled file input is treated as the CV, never as this — '
      + 'attaching the wrong document is worse than leaving a row for you to fill.',
  },
  dots: {
    title: 'What the dots mean',
    short: 'Green is done, yellow is worth a look, grey means nothing was found.',
    // What yellow is *actually* drawn for, per row type. It used to say a saved
    // selector that stops resolving is "how a form field, a redirect selector and
    // the Send button each report one", and only the redirect row does that: a
    // stale `fieldOverrides` selector is skipped by `detectFields` and the
    // guessing simply takes over, and `findSubmitControl` falls back to the label
    // heuristic. So the copy sent someone whose field row had gone grey hunting
    // for a yellow dot that cannot appear, and said nothing about the one thing
    // that does change under them silently.
    body: 'Green: matched and handled. Yellow: found something, but it is not settled — a '
      + 'guess the keyword matching is unsure of, a Send button recognised only by its '
      + 'label, or a selector you saved that resolves to something that cannot be filled, '
      + 'which the row spells out as "not a form field — re-pick". A redirect selector you '
      + 'saved that stops matching altogether is yellow too, and says "saved selector · no '
      + 'match". Three rows treat a stale save differently: the confirmation element stays '
      + 'green while it is only saved, because it does not exist until an application has '
      + 'gone through; a Job info row whose saved selector stops matching goes grey rather '
      + 'than yellow — its own line still reads "saved selector · no match"; and on a form '
      + 'field it is quieter than either, because the guessing takes back over, so the row '
      + 'simply reads "auto ·" again, or "not found". The third '
      + 'state is "nothing found", and it is drawn twice over: grey with a dash in the '
      + 'setup panel, where "not set" is an ordinary answer, and red with a cross in the '
      + 'fill report, where an unmatched field is a gap in what would be sent. The glyph '
      + 'inside the dot carries the same meaning as the colour, so it still reads if '
      + 'colour does not.',
  },
  autoVsSaved: {
    title: '“auto ·” versus “saved ·”',
    short: '“auto” was guessed just now; “saved” is your own selector, stored for this site.',
    body: '“auto” means the built-in keyword guessing found it this run and stored '
      + 'nothing. “saved” means a selector is stored in this site\'s config — yours, '
      + 'from Pick — and it beats the guessing every time. A row with neither says so in '
      + 'the words that suit it: “not found” on a form field or the Send button, “not '
      + 'set” on the redirect, job-info and confirmation rows. It is the same answer '
      + 'twice, and on an optional row it is perfectly fine.',
  },
  /**
   * Counted per step, by what that step is *for* — see `stepStates` in
   * `setupSteps.ts`. It used to be described as one uniform rule ("rows that
   * still need a decision"), which is true of exactly one of the six steps and
   * made the two most surprising counts read as bugs: a dozen grey field rows
   * that are not work, and a page-actions step that never counts at all.
   */
  todoChip: {
    title: 'The “N to do” chip',
    short: 'How much work a step still has. No chip means you can skip it.',
    body: 'How much work that step still has — counted by what the step is for, not by '
      + 'how many rows are grey. “Form fields” counts the CV and nothing else, so a page '
      + 'that asks for four things leaves a dozen grey rows and no chip. “Application '
      + 'type” counts only a selector you saved that has stopped matching, since “not '
      + 'set” is the healthy state there. “Sending” counts a missing Send button or a '
      + 'missing confirmation element. “Site” counts a blank URL pattern. “Job info” '
      + 'counts a title or description the modal could not find, but never the '
      + 'requirements row — that one has no automatic fallback, so “not set” is simply '
      + 'what a posting without a separate requirements block looks like. And “Page '
      + 'actions” never counts: a step that has not run yet is its normal state. A step '
      + 'with no chip can be ignored.',
  },
  picker: {
    title: 'Pick / Re-pick / Clear',
    short: 'Pick, then click the real thing on the page and press Confirm.',
    body: 'Pick hides the panel and lets you point at the real element on the page. '
      + 'A click selects rather than saves: the outline shows what you have got, and '
      + 'nothing is written until you press Confirm. Clicking the same spot again '
      + 'steps “into” the element you have — the first click lands on the box around '
      + 'the thing, and each one after that goes one level further in, wrapping back '
      + 'to the outside at the end. "Wider" and "Deeper" (or the arrow keys) do the '
      + 'same without having to find the spot again. Clear throws the saved selector '
      + 'away.',
    when: 'The heading you can see is usually a `span` inside the box you actually '
      + 'want, so the element under the pointer is rarely the one to save. The '
      + 'toolbar names each step and says how reliable a selector for it would be — '
      + 'stop on the one that is a name rather than a position.',
  },
  /**
   * What the review modal's greyed-out Apply button says when pressed. It has to
   * answer both halves of the user's question — what the button would do, and
   * why it is grey — or a dead control has simply learned to talk.
   *
   * Worded without a "here", because this is one of the entries the options Help
   * tab lists under "Terms you will see" (`initHelp`), where there is no button
   * to be grey and no page to be missing one. Behind the modal's `?` it still
   * reads as the answer to the press that opened it.
   */
  apply: {
    title: 'Apply',
    short: 'Presses the site’s own Send button for you, once you press this one.',
    body: 'Apply confirms the CV if this site needs that, then presses the site\'s own '
      + 'Send button. It is greyed out whenever no such button can be found on the '
      + 'page — usually because the form is behind a step that has not opened yet, or '
      + 'because the button is unusually named. Point it at the right one with “Set up '
      + 'this site” → Send button, and it goes live.',
    when: 'Apply is grey on a page that clearly has a Send button of its own.',
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
      + 'received” message the site shows after a successful send. Then Apply goes live '
      + '— as long as a Send button was found too — and that same element is what marks '
      + 'the posting applied.',
    when: 'Apply is grey on a site you have not finished setting up.',
  },
  /**
   * Why *two* controls are retired at once, which is the part nobody would guess.
   * Apply retiring on a finished posting reads as obvious; Skip retiring beside it
   * does not, and the reason is a real one — Skip writes a status, and writing
   * "skipped" over "applied" is how a completed application quietly loses its
   * record. So this says what happened, why neither button is live, and where the
   * decision can still be changed.
   */
  alreadyApplied: {
    title: 'This posting is already applied to',
    short: 'Apply and Skip are retired so an application cannot be sent or filed twice.',
    body: 'This posting is recorded as applied, so there is nothing left to decide here. '
      + 'Apply is retired because pressing the site\'s Send button again would send a '
      + 'second application to the same job. Skip is retired because skipping writes a '
      + 'status of its own, and writing “skipped” over “applied” would lose the record of '
      + 'an application you actually sent. Re-run is still in the ⋯ menu if you want to '
      + 'look at the form again — it does not send anything, and it does not '
      + 'change the record. If the posting was recorded wrongly, change its status in '
      + 'Options → Queue and it goes back to being an ordinary posting.',
    when: 'You open a posting you applied to earlier, or one an application just went '
      + 'through on.',
  },
  /**
   * The archive button in the Queue tab. Two things need saying and neither is
   * guessable from the label: that the text was already being kept as postings
   * were read (so the file is not built from what is open now), and that a
   * two-step posting arrives as one row rather than two.
   */
  exportJobs: {
    title: 'Export jobs',
    short: 'Downloads the postings you choose, with their text, as one file.',
    body: 'Downloads one file holding the postings you ask for: the job title, the '
      + 'company, location and type, the description and requirements as they read '
      + 'on the page, the URL, board, status and dates, and — on a two-step posting — '
      + 'the page it came from and the one it was handed off to. Every column goes in '
      + 'unless you say otherwise. “What to export” picks which of them go in it, which '
      + 'postings — the ones you applied to, by default, but the text of a skipped one '
      + 'is kept too — and whether the file is JSON or a CSV for a spreadsheet. The text '
      + 'is saved automatically for every posting the extension reads and reports on, '
      + 'so the file covers applications whose tabs were closed long ago. A '
      + 'two-step posting is one '
      + 'entry, not two — the board\'s description travels with the application it '
      + 'handed off to.',
    when: 'You want to look back over what you applied to and judge which roles fit.',
  },
  /**
   * The one thing sync cannot ship with: a Google OAuth client. It is a Google
   * Cloud console errand, so the steps are numbered and name the exact screens —
   * and the redirect URI is shown beside this in the page, because it is the
   * only value that has to be copied *out* of here and into Google.
   */
  syncClient: {
    title: 'Your Google OAuth client',
    short: 'Sync talks to your own Google project, so you create the client once.',
    body: 'Sync stores the job database in your own Google Drive, through a Google Cloud '
      + 'project you own — nothing passes through anyone else — so the one-time errand is '
      + 'creating the client it signs in with. In Google Cloud: (1) enable the Google '
      + 'Drive API; (2) create an OAuth client of type “Web application”; (3) add the '
      + 'redirect URI shown below it to that client, exactly as written — and on your '
      + 'second browser, add that one\'s too, since each has its own; (4) on the consent '
      + 'screen add your own account as a user, or publish it. Then paste the client ID '
      + 'and secret here, press Save client, press Connect — and switch “Sync the job '
      + 'database” on, which is the step that is easy to miss: until it is on, Sync now '
      + 'stays disabled and nothing is exchanged. The first Sync now after connecting '
      + 'stops and asks, naming the account and how many postings are on each side; '
      + 'nothing is combined until you press Combine. That one look is there because '
      + 'picking the wrong account in Google\'s chooser is a single misclick, and it '
      + 'would fold a stranger\'s job list into yours. Left in “Testing”, '
      + 'Google expires the sign-in '
      + 'after seven days and you reconnect weekly; publishing it costs one '
      + '“Advanced → continue” the first time instead. The secret is not really a secret '
      + 'in an installed extension — Google requires it here and assumes anyone with the '
      + 'extension can read it; the redirect URI and PKCE are what actually protect it.',
    when: 'You want the two browsers to share one job database without moving a file by '
      + 'hand.',
  },
  neverSubmits: {
    title: 'Nothing is sent until you say so',
    body: 'The extension fills and reports; it never sends anything by itself, however '
      + 'confident it is. The one thing that sends is Apply, and Apply only runs '
      + 'because you pressed it. Read the review, fix what it flagged, then press Apply '
      + '— or ignore it and press the site\'s own button yourself.',
  },
  twoStep: {
    title: 'Two-step (external) postings',
    short: 'Followed automatically, and both ends are recorded against each other.',
    body: 'A posting that applies on the employer\'s own site rather than on the board. '
      + 'The extension follows the link — after any “before leaving” page actions that '
      + 'site has, such as its own Save job — waits out any tracker redirects, records '
      + 'both ends against each other, and fills the form it lands on. Applying there '
      + 'marks the original posting applied too.',
  },
  appLink: {
    title: 'Postings that apply in an app',
    body: 'Some boards make their Apply button an app link — a `linkedin://` or '
      + '`intent://` address — which a phone resolves by opening the app rather than a '
      + 'web page. The extension cannot help there: it fills web forms, and it decides a '
      + 'posting was really sent by watching for the site\'s own confirmation on the page. '
      + 'So an app link is only followed when it carries a web address inside it, which '
      + 'many do; that address is opened instead and fills as usual. When there is none, '
      + 'the link is left for you and any form on this page is filled anyway.',
    when: 'Two handoffs no extension can intercept: an ordinary https link an installed '
      + 'app has claimed, which Android resolves under Settings → Apps → that app → '
      + '"Open supported links", and a page that redirects itself with its own scripts. '
      + 'Turning off "Keep links in the browser" in Settings hands every app link over.',
  },
  sessions: {
    title: 'Queue sessions',
    short: 'A fixed number of job tabs at a time, so a big import never becomes a wall of tabs.',
    body: 'A session keeps a fixed number of job tabs open — not all of them. Each one '
      + 'you finish, by applying, skipping or closing it, opens the next posting that '
      + 'is waiting. Stop and resume whenever: the queue is the postings still marked '
      + 'new, so nothing is lost by stopping.',
    // Not "press Start again and it carries on". The record survives with
    // `active: true`, so the button still reads Stop — and nothing tops the
    // session up until `startSession` runs again, which only Start does.
    when: 'A session left running is remembered across a browser restart, but it does '
      + 'not re-open anything on its own: the button still reads Stop session, so press '
      + 'Stop and then Start to pick it up.',
  },
  urlPattern: {
    title: 'URL patterns',
    body: 'A whole-URL glob where `*` matches any run of characters — with one '
      + 'exception: a `*` written before `://` matches a scheme only, never a `:` or a '
      + '`/`, so `*://acme.com/*` cannot be fooled by another site\'s page carrying '
      + '`https://acme.com/` in its query string. The alternative is a regular '
      + 'expression between slashes. Because the whole URL is tested, a glob without a '
      + 'trailing `*` stops matching the moment a posting adds `?job=123`.',
    example: '*://boards.acme.com/jobs/*',
  },
  successSelector: {
    title: 'How “applied” is decided',
    body: 'Pressing Send proves nothing — the server can still reject the form, and a '
      + 'site that checks your answers in JavaScript rejects it after the browser has '
      + 'already announced the submission. So a posting counts as applied only when the '
      + 'site\'s own confirmation element — what `successSelector` points at — actually '
      + 'appears on screen. Nothing else counts, which is why Apply stays grey '
      + 'until a site has one. The confirmation may be on a different page — many boards '
      + 'land on their own “thank you” URL — and that still counts for the posting you '
      + 'were applying to, as long as the page it lands on is covered by a config '
      + 'carrying the same confirmation element. That is why a site you were handed off '
      + 'to needs setting up before anything there can be recorded.',
  },
  howItWorks: {
    title: 'How it works',
    // The order is the run order in `Controller.run`, and the job text really is
    // read last — `extractJob` is called while the review is being built, not
    // before the fill. Listing it earlier described a pipeline we do not have.
    body: 'On a page one of your site configs matches: wait for the form to exist, run '
      + 'the page actions, work out whether the posting applies here or on the '
      + 'employer\'s site, find each field, fill the confident ones — CV included — then '
      + 'read the posting\'s own text and show you the review with both in it. Then you '
      + 'press Apply, or Skip.',
  },
};

/**
 * The dot key, as rows rather than prose — a colour is explained by showing the
 * colour next to its meaning, not by naming it in a paragraph. `status` matches
 * the `.cf-dot` modifier classes in primitives.css.
 *
 * It is rendered in exactly one place — the setup panel's legend — so each line
 * has to describe *that panel's* dots, and to agree with `CONCEPT_HELP.dots`
 * three lines below it. Two of them used to do neither. "a saved selector that
 * no longer matches" is true of the redirect rows alone: on a form field the
 * guessing takes back over (`auto ·` again, or `not found`, and no yellow) and
 * on a job-info row it goes grey — so the line sent someone hunting for a
 * yellow dot that cannot appear, while omitting what yellow is mostly drawn
 * for. And "press Pick" read as an instruction on every grey row, when grey is
 * the healthy resting state of the redirect rows and of the dozen profile
 * fields a short form never asks for.
 */
export const DOT_LEGEND: Array<{ status: 'high' | 'low' | 'none'; label: string }> = [
  { status: 'high', label: 'matched — nothing to do' },
  { status: 'low', label: 'found something, but it is not settled' },
  { status: 'none', label: 'nothing found — often fine; Pick it if this page asks for it' },
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
    // "Page action", not "setup step": the wizard's own units are steps ("Step 2
    // of 6"), and its second step is titled Page actions. Two names for one thing,
    // one of them colliding with the numbered steps, is the drift this file exists
    // to prevent — `CONFIG_HELP.prep` already sends the user there by that name.
    opening.push(`runs ${count(prep.length, 'page action')} (${describeStep(prep[0])}`
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
      + `${confirmCv.length > 1 ? `, and ${count(confirmCv.length - 1, 'action')} more` : ''} `
      + 'to confirm the upload.');
  }
  parts.push(config.submitSelector
    ? `Apply presses ${code(config.submitSelector)}.`
    : 'Apply presses whichever button reads as the site’s own Send.');
  if (config.autoDetect === false) {
    parts.push('Automatic field guessing is off — only your own selectors are used.');
  }

  // Both rules, in the order `detectRedirect` applies them. Two `if`s and not an
  // `if/else`: a board that mixes both kinds of posting configures both, and
  // describing only the handoff named the rule that loses — the quick-apply
  // marker is checked first and returns there, so it wins whenever it matches.
  const quickApply = config.redirect?.quickApplySelector;
  const handoff = config.redirect?.markerSelector ?? config.redirect?.applySelector;
  if (quickApply) {
    parts.push(`Postings with ${code(quickApply)} are filled here rather than followed `
      + `elsewhere${handoff ? ' — checked first, so it wins' : ''}.`);
  }
  if (handoff) {
    parts.push(`${quickApply ? 'Otherwise, postings' : 'Postings'} matching ${code(handoff)} `
      + 'hand off to the employer\'s site.');
  }

  // Not "a submitted form is the only sent signal" — there is no submit-event
  // fallback anywhere, and saying there was described the one state in which
  // Apply refuses to run as though it were a working alternative.
  parts.push(config.successSelector
    ? `Counts as sent — and applied — when ${code(config.successSelector)} appears.`
    : 'Has no confirmation selector, so Apply is greyed out and nothing here is ever recorded as applied on its own.');

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
