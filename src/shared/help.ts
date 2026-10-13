/**
 * The one place the extension explains itself.
 *
 * Every surface that answers "what is this?" — the Settings toggles, the Help
 * tab, the review card's `?` — renders from this catalog. Written once, so the
 * words cannot drift apart between the card and the page that documents it.
 *
 * `SETTINGS_HELP` is `Record<keyof Settings, …>`: adding a setting fails
 * `npm run typecheck` until it has an explanation here.
 *
 * Style rules for the copy: address the user ("you"), say what the thing does
 * before what it is called, and prefer a concrete example to a definition.
 */

import type { Settings } from './types';
import type { LocalSetting, SyncDomain } from './syncUnits';

export interface HelpEntry {
  /** Heading shown above the explanation. */
  title: string;
  /** Plain-English "what this is", one to three sentences. */
  body: string;
  /**
   * A one-line form, for places that are a key rather than an explanation — the
   * options settings rows, where the reference puts a caption under every title.
   * The full `body` stays one tap away behind that row's `?`.
   */
  short?: string;
  /** "You need this when …" — whether to bother with it at all. */
  when?: string;
  /** A concrete value, shown in monospace. */
  example?: string;
}

/**
 * An entry with per-row lines — what `ui/help.ts` renders as a list under the
 * body. Nothing in the catalog uses rows today; the type stays because the
 * renderer is shared with the options page's reference tables.
 */
export interface GroupHelp extends HelpEntry {
  rows?: Array<{ label: string; body: string; example?: string }>;
}

/* ---------------- Behavior settings ---------------- */

export const SETTINGS_HELP: Record<keyof Settings, HelpEntry> = {
  fillAutomatically: {
    title: 'Fill automatically',
    short: 'Fill every page as it loads, and every field that appears later',
    body: 'Every input on every page goes past the extension. The ones it recognises are '
      + 'filled as the page loads — and when more appear, because you pressed “Apply now” '
      + 'or moved to the next page of a form, those are filled too. A box that already '
      + 'has something in it is never touched, and neither is one you have typed in. '
      + 'Login and sign-up forms, search boxes and card details are always left alone.',
    when: 'Turn it off to fill only when you press Fill in the popup.',
  },
  openCardWhenFilled: {
    title: 'Open the review when a page is filled',
    short: 'Show the full card, not just the pill, wherever something was filled',
    body: 'When the extension fills something on a page, the review card opens by itself, '
      + 'listing every question and what went in. With this off it waits folded to a '
      + 'small pill in the corner — press it to see the same card. Pages where nothing '
      + 'was filled get neither.',
    when: 'Turn it on if you want to check every fill as it happens.',
  },
  keepInBrowser: {
    title: 'Keep queued links in the browser',
    short: 'Never let a queued link open a phone app',
    body: 'Some job links are app links rather than web links, and opening one hands the '
      + 'posting to a phone app, where nothing can be filled. With this on, a link that '
      + 'has a web address hidden inside it is opened at that address instead, and one '
      + 'with no web address at all is not opened.',
    when: 'Turn it off only if you would rather finish those applications in the app.',
  },
  sessionBatchSize: {
    title: 'Tabs at once',
    body: 'How many job tabs a queue session keeps open. Finishing one — skipping it or '
      + 'closing it — opens the next, so 60 imported links never become 60 tabs.',
    when: 'Keep it at 1–2 on a phone, where more job pages will not fit in memory.',
  },
  modalLayout: {
    title: 'Card size & position',
    body: 'Where the review card sits on screen and how big it is, set by dragging the '
      + 'card in the simulator below. Dragging or resizing the card on a page moves it for '
      + 'that page only and leaves this default alone. Desktop only: at 640px wide and '
      + 'under, the card is always a full-width bottom sheet.',
  },
  syncEnabled: {
    title: 'Sync this browser',
    short: 'Keep this browser and your others the same — everything listed under “What syncs”',
    body: 'Keeps the whole extension the same in two browsers: your job list, your '
      + 'profile, your own fields, what you have taught it, your CV and cover letter, and '
      + 'your settings — all of it listed under “What syncs”, along with the few things '
      + 'that stay on each browser. Both browsers connect to the same Google account, and '
      + 'the data is kept in a folder there that only this extension can see. Neither side '
      + 'overwrites the other: the two are combined, and where both changed the same thing '
      + 'the more recent change wins. It runs when you press Sync now and once when the '
      + 'browser starts, never on a timer.',
    when: 'You fill applications from more than one computer, or a computer and a phone.',
  },
};

