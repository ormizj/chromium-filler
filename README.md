# Chromium Filler

A Manifest V3 Chrome extension that auto-fills job-application forms. Open a job
URL, and on a site it recognizes it waits for the (slow) form, runs any prep
steps, shows a modal with the **job title + description**, and fills your fields
— **including CV upload** — so you only press the site's own *Send*.

Filling is automatic but **never silent**: a review modal shows every field as
filled (green), low-confidence (yellow), or unmatched (red). You override any
match by **clicking the real field on the page**; the selector is saved into that
site's config for next time. It never submits for you.

## Features

- **URL-based site detection** with per-site configs (match-patterns or regex).
- **Auto prep phase** — expand description, open the apply/CV modal, etc.
- **Review-report modal** (Shadow DOM, draggable; a bottom-sheet on mobile) with
  the job title, a scrollable description, and per-field status. Closing it
  **collapses it to a pill**, never destroying your fills, and during a session
  it carries the queue progress and a *Skip → next* action — so a whole run is
  drivable without ever opening the toolbar popup.
- **Field matching** = keyword heuristics + per-site selector overrides. Only
  high-confidence matches auto-fill; the rest are reported for one-click confirm.
- **Click/tap-to-pick overrides**, persisted to the site config.
- **CV upload** via `DataTransfer` (stored on-device in `chrome.storage.local`).
- **Job queue + sessions** — paste a messy text blob, every URL is extracted /
  normalized / deduped (the **URL is the unique key**). A **session** then keeps a
  fixed number of job tabs open (default 5; drop it to 1–2 on mobile) and opens
  the next posting the moment you submit, skip, or close one — so 60 imported
  links never become 60 tabs. Pause and resume at will; it survives a browser
  restart. Every entry tracks a timestamped status **history**
  (new → opened → applied, or skipped), with stat cards, search, and filters.
- **Auto-close after submit** (optional) — since the extension never submits,
  "sent" is detected per site via a `successSelector` (see below), which also
  marks the URL **applied**.
- **Mobile friendly** and touch-first (see below).

## Develop / build

```bash
npm install
npm test          # unit + integration tests (Vitest, TDD)
npm run typecheck # tsc --noEmit
npm run build     # -> dist/
npm run dev       # Vite dev server (also serves the UI dev harness, below)
npm run dev:ext   # rebuild dist/ on every change (for load-unpacked, below)

# End-to-end: loads the built extension into real Chromium and drives the
# three hard test sites. Requires the browser once: `npx playwright install chromium`.
npm run build && npm run test:e2e
```

The E2E suite (`e2e/extension.spec.ts`) is the confidence signal: it runs the
whole pipeline (wait → prep → detect → fill → CV → auto-close) against three
deliberately nasty fixture sites (see below), plus a popup render/size check. If
it's green, real boards should behave.

## Two ways to run it while developing

Pick based on what you're iterating on. **Start with the harness** for UI work;
use load-unpacked to verify against real pages and real messaging.

### A. Standalone UI harness — fast, no install (best for popup/options work)

```bash
npm run dev            # then open http://localhost:5173/dev/
```

This renders **all four surfaces** side by side in a normal browser tab — at both
a **390px phone width** and desktop — driven by a **mocked** `chrome.*` API
(`dev/mock-chrome.ts`) whose storage is backed by `localStorage`, whose content
script is faked so the popup's Fill / Reset buttons visibly change state, and
which simulates a queue session so the Start/Stop controls do something. Instant
Vite HMR, no extension install.

`dev/frame.html?page=…` opens one surface on its own: `popup`, `options`, `modal`,
or `setup`. The last two render the real Shadow-DOM classes over a fake posting —
without them those surfaces are only reachable by building the extension, loading
it unpacked and driving a real site, which is far too slow to iterate on. Add
`&session=1` to the modal to see the queue strip and the footer overflow menu.

