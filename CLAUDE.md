# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm test                 # Vitest watch (unit + integration)
npm run test:run         # Vitest once (CI-style)
npx vitest run src/shared/matcher.test.ts   # single test file
npx vitest run -t "dedupe"                   # single test by name
npm run typecheck        # tsc --noEmit
npm run build            # tsc --noEmit && vite build -> dist/
npm run dev              # Vite dev server + HMR
npm run test:e2e         # Playwright; requires `npm run build` first
```

### UI validation

`.mcp.json` registers the Playwright MCP server with `--caps=vision`, for driving
a real browser and inspecting rendered UI from a screenshot rather than from the
DOM. It is the tool of choice for checking the responsive surfaces — the modal,
the setup panel, and the options queue at phone width — because most of what can
go wrong there (a crushed row, an off-centre grip, an unreachable control) is
invisible to a DOM assertion. New MCP servers load on Claude Code restart.

For UI work also start `npm run dev` and open `http://localhost:5173/dev/`, which
renders **all four surfaces** against a mocked `chrome.*` — including a **390px
phone frame**, so the mobile-first layout is what you iterate on rather than an
afterthought. `dev/frame.html?page=…` takes `popup`, `options`, `modal`, and
`setup`; the last two render the real shadow-DOM classes over a fake posting,
because otherwise they are only reachable by loading the built extension and
driving a real site. `?page=modal&session=1` shows the queue strip and the
footer overflow menu.

`&state=…` picks which **flow** the surface is showing — modal: `long`, `redirect`,
`redirect-followed`, `landed`, `empty`, `failed-fill`, `apply-unset`,
`apply-unverified`, `applied`; setup: `external`, `help`, `cv-steps`,
`submit-unset`, `success-unset`. A two-step posting
renders a different modal body entirely (notice + "Fill this page instead", no
report), so it needs its own state rather than being inferred from the default
data. Add a state here whenever a flow gains a distinct rendering. `state=long` is
a full-length posting — the reading typography is the Job view's whole job, and a
three-line description proves nothing about it. `setup&state=help` is the
first-run panel with the legend open, which is otherwise reachable exactly once
per profile: dismissing it persists.

`&view=job|fields` picks which of the modal's two views is open, and `&note=apply`
opens the explanation behind the greyed-out Apply button (pair it with
`state=apply-unset`). The Job view is the default everywhere and the note starts
shut, so both are otherwise only reachable by clicking, which a screenshot cannot
do.

E2E loads the built extension into real Chromium (`npx playwright install chromium`
once). Always `npm run build` before `npm run test:e2e` — the suite loads `dist/`.

## Architecture

MV3 Chrome extension that auto-fills job-application forms. It **never submits on
its own** — filling is automatic but **never silent**, and nothing leaves the page
until the user presses something. A Shadow-DOM review modal reports every field as
filled (green) / low-confidence (yellow) / unmatched (red), and its footer carries
the two decisions: **Apply** (run any CV-confirmation steps, then press the site's
own Send button) and **Skip** (record the posting as skipped, and close the tab if
`settings.closeTabOnSkip`). Re-run and Reset live in the overflow behind them —
the footer must never grow past two visible buttons plus `⋯`, because a third
clipped the primary action off the right edge at 390px.

The Send button is found by `shared/submitDetect.ts` — a saved
`config.submitSelector` first, then a label heuristic that **vetoes** anything
reading "save", "draft", "cancel" or "search" and returns *nothing* rather than a
best guess. "Save job" sits an inch from the real button on most boards, and
pressing it loses the application silently; a greyed Apply that explains itself is
always the better failure. `settings.closeTabOnSkip` shares `closeTabDelayMs` with
the submit path deliberately.

**Apply also requires `successSelector`.** Nothing is sent to a site whose outcome
cannot be read back, so `applyState` is `noButton` | `noConfirmation` | `ready`
and the modal shows a *different* note for each — the two failures need different
actions from the user. Once the confirmation appears the modal says so (banner,
green `Applied ✓`, and the pill), because the site's own message is routinely
below the fold or behind the card.

The modal has **two views behind a header toggle**, and Job is the default: once
the form is filled the user's question is "do I want this job?", not "which of
sixteen fields matched". The report lives behind the Fields tab, which carries the
report's *worst* status as a dot — hiding the report must never hide a problem,
and that dot is what the E2E `.cf-dot.none` assertions now see.

Three runtime contexts, all sharing `src/shared` (which holds every piece of
pure, unit-tested logic):

- **`src/content`** — the per-page orchestrator (`main.ts` `Controller`). On a
  matching page: wait for slow form (`waitForForm.ts`) → run prep steps
  (`prep.ts`) → classify the posting (`redirectDetect.ts`) → **either** hand off
  to the external application **or** extract job title/description
  (`extract.ts`, which walks containers into blocks via `shared/jobText.ts`) →
  detect fields (`fieldDetect.ts`) → fill high-confidence only, incl. CV via
  DataTransfer (`fill.ts`) → show modal (`modal/`).
  `picker.ts` = click/tap-to-pick override.
