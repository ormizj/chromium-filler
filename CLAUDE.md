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
npm run package          # both release zips at the current version
npm run package -- 0.1.2 # bump every version-carrying file (no downgrades), then package
```

### UI validation

`.mcp.json` registers the Playwright MCP server with `--caps=vision`, for driving
a real browser and inspecting rendered UI from a screenshot rather than from the
DOM. It is the tool of choice for the responsive surfaces — the review card, the
queue chip and the Options profile at phone width — because most of what can go
wrong there (a crushed row, an unreachable control) is invisible to a DOM
assertion. New MCP servers load on Claude Code restart.

For UI work also start `npm run dev` and open `http://localhost:5173/dev/`, which
renders every surface against a mocked `chrome.*`, including a **390px phone
frame**. `dev/frame.html?page=…` takes `popup`, `options`, `modal`, `chip` and
`picker`. The mock's seed is versioned (`full-v2` in `dev/mock-chrome.ts`): bump it
whenever its shape changes, or a browser that ran the harness before keeps the old
store.

- **`page=modal`** renders the real review card over a fake posting.
  `&state=` picks the rendering: `long`, `flush`, `fullscreen`, `failed-fill`,
  `confirmed`, `taught`, `appeared-later`, `already-applied`, `nothing`, `empty`,
  `bare`, `pill-only`. `&teach=<n>` opens the Teach chooser on row n (and `&new=1`
  with it opens "New field…"); `&queue=1` (or `&session=1`) makes it a queue tab;
  `&view=job|fields` picks the view. Most of these are reachable on a real page
  only by pressing something, which a screenshot cannot do.
- **`page=chip`** is the queue chip beside the card's folded pill — the two marks
  the extension leaves on a queue tab. `&open=1` expands the card (on a phone the
  chip then hides).