/* ---------------- What syncs ---------------- */

/** One line of the Sync tab's "What syncs" list. */
export interface ScopeLine {
  title: string;
  detail: string;
}

/**
 * The synced side of the list, one line per family of synced data. Keyed on
 * `SyncDomain` — the families `syncUnits.ts` sorts every synced value into — so a
 * new kind of synced data fails `npm run typecheck` until it is described here,
 * and the list cannot quietly fall behind what actually leaves the browser.
 *
 * `settings` is the heading; the settings themselves are listed under it by their
 * `SETTINGS_HELP` titles, generated from `SYNCED_SETTINGS`.
 */
export const SYNC_SCOPE_TEXT: Record<SyncDomain, ScopeLine> = {
  jobs: { title: 'Your job list', detail: 'Every posting, and whether it is new or done.' },
  profile: { title: 'Your details', detail: 'Everything filled in under Profile → Your details.' },
  wordings: { title: 'Other ways sites ask', detail: 'The extra wordings you gave the built-in fields.' },
  customFields: { title: 'Your own fields', detail: 'Their names, answers, and the questions they answer.' },
  lessons: { title: 'What it has learned', detail: 'Every question you taught it, and what it fills there.' },
  resume: { title: 'Your CV', detail: 'The file itself.' },
  coverLetter: { title: 'Your cover letter file', detail: 'The file itself.' },
  settings: { title: 'Your settings', detail: 'These, from the Settings tab:' },
};

/**
 * The other side: what stays on this browser. The local settings are keyed on
 * `LocalSetting`, so a setting moved to that list has to say here why it stays.
 */
export const LOCAL_SCOPE_TEXT: Record<LocalSetting, ScopeLine> = {
  modalLayout: {
    title: 'Where the card sits, and its size',
    detail: 'Measured against this screen — another screen needs its own.',
  },
  syncEnabled: { title: 'The “Sync this browser” switch', detail: 'Each browser decides for itself whether to sync.' },
};

/** What stays here that is not a setting at all. */
export const DEVICE_ONLY_TEXT: ScopeLine[] = [
  {
    title: 'Your Google OAuth client and the connected account',
    detail: 'Each browser has its own redirect address, and signs in for itself.',
  },
];

/* ---------------- Concepts ---------------- */

export type ConceptKey =
  | 'howItWorks' | 'neverSubmits' | 'teaching' | 'customFields' | 'dots' | 'picker'
  | 'coverLetter' | 'leftAlone' | 'sessions' | 'queueChip' | 'done'
  | 'alreadyDone' | 'syncClient';

/**
 * One numbered step of a guide the user follows with another site open beside it.
 * `link` is the page that step happens on, so nobody has to find it in a menu;
 * `showsRedirectUri` asks the surface to draw this browser's own redirect URI
 * there, because it is derived from the extension ID and cannot be written down.
 */
export interface GuideStep {
  title: string;
  body: string;
  link?: { label: string; href: string };
  showsRedirectUri?: boolean;
}

/**
 * Setting up sync, written for someone who has never opened Google Cloud. Every
 * button is named as Google draws it, and every step that happens on a Google page
 * links straight to that page. Rendered as the last section of the Help tab; the
 * Sync tab links here rather than carrying a second copy.
 */