- **`src/background/service_worker.ts`** — opens options, handles the `SUBMITTED`
  message (mark URL applied + optional tab close), and owns the two-step redirect
  watcher (below). `session.ts` owns the queue session (below).
- **`src/popup`, `src/options`** — popup triggers run/reset and shows session
  progress; options is four tabs (Queue · Profile · Settings · Sites) managing
  the job queue, profile, CV, behavior settings, and site configs.

Cross-context messaging goes through the typed `MSG` contract in
`src/shared/messages.ts` (payloads must be structured-clone friendly).

### UI layer
`src/ui/tokens.css` + `src/ui/primitives.css` are the **only** place colours,
spacing, touch targets, buttons, rows, dots, sheets, and chips are defined. Both
files use a `:root, :host` selector list so one copy serves the light-DOM pages
(which `<link>` them) and the two shadow roots (which inline them via
`src/ui/shadowCss.ts`). Before this existed each surface had a private copy and
they contradicted each other — popup dark mode was literally the inverse of
options dark mode. Add a rule here, not in a surface's own file, if two surfaces
could ever want it.

Mobile is the priority target (Kiwi). `--tap: 44px` under `@media (pointer:
coarse)` is the floor for every control; status is never colour alone (dots carry
a glyph); and the modal/setup sheets become full-width bottom sheets under 640px.

### In-app help
`src/shared/help.ts` is the **only** place the extension explains itself. Every
surface that answers "what is this?" renders from it: the setup panel's
per-section `?` and legend, the options Settings `?` toggles, the Sites-tab key
reference, the Help tab, and the review modal's dot key. Copy written into a
surface instead of the catalog is a bug — the setup panel and the page
documenting it have to say the same thing.

The `Record<keyof …>` types are load-bearing. `CONFIG_HELP`, `REDIRECT_HELP`,
`SETTINGS_HELP` and `PREP_HELP` are keyed off `SiteConfig`, `RedirectConfig`,
`Settings` and `PrepAction`, so **adding a config key fails `npm run typecheck`
until it has an explanation**. That is what stops this going stale the way the
`types.ts` doc comments did: they were correct, and no user could read them.

`HelpEntry.short` is the one-line form, for places that are a *key* rather than
an explanation. The setup panel's legend uses it and the full `body` stays behind
that section's `?`; rendering the bodies there filled a whole 390px screen with
prose before the user could reach a single row. `DOT_LEGEND` shows the real
`.cf-dot` beside each meaning — a colour key made of words is not a key.

`describeConfig()` turns a stored `SiteConfig` into a sentence, so the Sites tab
does not require reading JSON to find out what a site will do. Pure, unit-tested.

`src/ui/help.ts` (`helpButton`/`helpPanel`/`richText`) builds the disclosure for
both shadow roots and the light-DOM pages; `.cf-help*` lives in primitives.css.
Disclosure, never `title=` tooltips — a hover tooltip does not exist on a phone.
`settings.helpSeen` records that the legend was dismissed, and also retires the
options getting-started checklist.

### Data model & storage
`src/shared/types.ts` is the source of truth: `Profile`, `SiteConfig`,
`JobUrlEntry`, `Settings`, `StoredState`. Everything persists in
`chrome.storage.local` via typed wrappers in `storage.ts`. `FieldKey` enumerates
every fillable field (`resume` = the CV file).

`SiteConfig` drives per-site behavior: `urlPatterns` (match-pattern or `/regex/`),
`waitFor`, `prep`, `extract`, `fieldOverrides` (beat the heuristics), `cvUpload`,
`submitCv`, `autoDetect`, `successSelector`.

`settings.modalLayout` (`shared/modalLayout.ts`) is where the review modal sits and
how big it is. **The drag-and-resize simulator in Options → Settings is the only
thing that writes it.** Dragging the modal on a job page is a page-lifetime
override held in `Controller.draggedLayout` and never persisted: moving the card
aside to read the field under it is a one-off gesture, and while it wrote storage
it silently redefined where the modal opened on every posting afterwards. The
override is what `showModal` renders from, or the card would snap back on the next
re-render. It is **desktop only** — at or below
`NARROW_WIDTH` (640px, shared with primitives.css) the modal is a full-width
bottom sheet and `modal.ts` *clears* the inline styles, because an inline width
would beat the media query. Every read goes through `clampLayout`, so a layout
chosen on a big monitor cannot strand the card off the edge of a laptop.

