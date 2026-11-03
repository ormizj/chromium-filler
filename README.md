# Chromium Filler

A Manifest V3 Chrome extension that fills job-application forms — **on every site,
with no per-site setup** — and **learns from the answers you type**. It never
submits anything: its job ends at a filled, reviewed form, and you press the
site's own submit button.

## What it does

- **Fills every page as it loads**, CV upload included. When more fields appear —
  the form behind "Apply now", step two of a multi-step form — they are filled as
  they appear. It runs in **every frame**, so forms Greenhouse, Lever, iCIMS and
  others embed in an iframe from their own domain are filled too.
- **Never writes over an answer.** Only empty boxes are filled, and a box you have
  typed in is never written again.
- **Leaves other forms alone.** Login and sign-up forms (anything with a password
  box), search boxes, card fields and one-time codes are never touched, on any site.
- **A review card, folded to a pill.** While it is on, a small pill in the corner of
  every page says so ("On · learning") and how much it filled. Press it for the
  report: one row per input — filled, worth a look, or new — and **Fill again**.
  The report holds still: rows are ordered once, and inputs that turn up later are
  appended under "Appeared later". Closing the card folds it back to the pill,
  never throws the report away. On a phone it is a full-width bottom sheet.
- **Learns from what you type** — there is nothing to teach. See
  [How it learns](#how-it-learns).
- **Your own fields.** Beyond the seventeen built-ins (name, email, phone, links,
  CV, cover letter, …) you can add fields of your own — "Years of experience",
  "Visa sponsorship" — each with the wordings sites use for it, and give the
  built-ins extra wordings too.
- **A queue, not sixty tabs.** Paste a messy block of text; every URL is extracted,
  normalised and de-duplicated. A session keeps a fixed number of job tabs open and
  opens the next posting when you close or skip one. See
  [Working through a batch](#working-through-a-batch-queue-sessions).
- **Optional sync** of everything between two browsers, through a hidden app
  folder in your own Google Drive. See [Sync](#sync-optional).
- **Explains itself.** A `?` beside every setting and section, a Help tab, a
  getting-started checklist, and a step-by-step sync guide — all rendered from one
  catalog, `src/shared/help.ts`, so no two surfaces can disagree.
- **Mobile friendly** and touch-first (see [Load on mobile](#load-on-mobile)).

## How it learns

When you **commit** an answer — you leave a box whose value you changed — the
extension reads it back and asks which of your saved details would have produced it:

- **Exactly one of them** → it learns that question, and fills it from then on, on
  every site. Your email typed into "Preferred contact" means that question asks
  for your email.
- **Several of them** → nothing; it fails closed.
- **None of them** → it is counted under Options → Profile → **Answers you've
  typed**, as a suggestion to save (as a built-in, one of your own fields, or a new
  field named after the question). It is never filled anywhere until you save it.
  Only short, one-line answers are counted — never anything from a text area or a
  rich-text editor — and the count stays on this browser.
- **You replaced or emptied something it filled** → it stops filling that question.

A lesson names **exactly one input**: "Name" under "Reference 1" is never
confused with "Name" under "Reference 2". A lesson that would match two inputs on a
page fills neither — a wrong value in an employer's form is worse than a blank one.
Tick boxes and answers too common to learn from ("Yes", "3") are never learned.
Everything it learned is under Options → Profile → **What it has learned**, where
any of it can be forgotten. Both behaviours have a switch in Settings.

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
npm run package -- 0.1.2   # bump to a new version first, then package
npm run screenshots # regenerate the store screenshots from the built extension

# End-to-end: loads the built extension into real Chromium and drives the
# fixture sites. Requires the browser once: `npx playwright install chromium`.
npm run build && npm run test:e2e
```

The E2E suite (`e2e/extension.spec.ts`) is the confidence signal: 39 specs run the
whole pipeline (detect → classify → fill → CV → learn) against the fixture pages —
including an embedded cross-origin form and a login page it must leave alone —
plus the queue session, popup and options. If it's green, real boards should
behave.

### The two zips

To release a new version pass it to the command: `npm run package -- 0.1.2`.
`scripts/version.mjs` refuses a version lower than the current one (or one Chrome
would not accept, such as `1.2-beta`), allows the same one with a notice, and
writes it into all four files that carry it — `package.json`,
`package-lock.json`, `manifest.config.ts` and `design/store/LISTING.md` — before
anything is built. Every run also refuses a `package.json` and manifest that
disagree. When it finishes it prints the store dashboard link and the upload steps.

`npm run package` produces **two** archives, and they are not interchangeable.
The difference that matters is where `manifest.json` sits: Chrome Web Store
uploads must have it at the archive root, and "Load unpacked" wants a folder.

|                      | `chromium-filler-v<version>.zip`         | `chromium-filler-v<version>-store.zip`      |
| -------------------- | ---------------------------------------- | ------------------------------------------- |
| **Use it for**       | GitHub releases, handing to a tester, mobile sideloading | The Chrome Web Store upload — nothing else |
| **Archive layout**   | everything nested under `chromium-filler/` | `manifest.json` at the archive **root**     |
| **Unzips to**        | one clean `chromium-filler/` folder       | its contents, loose in the current directory |
| **Code**             | minified (`npm run build`)                | unminified (`npm run build:store`)          |

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
4. Open **`http://localhost:5199/`** — the generated index of every scenario, each
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

This renders every surface side by side in a normal browser tab — at both a
**390px phone width** and desktop — driven by a **mocked** `chrome.*` API
(`dev/mock-chrome.ts`) whose storage is backed by `localStorage`, whose content
script is faked so the popup's Fill / Reset buttons visibly change state, and
which simulates a queue session so the Start/Stop controls do something. Instant
Vite HMR, no extension install.

`dev/frame.html` opens one surface on its own, and its query parameters are how
you reach a state a screenshot otherwise cannot — most of the card's states are
reachable on a real page only by typing into it:

| Parameter | What it picks |
| --- | --- |
| `page` | the surface: `popup`, `options`, `modal` (the review card over a fake posting), `chip` (the queue chip beside the folded pill) |
| `state` | for `modal`: `long`, `flush`, `failed-fill`, `learned`, `appeared-later`, `already-done`, `nothing`, `empty`, `bare`, `pill-only`, and the pill's `watching`, `just-learned`, `paused`. For `options`: `profile`, `custom-fields`, `wordings`, `learned`, `typed`, `sync`, `sync-guide`, `fresh` (an empty store). For `popup`: `fresh` |
| `queue=1` | makes the card a queue tab (`session=1` works too) |
| `open=1` | with `page=chip`, expands the card (on a phone the chip then hides) |

**`dev/index.html` links every one of them**, grouped by surface — use that list
rather than assembling URLs by hand, and add a link there whenever a surface gains
a distinct rendering. The mock's seed is versioned (`full-v5`): bump it whenever
its shape changes, or a browser that ran the harness before keeps the old store.

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

## The fixture sites

`test/fixtures/sites/` holds deliberately awkward pages that mirror real-world
pain. None of them has a config — there are none to have.

**`http://localhost:5199/` lists every scenario**, grouped by flow, each with its
own URL and the outcome you should see. It is generated from
`test/fixtures/scenarios.mjs` — the same catalog the E2E suite drives — so the
page and the tests cannot disagree. The server runs on **two ports**, because
`localhost:5199`, `127.0.0.1:5199` and `127.0.0.1:5200` are three different sites
to the extension: that is what proves a lesson learned on one site fills on
another, and what makes the embedded form genuinely cross-origin.

Filling:

- **slow-boards.html** — the form is injected ~2s after load, so it is filled as
  it appears.
- **modal-lever.html** — the form exists only once "Apply" is pressed, and its
  fields have no id or name, only accessible names.
- **cv-confirm.html** — the CV upload lives in a dialog.
- **chaos-form.html** — hashed ids, a multi-step form revealed by "Next", one
  disguised field and one that is only a guess.
- **quick-board.html** — `?job=plain` is a plain posting; `?job=uploads` asks for
  the cover letter as a second file input, which must not be given the CV.
- **ats-form.html** — an employer form on another origin.
- **embedded.html** — a careers page that embeds the ATS form in an iframe from
  another origin; the subframe fills, and its rows appear on the top frame's card.

Learning:

- **questions.html** — questions outside the built-in fields. Your own fields
  answer the years and the visa radio; typing your first name into "Preferred
  name" learns it for every site; replacing "Name" under Reference 1 stops filling
  it there only.

Left alone:

- **login.html** — a login form, a search box and a card number. Nothing is
  touched.

`http://localhost:5199/queue-seed.txt` is 12 postings, one per line, for driving a
real session against the fixtures.

## Working through a batch (queue sessions)

Import 60 links and opening them all at once helps nobody — it is 60 tabs, 60
forms filling simultaneously, and no way to tell where you got to. A **session**
is a sliding window instead:

1. Options → **Queue** → set *Tabs at once* (default 2; 1–2 on a phone) → **Start
   session**. That many postings open in the background, staggered rather than in
   one burst.
2. Each tab fills itself as usual, and carries a **Queue · n/total** chip so you
   know which tabs are the queue's. You review, submit on the site yourself, and
   close the tab — or press **Skip → next** on the card.
3. Either one marks the posting **done**, the slot frees, and **the next waiting
   posting opens**. The window stays full until the queue drains.

A posting is `new` or `done`, nothing else: the extension never submits, so it
cannot tell applied from skipped, and `done` is only ever your word — closing a
queue tab, Skip, or the posting's own control in Options → Queue. No timer or
heuristic marks anything. A tab opened *from* a queue tab (the employer's form
behind "Apply on company website") gets the chip too, but closing it finishes
nothing.

Progress shows in the options Queue tab, in the popup, and on the card itself.
**Stop session** stops refilling but deliberately leaves open tabs alone — you are
probably mid-application in one. The session survives a browser restart; open
tabs do not, so it simply refills when you start it again.

Only `http(s)` links are ever handed to the browser. An `intent://` link is opened
at its `browser_fallback_url`, and one that can only open a phone app is not
opened at all ("Keep queued links in the browser", on by default).

## Sync (optional)

Two browser profiles, one state: the job list, your details and the extra wordings,
your own fields, what it has learned, your CV and cover letter, and your settings.
A few things stay on each browser: the on/off switch, the "Sync this browser"
switch, where the card sits, the answers you've typed, and the OAuth client and its
tokens. Options → **Sync** lists both sides under "What syncs".

Both sides write with nobody arbitrating, so the merge is commutative, associative
and idempotent. Everything except the job list travels as small stamped units — one
per profile field, custom field, lesson, setting and document — and the more recent
change to each unit wins, so two devices editing different fields both keep their
edit. A posting's status history is set-unioned and its status derived from it, so
a correction is just a later event. Deleting is a tombstone rather than a splice,
because a union can only grow. The first merge asks before combining, because
connecting the wrong account would fold a stranger's profile into yours.

Setting it up — step by step in Help → **Setting up sync**:

1. Create a **Google OAuth client** in your own Google Cloud project and paste its
   ID and secret into Options → Sync. It has to be yours: a Google Cloud project is
   per-person.
2. **Copy the redirect URI** shown there into that client. It is derived from this
   browser's extension ID, so it cannot be printed in the help text, and each
   browser you sync needs its own added.
3. **Connect**, and pick the *same Google account* in both browsers. Sign-in goes
   through `launchWebAuthFlow`, not `getAuthToken`, precisely so the account is
   yours to choose rather than whatever the browser profile is signed into.
4. Switch **Sync this browser** on.

Everything lives as one `jobs.json` in Drive's hidden `appDataFolder`
(`drive.appdata` scope only), and every write is a compare-and-swap. Syncing runs
when you press **Sync now** and once at browser startup — never on a timer, which
is why there is no `alarms` permission.

The **backup file** on the same tab moves the same snapshot by hand, and importing
one combines rather than replaces, exactly as syncing does.

## Load on mobile

Stock **Chrome for Android does not support extensions.** Use a Chromium-based
mobile browser that does — primarily **Kiwi Browser**: run `npm run package` to
get `chromium-filler-v<version>.zip`, then menu → Extensions → enable Developer
mode → load the zip.

Mobile is the priority target, so every surface is touch-first: a 44px minimum
for every control, the review card becomes a full-width bottom sheet under 640px,
and status is shown by an icon shape as well as colour. Because reaching the
toolbar popup costs two or three taps through the browser menu, the card carries
the on/off switch and the queue's **Skip → next** too.

## Architecture

`src/content` — `main.ts` (the controller: loads the profile, lessons and
settings, asks whether the queue opened this tab, starts the engine);
`fillEngine.ts` (sweep, classify, fill, watch the page change, hear committed
answers); `fieldDetect.ts` (what is a candidate, and what never is); `fill.ts`;
`answer.ts` (reading an answer back); `fieldTags.ts` and `queueChip.ts` (the marks
drawn on the host page); and the review card, `modal/modal.ts`, on the shell in
`sheet.ts`. Every frame fills and learns; only the top frame draws.

`src/shared` — pure, unit-tested logic: `questionText.ts` (what an input asks),
`inputSignature.ts` and `lessons.ts` (exact-match lessons), `learning.ts` (what an
answer teaches), `typedAnswers.ts`, `profileFields.ts` (built-in and custom fields
as one catalog), `fieldKeys.ts` (the heuristics), `flowState.ts`, `queue.ts`,
`jobUrls.ts`, `urlImport.ts`, and the sync model (`syncUnits.ts`, `syncState.ts`).
`help.ts` and `labels.ts` are the only place the extension's explanations and its
button verbs are written.

`src/background` — the service worker (routing messages, forwarding subframe
reports to the top frame), `session.ts` (queue sessions), and `googleAuth.ts` /
`drive.ts` / `sync.ts` (Drive sync).

`src/ui` — the design tokens and component primitives every surface shares (one
copy, used by both the light-DOM pages and the shadow roots), with
`designSystem.test.ts` failing the build on a hardcoded colour, an undeclared
token or a status missing its colour, icon or word. `src/popup`, `src/options` —
the toolbar popup and the five options tabs (Queue · Profile · Settings · Sync ·
Help).

`CLAUDE.md` is the detailed design record: every rule above, and why.
