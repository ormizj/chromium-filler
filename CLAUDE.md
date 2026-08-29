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
afterthought. `dev/frame.html?page=…` takes `popup`, `options`, `modal`,
`setup` and `picker`; the middle two render the real shadow-DOM classes over a
fake posting, because otherwise they are only reachable by loading the built
extension and driving a real site. `picker` runs the real click-to-pick toolbar
over a deliberately nested posting — it draws on the host page's own light DOM
rather than in a shadow root and exists only while a pick is running, so it was
the one surface with no harness state at all: every `onPick*` elsewhere in the
harness is a console stub, which renders the *button* and never the toolbar it
opens. `&label=…` names the field the bar says it is picking. `?page=modal&session=1` shows the queue strip and the
footer overflow menu.

`&state=…` picks which **flow** the surface is showing — setup also has
`offer` (what a never-configured site opens on — the most-seen screen in the
panel), `recording`, `recording-armed` and `recording-reset` (the bar up over a page
held inert, the same bar with the page live for one gesture, and the warning behind
Reset — the panel folded to its pill in all three), `review` /
`review-external`, which are the two renderings a real page can only reach by
applying to a job, and `saved` / `saved-clean`, the two ends of Save — the second
being the only way to see the coral move from `Review configuration` onto `Done`; modal: `long`, `redirect`,
`redirect-followed`, `app-link`, `landed`, `empty`, `listing`, `failed-fill`, `apply-unset`,
`apply-unverified`, `applied`, `already-applied`, `already-applied-redirect`,
`flush`, `fullscreen`; setup: `external`, `help`,
`cv-steps`, `submit-unset`, `success-unset`; options *and popup*: `fresh`, which
seeds an empty store — on options so the getting-started checklist is reachable
at all (the normal seed ticks four of its five steps off), on the popup because
the first-run nudge and the never-configured action rows exist nowhere else; and
options `export`, which opens the archive's
"What to export" disclosure. A two-step posting
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
`setup&state=offer-empty` is the offer on a page detection can see nothing on — the
shape the count line exists for, and one `BASE_SETUP` (which finds five of six) can
never produce.

**`&marks=1` is a parameter, not a state**, and draws the on-page name chips over
`fakePosting()`. A parameter because a mark is a rendering of the *page* rather than
of the panel, so it has to pair with any `state` or `step` — which a state could not,
`setStep()` forcing `mode='wizard'`. It runs the real `detectForConfig` rather than
posing three chips, which is why `fakePosting()`'s controls carry real `for`/`id`
handles: a posting whose fields nothing can identify would render the marks as a blank
page, the one thing that view exists to disprove. Pair it with `state=recording` for
what the feature is actually for — the bar up, the panel a pill, and every field the
extension recognised named on the page.

`&step=site|prep|kind|info|fields|send` opens one of the setup wizard's six
steps. Only one is ever on screen, so without this the other five are reachable
only by pressing Next — which a screenshot cannot do. Pair a state with the step
that shows it (`state=success-unset&step=send`); with no `step` the panel opens
where a real posting would put it, on the first step with work outstanding.

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
`settings.closeTabOnSkip`). Re-run lives in the overflow behind them — the footer
must never grow past two visible buttons plus `⋯`, because a third clipped the
primary action off the right edge at 390px. **Reset is deliberately not there**:
it blanks every field just filled and destroys the card holding the report, and
an unconfirmed wipe with no undo does not belong one tap from Site setup on the
surface whose whole job is showing what was filled. It stays on the popup
("Reset & Re-run" → `MSG.RESET` → `Controller.reset()`), where starting over is
what the button is for.

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
`flowBanner()` returns `{ key, tone, title, detail, help? }` for one of nine
states: `applied` / `alreadyApplied` · `appLink` · `external` / `externalOpened` ·
`noButton` / `noConfirmation` · `empty` · `ready`.

It exists because the modal used to say none of this. Three unrelated renderings
— an applied banner, a redirect notice, and an explanation of the greyed-out
Apply that only appeared *after* the user pressed it — between them still left
the commonest case silent: a posting filled and waiting showed a job advert and a
coral button with nothing connecting them.

Five rules the branch order encodes, each with a test:
- **`applied` outranks everything**, including a two-step posting and a blocked
  Apply — neither can still be the answer once something went through.
- **`alreadyApplied` sits directly below it and above all the rest.** The two are
  kept apart because only one is a receipt for something that just happened:
  `applied` means a confirmation appeared during *this* page-load, and its wording
  ("Acme confirmed it"), its `role="status"` live region and "safe to close this
  tab" all say so. `alreadyApplied` is the database read back — see "Applied is a
  lock" below — so it says what the record says, announces nothing, and points at
  Options → Queue. What they share is `isApplied()` in `modal.ts`: the `Sent`
  chip, the demoted title, `.cf-applied`, the legend line and the pill are about a
  posting being *finished*, not about the instant it finished.
- **`appLink` outranks the redirect states.** A *configured* two-step site whose
  apply link turns out to be an app link is both at once, and "Opening the
  employer's application" would be a lie — nothing was opened. `main.ts` enforces
  the same thing from the other end by not setting `redirect` at all when
  `detection.appLink` is present: the footer's redirect branch leads with "Open
  application", and there is nothing here to open.
- **Blocked outranks `empty`.** A listing page has no fields *and* no Send
  button, and its greyed Apply still provokes "why can't I apply?"; answering
  "nothing to fill here" leaves a dead control unexplained.
- **`empty` means the profile is empty, and nothing else.** It fires on
  `total === 0`, where `total` is the number of rows in the report — and
  `detectFields` returns one row per *wanted* field, so zero rows can only mean
  `wantedFields()` was empty: no profile values, no CV, no cover-letter file. A
  page whose fields all went unrecognised reports a row each and lands on
  `ready`. `FLOW_TEXT.empty` is worded for that and points at Options → Profile;
  it used to read "No application form was found here", which blamed the site for
  the one state only the profile can cause — on the very first run the
  getting-started checklist walks a new user through.
- **The tone decides where it renders.** `ok`/`warn`/`accent` lead the body in
  both views; the `quiet` resting state rides in the **footer**, above Apply —
  the Job view leads with the posting on purpose, and a fill-status line above
  the title inverted that. Only the long form stays behind the `?`.

Once the confirmation appears the whole card becomes the receipt: the `ok` banner
leads at `--text-lg`, `.cf-title` drops to `.cf-title-sub`, the header carries a
`Sent` chip (the body scrolls; the header does not), and the footer's green
`Applied ✓` retires Apply. The site's own message is routinely below the fold or
behind the card, so this is the only place the outcome is legible. That loudness
is keyed on **`.cf-flow.ok.cf-applied`, not on the `ok` tone**: a green banner is
not by itself a receipt, and the setup wizard states a confident verdict in the
same object (below) at ordinary size.

The banner itself lives in **`primitives.css`**, because two shadow surfaces draw
it. `.cf-flow-head` is a **grid**, and that is what centres the dot on the
*title's row*: the title line also carries the `?`, which is 28px tall on a fine
pointer and 44px on a coarse one, so the old `margin-top: 3px` (measured against a
bare 19px line) left the mark ~4px high with a mouse and ~11px high on touch — on
exactly the blocked states whose explanation is why the `?` is there. No single
number can be right for all three heights, so there is no number. The dot's grid
column exists only on the tones that draw one, or `quiet` and `accent` would be
indented by a mark that is not there.

The footer's **overflow (`⋯`) carries the two ways out of a posting** —
`Options` · `Site setup` — prepended by `commonMenuItems()` to all three of the
footer's branches, so they are there whether the posting is quick-apply,
two-step, or already sent. Without them the card was a dead end: a site that
filled the wrong field could only be fixed by closing the modal (losing the
report), opening the toolbar popup, and finding Site setup there. Setup is a
**direct call**, not a message — the panel is in the same content script, and
`openSetup` already folds the review card through `arbitrateSheets`.
**Choosing any item closes the menu**: Re-run rebuilds the card and took it with
it, so this never showed, but the two ways out open another tab and leave this
one exactly as it was.

**The order is decided by which end of the popover is near the hand, not by
importance.** `.cf-more-menu` is anchored `bottom: calc(100% + …)`, so it opens
*upward* and the item **last in DOM order sits against the `⋯` the thumb just
pressed**. That cheapest position belongs to `Re-run`, so every branch reads
`Options` · `Site setup` · (situational item) · `Re-run` top to bottom. The
situational items — `Fill this page instead` on a two-step posting,
`Open application` on an applied one — go *between*, which is what keeps both
fixed ends true on every branch. Read top-down in source the list looks
backwards; it is anchored to the toggle, not to the top of the card.

`Add links` was a third, and is not: it is the one errand in the menu with
nothing to do with the posting on screen, and the popup's Queue button already
reaches the importer from a surface that needs no job page open. That deep link
is now covered by the popup's E2E rather than the modal's.

A **blocked primary de-fills rather than fading**
(`button.cf-btn.primary[aria-disabled]` → `--surface`): the coral gradient at 45%
opacity is a muddy brown block that reads as broken, not unavailable, and the
state it marks is entirely ordinary. Same shape of override as `.cf-applied-btn`
— `--btn-primary` stays the one primary fill and these two states opt out of it.

**`:disabled` follows the same rule**: keep the border, drop the emphasis
(`--surface` fill, `--muted-2` label), never fade the whole control. A blanket
`opacity` took the outline with it, which turned the Sync tab's resting state —
Connect / Sync now / Disconnect, all disabled until an OAuth client is entered —
into three lines of grey text, and the setup panel's first `↑` and last `↓` into
ghosts. Unavailable is a state a control is *in*, not a control that half exists.

The modal has **two views behind a header toggle**, and Job is the default: once
the form is filled the user's question is "do I want this job?", not "which of
sixteen fields matched". The report lives behind the Fields tab, which carries the
report's *worst* status as a dot — hiding the report must never hide a problem,
and that dot is what the E2E `.cf-view .cf-dot.none` assertions see.