The simulator's frame is the user's **screen**, not the options window:
`modelledViewport` takes `screen.avail*` and subtracts the browser chrome
*measured* from the options tab itself (`outerHeight - innerHeight` — tab strip,
address bar, and the bookmarks bar if one is open), so the frame has the aspect
ratio and the pixel count the modal will really get. Two paths cannot measure and
say so instead of guessing silently: an iframe (the dev harness) or an implausible
delta falls back to `NOMINAL_CHROME`, and a phone-sized result falls back to
`REFERENCE_VIEWPORT`, because clamping a desktop-only layout to a 390px screen
would destroy it.

That reading is taken **once per page load** (`sampleScreen`). Every "re-read once
the window settles" rule fails on the same fact — one resize produces several
repaints, so "settled" arrives before the window has stopped — and the result is a
frame that changes shape under the user's hand. Resizing the options window must
move nothing: the E2E `Options: resizing the window…` asserts the frame ratio, the
card's fraction of it, *and* the stored layout across four window sizes.

"Preview at full size" renders the real `FillerModal` over the options page, and
the two views are bound **both ways**: the frame drives the preview through
`FillerModal.place` (which re-places the card *without* rebuilding it — `render`
replaces the whole `.cf-card`, which mid-drag would throw away the element holding
the pointer capture), and the preview drives the frame through `onLayoutPreview`
(per pointermove, live) and `onLayoutChange` (on release, persists). Those two
callbacks are deliberately separate: `main.ts` writes storage in `onLayoutChange`,
so firing it per pointermove would be a storage write per frame. The preview's own
close button runs the options page's teardown, because a no-op `onClose` left the
× dead and the button lying.

Two rules that panel breaks easily. `paint()` clamps **for display only** and must
never assign back to the stored layout — `modal.ts` follows the same rule, and this
panel did not, so one short options window permanently shrank a card configured on
a big screen; only a real gesture (`commit`) may clamp. And the limit chips are
rendered once and toggled with `visibility`, never added and removed: they are
rewritten on every `pointermove`, so anything that reflows shifts the buttons under
them mid-drag. `layoutLimits`/`describeLimits`/`activeLimits` say which edges have
run out of room and why — screen edge (accent) vs minimum size (warn), in colour
*and* words — and `snapLayout` pulls a drag onto the edge or the 16px gutter,
without which "flush" is reachable only by luck.

### Two-step (redirect) postings
A board mixes quick-apply postings with postings that hand off to an employer
ATS, so the branch is **per page, not per site**. `redirectDetect.ts` classifies
(config `redirect.*` selectors first, then a narrow label/cross-origin heuristic
in `src/shared/redirect.ts`); only a confident `redirect` verdict diverts —
`unknown` falls through to the normal fill path, because a false positive
navigates away from a page that could have been filled. A listing page with
several external apply links is deliberately `unknown`.

Following is automatic: `redirect.beforeFollow` steps run first (the board's own
"Save job", forced optional), then `FOLLOW_REDIRECT` hands over to the background,
which watches the tab (and any tab it opens, via `openerTabId`) until the URL
settles past tracker/302 hops, then `linkRedirect`s both ends into the job DB and
pushes `REDIRECT_LANDED` to the destination. Watches live in
`chrome.storage.session` — the worker can die mid-navigation. A destination with
no site config gets one via `ensureConfigForUrl`, so its form fills immediately;
submitting there propagates `applied` up the `sourceUrl` chain
(`applyStatusChain`).

### Queue sessions
`src/shared/queue.ts` (pure) — `nextBatch` picks the waiting URLs that fit the
free slots, `queueProgress` summarizes for the headers. The queue is **derived**
from the job-URL database (status `new`), never copied, so imports and manual
status edits feed it automatically.

