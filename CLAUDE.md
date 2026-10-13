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
`picker`. The mock's seed is versioned (`full-v4` in `dev/mock-chrome.ts`): bump it
whenever its shape changes, or a browser that ran the harness before keeps the old
store.

- **`page=modal`** renders the real review card over a fake posting.
  `&state=` picks the rendering: `long`, `flush`, `failed-fill`,
  `confirmed`, `taught`, `appeared-later`, `already-done`, `nothing`, `empty`,
  `bare`, `pill-only`. `&teach=<n>` opens the Teach chooser on row n (and `&new=1`
  with it opens "New field…"); `&queue=1` (or `&session=1`) makes it a queue tab.
  Most of these are reachable on a real page
  only by pressing something, which a screenshot cannot do.
- **`page=chip`** is the queue chip beside the card's folded pill — the two marks
  the extension leaves on a queue tab. `&open=1` expands the card (on a phone the
  chip then hides).
- **`page=options`** takes `&state=profile|custom-fields|wordings|learned` (the
  Profile tab's sections, via the same `#tab&at=` deep links the extension uses),
  `sync` (the Sync tab at its "What syncs" lists), `sync-guide`, and `fresh` (an
  empty store — the getting-started checklist).
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
stayed is the fill, the queue and the sync. Do not reintroduce submit automation
or per-site configs. (The Archive export and the posting capture behind it went
too, the same month: nothing else read the captured text.)

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
3. **The card** (`src/content/modal/modal.ts`) shows the report. It appears as a
   folded pill, and only when something was filled (on a queue tab, as soon as
   there is a row). With `settings.openCardWhenFilled` (off by default) it opens
   expanded the first time something is filled — decided on every report, not when
   the card is made, and once only, so a × afterwards is the user's word.

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
fills the row in place. The popup's **Teach** and the card's footer **Teach** (one
word, one action) start the picker for an input no sweep listed; Confirm there opens the card on that
input's chooser (`engine.rowForElement` adds a row for it).

Lessons and custom fields **sync**, like the profile (see Syncing).
Options → Profile lists them: "Your own fields" (cards: name, kind, answer,
"Answers questions like" chips), "Other ways sites ask for these" (extra wordings
for the built-ins, behind a disclosure), and "What it has learned" (lessons by
field, with Forget; `index`/`host` lessons are flagged).

### The card
`FillerModal` extends `Sheet`. It is the report and nothing else — the Job view
(the posting, re-read from the page), the fullscreen toggle and the ⋯ menu are gone
(October 2026). Header: site name · `Done` chip · the report's worst-status dot ·
×. Footer: `Fill again` (sweep again, never over an answer), `Teach` (point at a
field), and on a queue tab `Skip → next`. **There is no coral primary** — the one thing left
to do is the user's own submit on the site. **Reset is deliberately not on the
card**: it blanks every field just filled and throws the report away; it lives on
the popup as a quiet "Reset this page" link.

### The flow banner
`src/shared/flowState.ts` (pure) picks one of four states, worded in
`labels.FLOW_TEXT`: `alreadyDone` (the job database has this URL as `done` —
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

**Closing a queue tab finishes it**, always — it is not a setting: the user
submits by hand, so closing the tab is the one "done" the extension hears.
`finishOnClose` moves a `new` posting to `done` and nothing else, then the next
posting opens. **Skip always closes its tab** too, `SKIP_CLOSE_DELAY_MS` after
the press (so the skip is seen to land), and frees the slot at once. Tabs that closed while the worker slept are finished the
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
inside a popover are `.btn-ghost`: the popover already has a border, and one per
item makes it a stack of boxes.

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
pointer, and the card's `.cf-close` is one tap tall.

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
insets are *darker* than the paper (not lighter). The options Settings tab uses
folder tabs, `.switch` toggles and a **two-column** grid of setting rows; the popup
leads with a progress card + status chips, and the card's session strip carries
progress dots.

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
- `jobUrls`, `settings`; the CV and cover letter in `cvStore.ts` (base64 —
  content scripts share the *page's* origin, so not extension IndexedDB).
- `profileStamps`, `lessonStamps`, `settingsStamps`, `docStamps` — when each
  synced unit last changed (see Syncing). Written in the same `set` as the data,
  by `stampedSet`; every save of synced state goes through it.
- `dropRetiredKeys` (on update) removes what older builds left: `jobDetails`,
  `siteConfigs`, and the `RETIRED_SETTINGS` inside the settings (`exportOptions`,
  `openCardOnQueueTabs`, `modalFullscreen`, …).

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
through `clampLayout`.

### The sheet
`src/content/sheet.ts` (`abstract class Sheet<D extends SheetData>`) is the shell
behind the review card: `FillerModal` supplies only `buildCard`/`buildPill`/
`repaint`. Mount, `applyLayout`, drag, the
three resize grips, collapse-to-pill and `destroy` all live there once.

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
claim the same slot. State splits by lifetime: `{ active, batchSize, opened }` in
`chrome.storage.local`, the tab maps in `chrome.storage.session`.

A posting with a tab on it is still `new` — there is no `opened` status — so the
session record keeps **`opened`, every URL this session has opened**, and
`nextBatch` skips them (`seen`). Without it a tab whose finish lost a race would
reopen at the next top-up. A fresh
`startSession` resets it (a resize keeps it). The session's own job-list writes
(`finishPostings`, Skip) are serialized through `writeJobs`, because two tabs
closing together each read-modify-write the whole list. Never restore
the old behaviour of opening every URL in one loop — 60 links meant 60 tabs.

### Job-URL database
`src/shared/jobUrls.ts` (pure) — `addUrls` dedupes by URL (the unique key),
`applyStatus` records status transitions with timestamped history,
`jobUrlStats` aggregates for the dashboard. `urlImport.ts`
extracts/normalizes/dedupes URLs from a pasted text blob.

**A posting is `new` or `done`, nothing else.** The extension never submits, so
it cannot tell applied from skipped from looked-and-moved-on; `done` is the user's
own word — closing a queue tab (`finishOnClose`), Skip,
or the row's control in Options → Queue. **No timer or heuristic may assign it.**
Earlier builds' six statuses are mapped on read by `normalizeEntry`
(`LEGACY_STATUS`: `opened` → `new`; `redirected`/`applied`/`skipped`/`markedDone` →
`done`), in the status *and* every history event, and the two-step fields
(`openedAt`, `appliedAt`, `sourceUrl`, `redirectUrl`) are dropped. It stays
idempotent — the sync merge normalizes its own output again — which is why two
events the mapping made identical collapse but different consecutive ones stay.

`STATUS_RANK` (`new` 0, `done` 1, `deleted` 2) is the sync merge's deterministic
tie-break for two events in one millisecond, and `ALL_JOB_STATUSES` is derived
from it.

### Syncing
Two browser profiles on different Google accounts, one state: **everything**,
except the card's `modalLayout` (a rectangle measured
against *one* screen — replicating it is the stranding `clampLayout` exists to
undo), the `syncEnabled` switch itself, and the OAuth client and tokens. Those
are `LOCAL_SETTINGS` (`syncUnits.ts`) and `DEVICE_ONLY_TEXT`; every other
setting syncs, including one added later, unless it is named there.

**The Sync tab says what syncs** (a "What syncs" disclosure, folded by default: synced vs stays
on this browser), because all of it happens in the background. It is rendered
from the model — `SYNC_DOMAINS` worded by `SYNC_SCOPE_TEXT: Record<SyncDomain, …>`,
the synced settings by their `SETTINGS_HELP` titles, `LOCAL_SCOPE_TEXT:
Record<LocalSetting, …>` — so a new family of synced data fails typecheck until
it is worded, and `help.test.ts` asserts every setting is on exactly one side.

The wire format (`syncState.ts`, `SYNC_SCHEMA` 3) is `{ schema, jobUrls, state }`:

- **`jobUrls` is the storage format verbatim** — no mapping layer to drift. Its
  merge: **`history` is set-unioned and `status` is *derived* from it** (newest
  event wins; same-millisecond ties by `STATUS_RANK`). The obvious rule — "the
  stronger status wins" — is wrong: rank is monotonic, so a posting could never
  be set back to `new`. A correction is just a later event.
- **`state` is everything else as stamped units** (`syncUnits.ts`):
  `profile.values.<k>`, `profile.keywords.<k>`, `customField.<id>`,
  `lesson.<signatureKey>`, `settings.<k>`, `doc.resume`/`doc.coverLetter`, each
  `{ at, value }` (`null` = removed). The merge is a **last-writer-wins register
  per unit**: newest `at`; at the same instant a value beats a removal, then a
  stable content key (`canonical`, sorted-key JSON). Small units are what make it
  fair — two devices editing different fields both keep their edit. A lesson is
  keyed by its **signature**, not its id (one lesson per signature, so two devices
  teaching the same input converge), and keeps the **higher hit count** whichever
  side wins; the hit count is left out of the content key and of change
  detection, so a hit never outvotes a re-teach.

**Stamps are written when a change is saved, not when it is synced**:
`saveProfile`/`saveLessons`/`saveSettings`/`setDoc`/`clearDoc` diff the units
before and after (`diffStamps`) and date what changed. A unit with no stamp
predates the feature and travels at `at: 0` — and a setting still at its default
with no stamp is not sent at all, so on the first merge an untouched default
cannot outvote a value the other user chose. `applySnapshot` writes merged state
**raw**, adopting the far side's stamps — re-stamping would date every synced
value to now.

The whole merge is **commutative, associative and idempotent** —
`syncState.test.ts` asserts it directly. That is also what makes the
compare-and-swap retry safe: a lost race is repaired by merging again.

Things that follow, each with a test:

- **Deletion is a tombstone, never a splice**: a `'deleted'` log event for a
  posting (`deleteUrl` — including Clear all), a `null` unit for everything else.
  A union can only grow, so a spliced entry returns on the next sync. Both kinds
  of tombstone are pruned after 90 days at the storage edge (`pruneTombstones`,
  `pruneUnits`), never in the merge, which must not depend on `now`.
- **Schema 3 replaced the opaque site-config carry.** A schema-2 build refuses a
  schema-3 file ("written by a newer version — update this device") instead of
  rebuilding it from the keys it knows and deleting the rest on the far side —
  which is also why the Drive file is still `jobs.json`: a new name would let
  not-yet-updated browsers keep syncing their job lists without a word. Schema 1
  and 2 files (an old backup, the remote file on first run) are read as a job
  list with no other state.
- **Forward compatibility is a one-shot decision.** `JobLogStatus` is
  deliberately open (`| (string & {})`), unknown entry fields survive by spreading
  both sides, and a unit this build cannot place is carried in the uploaded
  snapshot (`applySnapshot` returns the merged `state`, not one rebuilt from
  storage). `parseSnapshot` refuses an unknown `schema` outright: merging is
  all-or-nothing, so a stale peer can be *blocked* but must never corrupt.
- **The first merge asks** (`pending`: postings, profile fields and lessons on
  each side), because connecting the wrong account would fold a stranger's
  profile into this one.
- **After a sync or import, the options page reloads** if anything besides the
  job list changed (`showArrived` compares values, not stamps), carrying its
  status line across in `sessionStorage` — a dozen sections read storage once at
  load. Not while a savebar is showing: it says to reload instead.

The **backup file** (Sync → Export/Import backup) is the same snapshot, and
importing it is the same merge — so it combines rather than restores, and a
removal made after the backup was taken wins over it.

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
`syncClient` (this device only; never in the snapshot), and the steps for creating
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
still moves everything by hand.

**With "Sync this browser" off, the Google controls are not shown** — the account
line, Connect / Sync now / Disconnect and the OAuth client form (`.sync-when-on`).
None of it can run then. "What syncs" and the backup file stay: one says what
turning it on would do, the other works without it.

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
- **Two statuses: `new` and `done`.** Do not add more without asking; `done` is
  only ever the user's word. On a posting already done the card retires Skip
  (`aria-disabled`, never the `disabled` property, so the press can still explain
  itself) and `skipPosting` refuses.
- **Closing a queue tab only ever moves `new` → `done`** (`finishOnClose`). A
  child tab finishes nothing.
- **Everything syncs except `LOCAL_SETTINGS` and the OAuth client/tokens**, and
  every synced thing is listed in the Sync tab's "What syncs", rendered from the
  model. A new kind of synced data needs a `SyncDomain` and its wording.
- **Every save of synced state is stamped** (`stampedSet`). A write to
  `profile`/`lessons`/`settings`/`cv`/`coverLetterFile` that bypasses the
  wrappers is undated, and an undated change loses to the other device.
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
- **Upload what `applySnapshot` stored, not what `mergeSnapshots` returned.** It
  returns the pruned snapshot for exactly this reason: writing the unpruned merge
  back meant the remote `jobs.json` never shed a tombstone and grew for the life
  of the account. Both ends hold the same answer when a sync returns.
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
  indentation. `shared/jobText.ts` walks it into blocks instead (the picker's
  preview reads through it) — and drops `form`/`nav`/`aside`/`footer`, because a
  broad container (`main`, `article`, `[class*="content"]`) otherwise quotes the
  application form and the decoy sidebar back at the user.
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
still awaiting its reads. `onExtensionPage` waits for it.