**The report's key is its count line, above the rows.** `.cf-summary` is
`● n filled · ◐ n to check · ○ n unmatched` — the dot, the count and the word
from `STATUS_TEXT` in one item, all three statuses present even at zero, because
the line is a key as well as a tally. Two surfaces draw it now — the report, and the
setup panel's offer over the fields it recognised — so the rule and its builder live
where shared things live: `.cf-summary` in `primitives.css`, `summaryLine()` in
`src/ui/`. **The words are an argument, not a constant**: `STATUS_TEXT` on the modal,
`SETUP_STATUS_TEXT` on the panel, for the reason under labels.ts below. As a separate legend under the rows it was
read after the colours it explains, if at all: on a sixteen-field report the key
was a scroll past everything it was meant to help with. The Job view's three stat
tiles carry the same dot for the same reason — their number is coloured by
status, and colour alone is not a status anywhere else in the card. What stays
below the rows is `.cf-legend-send`, which is not a key: it is the note saying
this report is a record rather than a plan, and it takes the hairline the legend
used to draw.

Three runtime contexts, all sharing `src/shared` (which holds every piece of
pure, unit-tested logic):

- **`src/content`** — the per-page orchestrator (`main.ts` `Controller`). On a
  matching page: wait for slow form (`waitForForm.ts`) → run prep steps
  (`prep.ts`) → classify the posting (`redirectDetect.ts`) → **either** hand off
  to the external application **or** detect fields (`fieldDetect.ts`) → fill
  high-confidence only, incl. CV via DataTransfer (`fill.ts`) → show modal
  (`modal/`). The job text is read **inside `showModal`**, not before the fill —
  `extractJob` has one production call site and the review is what needs it, so a
  re-render re-reads it and `captureJob` writes it to the archive from there.
  `extract.ts` walks containers into blocks via `shared/jobText.ts`, and reads the
  company/location/type chips from the posting's JSON-LD via `shared/jobMeta.ts` —
  **only** from JSON-LD or a configured selector, never inferred: a chip the
  posting did not state is not rendered, and there is deliberately no
  `og:site_name` fallback for the company, because that names the *board* and put
  "LinkedIn" where the employer should be.
  `picker.ts` = click/tap-to-pick override: click to select, click the same spot
  again to step one level in, Confirm to save (`shared/elementChain.ts`).
  `fill.ts`'s `highlight` takes an optional **label**, and `fieldTags.ts` draws it as
  a name chip beside the outline; `clearHighlights` is the single teardown for both.
- **`src/background/service_worker.ts`** — opens options, handles the `SUBMITTED`
  message (mark URL applied + optional tab close), and owns the two-step redirect
  watcher (below). `session.ts` owns the queue session (below).
- **`src/popup`, `src/options`** — popup triggers run/reset and shows session
  progress; options is six tabs (Queue · Profile · Settings · Sites · Sync ·
  Help) managing the job queue, profile, CV, behavior settings, site configs and
  the job-database sync. Adding a tab is `'name'` in `TABS` plus a button and a
  panel following the `tab-`/`panel-` id convention — deep-linking comes free.
  The strip **spans the panel it opens** (`.tab { flex: 1 1 0 }`, the popup's
  idiom): left-packed it ran out a third of the way across, so the folder read as
  a small pill above a very wide sheet and *nothing ever reached the sheet's
  right-hand corner*. That matters because the panel's first section squares off
  only the corner a tab actually stands on — the first tab owns the top-left, the
  last owns the top-right, and every tab between them leaves both rounded
  (`data-tab-pos`, written by `selectTab`). Two hard corners joined to nothing
  read as a clipping bug. **The tab that owns a corner owns the edge under it
  too**: a section draws a hairline up both its sides and the active tab drew
  none, so the outline ran up the left of the panel and stopped dead where the
  Queue tab began. The first tab takes a `border-left` and the last a
  `border-right` — only the outer edge of each, since those are the two that
  continue anything. `.tab` has to **name `border-color` even while `border:
  none`**: the bare `button` rule transitions `border-color`, and the shorthand
  leaves the colour at its initial `currentColor` — the near-black label colour —
  so the new hairline appeared at full strength and spent 120ms fading down to
  `--border`, a visible dark flash on every Queue/Help click. The width appears
  instantly and cannot animate, so the colour has to be right before it does.
  **Switching tab scrolls to the top** (`selectTab`, only when the tab actually
  changes): the panel underneath is replaced whole, so keeping the offset opened
  the new one halfway down itself. Instant, not smooth — the smooth scroll belongs
  to `revealSection`, which is a journey *to* a place, and guarding on a real
  change is what keeps this out of the way of the deep links that call both.
  At ≤640px the strip becomes a **3-column grid** (`options.css`): six tabs are
  401px wide on a 390px screen, and `overflow-x: auto` with a hidden scrollbar hid
  the last two with nothing saying to swipe. A grid rather than `flex-wrap`
  because wrapping gave a row of four and a row of two, i.e. two different tab
  widths in one strip. The cost, paid only on narrow, is that an active tab on the
  first row no longer sits on the panel — so the corner rule is approximate there.

  Both ends of the page carry a **scroll fade** (`--fade-down`/`--fade-up`,
  `data-scroll` on `<body>`, `initScrollFade`). The page scrolls in the window and
  the platform's overlay scrollbar is invisible at rest, so a panel clipped by the
  viewport looked exactly like a panel that ends there. The top one hangs off the
  *bottom* of the sticky `.topbar` — at `top: 0` the bar's own opaque `--canvas`
  would cover it — and is hidden at `scrollY === 0` so it never washes over the
  tab/panel join. A `ResizeObserver` on `<main>` drives it alongside the scroll
  listener: switching tab, opening a `?` and rendering the queue all change how
  far the page scrolls without scrolling it.

The popup's actions are **two rows in fixed proportions, and nothing in them is
ever hidden**: Fill (100%), then Site setup · Queue · Options in equal thirds.
The split is what each row *does*: Fill acts on the page in front of you, and the
three below it open another surface — Queue sat beside Fill and read as a second
thing to do here. Site setup used to hide on an unconfigured site and Queue
whenever a session was running, so the popup was a different shape every time it
opened — and the control you wanted was missing exactly when the page was in the
state you wanted it for. Where a control is is half of knowing it exists.
**Queue deep-links to the URL importer**, not to the options page's default tab:
the queue *is* the links, and as a bare `OPEN_OPTIONS` it is indistinguishable
from the Options button — which now sits two along from it, so this matters more
than it did. Three buttons at `flex: 1 1 0` fit 360px with ~35px to spare and
there is no `flex-wrap`, so the labels staying one or two words is what keeps the
row a row; an E2E measures their `y`.

**Fill closes the popup**, like every other action there: the work moves to the
page, and the review modal reports it in full while the popup sat on top of that
repeating a one-line summary. Only that branch — `Reset & Re-run` puts the button
back to `Fill`, and the press that follows is the point of having pressed it.

Cross-context messaging goes through the typed `MSG` contract in
`src/shared/messages.ts` (payloads must be structured-clone friendly).

`MSG.OPEN_OPTIONS` carries `hash` (a tab) plus **`at` (a section id) and `focus`
(a selector in it)**, which `options.ts` feeds to the existing `revealSection`.
A tab is not a destination — the importer is the third section of Queue and the
config JSON sits below a reference and a chip row — so every deep link that
names only a tab leaves the user to go and find what they were sent for. That
was the whole bug in the setup wizard's "Advanced (JSON)", which named no tab at
all and opened on the queue.

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
(tile / word / aria for each `MatchConfidence`), `SETUP_STATUS_TEXT` (the same three
outcomes worded for *setting a site up*, keyed `Record<RowStatus, …>`) and
`ACTION_LABELS` (Apply, Skip, Confirm, Pick, …), typed `Record<>` so a new status or
action fails `npm run typecheck` until it is named.

**The two status catalogs disagree about `none`, and that is the point of there being
two.** `STATUS_TEXT` words the result of a *fill*, where an unmatched row is a field
nothing on the page matched. On the setup surfaces `detectFields` returns a row per
*wanted* field, so a grey row means the page never asked for it — the ordinary state
of most of the sixteen on any real form, and the exact rule `setupSteps.fields`
encodes when it counts only the CV as work. So `SETUP_STATUS_TEXT.none` is "not on
this page", and borrowing "unmatched" there would tell a user eleven of their fields
had failed on the one screen whose job is to say what already works. `high`/`low`
differ in tense too: nothing has been filled yet on that screen. Every surface renders its status words and
button verbs from here — the modal legend, summary, stat tiles, the setup rows
and the popup badge no longer disagree. `fieldStatus.STATUS_LABELS` re-exports
the aria forms from it.

`src/ui/palette.ts` is the **one** legitimate copy of the token colours, for the
three marks drawn on the *host* page (the field highlight in `fill.ts`, the name
chips beside it in `fieldTags.ts`, and the click-to-pick toolbar in `picker.ts`) —
content-script light-DOM never sees tokens.css, so it cannot read a `var(--…)`.

`src/ui/designSystem.test.ts` is the guardrail that makes "zero inconsistencies,
now and in the future" mechanical: it fails the build if any CSS/TS outside the
token layer hardcodes a colour, if a `var(--…)` names a token nothing declares,
if a second primary fill appears, if a status is missing its colour/icon/word, or
if `palette.ts` drifts from the tokens it mirrors. It reads the sources off disk
because Vite hands vitest an *empty* string for a `.css?inline` import.

**A control drawn as a fixed square must pin `min-width`/`min-height` too**, and
that test enforces it (a rule is "a control" if it says `cursor: pointer`). The
light-DOM pages carry bare element rules — `options.css` styles every `button` as
a secondary button, `min-height: var(--tap)` included — and `min-height` beats
`height`. `.cf-help-btn` lost that fight silently: it asked for 28×28 and rendered
**28×44**, so every `?` on the options page was a tall rounded rectangle wherever
the disc paints. Nothing could see it — the shadow surfaces have no bare `button`
rule, and on a coarse pointer the button grows to 44×44 and comes out square
anyway, so the mobile-first pass was clean as well. `input[type=checkbox]` and the
simulator's handles already carried the same line.

Geometry is otherwise invisible to vitest — jsdom evaluates neither the cascade
nor layout — so the rest is measured in the E2E: the `?` is square on a *fine*
pointer, and the two `.cf-view` segments are equal at one tap size.

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
surface that answers "what is this?" renders from it: the setup wizard's
per-step lead and `?`, the options Settings `?` toggles, the Sites-tab key
reference, the Help tab, and the review modal's dot key. Copy written into a
surface instead of the catalog is a bug — the setup panel and the page
documenting it have to say the same thing.

