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
`apply-unverified`, `applied`, `flush`, `fullscreen`; setup: `external`, `help`,
`cv-steps`, `submit-unset`, `success-unset`; options: `fresh`, which seeds an
empty store so the getting-started checklist is reachable at all (the normal seed
ticks four of its five steps off). A two-step posting
renders a different modal body entirely (notice + "Fill this page instead", no
report), so it needs its own state rather than being inferred from the default
data. Add a state here whenever a flow gains a distinct rendering — **and link it
from `dev/index.html`**, or it is a state nobody looks at: `applied`,
`apply-unset` and `apply-unverified` existed in the harness for months with no
link to them, which is most of why the confirmed state went unexamined.
`state=long` is a full-length posting — the reading typography is the Job view's
whole job, and a three-line description proves nothing about it.
`setup&state=help` is the first-run panel with the legend open, which is
otherwise reachable exactly once per profile: dismissing it persists.

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
and the modal says a *different* thing for each — the two failures need different
actions from the user.

### The flow banner
`src/shared/flowState.ts` (pure) is the one place that decides **where a posting
is in the flow**, and `labels.FLOW_TEXT` is where each state is worded.
`flowBanner()` returns `{ key, tone, title, detail, help? }` for one of seven
states: `applied` · `external` / `externalOpened` · `noButton` /
`noConfirmation` · `empty` · `ready`.

It exists because the modal used to say none of this. Three unrelated renderings
— an applied banner, a redirect notice, and an explanation of the greyed-out
Apply that only appeared *after* the user pressed it — between them still left
the commonest case silent: a posting filled and waiting showed a job advert and a
coral button with nothing connecting them.

Three rules the branch order encodes, each with a test:
- **`applied` outranks everything**, including a two-step posting and a blocked
  Apply — neither can still be the answer once something went through.
- **Blocked outranks `empty`.** A listing page has no fields *and* no Send
  button, and its greyed Apply still provokes "why can't I apply?"; answering
  "nothing to fill here" leaves a dead control unexplained. So `empty` is the
  narrower case: a page Apply *could* run on, whose fields went unrecognised.
- **The tone decides where it renders.** `ok`/`warn`/`accent` lead the body in
  both views; the `quiet` resting state rides in the **footer**, above Apply —
  the Job view leads with the posting on purpose, and a fill-status line above
  the title inverted that. Only the long form stays behind the `?`.

Once the confirmation appears the whole card becomes the receipt: the `ok` banner
leads at `--text-lg`, `.cf-title` drops to `.cf-title-sub`, the header carries a
`Sent` chip (the body scrolls; the header does not), and the footer's green
`Applied ✓` retires Apply. The site's own message is routinely below the fold or
behind the card, so this is the only place the outcome is legible.

A **blocked primary de-fills rather than fading**
(`button.cf-btn.primary[aria-disabled]` → `--surface`): the coral gradient at 45%
opacity is a muddy brown block that reads as broken, not unavailable, and the
state it marks is entirely ordinary. Same shape of override as `.cf-applied-btn`
— `--btn-primary` stays the one primary fill and these two states opt out of it.

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
  (`extract.ts`, which walks containers into blocks via `shared/jobText.ts`, and
  reads the company/location/type chips from the posting's JSON-LD via
  `shared/jobMeta.ts` — **only** from JSON-LD or a configured selector, never
  inferred: a chip the posting did not state is not rendered, and there is
  deliberately no `og:site_name` fallback for the company, because that names the
  *board* and put "LinkedIn" where the employer should be) →
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
The look is **Soft / Warm** (warm paper neutrals, one clay accent, icon status
dots, gentle shadows) — see `design/` for the source of truth. It is a design
*system*, enforced in three files plus a guardrail test, not just a stylesheet:

`src/ui/tokens.css` + `src/ui/primitives.css` are the **only** place colours,
spacing, touch targets, buttons, rows, dots, sheets, chips, and the stat tile are
defined. Both files use a `:root, :host` selector list so one copy serves the
light-DOM pages (which `<link>` them) and the two shadow roots (which inline them
via `src/ui/shadowCss.ts`). Before this existed each surface had a private copy
and they contradicted each other — popup dark mode was literally the inverse of
options dark mode. Add a rule here, not in a surface's own file, if two surfaces
could ever want it.

Colour lives **only** in tokens.css. The primary button has one fill
(`--btn-primary`, a coral gradient in light / solid accent in dark), read by
`.btn-primary` and nowhere else. Status dots are `--on-status` masked to a
per-status SVG (`--icon-check/alert/x/dash`), so the coloured circle keeps a
distinct *shape* — status is never colour alone, and `.cf-dot.ok/.warn/.none`
stay the class names (E2E asserts `.cf-dot.none`). Both the dots and the stat
tiles are keyed on `.high/.low/.none` *and* `.ok/.warn/.none`, because the modal
renders from the `MatchConfidence` value and the options queue from the tone —
spell any new status in both lists or one surface silently loses its colour.