- **`page=options`** takes `&state=profile|custom-fields|wordings|learned` (the
  Profile tab's sections, via the same `#tab&at=` deep links the extension uses),
  `export`, `sync-guide`, and `fresh` (an empty store — the getting-started
  checklist).
- **`page=picker`** runs the real click-to-pick toolbar over a deliberately
  nested posting; `&label=` names what it says it is picking, `&state=long`
  previews a full-length description.

Add a state whenever a surface gains a distinct rendering — **and link it from
`dev/index.html`**, or it is a state nobody looks at.

E2E loads the built extension into real Chromium (`npx playwright install chromium`
once). Always `npm run build` before `npm run test:e2e` — the suite loads `dist/`.

## Architecture

MV3 Chrome extension that fills job-application forms — **on every site, with no
per-site setup, and it never submits anything**. The user presses the site's own
submit button; the extension's job ends at a filled, reviewed form.

It used to be much more: per-site configs, a recorder and a six-step setup wizard,
prep clicks, two-step redirect following, and an Apply that pressed the site's
Send button and watched for a confirmation. All of that is gone (October 2026):
real sites have too much custom logic for the automation to pay for itself. What
stayed is the fill, the queue, the archive and the sync. Do not reintroduce
submit automation or per-site configs.

### How a page is filled

1. **The content script runs everywhere** (`<all_urls>`, `document_idle`).
   `Controller` (`src/content/main.ts`) loads the profile, the lessons, the
   settings and the two documents, asks the background whether the queue opened
   this tab (`MSG.QUEUE_TAB`), and — unless `settings.fillAutomatically` is off —
   starts the engine.
2. **The engine** (`src/content/fillEngine.ts`) sweeps the page: collect the
   candidate inputs, classify the ones not seen before, fill the confident empty
   ones, add a report row for each. A DOM-only `watchPageChange` (400ms settle,
   no scroll/resize) re-sweeps as the page changes, so the form behind "Apply now"
   and step 2 of a wizard are filled as they appear. It pauses while the tab is
   hidden and stands down after ten idle minutes.
3. **The card** (`src/content/modal/modal.ts`) shows the report. Off the queue it
   appears only as a folded pill, and only when something was filled; on a queue
   tab it opens expanded (`settings.openCardOnQueueTabs`).

### What is a candidate, and what never is
`collectCandidates` (`src/content/fieldDetect.ts`): text-like inputs, textareas,
single selects, radio *groups* (one candidate per group), lone checkboxes, file
inputs (even hidden — the real control behind a styled "Upload CV"), and
`contenteditable` roots. Never: password, search, hidden, submit/button types,
multi-selects, a group of checkboxes (a multiple choice one value cannot answer),
disabled/read-only inputs, anything with a `cc-*`, password, `one-time-code` or
`username` autocomplete token, **anything inside a form that has a password box**
(login, sign-up) or inside `role="search"`, and our own UI (`isExtensionUi`).
The engine runs on every site, so this list is what keeps it out of forms that are
none of its business — the E2E `login.html` fixture holds it.

### Classifying an input
`classify` decides each fresh candidate, in order of authority:

1. **A lesson** (`lessonFor`, `shared/inputSignature.ts`) — the user's own word
   about this exact input. An `ignore` lesson takes the input out of the report.
2. **Heuristics and keywords, scored together.** The built-in `FIELD_KEYWORDS`/
   `AUTOCOMPLETE_MAP` tables over id, name, label, aria-label, placeholder and the
   question text; plus `keywordMatch` (`shared/profileFields.ts`): a custom field's
   label and keywords, or the extra wordings the user gave a built-in, matched as
   **whole phrases** of the fingerprinted question, at weight 8 (beats every guess
   but autocomplete). Greedy, one input per field per page; a field already
   holding a live input from an earlier sweep cannot be claimed again.
3. **Uploads**: every *named* file input is claimed first; only then may `resume`
   fall back to an unlabelled one (at `low`). The cover letter never falls back.

Weight ≥ 5 is `high` and is filled; below is `low` — reported, never filled. The
"text written above the box" source is weight 4 on purpose: it is loose ("Tell us
about your first project" says "first").

### Question text and signatures
`shared/questionText.ts` reads what an input asks, in order: `<label>`,
`aria-labelledby`, `aria-label`, a radio group's `<legend>` (or `role=radiogroup`
name), the nearest preceding text block in its container (stopping at the first
sibling that holds another control — that text belongs to another field), then
`placeholder`, then `title`. `fingerprint` normalizes it (diacritics, punctuation,
"*", "(optional)", leading filler like "please enter your"). `sectionText` is the
enclosing legend or the nearest heading above.

**A lesson must name exactly one input**, because a lesson is global and wording
alone collides ("Name" for you and for a referee). `uniqueSignature` starts from
`{question, kind}` and adds `name` (only if it looks stable), then `section`, then
`options` until exactly one input on the teaching page matches; failing that it
stores `index`. An input with no words and no usable name is pinned to its `host`
— a global lesson on "an unlabelled box" would match one on every site. On any
later page a lesson matches only when **every stored part is equal**; the more
specific of two matching lessons wins; and a lesson that still matches two inputs
fills **neither** (`'ambiguous'`). Exact matching only — never fuzzy: a wrong value
in an employer's form is worse than a blank one.

### The report
One row per **input** (`FieldMatch`): `question`, `kind`, `field?` (absent = to
teach), `source` (`lesson`/`heuristic`/`keyword`/`none`), `confidence`, `filled`,
`kept` (left alone because it already held an answer), `taught`, `ignored`,
`later`. `matchStatus` makes `filled`/`kept`/`ignored` green.

**The report holds still.** Rows are banded once, at the first sweep (to teach,
then to check, then filled); inputs that arrive later are appended under an
"Appeared later" head. A row's status may change *in place* — Confirm and Teach
fill it — but no row ever moves under the finger working the list.

**Never write over an answer.** The engine fills only inputs where `hasValue` is
false (a select whose selected option is a prompt counts as empty), and marks an
input the user has typed in (a *trusted* `input`/`change` — our own fills dispatch
untrusted events) as never to be written again. `reconsider()` (on a profile or
lesson change, or a Teach) re-classifies only rows still open and untouched.
Confirm and Teach are the user asking, so they write regardless.

On the page: recognised inputs get an outline; **unrecognised ones get none** (on
every site that would be a ring round every search box); name chips are drawn
only where the user is working (`showLabels`: a queue tab, or after Fill/Teach).

### Teaching
On the card, a to-teach row has **Teach**; a matched row has **Not this** (plus
Confirm on a low guess with a value). Both open the same inline chooser under the
row (`.cf-teach`, never a popover — it has to work at 390px): a `<select>` grouped
"Your details" / "Your own fields" / "Something else" (`New field…`, `Ignore this
question`). `Controller.teach` creates the new field if asked, builds the
signature against `engine.allCandidates()`, stores the lesson (`shared/lessons.ts`
— one lesson per signature; teaching again replaces), and `engine.applyTeaching`
fills the row in place. The popup's **Teach** and the card's ⋯ → "Point at a field"
start the picker for an input no sweep listed; Confirm there opens the card on that
input's chooser (`engine.rowForElement` adds a row for it).

Lessons and custom fields are **device state, never synced** — same as the profile.
Options → Profile lists them: "Your own fields" (cards: name, kind, answer,
"Answers questions like" chips), "Other ways sites ask for these" (extra wordings
for the built-ins, behind a disclosure), and "What it has learned" (lessons by
field, with Forget; `index`/`host` lessons are flagged).

### The card
`FillerModal` extends `Sheet`. Two views behind a header toggle: **Fields** (the
default off the queue) and **Job** (the default on a queue tab — the posting,
read by `extract.ts` from generic containers and JSON-LD). Footer: `Fill again`
(sweep again, never over an answer), on a queue tab `Skip → next`, and ⋯ with
`Options` · `Point at a field`. **There is no coral primary** — the one thing left
to do is the user's own submit on the site. **Reset is deliberately not on the
card**: it blanks every field just filled and throws the report away; it lives on
the popup as a quiet "Reset this page" link.

### The flow banner
`src/shared/flowState.ts` (pure) picks one of four states, worded in
`labels.FLOW_TEXT`: `alreadyApplied` (the job database has this URL as applied —
shown first, Skip retired), `empty` (the profile has nothing to fill with —
worded about the profile, never the page), `nothing` (a page whose questions are
all new — an invitation to teach), `ready` ("Filled — submit on the site when you
are ready"). The quiet states ride in the footer.

### The queue knows its tabs
`background/session.ts` keeps `queueTabs` (tab → posting, the slots) and
`queueChildTabs` (a tab opened from a queue tab → its root tab: the employer's
form behind "Apply on company website"; it gets the chip but takes no slot) in
`chrome.storage.session`. A tab is recorded **the moment it is created**, not after
the batch — the page asks as soon as it loads — and the content script asks once
more 1.5s later in case it still won. `queueTab(sender.tab.id)` answers only for
the sender's own tab.

**Closing a queue tab finishes it** (`settings.markDoneOnClose`, default on):
`finishOnClose` moves an `opened` posting to `markedDone` and nothing else, then
the next posting opens. Tabs that closed while the worker slept are finished the
same way in `liveTabs()`. A child tab finishes nothing.

`content/queueChip.ts` draws "Queue · n/total" bottom-left (the pill rail is
bottom-right; on a phone it rises one row above the centred pill and hides while
the bottom sheet is open). Pressing it opens the card.

### Surfaces
- **Popup** — Fill (100%, or "Show report" when the card is folded), then Teach ·
  Queue · Options in equal thirds, never hidden; "Reset this page" under the
  detail line once something was filled; the session card with Skip enabled only
  on a queue tab. Queue deep-links to the URL importer.
- **Options** — five tabs: Queue · Profile · Settings · Sync · Help, following the
  `tab-`/`panel-` id convention (deep-linking comes free: `#tab&at=<section>&focus=<selector>`).
  At ≤640px the five tabs stay one row at a tighter padding.

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
levels, and neither is wrong: the **review card** is a paper card
floating on someone else's page, so their rows and tiles are `--surface` insets;
the **options tab panel** is the recessed body (its active folder tab takes the
same tone, because tab and body are one sheet) and its sections, rows, stat tiles
and bare controls are paper objects on it. If a new element looks flat, it is
sitting on its own tone — count the levels rather than picking a colour.

A **secondary button is not an inset** — it is paper with a border that fills in
on hover, the reference's outlined button. Nor is a **per-row action ever the
primary fill**: Confirm shipped as a primary once and turned a sixteen-row report
into sixteen CTAs. The card has no primary at all now (`modal.test.ts` asserts
it): the one thing left after a fill is the user's own press on the site. Buttons
inside a popover are `.btn-ghost` (the overflow menu): the popover already has a
border, and one per item makes it a stack of boxes.

The popup is itself a panel (`--bg`), not a page, so its progress card has
something to recess into. Labels *inside* a surface are sentence case: uppercase
plus letter-spacing is reserved for page furniture. Secondary actions are labelled
in **one or two words** ("Teach", "Queue", "Options"), not sentences — as prose
they wrapped inside a 360px popup and left the row ragged.

`src/shared/labels.ts` is the wording counterpart to help.ts: `STATUS_TEXT` (tile
/ word / aria for each `MatchConfidence` — `none` is **"to teach"**, never
"unmatched": an unrecognised question is an invitation, not a failure), `FLOW_TEXT`
(the four banner states), `ACTION_LABELS` and `queueChipText`, typed `Record<>` so
a new status or action fails `npm run typecheck` until it is worded. Every surface
renders its status words and button verbs from here.

The `none` dot is a neutral grey **question mark** (`--icon-teach`, `--muted-2`),
not the red ✕ it was: a page of red crosses beside new questions read as a page
of failures.

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
review card becomes a full-width bottom sheet under 640px.

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
overflow menu and the help disclosure. Where the two
disagree, design.html wins on values (colour, radius, density, casing) and the
gallery wins on structure (which controls a state has, and how loud each one is).

### In-app help
`src/shared/help.ts` is the **only** place the extension explains itself: the
Settings `?` toggles and captions (`SETTINGS_HELP`, `Record<keyof Settings, …>` —
a new setting fails typecheck until it is explained), the Help tab
(`CONCEPT_HELP`, the sync guide `SYNC_SETUP_STEPS`/`SYNC_TROUBLESHOOTING`), and
the card's banner `?`. Copy written into a surface instead of the catalog is a
bug. `help.test.ts` also refuses any entry that promises to send ("press Apply").

`src/ui/help.ts` (`helpButton`/`helpPanel`/`richText`) builds the disclosure for
the shadow root and the light-DOM pages. **`richText` renders backticks and
nothing else** — a `**word**` ships as literal asterisks. Disclosure, never
`title=` tooltips — a hover tooltip does not exist on a phone. The `?` is a masked
icon (`--icon-help`) placed **immediately after the text it explains**, never
pushed to an edge, and never inside a heading. A settings row's caption is a line
of the *row* (so the control sits on the title line); a `.setrow.stacked` must
carry `flex-wrap: nowrap` and reset its children to `flex: 0 0 auto`, or the
disclosure wraps into a second column and hangs off the card.

### Data model & storage
`src/shared/types.ts` is the source of truth. Everything persists in
`chrome.storage.local` via typed wrappers in `storage.ts`:

- `profile` — `values` (the 15 built-in text fields), `keywords` (extra wordings
  per built-in field), `customFields` (`CustomField`: `c_` id, label, kind
  `text`/`longText`/`yesNo`, value, keywords). `normalizeProfile` reads any older
  shape (the old unused `custom` map is dropped).
- `lessons` — `Lesson[]`: signature, target (`{field}` or `{ignore: true}`),
  label, taughtOn, hits. Hits are counted, batched, by the content script.
- `jobUrls`, `jobDetails` (the archive), `settings`; the CV and cover letter in
  `cvStore.ts` (base64 — content scripts share the *page's* origin, so not
  extension IndexedDB). Old `siteConfigs` keys left by earlier builds are ignored.

`FieldKey` is the built-in sixteen (`resume` = the CV file); `FieldId` is a
`FieldKey` or a custom id. `shared/profileFields.ts` is the one catalog over both
(`fieldLabel`, `fieldValue`, `fieldChoices`, `keywordMatch`) so a custom field is
a field everywhere. The cover letter is both a text field and a file; the page
decides which by the control it offers.

`settings.modalLayout` (`shared/modalLayout.ts`) is where the card sits and how
big it is on desktop. **The drag-and-resize simulator in Options → Settings is the
only thing that writes it**; a drag on a page is a page-lifetime override
(`Controller.draggedLayout`). Desktop only — at or below `NARROW_WIDTH` (640px) the
card is a full-width bottom sheet and inline styles are cleared. Every read goes
through `clampLayout`. `settings.modalFullscreen` overrides the layout without
writing it, and is the only setting a content script writes (`patchSettings`).

### The sheet
`src/content/sheet.ts` (`abstract class Sheet<D extends SheetData>`) is the shell
behind the review card: `FillerModal` supplies only `buildCard`/`buildPill`/
`repaint`. Mount, `applyLayout`, drag, the
three resize grips, fullscreen, collapse-to-pill and `destroy` all live there once.

**A repaint must not lose the user's place.** `paint` replaces the whole
`.cf-card`, which is how these surfaces show any change at all — so without
`captureUserPlace`/`applyUserPlace` every edit also scrolled to the top, dropped
focus and wiped anything typed but not committed. Picking the 14th of sixteen
field rows put you back at the first one. Four rules, each with a test:

- **Identity is `data-k`, stamped by the subclass** on what a control *is*
  (`teach:choice`, `teach:label`), never on where it sits — position is exactly
  what a rebuild changes. A key that no longer resolves restores nothing and is
  not an error: the edit being rendered may have deleted that row.
- **Scroll is restored after `applyLayout()`**, never before. The card is sized
  there, and a `scrollTop` written to an element with no height yet clamps to 0.
- **`setHidden` captures and restores too.** `display: none` destroys the layout
  box and the scroll offset with it, and the picker's sequence is hide → pick →
  show → render — only the hide happens early enough to read the real number. A capture while hidden is skipped, or it would overwrite a good one
  with zeroes.
- **Uncommitted text comes back for the focused control only.** These inputs
  commit on `change`, i.e. on blur. Writing a remembered value into an *unfocused*
  field would be the opposite bug — stale data beating a fresh render.
  (`selectionStart` throws on `type="number"`; the caret is a nicety and must not
  cost the value.) The Teach chooser keeps what is typed into it on the instance
  too, because the engine re-renders the card while the user works in it.

`designSystem.test.ts` fails the build if any surface stylesheet sets a box
property on `.cf-card`, which would beat the 640px bottom-sheet rules.

The card's `×` **minimizes** to the pill — closing must never destroy the report.
`nudgeLayout` moved from
`options.ts` into `shared/modalLayout.ts` so the card and the simulator — a scale
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

### Queue sessions
`src/shared/queue.ts` (pure) — `nextBatch` picks the waiting URLs that fit the
free slots, `queueProgress` summarizes for the headers, and `progressDots` turns
that summary into the card strip's row of dots. The queue is **derived** from the
job-URL database (status `new`), never copied.

`src/background/session.ts` drives it: at most `settings.sessionBatchSize` job
tabs exist at once, and *finishing one opens the next* — closing it (which marks
it done) or `SESSION_SKIP`. Opens are staggered (`STAGGER_MS`) and serialized
through a promise chain, because two events landing together would otherwise both
claim the same slot. State splits by lifetime: `{ active, batchSize }` in
`chrome.storage.local`, the tab maps in `chrome.storage.session`. Never restore
the old behaviour of opening every URL in one loop — 60 links meant 60 tabs.

### Job-URL database
`src/shared/jobUrls.ts` (pure) — `addUrls` dedupes by URL (the unique key),
`applyStatus` records status transitions with timestamped history
(new → opened → markedDone / skipped / applied), `jobUrlStats` aggregates for the
dashboard. `redirected` and `applied` are no longer set by anything automatic (no
redirect following, no confirmation watch) but stay in the type: they are in
stored and synced histories, and `applied` is still set by hand in Options.
`urlImport.ts` extracts/normalizes/dedupes URLs from a pasted text blob.

**`markedDone` is set only by a user action**: closing a tab the queue opened
(`finishOnClose`, under `markDoneOnClose`), or Options → Queue's bulk button. The
extension cannot see a site's submit button being pressed, so it never claims an
application went in. Options → Queue's
**Mark opened as done** (`markOpenedDone`, pure) moves every visible `opened`
posting to it after a confirm naming the count; `redirected` is left alone, the
queue already counting it done. It ranks between `skipped` and `applied` (the
user's final word, but not a confirmation anyone saw), counts toward
`queueProgress.done`, and is an ordinary history event, so sync needs no schema
bump. **No timer or heuristic may assign it** — that is what keeps it meaning
"I said so". Its confirm is `.confirm.calm`, not the red Clear-all box:
it is undoable row by row, and danger colours would overstate it.

`STATUS_RANK` names how far through the flow each status is. It exists because
two callers needed it for different reasons: `linkRedirect` must not demote a
posting by re-visiting it (it used to spell that as two inline
`!== 'applied'` checks, which silently *did* demote a skipped one), and the sync
merge needs a deterministic tie-break. Both now go through `promote()`.

### Syncing the job database
Two browser profiles on different Google accounts, one database: **the job
database** — `jobUrls` and `jobDetails` — and nothing else. The profile, the own
fields, the lessons, the CV and every setting are device state: `modalLayout` alone settles it, being a rectangle
measured against *one* screen (`sampleScreen`), so replicating it is the stranding
`clampLayout` exists to undo.

**Site configs from older builds ride through opaque.** This build has none, but
a peer on an older build still reads and writes `siteConfigs` in the shared file,
and dropping the key on upload would delete them there. So `mergeJobs` carries
`siteConfigs`/`deletedSiteConfigs` as `OpaqueConfig`s — union by id, newest wins,
sorted — and this device never writes them locally or sends its own.
`SYNC_SCHEMA` stays 2 for the same reason.

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

**The how lives in one place: Help → "Setting up sync"**, the Help tab's last
section, rendered from `SYNC_SETUP_STEPS` and `SYNC_TROUBLESHOOTING` (`help.ts`).
It is written for someone who has never opened Google Cloud — every step that
happens on a Google page links to that page, the "Create the client" step draws
this browser's live redirect URI with its own Copy, and the errors are titled in
Google's own words ("Access blocked: This app's request is invalid" is a redirect
URI missing from, or pasted into the wrong box of, the client). The Sync tab
deep-links there rather than carrying a copy, and `CONCEPT_HELP.syncClient` says
*why* and points at it — the numbered steps used to be one paragraph inside it, and
`help.test.ts` keeps them out.

### The archive (captured postings + export)
`extractJob` ran for the modal alone and threw its result away every re-render,
so a posting became unreadable the moment its tab closed. `jobDetails.ts` (pure)
keeps it: `Controller.captureJob` writes what the page said — title, description,
requirements, chips — for every page the job database knows (a queue tab, or an
imported URL; the engine runs on every site and a shop's product page is not a
posting to archive), and Options → Queue → **Archive** exports them as one file
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

- **Never submit.** Nothing in the extension presses a site's submit button, and
  nothing may. Filling is the whole job; the user submits on the site.
- **No per-site configs.** Everything the extension learns is global and keyed on
  the input (`InputSignature`), never on the site — the one exception is an input
  with no words and no usable name, pinned to its `host` because a global lesson on
  "an unlabelled box" would match one everywhere.
- **Signatures match exactly and fail closed.** A lesson applies only when every
  stored part is equal; one that matches two inputs on a page fills neither.
  Never add fuzzy matching — a wrong value in an employer's form is worse than a
  blank one.
- **Never write over an answer.** The engine fills only empty inputs, and never
  again one the user typed in (detected by `isTrusted`). Only an explicit Confirm
  or Teach writes over a value.
- **Leave other forms alone.** Password-bearing forms, search, card fields,
  one-time codes and our own UI are never candidates (`collectCandidates`). The
  engine runs on every site; this is what makes that acceptable.
- **Unrecognised inputs are not marked on the page**, and name chips appear only
  on pages the user is working on (`showLabels`). A ring round every unknown box on
  every site is the extension talking over the web.
- **The report holds still.** Rows are ordered once and later arrivals are
  appended; statuses change in place, rows never move.
- **Skip must never run on an applied posting**: it ends in `recordStatus`, a
  blunt overwrite, which would file `skipped` over `applied` and sync the loss. The
  card retires Skip (`aria-disabled`, never the `disabled` property, so the press
  can still explain itself) and `skipPosting` refuses.
- **Closing a queue tab only ever moves `opened` → `markedDone`** (`finishOnClose`).
  A skipped, applied or already-done posting keeps its answer; a child tab finishes
  nothing.
- **Lessons, custom fields and the profile are device state.** Never add them to
  the sync snapshot without a `SYNC_SCHEMA` bump and a decision about lessons that
  point at fields the other device does not have.
- **Content scripts share the PAGE's origin**, not the extension's — so the CV
  is stored in `chrome.storage.local` (base64, needs `unlimitedStorage`), NOT
  extension IndexedDB. See `cvStore.ts`.
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
- **Only ever hand `http(s)` to the browser.** `shared/appLink.ts` is an
  **allowlist** and `navigableUrl` is the one place `settings.keepInBrowser` is
  read; `session.ts`'s two opens go through it. Never re-widen it to a blocklist:
  an `intent://` or `linkedin://` link is a valid URL with a host, and on Android
  `chrome.tabs.create` would launch the app — a dead end where nothing can be
  filled. An `intent://` link is rewritten to its `browser_fallback_url`,
  re-checked through `webOnly`.
- **Selectors are resolved in exactly one place, `shared/query.ts`.** Six copies of
  the same guarded `querySelector` had grown across `content/` and `shared/`, and a
  malformed selector must never throw out of a sweep. The resolver also understands one extension to CSS,
  `button:-cf-text("Apply now")`, kept to elements whose collapsed text *equals* the
  literal. CSS cannot say "the button labelled Apply now", and on a board with no
  ids, hashed classes and a re-render between visits that label is the only durable
  handle there is. It is **terminal-only and at most one per selector** — which is
  what keeps the resolver a `split` rather than a parser, and costs nothing because
  `pickSelector` only ever emits it last. A selector breaking that rule resolves to
  *nothing*, never to a guess.
- **Never read a job container with `textContent`.** It welds every heading,
  paragraph and bullet into one string and preserves the HTML source's own
  indentation, which is what made the description unreadable. `shared/jobText.ts`
  walks it into blocks instead — and drops `form`/`nav`/`aside`/`footer`, because
  the broad `jobDescription` fallbacks (`main`, `article`, `[class*="content"]`)
  otherwise quote the application form and the decoy sidebar back at the user.
  `clip` lives there too — one line, cut to *n* — because every place that shows a
  snippet of page text (the picker's preview among them) is making the same
  decision about the same text.
- **Closing the review modal must never destroy it.** `onClose` minimizes to the
  pill (`FillerModal.minimize`); destroying it left "Reset & Re-run" as the only
  way back, which wipes every field just filled.
- **The picker never commits on a click, on any pointer.** A click *selects* and
  Confirm saves — one flow, no `pointerType` branch. What is under the pointer is
  not what the user checked.
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
- **And it reads back the words, not only the structure.** `div.job-description`
  says where a thing is and nothing about whether it is the right thing, so the
  toolbar reads back what the selection says. The `preview` row is `blocksToText(extractBlocks(el))`, the
  real reading path rather than `textContent`, falling back to the element's own
  words when that returns nothing: `extractBlocks` refuses a root that is chrome,
  which is *every control worth marking*, so without the fallback the Send button
  and the apply link preview as blank. It is **memoized on the element** — `paint`
  runs off a capture-phase `scroll` listener and reading a posting is a full walk —
  and clipped by `clip` plus a three-line clamp, because the bar is
  `width: max-content` and an unclamped description stretches it to the viewport.
  A third row, *below* the controls: the two rows above it must not move when a
  selection appears.
- **The picker's chrome is created once and repainted, never rebuilt**, and its
  capture-phase suppression covers `pointerdown`/`mousedown`/`mouseup`/`dblclick`/
  `contextmenu` and not just `click`: a site that acts on `mousedown` would
  otherwise act once per step of a multi-click pick.
- **Every mark the extension draws on the host page carries an `OWN_SELECTOR`
  attribute and contains no form control.** `fieldTags.ts`'s chips and the queue
  chip are in the page's DOM; without `TAG_ATTR`/`QUEUE_CHIP_HOST_ID` in
  `extensionUi.ts` they are pickable by `elementChain` and — if one ever wrapped
  an `<input>` — a candidate for the engine to fill. `pointer-events: none` is the
  belt, not the braces.
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

TDD: for pure/testable logic (question text, signatures, lessons, matchers,
selector generators, heuristics, storage codecs) write the failing Vitest test
first, then implement. Vitest runs under jsdom with a small `chrome.*` mock in
`test/setup.ts`; `*.test.ts` files sit next to the code they cover. jsdom has no
layout, so `collectCandidates` takes an injectable `visible` (tests pass
`isDisplayed`), and no way to forge `isTrusted`, so the engine takes an injectable
`isUserEvent`.

**`test/fixtures/scenarios.mjs` is the scenario catalog** and the single source of
URLs: the fixture server prints it, generates its index page at
`http://localhost:5199/` from it, and `e2e/extension.spec.ts` calls `urlFor(id)`.
Adding a flow means adding a scenario here, a fixture page, and an E2E spec. No
fixture has a config — there are none.

The server listens on **two ports** so there are three origins — `localhost:5199`
(board), `127.0.0.1:5199` (employer), `127.0.0.1:5200`. A different port is a
different site to the extension, which is what proves a lesson taught on one site
fills on another (`questions.html` served from both). `/queue-seed.txt` serves the
URL list the session E2E uses.

Off the queue the card starts **folded to its pill**, so an E2E that reads the
card opens it the way a user does (`openCard`). Rows that need teaching are listed
*first* — locate a row by its question or its buttons, never by position.

**Wait for `document.body.dataset.ready` before writing storage under an options
page.** `main()` ends by setting it; `load` fires long before, while the boot is
still awaiting a read-modify-write of the capture map. `onExtensionPage` waits for
it.