The `Record<keyof …>` types are load-bearing. `CONFIG_HELP`, `REDIRECT_HELP`,
`SETTINGS_HELP` and `PREP_HELP` are keyed off `SiteConfig`, `RedirectConfig`,
`Settings` and `PrepAction`, so **adding a config key fails `npm run typecheck`
until it has an explanation**. That is what stops this going stale the way the
`types.ts` doc comments did: they were correct, and no user could read them.

`SETUP_STEP_TITLES` and `SETUP_STEP_HELP` are keyed off `SetupStepKey`, so a
seventh wizard step cannot ship unnamed or unexplained. `prep` is titled "Before
filling" and not "Setup steps": the wizard's own units are steps now, and "Step 2
of 6: Setup steps" reads as a stutter.

`HelpEntry.short` is the one-line form, for places that are a *key* rather than
an explanation. The setup panel's legend uses it and the full `body` stays behind
that step's `?`; rendering all five bodies at once filled a whole 390px screen
with prose before the user could reach a single row — which is why the wizard
shows exactly one of them, the current step's. The options settings rows render
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
options getting-started checklist — and it is **shared with the options
getting-started card**, which writes the same flag, so dismissing either retires
both and moves where the wizard opens.

**`richText` renders backticks and nothing else.** It splits on `` ` `` and makes
the odd pieces `<code>`; there is no bold, no italic, no links. A `**word**` in a
catalog body ships as two literal asterisks on every surface that renders it, and
nothing fails — not `npm run typecheck`, not `help.test.ts`, which only asserts
that a body is non-empty and longer than its title. Emphasis in this copy is
done with “quotes” or by rewording.

The `?` is a **masked icon** (`--icon-help`), not a `?` typeset inside a bordered
pill. The pill was filled with `--surface`, which is *darker* than the card in
dark mode and a shade lighter in light — a low-contrast hole rather than a
control on every surface — and on a coarse pointer the painted disc itself
inflated to 44px. Drawing the circle as part of the icon separates the glyph
(a constant 18px) from the target (transparent, and free to be a full `--tap`),
which is the whole fix. `helpButton` therefore sets **no text content**: its only
name is the `aria-label`.

Placement matters as much as the mark, and the rule is **immediately after the
text it explains, never pushed to an edge**. Nothing in `primitives.css`
positions it; a `?` at the right-hand edge of a row reads as belonging to the row
rather than to a phrase in it, and on a full-width card it ends up a card's width
from the words it is about. So `.setrow-text > .cf-help-btn` carries no
`margin-left: auto` (it did, to land at the same x on every row — which works on
a half-width card and is absurd on a wide one), the setup wizard's step meta line
is `Step n of 6` · `?` … `N to do` with the *chip* taking the slack, and the
modal's flow banner puts the `?` on a `.cf-flow-titleline` beside the title
instead of after a `flex: 1` text block.

It still never goes *inside* a heading: `attachRowHelp` puts it in the row's text
block after the title, so no control runs through the middle of a text block, and
the wizard's `?` stays on the meta line above the step title rather than in it.

**A settings row's caption is a line of the row, not part of its text block**, and
that is what puts the control on the title line: `<title> <?>` … `<toggle>`, then
the caption, then the disclosure. Inside the text block the caption made it two
lines tall and `.setrow`'s `align-items: center` centred the toggle against both,
so every switch on the page rode half a line below the title it belongs to.
`attachRowHelp` therefore appends it to the **row** — last, because its
`flex: 1 0 100%` starts a new line, and between the title and the control it would
have taken the control down with it. `.setrow-text` is `flex-wrap: nowrap` for the
same reason: let the `?` drop to a line of its own and the block is two lines tall
again, which is exactly what happens at 390px.

**A `.setrow.stacked` is the same row with its axis turned**, and every length in
it was written for a row: it must carry `flex-wrap: nowrap` and reset its children
to `flex: 0 0 auto`. Wrapping in a column wraps into a second *column* —
`.setrow-help`'s `flex-basis: 100%` is the card's **height** there, cannot fit
beside its siblings, and so the disclosure panel left the card entirely and hung
off its right-hand edge over the page. `flex: 1` on the text block grew it
vertically, which floated the caption in the middle of the card and pinned the
control to the bottom. Neither is visible to jsdom; an E2E measures the panel
inside its row on both shapes of row.

### Data model & storage
`src/shared/types.ts` is the source of truth: `Profile`, `SiteConfig`,
`JobUrlEntry`, `Settings`, `StoredState`. Everything persists in
`chrome.storage.local` via typed wrappers in `storage.ts`. `FieldKey` enumerates
every fillable field (`resume` = the CV file).

`SiteConfig` drives per-site behavior: `urlPatterns` (match-pattern or `/regex/`),
`waitFor`, `prep`, `extract`, `fieldOverrides` (beat the heuristics), `cvUpload`,
`submitCv`, `autoDetect`, `successSelector`.

**Two documents, one mechanism.** `cvStore.ts` is keyed by `DocKind`
(`resume` → `'cv'`, `coverLetter` → `'coverLetterFile'`); `getCv`/`setCv`/
`clearCv` are wrappers on it. The cover letter is the one field that is *both* a
`TextFieldKey` and a file, because sites are split on how they ask for it and the
user cannot know which in advance — so Options → Profile gives it its own section
with a box **and** an upload, and `applyFill` branches on the control the page
actually offers. Detection follows `UPLOAD_FIELDS` (`fieldDetect.ts`): every
*named* upload is claimed first, and only then may `resume` fall back to a
leftover unlabelled file input. Only the CV gets that fallback — attaching a
cover letter to an input nobody labelled is the wrong document sent to an
employer, which is the same failure `findSubmitControl` refuses to risk.

Both render as **one `.file-row`, and both the same shape**: the two controls
inline (pick a file, remove the one that is there, Remove held against the right
edge away from the picker) with what is *currently* stored on its own line
beneath. Wedged between the two controls that line pushed them apart by however
long the filename happened to be, so the same button sat at a different x on the
two document rows — and it put a `role="status"` live region in the middle of a
control row.

**`FIELD_ORDER` and `orderFields` (`fieldKeys.ts`) decide what order fields are
read in**: the CV, the cover letter, then contact details, then the rest —
and, within that, everything the user actually filled in before everything they
did not. It is applied to the **output** of detection, never to its input:
`detectFields` uses its `fields` argument as the tie-break between two fields
scoring equally on one control, so reordering the input would quietly change
which control a field claims. The wizard's step 5 sorts through it; Options →
Profile renders in the same order but *without* the filled-first half, because a
form that reshuffles as you type is worse than one with a fixed order. Before
this the report was ordered by nothing better than the order the profile happened
to be typed in, with the CV always last.

**The modal's report sorts by outcome first** (`orderReport`, `fieldStatus.ts`,
on the shared `orderFieldsBy`): unmatched, then to check, then filled, with
`FIELD_ORDER` deciding ties inside each band. What a row needs from the user
outranks which field it is — in plain `FIELD_ORDER` the one field needing a Pick
sat wherever the list happened to put it, under eleven green rows. It ranks on
`matchStatus`, not on `confidence`, so a high-confidence match the control would
not take sorts where its own dot says it belongs. The wizard keeps
the profile-filled split instead: it lists every field the extension knows, where
most `none` rows only mean "this page never asked for it".

**The report is the record of one fill, and it holds still.** `orderReport` runs
**once**, at the end of `detectAndFill`, and `modal.ts` renders `data.matches`
verbatim — the whole overview (row order, dots, tag words, the `.cf-summary`
counts, the Job view's tiles, the Fields tab's dot) is established by a fill and
by nothing else. It sorted per render for a while, on the theory that a row
leaving the top showed the work going down; what it actually did was drop the row
out from under the finger that had just pressed its button and move every row
below it. Every other thing that re-renders the card (the success
`MutationObserver`, `closeSetup`, fold/restore/fullscreen, the Job/Fields toggle)
paints the same array, so a snapshot is all any of them can show.

Two consequences, each with a test:

- **`confirmField` does not write back into `matches`.** It fills the control and
  re-colours the on-page highlight, and that is the whole of its effect on the
  record. The card's acknowledgement is the row's own button retiring to
  `Confirmed ✓` (`ModalData.confirmed`, `Controller.confirmedFields`) — the same
  `aria-disabled` convention as the footer's `Applied ✓`, and deliberately *not* a
  status: it must never reach `matchStatus`, `statCounts` or `worstStatus`. Only a
  successful fill records one, so a Confirm that fails leaves the live button
  there to press again, and `detectAndFill` clears the set, because a new record
  carries no memory of a press against the old one. `reset()` still counts a
  confirmed field as written, or it would leave on the page the one value it put
  there outside a fill.
- **The dev harness's `REPORT` is written pre-sorted**, since the modal no longer
  sorts anything; `?page=modal&state=confirmed` is the retired button, which is
  otherwise reachable only by pressing it.

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

### Recording a site
**The front door to Site setup is recording, not the wizard.** The user applies to
one job, saying as they go which of their actions is a step to repeat and which
element is what, and the config is compiled from that.
The six-step wizard is still there, and is where a recording is corrected — but it is
the long way round now, not the way in.

The problem it replaces: setting a site up meant answering ~25 questions one at a
time, and the two that actually gate Apply (`submitSelector`, `successSelector`) were
last in the queue, so on most sites they never got set. `successSelector` is the
sharper case — it does not exist until an application has really gone in, so the only
moment it can be captured is during one, which the wizard had no way to be present
for.

Four pieces, and the split matters: **`src/shared/recording.ts`** is pure and holds
every rule about what a recording *means*; **`src/content/recorder.ts`** owns the page
while one runs; **`src/content/inertPage.ts`** is the suppression it and `picker.ts`
share; **`src/content/recorderBar.ts`** is the HUD that carries the one decision.

A recording is a flat, ordered `RecordedStep[]`. Each step is either something the
user *did* (`click` / `input` / `navigate`) or carries a **bind** — "this is the
description", "that is the Send button", "that banner is the confirmation". Binds are
the whole point: without them a recording is a macro, and a macro cannot tell the
description from the sidebar.

**Nothing is recorded unless the user asked for it, and the page is inert until they
do.** The recorder used to be the inverse of `picker.ts` — a passive observer that
cancelled nothing and watched everything — and that put the cost the wrong way round:
`prep` replays on every later visit, so every incidental press while *reading* a
posting became a step replayed for ever, and the decision that matters (*what is
this*) was asked afterwards about whatever had just happened. So the question is asked
first, and there are two answers:

- **Interact** arms one gesture. The next click reaches the page and is kept as a
  step. `RecorderMode` is `idle` | `armed` | `live`, held on the handle and reported
  through `onMode` — the bar is the only thing on screen that can say which.
- **Declare…** picks a `BindKey` from the bar's menu and hands off to `startPicker`,
  so a mark is chosen *before* it is pointed at. It works on anything, not only on
  what was just done, which is the only way to catch the confirmation banner — that
  appears because the application went in, and is never the thing you pressed.

Five consequences, each with a test:

- **An arm covers an interaction, not an event.** An armed click that lands in a text
  control decays to `live`, and keys aimed at *that control* pass until it is done
  with. Without it a user could not type an email address, so could never reach the
  Send button or the confirmation — which is the whole reason recording exists.
- **The permission crosses two listeners by event identity.** The recorder's own
  `click` reader has to be registered *before* the suppression (which ends in
  `stopImmediatePropagation`, killing anything registered after it on `document`), and
  it spends the arm as it goes — so by the time the suppression asks, the mode already
  reads `idle`. `gestureEvent === e` is what carries it.
- **A `submit` passes on containment alone, with no time limit.** There is no way to
  reach one except from a press this recorder allowed, and a site that validates in JS
  calls `requestSubmit()` seconds later — cancelling that would silently eat the
  application being sent.
- **`SAME_GESTURE_MS` is the gesture's tail, not a dedupe.** A `<label>` press makes
  the browser raise a second click on the control it names, and that one must still
  *reach the page* or the box never ticks. It only ever covers a **different**
  element: the same one again is a second press, and one arm is one press.
- **It stands down completely while a picker is running** (`[data-cf-picker]` in the
  DOM) — both the recording and the suppression, since `picker.ts` has its own and its
  `isOwn` is `isExtensionUi`, so the bar stays pressable. Read off the marker element
  rather than a flag, so it is right for every picker entry point.

Two things that did not change: **it records where things are and never what was
typed** (`RecordedStep` has no value field; `labelFor` reads an `<input>`'s `value`
only for the four types where that is a label), and **a click is named by
`closest(INTERACTIVE)`**, because a click lands on whatever `<span>` a button wraps
its label in. A **checkbox**'s `change` is still skipped entirely — the armed click
already recorded it, and the second copy would arrive as an unbound `input` step the
compiler drops, so "I agree to the terms" would silently not be in the config.

**`inertPage.ts` is where "inert" is defined, once, for both surfaces.** Everything is
`stopPropagation` + `stopImmediatePropagation` at `document` in the capture phase;
only `CANCELLED` (`click`, `dblclick`, `auxclick`, `contextmenu`, `keydown`,
`keypress`, `submit`) is also `preventDefault`ed. The pointer/mouse/touch *down and
up* events deliberately are not, because their default is **scrolling** and a
recording runs for minutes on a posting the user has to read. `picker.ts` passes
`hard: true` and opts back in: a pick lasts seconds, and killing the drag-selection is
worth more there. `wheel` and `scroll` are in neither list.

**`Controller.run()` returns early while a recording is live**, and
`closeTabOnSubmit` is suppressed in `handleSubmitted`. The second is not tidiness: the
confirmation appearing is the exact moment it has to be marked, and closing the tab
would take the page away at the last step of the setup the recording exists to
produce. The posting is still marked applied — the user really did apply.

#### The compiler
`compileRecording` slices the timeline into the existing `SiteConfig` shape, so
nothing downstream changes. Ten rules, one `describe` each in `recording.test.ts`:

1. **Legs decide which config a step lands in**, and what happened outranks the flow
   the user picked — in both directions. The choice only ever shaped what the bar
   asked for.
2. **A bound step is never also a prep click.** The click that opened the file dialog
   is dropped once the upload is bound: the extension attaches the CV with a
   DataTransfer, so replaying it would pop an OS dialog over a page nobody is looking
   at.
3. **Nothing that sends an application reaches a prep list.** This is *"Never submit
   unprompted"* expressed where a recording could break it — `prep` runs
   automatically on every later visit, so a Send click in it would submit
   applications on page load. A bound `submit` sets `submitSelector` only; an
   **unbound** click whose label reads like a send (`looksLikeSend`, exported from
   `submitDetect` so the veto list is the same one) is *adopted* as the Send button
   rather than replayed. That second case is the dangerous one: the user pressed Send
   and never said so.
4. **Internal split**: clicks before the CV bind → `prep`, clicks after it and before
   `submit` → `submitCv`, clicks after `submit` → dropped.
5. **External split**: the handoff click → `redirect.applySelector`; clicks before it
   → `redirect.beforeFollow`, every one `optional: true`; the handoff click itself is
   **not** also in `beforeFollow`, or the employer's form opens twice.
6. **A pause becomes the click's own timeout**, not a `waitFor` step — `PrepStep.ms`
   on a click already *is* the `waitForSelector` timeout `prep.ts` gives it, so a
   separate step would wait twice for the same element.
7. **Consecutive clicks on the same target are kept, not collapsed.** They used to
   be de-duplicated, because a passive recorder saw a double press as two steps
   nobody meant. Every click costs a press of Interact now, so a repeat is a
   repeat and collapsing it drops a step the user paid for twice.
8. A fragile target compiles but warns.
9. No confirmation marked warns — it is the one selector with nowhere else to come
   from.
10. **The leg that sends the application owns the sending.** The destination never
    carries a `redirect` block; a posting that hands off never carries
    `submitSelector`/`successSelector`.

**The `navigate` step is emitted on *resume*, by the content script that wakes up
somewhere else.** No click knows in advance that it is the one that will leave, and
the background is told nothing until a step arrives from the far side — so the
handoff is noticed on arrival, by comparing where this page is with where the
recording began. It is stamped `leg: 'posting'` on purpose: it is the last thing that
happened on the board, and rule 5 reads it there to work out which click was the
apply link.

`applyConfigPatch` (`storage.ts`) writes the result, and **a patch only ever speaks
about what it saw**: maps merge key by key, sequences replace only when non-empty,
single selectors overwrite only when set. Recording a site again to mark the
description you forgot must not wipe the Send button you got right the first time.

#### The bar
`src/content/recorderBar.ts` is a **toolbar, not a `Sheet`** — it never takes a
`--pill-slot`, so "one slot, two sheets" is untouched, and it is the smallest thing
that can still be pressed, because the page underneath is what the user is working
in. Placement mirrors `picker.ts`: bottom on a coarse pointer, top on a fine one.

**The middle is the two options, and it is the whole reason the bar exists:**
`Interact` · `Declare…`. Neither is a default — while neither is chosen a click does
nothing at all — so the question "is this a step, or is it a thing" is answered
*before* the user acts rather than reconstructed from a list of nine clicks at the
end. `Declare…`'s menu is the same `BindKey` list it always was; `Interact` is a
toggle, because the button holding the page live has to be the way back out of it.

**The armed state is a mode, and drawn as one.** It does *not* take the primary fill
— `Done` is the one thing this bar is for, and a second coral beside it makes neither
mean anything — and it does *not* pulse its own opacity: the live dot can, being a
10px dot, but a full-width control fading to a third and back is the same muddy
half-there block a disabled primary used to be, so "waiting for you" would read as
"not available". The tint holds still and the **ring** moves.

The extension's own guess still runs (`guessField`, exported from `fieldDetect` —
same scoring as `detectFields` but for one element, since the bar cannot wait for a
whole-form assignment) on the `input` step an armed click into a field produces. The
bar no longer carries a control to refuse it: that moved to the review's bind select,
which is why that select now offers the sixteen profile fields under an `<optgroup>`.

**The exits are three sizes of changing your mind** — `Reset` · `Undo` · `Done` —
and Reset is the one with no way back, so it asks first.

`Undo` can only ever take a step out of the *list*; it cannot take back what the step
did. The "Show more" is still open, the form is still on page three, and after a
handoff the browser is on the employer's site entirely — so a recording carried on
after a few undos is compiled against a page state no later visit ever reaches, and
`prep` replays into it. That is why Reset **reloads**: a clean list against a dirty
page is the half-fix, and the worse one.

Four things it does, each with a test:

- **It re-sends `RECORD_START`, and there is no `RECORD_RESET`.**
  `background/recordings.ts` already overwrites the tab's entry unconditionally, which
  is exactly a clean slate: empty `steps`, fresh `startedAt`, and no `destinationUrl`
  — the last of which is what stops `compileRecording` still believing a handoff
  happened.
- **It re-sends the recording's own `postingUrl`, never `location.href`.** Resetting
  from the employer's ATS must not redefine the posting as the ATS page, or the
  handoff could never be recorded again. So on the posting leg Reset is a reload and
  on the destination leg it is a walk back to the board — which is also why the
  confirm is worded per leg (`resetRecordingPrompt` in `labels.ts`): on one of them
  "start again" means leaving the page you are looking at.
- **It tears nothing down by hand.** Unload does that. `run()` stands down on
  `this.recorder` existing, so clearing it here would open a window in which an
  autofill could start against a page that is about to be replaced. Nor does it reset
  `this.recording`: the next content script reads the empty recording back through
  `resumeRecording()`, which already derives `leg: 'posting'` and — `destinationUrl`
  being gone — no longer synthesizes the `navigate` step.
- **It goes through `webUrl` like every other href handed to the browser**, even
  though a `postingUrl` captured from a content script is always http(s). A refusal
  falls back to `location.reload()`, so the control can never do nothing.

The confirm is a popover on the same mechanism as the Declare menu, and **only one of
the two is ever up** — they overlap, and the second to open would sit on the first
with nothing saying which press it belongs to. Both flags live on the instance, so the
one-second clock leaves them alone. `.btn-danger` had to be **paired at shadow
specificity** in `primitives.css` (`.btn-danger, button.cf-btn.btn-danger`) exactly as
`.btn-ghost` already is: `button.cf-btn` names a class of its own, so the bare rule
lost both the colour and the border and Reset drew as an ordinary secondary button.

At ≤640px the bar wraps to **four** rows in a fixed order — state, the three exits,
the two options, the readout — because left to source order the options moved with the
length of the readout and took the exits with them. It was three while the exits were
two buttons sharing the first row: at 390px the state readout ends around x=175 and
Undo began around x=258, so a third control eats the last of that slack the moment the
clock reaches two digits or the count reaches ten, and a row that reflows while the
user is looking at it is the failure this order exists to stop. Both the options and
the exits are **equal halves/thirds**, and every child of both is wrapped in an
identical `.cf-rec-wrap` to make that true: a bare `<button>` beside a `<div>` under
`flex-basis: 0` adds its own padding on top of its share and comes out 191/169. Those
narrow overrides live at the **end** of `recorderBar.css`, after the component rules
they beat — at equal specificity source order is the only thing deciding them. The
confirm popover anchors `right` on a wide bar (Reset sits near its right-hand end, so
it opens back across the bar rather than past its edge) and is flipped to `left` in
that narrow block, where Reset is the leftmost third of a row of its own.

**The mark menu is re-ordered by leg, never filtered by it.** Ordering is worth doing:
on the board half of a two-step posting the apply link is what there is to mark.
Filtering was a bug an E2E caught — keying the list off the *flow* alone left the
destination leg, the page where the application is actually sent, with no way to mark
the Send button or the confirmation at all. A mark that is unlikely here costs a line
in a menu; a mark that is missing costs the recording.

#### What it shows you while you record
**The page is marked up by name, on both legs.** `highlight` (`fill.ts`) draws a
coloured outline and nothing else, so a form with nine outlined inputs says nine
things were found and never which one is Email — and while a recording runs that is
the *only* field feedback there is, the panel being folded to its pill.
`content/fieldTags.ts` puts a name on each mark: the host page's own light DOM,
inline-styled from `ui/palette.ts`, `pointer-events: none`, positioned from
`getBoundingClientRect()` and re-placed on every scroll (captured, so inner scrollers
count) and resize, batched into one rAF pass for the whole set.

Six things it gets right, each with a test:

- **`highlight(el, confidence, label?)` is the only entry and `clearHighlights` the
  only exit.** The chips are part of the mark, so four call sites each remembering to
  clear a second thing is how one of them ends up not doing it — and the symptom is a
  name pinned over a page nothing is marked on any more.
- **A label-less `highlight` re-colours the chip rather than removing it.**
  `confirmField` passes no label because nothing is being renamed, only whether the
  value went in has changed; dropping the chip there would unname the one field the
  user has just acted on.
- **Above the control and aligned to its *right* edge.** The gap above a form control
  is where the form's own `<label>` lives, so above-left sits on top of the very words
  it is echoing — on every field of every form. Labels are short and controls are
  wide. When there is no room above (the topmost field of a form scrolled to the top,
  i.e. the commonest field on the page) it drops *inside* the control, never below,
  because below is where the next field's chip goes.
- **A zero-area or off-screen element is hidden, never cleared.** The `display: none`
  file input behind a custom "Upload CV" button is the commonest shape of `resume` on
  an ATS; and an element scrolls back, so its mark has to come with it.
- **`TAG_ATTR` is in `extensionUi`'s `OWN_SELECTOR`**, so the picker's `elementChain`
  and the recorder's three `isExtensionUi` guards all skip them. `pointer-events: none`
  already keeps them out of hit-testing; a mark must also **never contain a form
  control**, or `detectFields` could claim one. They are `aria-hidden`: they sit in the
  *page's* DOM and would otherwise be read in the form's own order, a second and worse
  copy of every label it already has.
- **`markDetectedFields` runs when the recorder attaches, after the bar.** The bar is
  the only thing saying the page is inert, and marks ahead of it are unexplained. It
  clears first, which is what makes the two legs the same page: the posting leg used
  to inherit whatever `refreshSetup` had drawn a moment earlier and the destination
  leg — a fresh content script on the employer's site — had nothing at all. **Fields
  only**: `refreshSetup` also names the Send button, but that is the panel's *guess*,
  and a chip reading "Send button" beside something the user is about to press for
  real reads as an instruction the extension is in no position to give. `pickForBind`
  chips what it is told instead, `bindLabel(bind)` — declare the Confirmation and then
  the Send button and, unlabelled, they are two identical green outlines on exactly
  the two marks that gate Apply.

Two consequences elsewhere. **`detectForConfig` (`fieldDetect.ts`) takes an optional
config**, and that is not tidiness: the destination leg runs where
`findMatchingConfig` returns nothing and `ensureConfigForUrl` deliberately does not
run until Save, so a sweep there has to mean "the heuristics, and nothing saved". It
is also where the `cvUpload` fold-in finally lives once instead of at each of its
three call sites. And **`closeSetup` does not clear while a recording is live**: the
panel is reachable from its pill mid-recording, and its Done means "finished with the
panel", not "finished with the marks" — nothing would re-draw them until the recording
ended.

#### Where it is offered
**The panel has four screens, and a never-configured site opens on the offer** —
`SetupPanel.mode` is `offer` | `wizard` | `review` | `saved`, on the instance (same
rule as `step`). Only the *opening* one is chosen once; the other three are commands
(`showOffer`, `showReview`, `showSaved`), because they are places in a task.

The offer is a screen of its own and not a block on wizard step 1, and that
distinction is the whole feature working or not. The panel does not *open* on step 1:
`render` sends anyone with `helpSeen` to `firstStepWithWork`, and a brand-new config
always has work on `fields` or `send` — so as a block the Record buttons opened four
presses of Back away from every user who needed them, and Site setup looked exactly
as it always had. `isUnconfigured` (pure, in `setupSteps.ts`) is what routes it, and
it tests **saved** selectors only: every heuristic on the page reports itself as a
match, so counting those would call a fresh site configured on the strength of
guesses stored nowhere.

**The offer has no footer, and that is the screen.** It carried two buttons and
neither was an outcome. "Set up by hand ›" pointed at the six-step wizard from the
one screen built to avoid it — and the wizard is what put `submitSelector` and
`successSelector` last in a queue of twenty-five, which is why they went unset on
nearly every site and why recording exists at all. `Done` closed the panel having
taught the extension nothing: the site is still unconfigured, so the next posting on
it opens on this same screen. So the only way *on* is to record, and the header `×`
stays what it always was — the way to get the card out of the way (it minimizes to
the pill), not a way to finish with the site.

The wizard is not lost, it is downstream: record → review → Save → `Review
configuration` (`savedFooter`). Anyone who has taught this site anything never sees
the offer at all, because `render` only routes here while `isUnconfigured` — and that
tests *saved* selectors, so one Pick from the review modal's report flips it. The
accepted cost: **a user who wants to configure a site by hand without applying to a
job has no in-panel route.** Options → Sites is theirs, which is where the wizard's
own "Advanced (JSON)" already deep-links. `showOffer()` takes no argument for the same
reason — nothing turns the offer off any more.

Step 1 keeps a smaller version of the lead, worded for **re-recording** a site to
correct or add to what is saved — and there both Record buttons are secondary, with
Next keeping the footer's primary. Anyone in the wizard has already chosen that path.

**Each Record button carries a caption, and the pick is declared safe to get wrong.**
`RECORD_FLOW_TEXT` (`labels.ts`, `Record<RecordFlow, { label, detail }>`) is the one
home for both — they were duplicated into `ACTION_LABELS`, which no longer names them.
As bare labels the two buttons asked the one question a user is on this panel because
they cannot yet answer, and "this site" versus "the employer's site" is exactly that
question. `RECORD_FLOW_HINT` is the other half: the pick only orders the recorder
bar's Declare menu, so a wrong one costs nothing — a fact that lived in
`CONCEPT_HELP.recording.when`, which the offer screen does not render. It shows on the
offer only; step 1 already ends on "Or correct it by hand below."

**The offer says what the extension can already read on the page.** `refreshSetup`
runs the full detection sweep on every render, in every mode — so a complete
`data.fields` had always been in hand here and this screen read none of it. "Teach the
extension this site" gave no sense of how much teaching was left, and the rows that
would have said were two taps down a rail the offer does not draw. `detected()` is a
count line (`ui/summaryLine.ts`) and a `.chip` per field found, and three rules make
it:

- **After the Record buttons, not before.** The screen's job is the offer; a count
  above it demotes the two things the screen exists for — the same reason the flow
  banner's resting state rides in the modal's *footer* rather than over its title.
  Read in order: this is what recording does · do it · here is what you already have.
- **All three statuses stay on the line at zero**, because it is a key as much as a
  tally — the rule `.cf-summary` has always followed, which is why the line and its
  CSS moved to `ui/` and `primitives.css` when a second surface wanted them.
- **`none` is worded from `SETUP_STATUS_TEXT`, never `STATUS_TEXT`.** Detection
  returns a row per *wanted* field, so a grey row here means the page never asked for
  it — nine of them is the ordinary state of any real form. `STATUS_TEXT.none.word`
  ("unmatched") would blame the site for the commonest case, which is the exact
  cry-wolf failure `setupSteps.fields` counts only the CV to avoid. Only the rows that
  found something get a chip: a `none` row has no element and so nothing to name.

Not on wizard step 1. Step 5 already lists every field with its selector *and* a Pick,
and the rail carries that step's dot and its "N to do" chip on every step — so a
second, unactionable copy under the re-record buttons is the clutter the
`cf-record-hint` / `cf-record-or` split already refuses.

Two things `choiceBtn` gets right that are easy to lose. The caption is *supporting*
text, so the button keeps the bare label as its accessible **name** (`aria-label`) and
carries the caption on `aria-describedby` — built from both, the name becomes "Apply
on this site The application form is on this page…", which is worse to hear and worse
to match on (five E2E lookups do). And `.cf-record-choice` is **paired at
`button.cf-btn` specificity** in `setupPanel.css`, the same trap `.btn-danger` fell
into: the bare class is (0,1,0) and loses to (0,1,1), so `white-space: normal` never
landed and every caption ran off the right-hand edge as one `nowrap` line.

#### Reviewing it
Stopping compiles and opens the panel's **review**: the timeline, each row carrying
the *selector's* strength as its dot (not a match status — the row's question is "will
we find this again"), a per-step "what is this" select, and a Pick on the fragile ones.
Nothing is written until Save; a recording is a proposal, and half the point of the
review is that it can be refused.

**The "what is this" select carries the profile fields too, under an `<optgroup>`.**
It deliberately did not, on the grounds that sixteen fields would bury the five that
matter and a field was corrected from the bar while the cursor was still in it — but
the bar has no such control any more, and the one bind the extension still guesses for
itself is exactly a field. This is now the only place a wrong guess can be refused, so
it has to offer them; grouped, because flat they run straight past the marks above.
The order comes from `fieldMarks()`, exported from `recorderBar.ts` rather than
re-listed, which is the same rule the label catalog exists for.

#### Finishing it
**Save reports; it does not become the wizard.** It used to: `saveRecording` wrote
both patches and then fell through to `showReview(false)`, so finishing a recording
landed the user four steps into the manual surface with nothing saying it had worked.
`mode: 'saved'` is that report — which shape was written (the one fact the timeline
behind it was arguing about), and the steps `stepStates` says still have work, since
those are the entire reason to go into the wizard rather than close the panel.

**Which of its two buttons is coral is the whole screen.** Work outstanding → `Review
configuration` takes the primary; nothing outstanding → `Done` does. Both renderings
have a harness state (`saved`, `saved-clean`), because a swap only one fixture can
produce is a swap nobody looks at.

**The Controller sets the mode *before* it refreshes**, and that ordering is the fix
for a bug that predates the screen: `showReview(false)` derived its landing step from
`this.data`, which is still the **pre-save** render — `refreshSetup` runs afterwards
and `placed` is already true, so it never recomputes — and the panel opened on work
the patch had just done. Everything this screen counts is counted from the render that
follows the write.

**Discard is the back door, and goes wherever the panel would have opened**: the offer
when `isUnconfigured`, the wizard otherwise. Refusing a recording on a site with
nothing saved should leave recording one press away, not four steps into the wizard
the user has just declined to use. `clearRecording` is split out of `discardRecording`
because Save and Discard both finish with the recording and then go to different
screens — and it has to run before either renders, or `refreshSetup` hands the panel a
`compiled` it would put the review back up from.

`SetupPanel.mode` is **on the instance, never in `SetupData`** — same rule as `step`,
and the same failure if broken: `refreshSetup` re-renders on every edit, so a mode
derived from the data would throw the user out of the review the first time they
changed a row.

### The setup wizard
"Set up this site" is a **linear wizard**: one step on screen at a time, a
progress rail, and Back / Next. It used to stack five `<details>` sections in one
scroll and auto-open every one holding unresolved rows, so a fresh site opened
onto ~25 rows reading `auto · #first_name` with no ordering and nothing saying
which of them mattered. On a 390px phone that was unreadable.

