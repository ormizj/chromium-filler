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
`redirect-followed`, `app-link`, `landed`, `empty`, `failed-fill`, `apply-unset`,
`apply-unverified`, `applied`, `flush`, `fullscreen`; setup: `external`, `help`,
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
`flowBanner()` returns `{ key, tone, title, detail, help? }` for one of eight
states: `applied` · `appLink` · `external` / `externalOpened` · `noButton` /
`noConfirmation` · `empty` · `ready`.

It exists because the modal used to say none of this. Three unrelated renderings
— an applied banner, a redirect notice, and an explanation of the greyed-out
Apply that only appeared *after* the user pressed it — between them still left
the commonest case silent: a posting filled and waiting showed a job advert and a
coral button with nothing connecting them.

Four rules the branch order encodes, each with a test:
- **`applied` outranks everything**, including a two-step posting and a blocked
  Apply — neither can still be the answer once something went through.
- **`appLink` outranks the redirect states.** A *configured* two-step site whose
  apply link turns out to be an app link is both at once, and "Opening the
  employer's application" would be a lie — nothing was opened. `main.ts` enforces
  the same thing from the other end by not setting `redirect` at all when
  `detection.appLink` is present: the footer's redirect branch leads with "Open
  application", and there is nothing here to open.
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

The footer's **overflow (`⋯`) carries the three ways out of a posting** —
`Site setup` · `Add links` · `Open options` — appended by `commonMenuItems()` to
all three of the footer's branches, so they are there whether the posting is
quick-apply, two-step, or already sent. Without them the card was a dead end: a
site that filled the wrong field could only be fixed by closing the modal
(losing the report), opening the toolbar popup, and finding Site setup there.
Setup is a **direct call**, not a message — the panel is in the same content
script, and `openSetup` already folds the review card through `arbitrateSheets`.
**Choosing any item closes the menu**: Re-run and Reset rebuild the card and took
it with them, so this never showed, but two of the three open another tab and
leave this one exactly as it was.

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
  progress; options is six tabs (Queue · Profile · Settings · Sites · Sync ·
  Help) managing the job queue, profile, CV, behavior settings, site configs and
  the job-database sync. Adding a tab is `'name'` in `TABS` plus a button and a
  panel following the `tab-`/`panel-` id convention — deep-linking comes free.
  At ≤640px the strip **wraps** (`options.css`): six tabs are 401px wide on a
  390px screen, and `overflow-x: auto` with a hidden scrollbar hides the last two
  with nothing saying to swipe. The cost, paid only on narrow, is that an active
  tab on the first row no longer sits on the panel.

The popup's actions are **two rows in fixed proportions, and nothing in them is
ever hidden**: Fill (75%) · Queue (25%), then Site setup (50%) · Options (50%).
Site setup used to hide on an unconfigured site and Queue whenever a session was
running, so the popup was a different shape every time it opened — and the
control you wanted was missing exactly when the page was in the state you wanted
it for. Where a control is is half of knowing it exists. **Queue deep-links to
the URL importer**, not to the options page's default tab: the queue *is* the
links, and as a bare `OPEN_OPTIONS` it was indistinguishable from the Options
button beside it.

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
control runs through the middle of a text block. The setup wizard's step header
is a fixed order (`Step n of 6` `flex: 1` · count chip · `?`) above the title, so
the `?` never sits inside the heading and lands in the same place on all six
steps.

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

**`FIELD_ORDER` and `orderFields` (`fieldKeys.ts`) decide what order fields are
read in**: the CV, the cover letter, then contact details, then the rest —
and, within that, everything the user actually filled in before everything they
did not. It is applied to the **output** of detection, never to its input:
`detectFields` uses its `fields` argument as the tie-break between two fields
scoring equally on one control, so reordering the input would quietly change
which control a field claims. Both the modal's report and the wizard's step 5
sort through it; Options → Profile renders in the same order but *without* the
filled-first half, because a form that reshuffles as you type is worse than one
with a fixed order. Before this the report was ordered by nothing better than the
order the profile happened to be typed in, with the CV always last.

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

Four counting rules, each with a test, and every one of them the same decision:
**a healthy site must report no work**, or the chip is noise and the one step
that really is unfinished goes unread with the rest.

- `info` / `fields`: any row that is not a confident match.
- `kind`: **only** a *saved* selector that no longer resolves. "Not set" is the
  ordinary state of a quick-apply site; counting it labelled every site "2 to do".
- `prep`: **never**. A `waitFor` whose target has not appeared yet is the normal
  state of a page whose form is behind a click — that is what the step is for.
- `send`: a Send button found by its *label* is healthy, so only "none found"
  counts; a missing confirmation element **always** counts, because without it
  nothing here can ever be recorded as applied and Apply refuses to send.

`send` is its own step and not the tail of `fields` on purpose. Those three rows
are what Apply depends on, and while they sat below sixteen field rows the
confirmation element went unset on nearly every site — which is exactly what
greys Apply out.

Three rules the panel enforces:

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
  about the *panel*, so they lead step 1 above the rail, not inside it.

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

**Wait for `document.body.dataset.ready` before writing storage under an options
page.** `main()` ends by setting it; `load` fires long before, while the boot is
still awaiting — and the last thing it does is `pruneDetails`, a read-modify-write
of the capture map. A spec that seeds storage the instant the page loads is
racing that write and loses to a snapshot taken before the seed existed, which is
how the archive spec failed intermittently and only in a full serial run.
`onExtensionPage` waits for it, so anything going through that helper is already
safe. Nothing a user does has this shape — it is an artifact of writing storage
beneath a page that is still starting up.