`src/background/session.ts` drives it: at most `settings.sessionBatchSize` job
tabs exist at once, and *finishing one opens the next* — `chrome.tabs.onRemoved`,
`SUBMITTED`, and `SESSION_SKIP` all free a slot and top up. Opens are staggered
(`STAGGER_MS`) and serialized through a promise chain, because two events landing
together would otherwise both claim the same slot and open a posting twice.
State splits by lifetime like the redirect watches: `{ active, batchSize }` in
`chrome.storage.local` (survives a restart), tab↔URL map in
`chrome.storage.session` (tab ids don't). Never restore the old behaviour of
opening every URL in one loop — 60 links meant 60 tabs.

### Job-URL database
`src/shared/jobUrls.ts` (pure) — `addUrls` dedupes by URL (the unique key),
`applyStatus` records status transitions with timestamped history
(new → opened → redirected → applied / skipped), `linkRedirect` records a
two-step posting (both ends, cross-linked, never demoting an existing status),
`applyStatusChain` propagates up `sourceUrl`, `jobUrlStats` aggregates for the
dashboard.
`urlImport.ts` extracts/normalizes/dedupes URLs from a pasted text blob.

## Non-obvious constraints (do not regress)

- **Content scripts share the PAGE's origin**, not the extension's — so the CV
  is stored in `chrome.storage.local` (base64, needs `unlimitedStorage`), NOT
  extension IndexedDB. See `cvStore.ts`.
- **`successSelector` becoming VISIBLE is the ONLY "actually sent" signal.**
  Not merely present — sites pre-render hidden success nodes; the
  `MutationObserver` in `main.ts` watches `style`/`class`/`hidden` flips. There is
  deliberately **no `submit`-event fallback**: the event fires before the server
  answers, and a site that validates in JS sees it in the capture phase *and then*
  rejects the form, which recorded applications that never happened. Never
  reinstate it — the cost of the strictness is paid in `applyState`, not here.
- **The confirmation is often on a different URL** (Greenhouse lands on
  `…/jobs/<id>/confirmation`). The content script there is a fresh one that knows
  nothing about the posting, so the background keys `applyingTabs` by tab id in
  `chrome.storage.session` (`MSG.APPLYING`) and attributes `SUBMITTED` to the
  posting the tab was *filling*, not to the page reporting it. Without that the
  posting stays `opened` forever and the confirmation page is recorded instead.
  A consequence worth knowing: an auto-created destination config has no
  `successSelector`, so a handoff destination needs that one setup step before
  anything there can be recorded.
- **Never submit unprompted.** Filling never sends. The *only* thing that presses
  a site's Send button is `Controller.apply()`, reached solely by pressing Apply
  in the review modal — no timer, no auto-run path, and no "it looked complete"
  heuristic may ever call it. Note this is a rule about who decides, not about
  capability: Apply presses Send with no guard once pressed, even with required
  fields empty.
- **The submit heuristic must fail closed.** `findSubmitControl` returns `none`
  rather than a best guess, and its veto list beats any positive match. Never
  "improve" it by falling back to the highest-scoring button.
- **Never read a job container with `textContent`.** It welds every heading,
  paragraph and bullet into one string and preserves the HTML source's own
  indentation, which is what made the description unreadable. `shared/jobText.ts`
  walks it into blocks instead — and drops `form`/`nav`/`aside`/`footer`, because
  the broad `jobDescription` fallbacks (`main`, `article`, `[class*="content"]`)
  otherwise quote the application form and the decoy sidebar back at the user.
- **Closing the review modal must never destroy it.** `onClose` minimizes to the
  pill (`FillerModal.minimize`); destroying it left "Reset & Re-run" as the only
  way back, which wipes every field just filled.
- **On touch the picker only commits via Confirm.** A finger has no hover state,
  so a plain `click` handler commits whatever it happened to land on; `picker.ts`
  branches on `pointerType`. Mouse still commits on click.
- Field matching normalizes attributes with diacritics stripped, so "Résumé"
  matches "resume" (`normalizeAttr` in `src/shared/fieldKeys.ts`).
- **Playwright must use `channel: 'chromium'`** — the headless shell can't load
  extensions. `worker.url()` is a method, not a property.

## Testing conventions

TDD: for pure/testable logic (parsers, matchers, selector generators,
heuristics, storage codecs) write the failing Vitest test first, then implement.
Vitest runs under jsdom with a small `chrome.*` mock in `test/setup.ts`.
`*.test.ts` files sit next to the code they cover in `src/shared` and
`src/content`. The hard fixture sites (`test/fixtures/sites/`, configs in
`test-site-configs.json`) mirror real-world pain and are the E2E confidence
signal — keep them green.

**`test/fixtures/scenarios.mjs` is the scenario catalog** and the single source
of URLs: the fixture server prints it, generates its index page at
`http://localhost:5199/` from it, and `e2e/extension.spec.ts` calls `urlFor(id)`
rather than building URLs by hand. A posting, not a page, is the unit — one board
HTML serves several `?job=…` postings because that is the shape the classifier
exists for. Adding a flow means adding a scenario here, a posting in the fixture,
and an E2E spec; a scenario nobody can find the URL of is a scenario nobody runs.

The server listens on **two ports** so there are three origins — `localhost:5199`
(board), `127.0.0.1:5199` (employer ATS), `127.0.0.1:5200` (tracker / third-party
ATS). `isExternalUrl` compares `URL.host`, which includes the port, so these are
genuinely different sites to the extension: that is what makes the cross-origin
handoff, and the tracker chain (`/r/302` → `redirect-hop.html` → ATS), real in
E2E. `/queue-seed.txt` serves the same URL list the session E2E uses.

Two fixture rules that are easy to break: site-config `urlPatterns` are
whole-URL globs, so **every pattern needs a trailing `*`** to survive a `?job=…`
query string; and a destination fixture that must have *no* config of its own
(so `ensureConfigForUrl` creates one) has to live on an origin no other config
covers — the auto-created `*://127.0.0.1:5199/*` would otherwise adopt it.