`src/shared/setupSteps.ts` (pure) owns the model: `SETUP_STEP_ORDER` is the six
steps in the order the extension itself does things — `site` · `prep` · `kind` ·
`info` · `fields` · **`send`** — and `stepStates` says how much work each still
has. It also owns `SetupRow`/`PrepRow`/`SetupSnapshot`, which `setupPanel.ts`
re-exports so the controller and the harness keep one import path.

Five counting rules, each with a test, and every one of them the same decision:
**a healthy site must report no work**, or the chip is noise and the one step
that really is unfinished goes unread with the rest.

- `info`: any row that is not a confident match.
- `fields`: **only the CV**. Detection runs over all fifteen text fields plus
  `resume`, and a field the page does not ask for comes back `'none'` — so a
  posting with four inputs had twelve unmatched rows and nothing wrong with it,
  and this step said "12 to do" on every site in the world. An unmatched (or
  merely `low`, or entirely absent) `resume` row still always counts: an
  application sent without the document attached is the failure the whole surface
  exists to prevent.
- `kind`: **only** a *saved* selector that no longer resolves. "Not set" is the
  ordinary state of a quick-apply site; counting it labelled every site "2 to do".
- `prep`: **never**. A `waitFor` whose target has not appeared yet is the normal
  state of a page whose form is behind a click — that is what the step is for.
  Its *summary* still counts, and counts **all three** of its lists: reading only
  `s.prep` told a site whose page actions are entirely `submitCv` or
  `beforeFollow` that there was "nothing to run", on the step holding them.
