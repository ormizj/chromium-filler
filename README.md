# Chromium Filler

A Manifest V3 Chrome extension that auto-fills job-application forms. Open a job
URL, and on a site it recognizes it waits for the (slow) form, runs any prep
steps, classifies the posting, shows a modal with the **job title + description**,
and fills your fields — **including CV upload**.

Filling is automatic but **never silent**, and **nothing is sent until you press
something**: a review modal reports every field as filled (green), low-confidence
(yellow) or unmatched (red), and its footer carries the two decisions — **Apply**
(run any CV-confirmation steps, then press the site's own *Send* button) and
**Skip**. You override any match by **clicking the real field on the page**; the
selector is saved into that site's config for next time. Nothing auto-submits: no
timer and no "it looked complete" heuristic can reach Apply.

## Features

- **URL-based site detection** with per-site configs (match-patterns or regex).
- **Auto prep phase** — expand description, open the apply/CV modal, etc.
- **Review-report modal** (Shadow DOM, draggable; a bottom-sheet on mobile) with
  **two views behind a header toggle**: *Job* (title, company/location/type chips,
  a scrollable description) is the default, and *Fields* holds the per-field
  report, carrying the report's worst status as a dot so hiding it can never hide
  a problem. A **flow banner** says where the posting is — filled and waiting,
  handing off to an employer, applied, or blocked and why. The footer is
  **Apply · Skip · ⋯** (Options · Site setup · Re-run), never more than two
  visible buttons. Closing it **collapses it to a pill**, never destroying your
  fills, and during a session it carries the queue progress and a *Skip → next*
  action — so a whole run is drivable without ever opening the toolbar popup.
- **Field matching** = keyword heuristics + per-site selector overrides. Only
  high-confidence matches auto-fill; the rest are reported for one-click confirm.
- **Click/tap-to-pick overrides**, persisted to the site config.
- **CV upload** via `DataTransfer` (stored on-device in `chrome.storage.local`).
  The cover letter is handled as both a text field and a file, because sites are
  split on how they ask for it.
- **An on-page setup wizard** — six steps in the order the extension does things
  (Site · Page actions · Application type · Job info · Form fields · Sending),
  one on screen at a time, with a progress rail marking which still have work.
  Every selector in it is pickable by clicking the page.
- **Job queue + sessions** — paste a messy text blob, every URL is extracted /
  normalized / deduped (the **URL is the unique key**). A **session** then keeps a
  fixed number of job tabs open (default 5; drop it to 1–2 on mobile) and opens
  the next posting the moment you apply, skip, or close one — so 60 imported
  links never become 60 tabs. Pause and resume at will; it survives a browser
  restart. Every entry tracks a timestamped status **history**
  (new → opened → redirected → applied, or skipped), with stat cards, search and
  filters.
- **Applied is a lock.** Re-opening a posting the database already records as
  applied retires both Apply and Skip, and declines to follow a two-step handoff
  a second time.
- **Auto-close after submit** (optional) — "sent" is detected per site via a
  `successSelector` becoming visible (see below), which also marks the URL
  **applied**.
- **An archive of what you read** — every posting's title, description,
  requirements and chips are captured, and exportable as JSON or CSV with the
  columns and statuses you tick.
- **Optional sync** of the job database between two browsers, through a Google
  Drive app folder. The database only — never your profile, CV or settings.
- **Explains itself.** Every step of the on-page setup wizard leads with what it
  is and whether you need it; a legend keys the dots, the `auto ·` / `saved ·`
  prefixes and the *N to do* chips on first run; the options page has a **Help**
  tab, a `?` on each setting, a key-by-key **config reference**, and a
  plain-English sentence per saved site ("waits up to 15s for `form`, clicks
  `#expand-description`, then fills…"). A getting-started checklist ticks itself
  off as you set things up. All of it renders from one catalog,
  `src/shared/help.ts`, so no two surfaces can disagree.
- **Mobile friendly** and touch-first (see below).

## Develop / build

```bash
npm install

npm run dev:all   # ⭐ rebuild dist/ on every change + serve the fixture sites
npm run dev       # Vite dev server: the mocked UI harness at :5173/dev/
npm run dev:ext   # just the rebuild-on-change half of dev:all

npm test          # Vitest watch (unit + integration, TDD)
npm run test:run  # Vitest once (CI-style)
npm run typecheck # tsc --noEmit
npm run build     # typecheck + vite build -> dist/
npm run build:store # same, unminified (vite build --mode store)
npm run package   # build both release zips (see below)
npm run screenshots # regenerate the store screenshots from the built extension

# End-to-end: loads the built extension into real Chromium and drives the
# fixture sites. Requires the browser once: `npx playwright install chromium`.
npm run build && npm run test:e2e
```

The E2E suite (`e2e/extension.spec.ts`) is the confidence signal: 57 specs run
the whole pipeline (wait → prep → classify → detect → fill → CV → Apply →
success-watch → auto-close) against 13 deliberately nasty fixture pages, plus
popup/options render and size checks. If it's green, real boards should behave.

### The two zips

`npm run package` produces **two** archives, and they are not interchangeable.
The difference that matters is where `manifest.json` sits: Chrome Web Store
uploads must have it at the archive root, and "Load unpacked" wants a folder.

|                      | `chromium-filler-v<version>.zip`         | `chromium-filler-v<version>-store.zip`      |
| -------------------- | ---------------------------------------- | ------------------------------------------- |
| **Use it for**       | GitHub releases, handing to a tester, mobile sideloading | The Chrome Web Store upload — nothing else |
| **Archive layout**   | everything nested under `chromium-filler/` | `manifest.json` at the archive **root**     |
| **Unzips to**        | one clean `chromium-filler/` folder       | its contents, loose in the current directory |
| **Code**             | minified (`npm run build`)                | unminified (`npm run build:store`)          |
| **Size**             | ~97 KB                                    | ~171 KB                                     |

**Why the store copy is unminified.** Minification is allowed — obfuscation is
what the policy bans — but Chrome's review-process page names "hard-to-review
code" as something that draws extra scrutiny, and this extension already asks for
`<all_urls>`, which routes it to in-depth review regardless. The reviewer reading
`getSettings` instead of `f` costs nothing and can only help. `--mode store` is
the *only* thing that changes; the manifest, the version and the behaviour are
identical.

`package.sh` asserts the root manifest and fails the build if it is ever missing,
because that mistake is silent until the store rejects the upload. It also builds
the store copy **last**, so whatever is left in `dist/` afterwards is the readable
build — the one to load unpacked while reproducing something a reviewer reports.

Loading either one by hand still needs `chrome://extensions` → Developer mode →
**Load unpacked**, pointed at an unzipped folder. Note that an unpacked
extension's ID is derived from its install path, so a tester's copy is a
different extension to Google than yours — which matters for sync, and is what
the commented-out `key` in `manifest.config.ts` is for.

## Running it while you work on it

Two loops, and they answer different questions. **Start with `dev:all`** — it is
the real extension on real pages. Drop to the harness when you are iterating on
the pixels of a surface and don't want to reload an extension to see a change.

### A. `npm run dev:all` — the real extension, real pages

```bash
npm run dev:all
```

That is two processes: `vite build --watch`, which rewrites `dist/` on every
edit, and the fixture server on **ports 5199 and 5200**. When the build settles
it prints the **build ID** (`swift-lynx-x7 · <git-hash>`) and every scenario URL.
The same label is shown at the bottom of the popup, which is how you tell what
code Chrome is actually running — the label is random per build, so a stale one
is obvious.

1. Go to `chrome://extensions` and enable **Developer mode**.
2. **Load unpacked** → select the `dist/` folder. Note the extension ID on the
   card; you'll want it below.
3. Open the extension's **Options** → **Profile** and fill in your details plus a
   CV. Nothing fills without them.
4. Options → **Sites** → paste `test/fixtures/test-site-configs.json` into the
   configuration box and save, so the fixture sites are recognized.
5. Open **`http://localhost:5199/`** — the generated index of every scenario, each
   with the outcome you should see. Work down it.

After an edit the watcher rewrites `dist/` on its own, but Chrome does not pick
it up by itself: press the **↻** on the extension's `chrome://extensions` card,
then reload the page you're testing (the content script is injected at load).

> Tip: to inspect the popup with full DevTools instead of the cramped panel, open
> it as a normal tab at
> `chrome-extension://<your-extension-id>/src/popup/popup.html`.

### B. `npm run dev` — the mocked UI harness

```bash
npm run dev            # then open http://localhost:5173/dev/
```

This renders **all four surfaces** side by side in a normal browser tab — at both
a **390px phone width** and desktop — driven by a **mocked** `chrome.*` API
(`dev/mock-chrome.ts`) whose storage is backed by `localStorage`, whose content
script is faked so the popup's Fill / Reset buttons visibly change state, and
which simulates a queue session so the Start/Stop controls do something. Instant
Vite HMR, no extension install.

`dev/frame.html` opens one surface on its own, and its query parameters are how
you reach a state a screenshot otherwise cannot:

| Parameter | What it picks |
| --- | --- |
| `page` | the surface: `popup`, `options`, `modal`, `setup` |
| `state` | which *flow* that surface is showing (`applied`, `redirect`, `app-link`, `empty`, `export`, `fresh`, …) |
| `step` | one of the setup wizard's six steps (`site`, `prep`, `kind`, `info`, `fields`, `send`) |
| `view` | the modal's `job` or `fields` view |
| `note` | `apply` opens the explanation behind a greyed-out Apply |
| `session=1` | the modal's queue strip and footer overflow menu |
| `pills=1` | both sheets collapsed to their pills |

**`dev/index.html` links every one of them**, grouped by surface — use that list
rather than assembling URLs by hand, and add a link there whenever a flow gains a
distinct rendering.

The harness index also embeds the fixture scenario index, so that panel stays
blank unless `npm run dev:all` is running alongside.

> ⚠️ The harness is a *simulation*. It exercises the UI only — it does **not**
> cover real content-script injection, cross-context messaging, or real sites.
> Use `dev:all` + load-unpacked and the E2E suite for those.

> ⚠️ **`npm run dev` writes a *dev* `dist/`** that loads its code from the Vite
> server — that build only works while `npm run dev` is running, and a
> load-unpacked copy of it (or the E2E suite) will fail with
> `ERR_CONNECTION_REFUSED` once the server stops. For a standalone extension use
> `npm run dev:all` (watch) or `npm run build`, which emit a production `dist/`.
> Always `npm run build` before `npm run test:e2e`.

### Validating the UI

`.mcp.json` registers the [Playwright MCP server](https://github.com/microsoft/playwright-mcp)
with `--caps=vision`, so a browser can be driven and the **rendered** result
inspected from a screenshot. That is the right tool for the responsive surfaces —
a crushed row, an off-centre sheet grip or an unreachable button are all invisible
to a DOM assertion. It loads on Claude Code restart.

## Try it (local fixtures)

With `npm run dev:all` running and the extension loaded:

1. Open `http://localhost:5199/sample-form.html`.
2. The default config (`Local test fixture`) matches `*://*/sample-form.html`, so
   with a profile + CV saved the form fills, the modal appears, and fields are
   highlighted. The deliberately mis-named "Where are you based?" field will be
   **unmatched (red)** — press **Pick**, then click that field, and it's saved.

(The same file opens over `file://` too, but only if you tick **Allow access to
file URLs** on the extension's `chrome://extensions` card.)

### The fixture sites

`test/fixtures/sites/` contains deliberately awful pages that mirror real-world
pain, with ready configs in `test/fixtures/test-site-configs.json` (paste them
into the options **Sites** tab, or let the E2E suite seed them).

**`http://localhost:5199/` lists all 23 scenarios**, grouped into six flows, each
with its own URL and the outcome you should see. It is generated from
`test/fixtures/scenarios.mjs` — the same catalog the E2E suite drives — so the
page and the tests cannot disagree. The server runs on **two ports**, because
`localhost:5199`, `127.0.0.1:5199` and `127.0.0.1:5200` are three different hosts
to the extension: that is what makes the cross-origin handoff real.

Filling in place:

- **slow-boards.html** — the form is injected ~2s after load (tests `waitFor`).
- **modal-lever.html** — the form is behind an "Apply" modal, and the CV input is
  injected only after clicking "Add résumé"; fields have no id/name, only
  accessible names (tests prep steps + accessible-name matching + CV override).
- **cv-confirm.html** — the CV is accepted into a dialog but not attached until a
  confirm button is pressed, which is what `submitCv` steps are for: Apply presses
  Attach, then Send.
- **chaos-form.html** — hashed ids, a multi-step form revealed by "Next" (prep), a
  disguised `city` field that stays **unmatched** so you can Pick it, and a
  placeholder-only phone field that lands yellow for Confirm.
- **quick-board.html** — never hands off, and is adversarial about it:
  `?job=plain` dangles an "Apply on company website" link in the sidebar that the
  heuristic would follow, and the config's quick-apply marker has to beat it;
  `?job=nolink` has nothing external at all (verdict `unknown`, filled anyway);
  `?job=uploads` asks for the cover letter as a second file input, which must not
  be given the CV.

Handing off (the two-step flow below):

- **redirect-board.html** — one board, six postings: `?job=quick` fills in place,
  `?job=external` hands off on its label, `?job=blank` on target=_blank +
  cross-origin alone, `?job=tracked` through a 302 → interstitial chain (the final
  URL is the one recorded), `?job=applink` is an `intent://` link that is followed
  via its `browser_fallback_url`, and `?job=appscheme` is a `linkedin://` link with
  no web address — nothing is opened and the modal says the posting applies in an
  app.
- **external-board.html** — every posting hands off, by *configured* selector:
  `?job=link` (apply link), `?job=js` (a button with no href — the page opens its
  own tab), `?job=marker` (only a badge says it is external), `?job=nav`.
- **listing-board.html** — a search-results page with three different apply links.
  Ambiguous on purpose: it must follow **nothing**.

Destinations and edge cases:

- **ats-form.html / ats-nav.html** — employer forms with no config until a handoff
  creates one. The second submits by full-page navigation, so its confirmation is
  on the *next* page (`thanks.html`): the background attributes it to the posting
  the tab was filling, not to the page showing the message.
- **redirect-hop.html** — the interstitial in the middle of a tracker chain.
- **hidden-success.html** — the confirmation banner ships with the page, hidden.
  Pressing Send must **not** count as applied; only revealing it does.

## Working through a batch (queue sessions)

Import 60 links and opening them all at once helps nobody — it is 60 tabs, 60
forms filling simultaneously, and no way to tell where you got to. A **session**
is a sliding window instead:

1. Options → **Queue** → set *Tabs at once* (default 5; 1–2 on a phone) → **Start
   session**. That many postings open in the background, staggered rather than in
   one burst.
2. Each tab fills itself as usual. You press **Apply**, or **Skip → next** in the
   modal, or just close the tab.
3. Whichever you do, the slot frees and **the next waiting posting opens**. The
   window stays full until the queue drains.

`http://localhost:5199/queue-seed.txt` is 12 postings, one per line, for driving a
real session against the fixtures.

Progress (`done / total`, applied, skipped, waiting) shows in the options Queue
tab, in the popup, and in the modal itself. **Stop session** stops refilling but
deliberately leaves open tabs alone — you are probably mid-application in one.
Closing a tab without applying leaves that posting `opened`, not lost, so it
stays visible in the dashboard.

The session survives a browser restart; open tabs do not, so it simply refills
when you start it again.

## Two-step (redirect) applications

Boards mix postings that apply in place with postings whose Apply button leaves
for the employer's own ATS. Each page is classified before filling:

1. Per-site selectors win — `redirect.quickApplySelector` (form is here),
   `redirect.markerSelector` (external badge), `redirect.applySelector` (the
   control to follow). Pick them visually in the on-page **Setup** panel.
2. Otherwise a narrow heuristic: a control labelled "Apply on company website"
   (or an `Apply` link opening a new tab) whose href leaves this host. If a page
   has several such links, or none, it is treated as quick-apply and filled as
   usual — a wrong guess must never navigate away from a fillable form.

A posting classified as a redirect is followed automatically. Any
`redirect.beforeFollow` steps run first — typically clicking the board's own
**Save job**, so its application tracking records the apply too. The background
then watches the handoff through its tracker/redirect hops and, once it settles:

- the posting is recorded as **redirected** with a link to where it went, and the
  destination is added as its own entry pointing back at the posting (both ends
  appear in the URL dashboard, whether or not the posting was imported);
- the destination gets a site config created automatically if it has none, so the
  ATS form fills straight away (it will still need a `successSelector` before
  anything there can be recorded — see below);
- applying there marks the destination **and** the board posting **applied**.

Only `http(s)` links are ever handed to the browser. An `intent://` apply link is
followed through its `browser_fallback_url`; one that can only open a phone app is
refused, and the modal says so rather than launching an app with no form in it.

Where the application opens — new tab replacing the posting (default), new tab
beside it, or the same tab — is the "Two-step applications" setting in
Options → **Settings**.

## Sending, and knowing it landed

The extension never sends anything on its own. The only thing that presses a
site's Send button is **Apply** in the review modal, and Apply needs two things:

- **the Send button** — `submitSelector`, or a label match. The heuristic **fails
  closed**: it vetoes anything reading "save", "draft", "cancel" or "search" and
  returns *nothing* rather than a best guess, because "Save job" sits an inch from
  the real button on most boards and pressing it loses the application silently.
- **`successSelector`** — a confirmation element that becomes **visible** on
  success. Nothing is sent to a site whose outcome cannot be read back.

Missing either one greys Apply out, and the modal says *which* is missing, because
the two need different things from you. Set both on the wizard's **Sending** step.

`successSelector` becoming visible is the **only** "actually sent" signal. Not
merely present — sites pre-render hidden thank-you nodes, which is what
`hidden-success.html` exists to prove. There is deliberately **no `submit`-event
fallback**: that event fires before the server answers, and a site that validates
in JS sees it and *then* rejects the form, which recorded applications that never
happened. When a site confirms by navigating to another page instead, point a
config at that page (the fixtures do this with `nav-thanks` → `#thanks`); the
background still attributes it to the posting the tab was filling.

Auto-close after applying, and its delay, are in Options → **Settings** →
Behavior.

## Sync (optional)

Two browser profiles, one job database. **Only** the job database — `jobUrls` and
`jobDetails`. Your profile, CV, site configs and settings are device state and
never leave.

Both sides write with nobody arbitrating, so the merge is commutative,
associative and idempotent: status history is set-unioned and the status derived
from it, so a correction is just a later event and neither device can overwrite
the other. Deleting is a tombstone rather than a splice, because a union can only
grow.

Options → **Sync**:

1. Paste a **Google OAuth client** — ID and secret. It has to be yours: a Google
   Cloud project is per-person. The steps are behind the section's `?`.
2. **Copy the redirect URI** shown there into that client. It is derived from this
   browser's extension ID, so it cannot be printed in the help text, and each
   browser you sync needs its own added.
3. **Connect**, and pick the *same Google account* in both browsers. Sign-in goes
   through `launchWebAuthFlow`, not `getAuthToken`, precisely so the account is
   yours to choose rather than whatever the browser profile is signed into.
4. Switch **Sync the job database** on. It is off by default and connecting does
   not turn it on — until it is on, **Sync now** stays disabled and nothing is
   exchanged.

The database lives as one `jobs.json` in Drive's hidden `appDataFolder`
(`drive.appdata` scope only), and every write is a compare-and-swap. Syncing runs
when you press **Sync now** and once at browser startup — never on a timer, which
is why there is no `alarms` permission.

The **Backup file** below it moves the same database by hand, and importing one
combines rather than replaces, exactly as syncing does.

## The archive

Every posting the extension reads is captured — title, description, requirements
and chips — applied or skipped, so a job stays readable after its tab is gone.
Options → **Queue** → **Archive** exports them as one file.

What goes in it is ticked, not fixed, under *What to export*: which columns, which
statuses (applied only, by default), and JSON or CSV. The choices are stored as
sparse overrides, so a column added by a later build appears for everyone rather
than being silently omitted. A two-step application is collapsed to a single row
at its destination, with the board's description merged in.

## Load on mobile

Stock **Chrome for Android does not support extensions.** Use a Chromium-based
mobile browser that does — primarily **Kiwi Browser**: run `npm run package` to
get `chromium-filler-v<version>.zip`, then menu → Extensions → enable Developer
mode → load the zip.

Mobile is the priority target, so every surface is touch-first: a 44px minimum
for every control, the modal and setup panel become full-width bottom sheets,
status is shown by glyph as well as colour, tap-to-pick proposes a target and
waits for **Confirm** (tapping again steps into the element inside the one you
have, because what is under a finger is rarely what you meant), and the picker
toolbar sits at the bottom where your thumb is. Because reaching the toolbar popup costs two or three taps through
the browser menu, the on-page modal carries the session controls too.

## Site config shape

```jsonc
{
  "id": "greenhouse",
  "name": "Greenhouse",
  "urlPatterns": ["*://boards.greenhouse.io/*", "/greenhouse\\.io/"],
  "waitFor": "#application_form",       // await slow form
  "waitTimeoutMs": 15000,
  "prep": [                              // auto-run before filling
    { "action": "click", "selector": "#expand", "optional": true }
  ],
  "extract": {                           // the Job view; chips only if stated
    "jobTitle": "h1",
    "jobDescription": "#content",
    "jobRequirements": "#requirements",
    "company": ".company",               // else read from the posting's JSON-LD
    "location": ".location",
    "employmentType": ".job-type"
  },
  "fieldOverrides": { "phone": "#candidate_tel" }, // beat the heuristics
  "cvUpload": "input[type=file]",        // override CV file input
  "submitCv": [ { "action": "click", "selector": "#attach-cv" } ], // run first by Apply
  "submitSelector": "#send",             // the button Apply presses
  "successSelector": "#thanks",          // REQUIRED for Apply: becoming VISIBLE is
                                         // the only proof the application landed
  "autoDetect": true,                    // false = overrides only
  "redirect": {                          // two-step postings (see above)
    "applySelector": ".apply-external",  // control that leaves for the employer
    "quickApplySelector": "#inline-form", // presence = form is on this page
    "markerSelector": ".external-badge",
    "beforeFollow": [ { "action": "click", "selector": "#save-job" } ],
    "autoDetect": true                   // false = no label/cross-origin heuristic
  }
}
```

## Architecture

`src/shared` — types, storage, matcher, selector, URL import, queue, field
heuristics, CV codec, the flow-state classifier, the sync merge and the job
archive (all pure logic is unit-tested). `src/shared/help.ts` and `labels.ts` are
the only place the extension's explanations and its button verbs are written, so
no two surfaces can word the same thing differently.

`src/content` — orchestrator + waitFor, prep, extract, fieldDetect, fill, picker,
and the two shadow surfaces (review modal, setup wizard), which share one shell
and one on-screen slot in `sheet.ts`.

`src/background` — service worker (submit reporting, the two-step redirect
watcher), `session.ts` (queue sessions), and `googleAuth.ts` / `drive.ts` /
`sync.ts` (Drive sync).

`src/ui` — the design tokens and component primitives every surface shares (one
copy, used by both the light-DOM pages and the shadow roots), with
`designSystem.test.ts` failing the build on a hardcoded colour, an undeclared
token or a status missing its colour, icon or word. `src/popup`, `src/options` —
the toolbar popup and the six options tabs (Queue · Profile · Settings · Sites ·
Sync · Help).