Surfaces layer the warm tones by **alternating**, which is what the reference
does: the page behind everything is `--canvas`, and from there each level flips
side — a recessed body (`--surface`), the paper objects standing on it (`--bg`,
plus a hairline `--border`), and an inset *within* one of those objects back to
`--surface` (`--surface-2` is a half step, for hovers on paper). Both surface
tones sit on the same side of `--bg` in either scheme.

The shadow sheets and the options page start that alternation at different
levels, and neither is wrong: the **modal and setup panel** are a paper card
floating on someone else's page, so their rows and tiles are `--surface` insets;
the **options tab panel** is the recessed body (its active folder tab takes the
same tone, because tab and body are one sheet) and its sections, rows, stat tiles
and bare controls are paper objects on it. If a new element looks flat, it is
sitting on its own tone — count the levels rather than picking a colour.

A **secondary button is not an inset** — it is paper with a border that fills in
on hover, the reference's outlined button. Nor is a **per-row action ever the
primary fill**: the coral belongs to the one thing a surface is for (the modal's
Apply, the setup panel's Done), and both references draw row actions as plain
buttons. `modal.test.ts` asserts exactly one `.primary` in the card, because
Confirm shipped as a primary once and turned a sixteen-row report into sixteen
CTAs. Buttons inside a popover are `.btn-ghost` (the overflow menu): the popover
already has a border, and one per item makes it a stack of boxes.

The popup is itself a panel (`--bg`), not a page, so its progress card has
something to recess into. Labels *inside* a surface are sentence case: uppercase
plus letter-spacing is reserved for page furniture, and the reference has none of
it in a control. Secondary actions are labelled in **one or two words** ("Site
setup", "Queue", "Options"), not sentences — as prose they wrapped inside a 360px
popup and left the row ragged.

One vocabulary, enforced by where the words live. Our action is **Apply** on
every surface; the *site's* control Apply presses is **the Send button**. Those
are two different objects and the distinction is load-bearing — the E2E matches
on both phrases. Before this, one flow had four names (`Apply` in the modal,
"Send" in its help, "after I submit" in Options, `n filled` for applied postings
in the popup's session chips).

`src/shared/labels.ts` is the wording counterpart to help.ts: `FLOW_TEXT`
(the seven flow states above, keyed `Record<FlowKey, …>`), `STATUS_TEXT`
(tile / word / aria for each `MatchConfidence`) and `ACTION_LABELS` (Apply, Skip,
Confirm, Pick, …), typed `Record<>` so a new status or action fails
`npm run typecheck` until it is named. Every surface renders its status words and
button verbs from here — the modal legend, summary, stat tiles, the setup rows
and the popup badge no longer disagree. `fieldStatus.STATUS_LABELS` re-exports
the aria forms from it.

`src/ui/palette.ts` is the **one** legitimate copy of the token colours, for the
two marks drawn on the *host* page (the field highlight in `fill.ts`, the
click-to-pick toolbar in `picker.ts`) — content-script light-DOM never sees
tokens.css, so it cannot read a `var(--…)`.

`src/ui/designSystem.test.ts` is the guardrail that makes "zero inconsistencies,
now and in the future" mechanical: it fails the build if any CSS/TS outside the
token layer hardcodes a colour, if a `var(--…)` names a token nothing declares,
if a second primary fill appears, if a status is missing its colour/icon/word, or
if `palette.ts` drifts from the tokens it mirrors. It reads the sources off disk
because Vite hands vitest an *empty* string for a `.css?inline` import.

Mobile is the priority target (Kiwi). `--tap: 44px` is the height of every
button on *every* pointer (the reskin matched `design/reference-updated/` and
dropped the old denser 32px desktop button — buttons are one comfortable size
everywhere now), and `@media (pointer: coarse)` extends that floor to the other
native controls; status is never colour alone (dots carry an icon shape); and the
modal/setup sheets become full-width bottom sheets under 640px.

`design/reference-updated/design.html` is the current visual source of truth for
**values** (it supersedes `design/design-system.md`): rounder than the first cut
(`--radius-btn/-card/-xl` = 13/14/20), buttons and chips at weight 500, a
two-layer `--shadow-2`, a third text level `--muted-2`, and a dark palette whose
insets are *darker* than the paper (not lighter). The Job/Fields toggle is a
rounded-rectangle segmented control; the options Settings tab uses folder tabs,
`.switch` toggles and a **two-column** grid of setting rows; the popup leads with a
progress card + status chips; the Job view leads with company / location / type
chips and the session strip carries progress dots.

`design/reference/states-gallery.html` is the source of truth for the **flows** the
mockup never drew — the modal's redirect/applied/blocked states, the pill, the
overflow menu, the help disclosure, and the whole setup panel. Where the two
disagree, design.html wins on values (colour, radius, density, casing) and the
gallery wins on structure (which controls a state has, and how loud each one is).
Reading only one of them is how the third pass ended up with a coral Pick on every
setup row.

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
prose before the user could reach a single row. The options settings rows render
their caption from it too (`attachRowHelp`), so the line under a switch and the
panel behind its `?` cannot drift — those captions were written into
`options.html` and had already started to disagree. `DOT_LEGEND` shows the real
`.cf-dot` beside each meaning — a colour key made of words is not a key.

`describeConfig()` turns a stored `SiteConfig` into a sentence, so the Sites tab
does not require reading JSON to find out what a site will do. Pure, unit-tested.

`src/ui/help.ts` (`helpButton`/`helpPanel`/`richText`) builds the disclosure for
both shadow roots and the light-DOM pages; `.cf-help*` lives in primitives.css.
Disclosure, never `title=` tooltips — a hover tooltip does not exist on a phone.
`settings.helpSeen` records that the legend was dismissed, and also retires the
options getting-started checklist.

The `?` is a **masked icon** (`--icon-help`), not a `?` typeset inside a bordered
pill. The pill was filled with `--surface`, which is *darker* than the card in
dark mode and a shade lighter in light — a low-contrast hole rather than a
control on every surface — and on a coarse pointer the painted disc itself
inflated to 44px. Drawing the circle as part of the icon separates the glyph
(a constant 18px) from the target (transparent, and free to be a full `--tap`),
which is the whole fix. `helpButton` therefore sets **no text content**: its only
name is the `aria-label`.

Placement matters as much as the mark. It never goes *inside* a heading —
`attachRowHelp` anchors it on the `.setrow` after the title and **before** the
caption, so six rows do not put six buttons at six different x-positions and no
control runs through the middle of a text block. The setup panel's section header
is a fixed order (title `flex: 1` · count chip · `?` · chevron), replacing a pair
of `:has()` rules that shuffled an auto margin between the chip and the button.
The chevron is drawn from `--icon-chevron` for the same reason the `?` is: as the
text glyph `▾` at the summary's 13px it was a speck beside it.

### Data model & storage
`src/shared/types.ts` is the source of truth: `Profile`, `SiteConfig`,
`JobUrlEntry`, `Settings`, `StoredState`. Everything persists in
`chrome.storage.local` via typed wrappers in `storage.ts`. `FieldKey` enumerates
every fillable field (`resume` = the CV file).

`SiteConfig` drives per-site behavior: `urlPatterns` (match-pattern or `/regex/`),
`waitFor`, `prep`, `extract`, `fieldOverrides` (beat the heuristics), `cvUpload`,
`submitCv`, `autoDetect`, `successSelector`.

`settings.modalLayout` (`shared/modalLayout.ts`) is where an on-page sheet sits and
how big it is — **both** of them, the review modal and the setup panel, because
there is exactly one slot (see "One slot, two sheets" below). **The drag-and-resize
simulator in Options → Settings is the only thing that writes it.** Dragging or
resizing a sheet on a job page is a page-lifetime override held in
`Controller.draggedLayout` and never persisted: moving the card aside to read the
field under it is a one-off gesture, and while it wrote storage it silently
redefined where the modal opened on every posting afterwards. The override is what
`showModal` and `refreshSetup` render from, or the card would snap back on the next
re-render. It is **desktop only** — at or below
`NARROW_WIDTH` (640px, shared with primitives.css) a sheet is a full-width
bottom sheet and `sheet.ts` *clears* the inline styles, because an inline width
would beat the media query. Every read goes through `clampLayout`, so a layout
chosen on a big monitor cannot strand the card off the edge of a laptop. The key's
name is historical — it predates the setup panel joining it, and renaming a stored
key would need a migration to buy nothing.

`settings.modalFullscreen` **overrides that layout without writing it** — the
configured card is what "exit fullscreen" gives back, so implementing this by
saving a full-viewport rectangle would destroy the thing it is overriding.
`applyLayout` swaps in `fullscreenLayout(innerWidth, innerHeight)`, which is flush
on all four edges and therefore already squares the corners and drops the borders
through the existing `data-limit-*` rules — desktop fullscreen needs no CSS of its
own. Narrow does: inline styles are cleared there, so `.cf-card.cf-full` lifts the
85vh cap in primitives.css instead. The header's `.cf-fullscreen` toggle is the
**only setting a content script writes** (via `patchSettings`, which re-reads first
— the controller's `settings` snapshot is as old as the page). It is deliberately
not a `draggedLayout`-style page-lifetime override: a drag is a nudge, this is a
preference, and it holds until it is pressed again. Dragging is disabled while it
is on, or the card would move out from under the flag.

### One slot, two sheets
`src/content/sheet.ts` (`abstract class Sheet<D extends SheetData>`) is the shell
behind **both** shadow surfaces: `FillerModal` and `SetupPanel` subclass it and
supply only `buildCard`/`buildPill`/`repaint`. Mount, `applyLayout`, drag, the
three resize grips, fullscreen, collapse-to-pill and `destroy` all live there once.

Before it they were two unrelated products sharing a stylesheet: the panel
hardcoded `top: 16px; width: 400px`, its drag floored at 0 without capping (so it
could be pushed off the right edge and left there), nothing re-clamped it on
resize, and — because `setupPanel.css` is inlined *after* `primitives.css` at equal
specificity — its own `.cf-card` block **beat the 640px bottom-sheet rules**, so on
a phone it was a 400px column hanging off the top, overlapping the modal's sheet
with only DOM order arbitrating. That last one is invisible to jsdom, which
evaluates neither the cascade nor media queries; `designSystem.test.ts` now fails
the build if any surface stylesheet sets a box property on `.cf-card`, and an E2E
spec measures the panel at 390px.

Two rules the controller enforces, both in `Controller.arbitrateSheets`:

- **At most one card is expanded.** Opening one folds the other to its pill —
  never destroys it, because a destroyed review modal takes the fill report with
  it. Sheets report folds through `SheetCallbacks.onFold`, which is how Escape and
  a pill tap reach the controller.
- **While a card is expanded, no pill shows.** Both pills dock bottom-right, which
  is where an expanded card already is, and on mobile underneath the sheet itself.
  With the slot free they stack: `setSlot(n)` is a rail index, `setSlot(null)` is
  "stay out of sight". The rail crosses two shadow roots, so CSS cannot do it —
  hence the controller-supplied `--pill-slot`.

The setup panel's two exits now mean different things, matching the modal: header
`×` **minimizes**, footer **Done** destroys (`closeSetup`). `nudgeLayout` moved from
`options.ts` into `shared/modalLayout.ts` so the sheets and the simulator — a scale
drawing of the same rectangle — cannot disagree about which way a handle goes.

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
free slots, `queueProgress` summarizes for the headers, and `progressDots` turns
that summary into the modal strip's row of dots: literal up to its cap, then
proportional, and always keeping one dot for the posting that is open (sixty dots
in a 380px strip is a glance at nothing). The queue is **derived**
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

### The archive (captured postings + export)
`extractJob` ran for the modal alone and threw its result away every re-render,
so a posting became unreadable the moment its tab closed. `jobDetails.ts` (pure)
keeps it: `Controller.captureJob` writes what the page said — title, description,
requirements, chips — for **every** posting the extension reads, applied or
skipped, and Options → Queue → **Archive** exports the applied ones as one JSON
file (`jobExport.ts`).

Kept under its **own storage key**, not as fields on `JobUrlEntry`: the job-URL
list is read and rewritten whole on every status change, session tick and queue
render, and prose is orders of magnitude bigger than the entry it belongs to.
`mutateJobDetails` skips the write when the pure helper returns the map
unchanged, and `captureJob` holds a signature of the last text written so the
re-renders (`confirmField`, `pick`, `apply`, every message) don't rewrite it.

Three rules the two-step case forces, each with a test:
- **An empty capture never overwrites a non-empty one.** A re-run or a Reset
  re-extracts against a page whose container may be gone, and writing that
  through trades good text for nothing, silently.
- **`resolveDetails` merges up the `sourceUrl` chain field by field**, not by
  picking the nearest non-empty record. The ATS end always has *a* title
  (`extractJob` falls back to `document.title`) and routinely no description, so
  record-level resolution returns that title with an empty body and leaves the
  board's description one hop away unread. This is what the E2E MixedBoard
  assertion caught.
- **`buildExport` collapses a chain to its destination.** `applyStatusChain`
  marks both ends applied, so one application would otherwise arrive as two rows
  — one holding the description, one holding the outcome.

The download is an anchor + `URL.createObjectURL` on the **options page**: it
needs no `downloads` permission, and an MV3 service worker has no
`createObjectURL` to do it with. Do not add the permission.

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