- `send`: a Send button found by its *label* is healthy, so only "none found"
  counts; a missing confirmation element **always** counts, because without it
  nothing here can ever be recorded as applied and Apply refuses to send.

`send` is its own step and not the tail of `fields` on purpose. Those two rows
are what Apply depends on, and while they sat below sixteen field rows the
confirmation element went unset on nearly every site — which is exactly what
greys Apply out. **Two rows and nothing else**: the CV-confirmation steps led
this step for a while, which put a prep list above the very rows it exists to
un-bury, under a lead paragraph that describes neither. They are a prep list, so
they belong with the other two on `prep`.

Two steps carry more than one list, and both groupings are the panel's doing
rather than the model's:

- **`prep` is "Page actions"** and holds *all three* prep lists — "Run in order
  before filling", "After attaching the CV" and "Before leaving — run on the
  posting first". They are the same thing (clicks and waits this site needs
  around what the extension does, same `PrepRow`, same `PrepListKey`, same
  `runPrepSteps`) and they were three steps apart, each of the last two the odd
  list out under rows it had nothing to do with — `beforeFollow` beneath the
  redirect selectors of `kind`, `submitCv` above the two rows `send` exists to
  un-bury. **Order is the order they can happen**: the unconditional list, then
  the two mutually exclusive endings — send from this page (confirm the file,
  then Apply presses Send) or hand off to the employer. Only the first gets a
  `Run steps ▶`, and neither of the others can have one: the CV steps act on a
  half-sent application, and running the before-leaving list ends by navigating
  away from the posting. The title is not "Before filling" any more because that
  named one of the three, and not "Setup steps" because "Step 2 of 6: Setup
  steps" stutters.