`&state=…` picks which *flow* the surface is in — the modal takes `redirect`,
`redirect-followed`, `landed` and `empty` as well as the default filled report,
and the setup panel takes `external`. A two-step posting renders a completely
different modal body (a notice and two buttons, no report at all), so without
these it could only be seen by driving a real board. The harness index links each
one, and embeds the fixture scenario index alongside them.

> ⚠️ The harness is a *simulation*. It exercises the UI only — it does **not**
> cover real content-script injection, cross-context messaging, or real sites.
> Use load-unpacked (below) + the E2E suite for those.

### B. Load unpacked in Chrome — the real extension

1. `npm run build` (or `npm run dev:ext` to auto-rebuild `dist/` as you edit).
2. Go to `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select the `dist/` folder. (After a rebuild, click the
   extension's ↻ reload button on that page.)
4. Click the toolbar icon to open the popup, then **Manage profile, configs &
   URLs** to set your profile and upload your CV.

Tip: to inspect the popup with full DevTools instead of the cramped panel, open
it as a normal tab at `chrome-extension://<your-extension-id>/src/popup/popup.html`
(the id is shown on the `chrome://extensions` card).

> ⚠️ **`npm run dev` writes a *dev* `dist/`** that loads its code from the Vite
> server — that build only works while `npm run dev` is running, and a
> load-unpacked copy of it (or the E2E suite) will fail with
> `ERR_CONNECTION_REFUSED` once the server stops. For a standalone extension,
> use `npm run dev:ext` (watch) or `npm run build`, which emit a production
> `dist/`. Always `npm run build` before `npm run test:e2e`.

## Load on mobile

Stock **Chrome for Android does not support extensions.** Use a Chromium-based
mobile browser that does — primarily **Kiwi Browser**: menu → Extensions →
enable Developer mode → load the packed/zipped `dist/`.

Mobile is the priority target, so every surface is touch-first: a 44px minimum
for every control, the modal and setup panel become full-width bottom sheets,
status is shown by glyph as well as colour, tap-to-pick proposes a target and
waits for **Confirm** (a finger has no hover, so committing on first tap picked
whatever you happened to hit), and the picker toolbar sits at the bottom where
your thumb is. Because reaching the toolbar popup costs two or three taps through
the browser menu, the on-page modal carries the session controls too.

### Validating the UI