export const SYNC_SETUP_STEPS: GuideStep[] = [
  {
    title: 'Open Google Cloud',
    body: 'Sign in with the Google account whose Drive should keep your synced data. If '
      + 'Google asks you to accept its terms of service, accept them. This is free: '
      + 'nothing here needs a billing account or a card.',
    link: { label: 'Open Google Cloud', href: 'https://console.cloud.google.com/' },
  },
  {
    title: 'Create a project',
    body: 'A project is just a folder for the next few settings. Give it any name — '
      + '“Job filler sync” is fine — and press Create. When it is ready, check that its '
      + 'name is the one shown in the project picker at the top of the page; every '
      + 'step below happens inside it.',
    link: { label: 'Create a project', href: 'https://console.cloud.google.com/projectcreate' },
  },
  {
    title: 'Turn on the Google Drive API',
    body: 'This lets the project store a file in your Drive. On the page that opens, '
      + 'press Enable. If the button says Manage instead, it is already on — go to the '
      + 'next step.',
    link: {
      label: 'Open the Drive API page',
      href: 'https://console.cloud.google.com/apis/library/drive.googleapis.com',
    },
  },
  {
    title: 'Set up the sign-in screen',
    body: 'This is the screen Google shows when you connect. Press Get started, then: '
      + 'App name — anything, for example “Job filler”; User support email — your own; '
      + 'Audience — External; Contact information — your own email again. Tick that '
      + 'you agree to the policy, press Continue, then Create.',
    link: { label: 'Open the sign-in screen settings', href: 'https://console.cloud.google.com/auth/overview' },
  },
  {
    title: 'Let your own account in',
    body: 'A new project only lets in the accounts you list. On the Audience page, '
      + 'under Test users, press Add users and enter the email you signed in with, '
      + 'then Save. Or press Publish app instead: you will see one “Google hasn\u2019t '
      + 'verified this app” warning the first time you connect, but you will not have '
      + 'to reconnect every seven days, which a test-only project requires.',
    link: { label: 'Open the Audience page', href: 'https://console.cloud.google.com/auth/audience' },
  },
  {
    title: 'Create the client',
    body: 'Set Application type to Web application and give it any name. Then find '
      + 'the box called Authorized redirect URIs — not the one above it called '
      + 'Authorized JavaScript origins — press Add URI, paste the address below, and '
      + 'press Create. It must match exactly, so use the Copy button rather than typing '
      + 'it.',
    link: { label: 'Create an OAuth client', href: 'https://console.cloud.google.com/auth/clients/create' },
    showsRedirectUri: true,
  },
  {
    title: 'Copy the Client ID and Client secret here',
    body: 'Google now shows the new client\u2019s Client ID and Client secret. Copy '
      + 'both — the secret is shown in full only this once, so download the JSON too if '
      + 'it offers. In the Sync tab, paste them into Client ID and Client secret under '
      + '“Google OAuth client”, and press Save client.',
  },
  {
    title: 'Connect',
    body: 'Press Connect in the Sync tab and choose the same Google account. If Google '
      + 'says it hasn\u2019t verified this app, that is expected — the app is your own '
      + 'project. Press Continue (or Advanced, then Go to the app\u2019s name), then '
      + 'Continue again to allow access to the app\u2019s own data in your Drive.',
  },
  {
    title: 'Sync for the first time',
    body: 'Check that “Sync this browser” is on — it is unless you turned it off — and press Sync '
      + 'now. The first time, it stops and shows which account it is about to use and '
      + 'what each side holds; press Combine if that is right.',
  },
  {
    title: 'Your other browser',
    body: 'Every browser has its own redirect address. On the second browser, open this '
      + 'guide again and copy its address from the Create the client step. In Google '
      + 'Cloud open the client you already made, add that address under Authorized '
      + 'redirect URIs as a second line, and Save. Then paste the same Client ID and '
      + 'Client secret into that browser\u2019s Sync tab, Connect with the same account, '
      + 'and press Sync now there too. Do not create a second project.',
    link: { label: 'Open your OAuth clients', href: 'https://console.cloud.google.com/auth/clients' },
  },
];

/**
 * What Google says when a step above went wrong, titled with Google's own words so
 * the user can match the message on their screen to the fix.
 */
export const SYNC_TROUBLESHOOTING: HelpEntry[] = [
  {
    title: '“Access blocked: This app\u2019s request is invalid”',
    body: 'Google did not recognise this browser\u2019s redirect address (its details '
      + 'say `redirect_uri_mismatch`). Either it was never added, or it went into '
      + 'Authorized JavaScript origins instead of Authorized redirect URIs, or a '
      + 'character is missing. Copy it again from the Create the client step, open your '
      + 'client in Google Cloud, put it under Authorized redirect URIs, Save, and wait a '
      + 'few minutes before pressing Connect again — Google can take up to five to '
      + 'pick up a change.',
  },
  {
    title: '“… has not completed the Google verification process”',
    body: 'The project is still in testing and the account you chose is not on its '
      + 'list (`access_denied`). Add that email under Test users on the Audience page, '
      + 'or press Publish app there — see Let your own account in.',
  },
  {
    title: '“The OAuth client was not found” or “invalid_client”',
    body: 'The Client ID or Client secret here does not match a client in Google Cloud '
      + '— usually a missing character or a space copied with it, or the client was '
      + 'deleted. Copy both again from your client\u2019s page and press Save client. '
      + 'If the secret can no longer be shown, add a new secret to the same client.',
  },
  {
    title: '“Google Drive API has not been used in project …”',
    body: 'The Drive API is not turned on for this project. Do the Turn on the Google '
      + 'Drive API step — and check the project picker at the top shows the same '
      + 'project the client is in — then press Sync now again.',
  },
  {
    title: 'It asks me to connect again every week',
    body: 'Google ends the sign-in of a test-only project after seven days. Press '
      + 'Publish app on the Audience page and connect once more; it then lasts.',
  },
  {
    title: 'It works in one browser and is blocked in the other',
    body: 'The second browser has its own redirect address, and only the first one is '
      + 'on the client. Do the Your other browser step.',
  },
];