- **`kind` groups its redirect rows by the verdict each argues for**
  (`REDIRECT_GROUPS` in `setupPanel.ts`): Quick-apply marker under one head,
  External marker + External apply link under the other. Those last two are one
  answer between them — "this posting applies elsewhere, and here is what to
  press" — and neither is any use alone. **Quick apply leads**: it is the ordinary
  case, and the only group a site that never hands off has anything to fill in —
  and since an empty group draws no heading, leading with External opened the
  commonest site onto a section about the thing it does not do. The group's key
  order wins over `REDIRECT_ROWS`', and a key in no group renders under a trailing
  "Other" head rather than silently not rendering.

  **The live verdict leads the group it argues for**, which is what each group's
  `kinds` is: quick-apply *and* `unknown` under the first head (an assumed posting
  is treated as quick apply — "(assumed)" is the whole difference), `redirect`
  under the second. It is drawn as the modal's flow banner, `warn` with the `!`
  when the classifier is guessing and `ok` otherwise — the step's one conclusion
  was a `--text-sm` caption in a plain box carrying no status mark at all, quieter
  than the rows that led to it, and floating above both headings it was about
  nothing in particular. `SetupVerdict` is `{ title, detail, kind }` for that:
  the banner is a title and a line under it, and `kind` decides both the tone and
  the group. A group with no rows draws no heading and must not take the verdict
  down with it, so an unplaced banner falls back to the top of the step.

Four rules the panel enforces:

- **The step lives on the `SetupPanel` instance, never in `SetupData`.**
  `refreshSetup` re-renders after every Pick, prep edit and rename, so a step
  derived from the data would throw the user back to step 1 each time they picked
  a single field. An E2E asserts it across a real storage round-trip.
- **Where it opens is decided once** (`placed`), never re-derived: a first-time
  user (`!helpSeen`) walks from step 1 with the legend; anyone else lands on
  `firstStepWithWork`, which is what the old auto-opening sections were reaching
  for. Re-deriving it would teleport the user mid-task as they resolved the last
  row of a step.
- **Each step leads with its own `SETUP_STEP_HELP[key].body`, shown.** That prose
  already existed and lived behind a `?` nobody pressed; with one step on screen
  there is finally room for it. The row-by-row `rows` stay behind the `?` — they
  are a reference, not an introduction. The intro sentence and the legend are
  about the *panel* rather than about step 1, so they still lead the step's own
  prose — they just no longer lead the card.
- **The rail is the first thing in `.cf-body`, on every step.** The intro and the
  legend render on step 1 only, so ahead of the rail they moved it ~200px between
  step 1 and step 2, and moved it again whenever the legend's `<details>` was
  opened — under the finger that had just opened it. The one element whose whole
  job is to be in a fixed place cannot sit behind two that come and go.

The rail carries **two marks per step**, because there are two questions. The
step's own icon (`SETUP_STEP_ICONS`, `Record<SetupStepKey, string>` → an
`--icon-step-*` token) says *which* step it is; the `.cf-dot` under it says how
that step is doing. The icon cannot be swapped *into* the dot — the dot's
check/alert/dash is the shape half of "status is never colour alone" — so it goes
above, and `--rail-dot-center` is what keeps the connector running through the
dots rather than through the middle of a now two-element node. Icons are picked
for contrasting *silhouettes* (round · diagonal · Y · sheet · bars · plane): six
marks at 18px are told apart by outline first, and a set that is all rectangles
is the same failure as the six identical dots this replaced.
`designSystem.test.ts` fails the build if a step's token does not exist or two
steps share one; the `Record<>` already fails `npm run typecheck` if a seventh
step ships unmarked. The icon is `aria-hidden`: each node is a button whose
`aria-label` already names the step and its outstanding work. There is no
separate index screen, so the rail is also how someone who opened the panel to
re-pick one field gets there without six taps of Next.

### One slot, two sheets
`src/content/sheet.ts` (`abstract class Sheet<D extends SheetData>`) is the shell
behind **both** shadow surfaces: `FillerModal` and `SetupPanel` subclass it and
supply only `buildCard`/`buildPill`/`repaint`. Mount, `applyLayout`, drag, the
three resize grips, fullscreen, collapse-to-pill and `destroy` all live there once.