`.mcp.json` registers the [Playwright MCP server](https://github.com/microsoft/playwright-mcp)
with `--caps=vision`, so a browser can be driven and the **rendered** result
inspected from a screenshot. That is the right tool for the responsive surfaces —
a crushed row, an off-centre sheet grip or an unreachable button are all invisible
to a DOM assertion. It loads on Claude Code restart.

## Try it (local fixtures)

1. Open `test/fixtures/sample-form.html` in Chrome (a `file://` URL).
2. The default config (`Local test fixture`) matches `*/sample-form.html`. With a
   profile + CV saved, the form fills, the modal appears, and fields are
   highlighted. The deliberately mis-named "Where are you based?" field will be
   **unmatched (red)** — click **Pick**, then click that field, and it's saved.

### The hard test sites

`test/fixtures/sites/` contains deliberately awful pages that mirror real-world
pain, with ready configs in `test/fixtures/test-site-configs.json` (paste them
into the options "Site configurations" box, or they're auto-seeded by the E2E).

```bash
npm run dev:all        # then open http://localhost:5199/
```

**`http://localhost:5199/` lists every scenario**, grouped by flow, each with its
own URL and the outcome you should see. It is generated from
`test/fixtures/scenarios.mjs` — the same catalog the E2E suite drives — so the
page and the tests cannot disagree. The server runs on **two ports**, because
`localhost:5199`, `127.0.0.1:5199` and `127.0.0.1:5200` are three different hosts
to the extension: that is what makes the cross-origin handoff real.

Filling in place:

- **slow-boards.html** — the form is injected ~2s after load (tests `waitFor`).
- **modal-lever.html** — the form is behind an "Apply" modal, and the CV input is
  injected only after clicking "Add résumé"; fields have no id/name, only
  accessible names (tests prep steps + accessible-name matching + CV override).
- **chaos-form.html** — hashed ids, a multi-step form revealed by "Next" (prep),
  and a disguised `city` field that stays **unmatched** so you can Pick it.
- **quick-board.html** — never hands off, and is adversarial about it: `?job=plain`
  dangles an "Apply on company website" link in the sidebar that the heuristic
  would follow, and the config's quick-apply marker has to beat it.

Handing off (the two-step flow below):

- **redirect-board.html** — one board, four postings, all classified by the
  heuristic: `?job=quick` fills in place, `?job=external` hands off on its label,
  `?job=blank` on target=_blank + cross-origin alone, and `?job=tracked` through a
  302 → interstitial chain (the final URL is the one recorded).
- **external-board.html** — every posting hands off, by *configured* selector:
  `?job=link` (apply link), `?job=js` (a button with no href — the page opens its
  own tab), `?job=marker` (only a badge says it is external), `?job=nav`.
- **listing-board.html** — a search-results page with three different apply links.
  Ambiguous on purpose: it must follow **nothing**.

Destinations and edge cases:

- **ats-form.html / ats-nav.html** — employer forms with no config until a handoff
  creates one. The second submits by full-page navigation, so the `submit` event
  is the only "sent" signal there is.
- **hidden-success.html** — the confirmation banner ships with the page, hidden.
  Pressing Send must **not** count as applied; only revealing it does.

## Working through a batch (queue sessions)

Import 60 links and opening them all at once helps nobody — it is 60 tabs, 60
forms filling simultaneously, and no way to tell where you got to. A **session**
is a sliding window instead:

1. Options → **Queue** → set *Tabs at once* (default 5; 1–2 on a phone) → **Start
   session**. That many postings open in the background, staggered rather than in
   one burst.
2. Each tab fills itself as usual. You press the site's own Send, or **Skip →
   next** in the modal, or just close the tab.
3. Whichever you do, the slot frees and **the next waiting posting opens**. The
   window stays full until the queue drains.

Progress (`done / total`, applied, skipped, waiting) shows in the options Queue
tab, in the popup, and in the modal itself. **Stop session** stops refilling but
deliberately leaves open tabs alone — you are probably mid-application in one.
Closing a tab without submitting leaves that posting `opened`, not lost, so it
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
  ATS form fills straight away;
- submitting there marks the destination **and** the board posting **applied**.

Where the application opens — new tab replacing the posting (default), new tab
beside it, or the same tab — is the "Two-step applications" setting in options.

## Auto-close after submit

The extension never submits — you press the site's Send. Detecting that it was
*actually sent* is done per site via `SiteConfig.successSelector` (a confirmation
element that becomes **visible** on success). That is the reliable signal:
auto-close and "mark applied" fire only when it appears, never on a failed
attempt. Without a `successSelector`, a plain form `submit` event is the fallback
(for full-page-navigation flows). Enable auto-close and set the delay in the
options "Behavior" section.

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
  "extract": { "jobTitle": "h1", "jobDescription": "#content" },
  "fieldOverrides": { "phone": "#candidate_tel" }, // beat the heuristics
  "cvUpload": "input[type=file]",        // override CV file input
  "submitCv": [ { "action": "click", "selector": "#attach-cv" } ], // "Submit CV" button
  "successSelector": "#application-confirmation", // reliable "sent" signal (visible)
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
heuristics, CV codec (all pure logic is unit-tested). `src/content` —
orchestrator + waitFor, prep, extract, fieldDetect, fill, picker, modal, setup
panel. `src/ui` — the design tokens and component primitives every surface shares
(one copy, used by both the light-DOM pages and the shadow roots). `src/popup`,
`src/options`, `src/background` (service worker + queue session).