export const CONCEPT_HELP: Record<ConceptKey, HelpEntry> = {
  howItWorks: {
    title: 'How it works',
    body: 'Every input on every page goes past the extension. It reads what each one asks '
      + '— the label, or the words written above the box — and checks it against what you '
      + 'have taught it, its own knowledge of the common fields, and the wordings you gave '
      + 'your own fields. What it is sure of is filled straight away and outlined green; '
      + 'what it only suspects is outlined yellow and left for you; what it does not know '
      + 'is listed on the card for you to teach. When more fields appear — a form opening, '
      + 'the next page of one — the same happens to them. Then you read it over and press '
      + 'the site\'s own Submit button.',
  },
  neverSubmits: {
    title: 'Nothing is ever sent for you',
    body: 'The extension fills and reports; it never presses a site\'s Submit button, '
      + 'however confident it is. Read the card, fix what it flagged, then submit on the '
      + 'site yourself.',
  },
  teaching: {
    title: 'Teaching a question',
    short: 'Say once what a question is, and it is filled on every site that asks it.',
    body: 'Press Teach on a question the card did not recognise and say what it is: one of '
      + 'your details, one of your own fields, a new field made there and then, or a '
      + 'question to ignore. It is filled at once — and remembered by its wording, so the '
      + 'next site that asks “Given name” gets your first name without asking you. A '
      + 'wrong match is corrected the same way, with Not this.',
    when: 'A lesson names exactly one box. Where a form asks the same thing twice — your '
      + 'name, and a referee\'s — the lesson also remembers which part of the form it was '
      + 'in, so the two are never confused; and if a page still has two boxes a lesson '
      + 'cannot tell apart, it fills neither and lists both. Everything taught is listed '
      + 'under Options → Profile → What it has learned, where any of it can be removed.',
  },
  customFields: {
    title: 'Your own fields',
    short: 'Answers for the questions the built-in fields do not cover.',
    body: 'Add a field for anything you get asked often — years of experience, notice '
      + 'period, whether you need sponsorship, a salary expectation. Give it a name and a '
      + 'value, and list the ways sites word the question under “Answers questions like”. '
      + 'A question containing any of those words is answered with your value — typed into '
      + 'a box, chosen in a drop-down, or ticked in a yes/no.',
    example: 'Years of experience → 7',
  },
  dots: {
    title: 'What the dots mean',
    short: 'Green is done, yellow is worth a look, grey is a question to teach.',
    body: 'Green: the answer is in the box — filled now, or already there. Yellow: the '
      + 'extension has a guess, or knows the question but has nothing in your profile for '
      + 'it — Confirm it, or add the value in Options. Grey: a question it does not '
      + 'recognise yet — Teach it, once. The same colours outline the fields on the page.',
  },
  picker: {
    title: 'Pointing at a field',
    short: 'Teach a box the card did not list by pointing at it.',
    body: 'Some fields are drawn in ways the extension does not read as a question — a '
      + 'custom drop-down, a box hidden behind a button. Press Teach in the popup (or Pick '
      + 'on a row), tap the field on the page, and Confirm. The card then opens on it so '
      + 'you can say what it is.',
  },
  leftAlone: {
    title: 'What is never touched',
    short: 'Login forms, search boxes, card details, and anything you typed.',
    body: 'A form with a password box in it, a search box, card numbers, one-time codes — '
      + 'none of them are ever filled, on any site. Nor is a box that already has '
      + 'something in it, or one you have typed in: what is on the page beats what is in '
      + 'your profile.',
  },
  sessions: {
    title: 'Queue sessions',
    short: 'A fixed number of job tabs at a time, so a big import never becomes a wall of tabs.',
    body: 'A session keeps a fixed number of job tabs open — not all of them. Each one '
      + 'you finish, by closing or skipping it, opens the next posting that is waiting. '
      + 'Stop and resume whenever: the queue is the postings still marked new, so nothing '
      + 'is lost by stopping.',
    when: 'A session left running is remembered across a browser restart, but it does '
      + 'not re-open anything on its own: the button still reads Stop session, so press '
      + 'Stop and then Start to pick it up.',
  },
  queueChip: {
    title: 'The Queue chip',
    short: 'Marks a tab the queue opened, with how far through the queue you are.',
    body: 'A tab the queue opened carries a small “Queue” chip in its corner, so you can '
      + 'tell a posting from the queue from a page you opened yourself. A tab opened from '
      + 'it — the employer\'s own form behind “Apply on company website” — carries it too. '
      + 'Tap it to open the review card.',
  },
  done: {
    title: 'New and Done',
    short: 'A posting is waiting, or you have finished with it.',
    body: 'Every posting is New until you finish it, then Done. Closing a tab the queue '
      + 'opened marks its posting Done and opens the next one; so does Skip. You can also '
      + 'set any posting either way from its row in Options → Queue. Only you set it: the '
      + 'extension cannot see a site\'s Submit button being pressed, so it never claims an '
      + 'application went in.',
    when: 'You want to know what the two words in the queue mean.',
  },
  alreadyDone: {
    title: 'This posting is already done',
    short: 'You finished it earlier; Skip has nothing left to do.',
    body: 'Your job database has this page down as done — you closed its queue tab, '
      + 'skipped it, or marked it by hand. The form is still filled, in case you are '
      + 'looking at it again on purpose, but Skip is retired: there is nothing left for it '
      + 'to finish. If you are not done with it, set it back to New in Options → Queue.',
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
    // The why, not the how: the numbered steps are SYNC_SETUP_STEPS, rendered as
    // their own section at the bottom of Help. Both used to live in this one
    // paragraph, which is how a user got as far as Connect with the redirect URI
    // pasted into the wrong box and nothing saying which box was right.
    body: 'Sync stores everything it shares in your own Google Drive, through a Google Cloud '
      + 'project you own — nothing passes through anyone else — so the one-time errand is '
      + 'creating the client it signs in with. It is free and takes about ten minutes; '
      + 'the step-by-step guide, with a link to each Google Cloud page and the address '
      + 'this browser needs, is “Setting up sync” at the bottom of the Help tab. The '
      + 'first Sync now after connecting stops and asks, naming the account and what is on '
      + 'each side; nothing is combined until you press Combine, because '
      + 'picking the wrong account in Google\'s chooser is a single misclick. The secret '
      + 'is not really a secret in an installed extension — Google requires it here and '
      + 'assumes anyone with the extension can read it; the redirect URI and PKCE are '
      + 'what actually protect it.',
    when: 'You want two browsers to stay the same without moving a backup file by hand.',
  },
  coverLetter: {
    title: 'A cover letter as text or as a file',
    short: 'Fill in either or both — whichever the site asks for is the one used.',
    body: 'Sites are split on this: some give you a box to type into, some want a '
      + 'document uploaded, and you cannot tell which until the form is in front of '
      + 'you. So both live here. The text fills a cover-letter box you would have '
      + 'typed into; the file is attached to a cover-letter upload. Fill in whichever '
      + 'you expect to need, or both — nothing is ever sent for you.',
    when: 'The file is only ever attached to an upload the page names as a cover '
      + 'letter. An unlabelled file input is treated as the CV, never as this — '
      + 'attaching the wrong document is worse than leaving a row for you to fill.',
  },
};

/**
 * The dot key, as rows rather than prose — a colour is explained by showing the
 * colour next to its meaning, not by naming it in a paragraph. `status` matches
 * the `.cf-dot` modifier classes in primitives.css.
 */
export const DOT_LEGEND: Array<{ status: 'high' | 'low' | 'none'; label: string }> = [
  { status: 'high', label: 'the answer is in the box' },
  { status: 'low', label: 'a guess, or nothing in your profile for it' },
  { status: 'none', label: 'a question to teach, once' },
];