**A repaint must not lose the user's place.** `paint` replaces the whole
`.cf-card`, which is how these surfaces show any change at all — so without
`captureUserPlace`/`applyUserPlace` every edit also scrolled to the top, dropped
focus and wiped anything typed but not committed. Picking the 14th of sixteen
field rows put you back at the first one. Four rules, each with a test:

- **Identity is `data-k`, stamped by the subclass** on what a control *is*
  (`field:email`, `prep:prep:2:ms`), never on where it sits — position is exactly
  what a rebuild changes. A key that no longer resolves restores nothing and is
  not an error: the edit being rendered may have deleted that row.
- **Scroll is restored after `applyLayout()`**, never before. The card is sized
  there, and a `scrollTop` written to an element with no height yet clamps to 0.
- **`setHidden` captures and restores too.** `display: none` destroys the layout
  box and the scroll offset with it, and the picker's sequence is hide → pick →
  show → `refreshSetup` — only the hide happens early enough to read the real
  number. A capture while hidden is skipped, or it would overwrite a good one
  with zeroes.
- **Uncommitted text comes back for the focused control only.** These inputs
  commit on `change`, i.e. on blur. Writing a remembered value into an *unfocused*
  field would be the opposite bug — stale data beating the fresh config read that
  `refreshSetup` exists to make. (`selectionStart` throws on `type="number"`,
  which the prep timeouts are; the caret is a nicety and must not cost the value.)

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
`×` **minimizes**, footer **Done** destroys (`closeSetup`) — and Done is now the
*last step's* Next, because finishing the wizard and finishing with the site are
the same act. `nudgeLayout` moved from
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
built once and only ever shown or hidden — they are rewritten on every
`pointermove`, and rebuilding six elements a frame is not free — but they **flow**
rather than holding six reserved cells: `.sim-limits` reserves exactly one chip's
height, which is all that was needed, because 0→1 is the only transition that can
shift the buttons below and six chips cannot reach a second line in an 820px
panel. Reserving all six bought a still block at the price of a permanently empty
two-row band on a panel that is usually showing no limits at all.
`layoutLimits`/`describeLimits`/`activeLimits` say which edges have
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

`STATUS_RANK` names how far through the flow each status is. It exists because
two callers needed it for different reasons: `linkRedirect` must not demote a
posting by re-visiting it (it used to spell that as two inline
`!== 'applied'` checks, which silently *did* demote a skipped one), and the sync
merge needs a deterministic tie-break. Both now go through `promote()`.

### Syncing the job database
Two browser profiles on different Google accounts, one database. **Only the job
database** — `jobUrls` and `jobDetails`. The profile, the CV, the site configs and
every other setting are device state: `modalLayout` alone settles it, being a
rectangle measured against *one* screen (`sampleScreen`), so replicating it is
the stranding `clampLayout` exists to undo.

`src/shared/syncJobs.ts` (pure) is the whole correctness story. Two devices write
with nobody arbitrating, so `mergeJobs` is **commutative, associative and
idempotent** — asserted directly in `syncJobs.test.ts`, not just implied. That is
also what makes the compare-and-swap retry safe: a lost race is repaired by
merging again. It is bought by making every rule a *join*:

- **`history` is set-unioned and `status` is *derived* from it** (newest event
  wins; same-millisecond ties by `STATUS_RANK`). The obvious rule — "the stronger
  status wins" — reads well and is wrong: rank is monotonic, so a posting could
  never be **un-skipped**, and every later sync would silently re-skip it. A union
  of events also needs no special case for a manual edit; a correction is just a
  later event.
- `jobDetails` reuses `captureDetails`' rule: an empty capture never overwrites a
  populated one.
- Conflicts tie-break **symmetrically** (newest, then a stable content key).
  "The left-hand side wins" would quietly destroy commutativity, and the bug shows
  only as two devices disagreeing forever.

Three things that follow, each with a test:

- **Deletion is a `'deleted'` log event, never a splice** (`deleteUrl`). A union
  can only grow, so a spliced entry returns on the next sync — the delete appears
  to work and then undoes itself. That includes Options' Clear button, which
  tombstones every entry rather than writing `[]`. `visibleUrls` hides them;
  `pruneTombstones` forgets them after 90 days, at the storage edge rather than in
  the merge (it depends on `now`, and a merge that changed with the clock could
  not be idempotent).
- **The wire format *is* the storage format** — `JobUrlEntry[]` and
  `JobDetailsMap` verbatim, plus a `schema`. No mapping layer to drift, and the
  round-trip is lossless by construction. Contrast `jobExport.ts`, which flattens
  and reformats for a human and is therefore unusable here.
- **Forward compatibility is a one-shot decision.** `JobLogStatus` is
  deliberately open (`| (string & {})`), inbound entries go through
  `normalizeEntry`, and unknown fields are preserved by spreading both sides.
  Tolerance lives in the *older* build, which is frozen once installed — so an
  unrecognised status is carried through the log untouched rather than validated
  away. `parseSnapshot` refuses an unknown `schema` outright: merging is
  all-or-nothing, so a stale peer can be *blocked* but must never corrupt.

`src/background/` — `googleAuth.ts` uses `launchWebAuthFlow` + PKCE, **not
`getAuthToken`**, and that is the feature: `getAuthToken` returns a token for
whatever account the *browser profile* is signed into, so two profiles would get
two separate Drives and nothing would ever sync. The chooser is how the same
account gets picked twice. `drive.ts` keeps one `jobs.json` in `appDataFolder`
(hidden, `drive.appdata` scope only) and **compare-and-swaps every write** —
without it two simultaneous syncs both read version N and the second erases the
first. `sync.ts` serializes runs through a promise chain, like `session.ts`.

The UI is its own **tab**, not a section under Settings: it has a connected
account to report, and below the layout simulator it sat a screen and a half past
anything anyone was looking for. Triggers are the **Sync now** button and
`chrome.runtime.onStartup` only — hence no `alarms` permission.

**The OAuth client is the user's, entered in Options → Sync**, not a build-time
constant — a Google Cloud project is per-person, and as two constants an
installed build could only ever tell its user to go and edit a source file they
may not have. `syncConfig.ts` holds it in `chrome.storage.local` under
`syncClient` (device state; never in the snapshot), and the steps for creating
one are in `CONCEPT_HELP.syncClient`, behind the section's `?`, because it is a
thing the extension explains to the person doing it. Three rules there:

- **`googleAuth` reads the client on every call**, never at load — the worker
  outlives the options page, and a client pasted a minute ago has to be the one
  the next Connect uses.
- **Changing the client id drops the tokens** (`setSyncClient` → `disconnect`).
  A refresh token belongs to the client that issued it, so keeping it leaves the
  account line naming an account no token can be got for — connected, and
  failing at every sync.
- **The redirect URI is shown and copyable in the panel**, because it is derived
  from *this* browser's extension ID and so cannot be printed in the help text.
  Each browser's has to be added to the client; a manifest `key` pins the ID to
  one string instead, but adding both URIs works without it.

Until a client is entered, Connect is disabled and says so, and the backup file
still moves the database by hand.

### The archive (captured postings + export)
`extractJob` ran for the modal alone and threw its result away every re-render,
so a posting became unreadable the moment its tab closed. `jobDetails.ts` (pure)
keeps it: `Controller.captureJob` writes what the page said — title, description,
requirements, chips — for **every** posting the extension reads, applied or
skipped, and Options → Queue → **Archive** exports them as one file
(`jobExport.ts`).

**What goes in that file is ticked, not fixed** — the columns, the statuses and
JSON vs CSV, in the Archive panel's "What to export". Two rules make that
survive the schema growing, and both are the same decision:

- **The choice is stored as sparse *overrides*, never as the list of what to
  include** (`ExportSelection` → `resolveExport`). A stored list of columns would
  silently omit any column a later build adds, for everyone who had ever opened
  the panel; a map of decisions lets an unmentioned key take its coded default
  (a column is on, a status is off unless it is `applied`). Same forward
  compatibility as `normalizeEntry`, and an unknown key is ignored rather than
  validated away.
- **The checkboxes are rendered from the model, never written into
  `options.html`**: the columns walk `EXPORT_FIELD_LABELS`
  (`Record<ExportField, string>`, and `ExportField` is `keyof ExportedJob`, so a
  new field fails `npm run typecheck` until it is named — and naming it is all it
  takes to get a checkbox), the statuses walk `ALL_JOB_STATUSES`, which is
  *derived* from `STATUS_RANK` for the same reason. `EXPORT_FIELD_LABELS` is also
  the column **order**, so there is one list rather than two.

The edits are serialized through a promise chain (`session.ts`'s trick): each
tick is a read-modify-write of one settings object, and ticking columns off is
exactly the gesture people repeat quickly. A selection with no columns — or no
statuses — disables Export and says which tick is missing, rather than
downloading a file of empty objects. `?page=options&state=export` in the dev
harness opens the panel, which is otherwise behind a closed `<details>` and so
invisible to a screenshot.

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
- **Sync carries the job database and nothing else.** Never widen the snapshot to
  the profile, the CV, the site configs or `settings` — see the sync section
  above. `Omit`ing them is not the guard; the snapshot type simply has two fields.
- **Never make the sync merge depend on `now`, or on which argument came first.**
  Both break the properties two-way sync rests on. Pruning belongs at the storage
  edge, tie-breaks must be symmetric.
- **Only a refusal from Google throws the refresh token away.** `accessToken()`
  disconnects on `SyncAuthRevokedError` — `invalid_grant`/`invalid_client`, i.e.
  a grant that will never work again — and on nothing else. An unconditional
  `catch` there is the same bug twice over: `postToken` also throws when the
  machine is offline or a proxy answers with an HTML 502 (which is why it reads
  the body as *text* and parses defensively, rather than `res.json()` on the way
  past), and `syncOnStartup` runs on `chrome.runtime.onStartup` — precisely when
  a resuming laptop has no network. Disconnecting there costs a full trip
  through the consent screen to repair nothing.
- **Upload what `applySnapshot` stored, not what `mergeJobs` returned.** It
  returns the pruned snapshot for exactly this reason: writing the unpruned
  merge back meant the remote `jobs.json` never shed a tombstone or an orphaned
  capture and grew for the life of the account, carrying job text for postings
  that no longer exist. Both ends hold the same answer when a sync returns.
- **The file's write token is `version`, and there is no other.** Drive v3
  dropped resource etags; an `If-Match` built from the *list* response describes
  the query, not the file, and honouring it would 412 every write on a single
  device. `If-Match: '*'` ("as long as it still exists") is all that header may
  ever say here. Relatedly, `authed()` retries once on 401 with a forced
  refresh: expiry is judged on this machine's clock alone, so Drive is the only
  thing that knows a token has really died.
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
  fields empty — *unless* the posting is already applied, which is the one thing
  it does refuse (below).
- **Applied is a lock, and it is read from storage.** `Controller.applied` only
  ever meant "a confirmation appeared during this page-load", so the `applied`
  record was write-only from the page's point of view and re-opening a posting
  handed the user a live Apply that would press Send a second time.
  `readAppliedRecord` fixes that from `statusForUrl(state.jobUrls, location.href)`
  — no new message and no new key, because `getState()` was already fetching
  `jobUrls` on every run and discarding them. It is re-read **per run**, so a
  status corrected in Options → Queue reaches the card that Re-run rebuilds. Three
  guards enforce it, and the UI is deliberately not one of them: `apply()` and
  `skipPosting()` return early, and `shouldFollow()` declines — otherwise a
  re-visited two-step posting re-opens the employer's form, and under the default
  `newTabCloseSource` closes the posting the user just opened. No `sourceUrl` walk
  is needed: `applyStatusChain` already marks both ends of a chain.
- **Skip must never run on an applied posting**, and not for tidiness: it ends in
  `recordStatus` → `applyStatus`, which is a blunt overwrite rather than a
  `promote()`, so it files `skipped` over `applied` (rank 4 → 3) and appends that
  to the history — which the sync merge derives status from, carrying the loss to
  the other device. So the modal retires Skip beside Apply on **both** applied
  states, using the same `aria-disabled` + swapped-`onclick` convention as the
  blocked Apply (never the `disabled` property — it swallows the press that asks
  why the control is grey).
- **The footer's applied branch comes before its redirect branch.** It has to:
  `shouldFollow` now declines an applied handoff, so a two-step posting opened
  again arrives with `redirect` *and* `alreadyApplied` set, and the other order put
  a live "Open application" primary on a job already applied for. `Open
  application` moves into the `⋯` there, and only when there is a redirect to
  open. This is also what makes the footer agree with `flowState.classify`, which
  had always ordered the two this way.
- **The submit heuristic must fail closed.** `findSubmitControl` returns `none`
  rather than a best guess, and its veto list beats any positive match. Never
  "improve" it by falling back to the highest-scoring button.
- **Only ever hand `http(s)` to the browser.** `shared/appLink.ts` is an
  **allowlist** and `navigableUrl` is the one place `settings.keepInBrowser` is
  read; `resolveHref`, `followRedirect` and `session.ts`'s two opens all go
  through it. Never re-widen it to a blocklist: an `intent://` or `linkedin://`
  apply link is a valid URL with a host, so under the old blocklist it read as
  cross-origin, was nominated as the page's one external apply link, and was
  handed to `chrome.tabs.create` — which on Android launches the app. That is
  always a dead end (no form to fill, no `successSelector` to watch), so the watch
  expired and the posting stayed `opened` for ever. An `intent://` link is
  rewritten to its `browser_fallback_url` — re-checked through `webOnly`, never
  trusted because of the key it arrived under — and one with no web form sets
  `detection.appLink`, which blocks the follow and words the banner. Two handoffs
  are out of reach and belong in `CONCEPT_HELP.appLink`, not in code: an `https`
  link an installed app has claimed (Android resolves it first) and a page that
  navigates itself from the main world. `declarativeNetRequest` cannot help —
  it matches http/https/ws only — so do not add it or `webNavigation`.
- **Every stored selector comes out of `pickSelector`, and every candidate it
  returns is verified.** `shared/selector.ts` is a ranked ladder — id · name · test
  id · aria-label · text · semantic attribute · class · scoped · path — and a rung
  only wins if it resolves to exactly one element *and* that element is the one it
  was given. The old four-rung version checked uniqueness on rungs 1-3 and not on the
  structural fallback, which therefore could and did match two elements silently.
  Two rules keep the bottom rung honest: a path is **anchored** at the nearest
  ancestor that can name itself (`anchorFor`, ≤6 up) and **capped** at `MAX_TAIL`
  hops from it, so `html > body > div > div:nth-of-type(2) > …` is no longer what a
  hashed-class SPA produces; and `isStableClass` rejects generated names (a
  CSS-modules suffix is told from a BEM word by the digit in it) as well as state and
  layout words, which are real words that are on half the page. `SelectorPick` also
  carries a `strength`, which is what the recorder's review draws as a dot — "it
  worked when I picked it" and "it will work next month" are different claims.
- **Selectors are resolved in exactly one place, `shared/query.ts`.** Six copies of
  the same guarded `querySelector` had grown across `content/` and `shared/`, and
  `prep.ts` had none at all — so one malformed saved selector threw out of `runStep`
  and aborted a whole prep list. That resolver also understands one extension to CSS,
  `button:-cf-text("Apply now")`, kept to elements whose collapsed text *equals* the
  literal. CSS cannot say "the button labelled Apply now", and on a board with no
  ids, hashed classes and a re-render between visits that label is the only durable
  handle there is. It is **terminal-only and at most one per selector** — which is
  what keeps the resolver a `split` rather than a parser, and costs nothing because
  `pickSelector` only ever emits it last. A selector breaking that rule resolves to
  *nothing*, never to a guess: the elements this names are the ones that send an
  application.
- **Never read a job container with `textContent`.** It welds every heading,
  paragraph and bullet into one string and preserves the HTML source's own
  indentation, which is what made the description unreadable. `shared/jobText.ts`
  walks it into blocks instead — and drops `form`/`nav`/`aside`/`footer`, because
  the broad `jobDescription` fallbacks (`main`, `article`, `[class*="content"]`)
  otherwise quote the application form and the decoy sidebar back at the user.
- **Closing the review modal must never destroy it.** `onClose` minimizes to the
  pill (`FillerModal.minimize`); destroying it left "Reset & Re-run" as the only
  way back, which wipes every field just filled.
- **The picker never commits on a click, on any pointer.** A click *selects* and
  Confirm saves — one flow, no `pointerType` branch. It used to commit outright on
  a mouse, which wrote a selector into the site config off a stray press with
  nothing in between; touch already had the safer half of this, for the reason
  that turns out to hold everywhere: what is under the pointer is not what the
  user checked.
- **A point gives a run of elements, not one.** `document.elementFromPoint` hands
  back a single node and it is routinely not the one meant — the description is
  the `<div>` around the `<span>` you can see, and the Send button is the
  `<button>` around the `<span>` the click lands on. `shared/elementChain.ts` is
  the pure half: the hit-test stack, **outermost first**, with `<html>`/`<body>`
  and everything the extension drew removed, capped at `MAX_CHAIN` above the
  innermost. Clicking the same spot again steps one level *in* and wraps; Wider /
  Deeper and the arrow keys walk it both ways. It reads outermost-first because
  the outer element is usually the one that can name itself and the inner one is
  usually an unnamed `<span>` — which is also why the toolbar reads back
  `describeElement` plus the `pickSelector` strength for the current step: the
  choice being made is which depth gives a handle that still resolves next month.
  **A wrapper drawing the same box as its child is dropped**, because that click
  moves nothing on screen and reads as the picker being broken.
- **The picker's chrome is created once and repainted, never rebuilt.**
  `recorder.ts` stands down on `[data-cf-picker]` being in the DOM, and a pick is
  several gestures long now — a marker that came and went between them would have
  the recorder logging the user aiming at the confirmation banner as a step in the
  application. For the same reason the capture-phase suppression covers
  `pointerdown`/`mousedown`/`mouseup`/`dblclick`/`contextmenu` and not just
  `click`: a site that acts on `mousedown` would otherwise act once per step.
- **The recorder bar's clock must never repaint the bar.** Its ticker writes
  `.cf-rec-clock`'s text and nothing else (`RecorderBar.tick`). It used to call
  `paint()`, which removes and rebuilds `.cf-bar` — including the open Declare
  menu, a `60vh` scrolling list of ~28 marks that deliberately survives a repaint
  (`this.menu` is on the instance). So reaching a profile field, or the
  description, was a race against a one-second timer, and any focused item in it
  was destroyed just as often. The clock is `aria-hidden` for the other half of
  the same fact: it sits in the bar's one `role="status"` region, which would
  otherwise re-announce every second. `paint()` still rebuilds on a real state
  change, and carries the menu's `scrollTop` across — same rule as the sheets'
  `captureUserPlace`, restore included, *after* the bar is in the document.
- **Every mark the extension draws on the host page carries an `OWN_SELECTOR`
  attribute and contains no form control.** `fieldTags.ts`'s chips are in the page's
  own light DOM, so without `TAG_ATTR` in `extensionUi.ts` they are pickable by
  `elementChain`, recordable as steps, and — if one ever wrapped an `<input>` —
  detectable as a field. `pointer-events: none` is the belt, not the braces.
- **A label-less `highlight` re-colours an existing chip; it must never remove one.**
  `confirmField` re-colours a field's outline after a Confirm and passes no label,
  because nothing has been renamed. Removing the chip there unnames the one field the
  user has just acted on; leaving the stripe alone leaves a yellow chip on a green
  mark. `retintTag` is the whole of it.
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

**Wait for `document.body.dataset.ready` before writing storage under an options
page.** `main()` ends by setting it; `load` fires long before, while the boot is
still awaiting — and the last thing it does is `pruneDetails`, a read-modify-write
of the capture map. A spec that seeds storage the instant the page loads is
racing that write and loses to a snapshot taken before the seed existed, which is
how the archive spec failed intermittently and only in a full serial run.
`onExtensionPage` waits for it, so anything going through that helper is already
safe. Nothing a user does has this shape — it is an artifact of writing storage
beneath a page that is still starting up.
