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
  the job title, a scrollable description, and per-field status.
- **Field matching** = keyword heuristics + per-site selector overrides. Only
  high-confidence matches auto-fill; the rest are reported for one-click confirm.
- **Click/tap-to-pick overrides**, persisted to the site config.
- **CV upload** via `DataTransfer` (stored on-device in `chrome.storage.local`).
- **Job URL database + dashboard** — paste a messy text blob, every URL is
  extracted / normalized / deduped (the **URL is the unique key**); batch-open
  them and each tab auto-fills on load. Every entry tracks a timestamped status
  **history** (new → opened → applied, or skipped), with stat cards and a status
  filter.
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

This renders the **real** `popup.ts` and `options.ts` side by side in a normal
browser tab, driven by a **mocked** `chrome.*` API (`dev/mock-chrome.ts`) whose
storage is backed by `localStorage` and whose content script is faked so the
popup's Fill / Reset buttons visibly change state. Instant Vite HMR, no
extension install.

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
enable Developer mode → load the packed/zipped `dist/`. Every surface (modal,
popup, options) is responsive and touch-first.

## Try it (local fixtures)

1. Open `test/fixtures/sample-form.html` in Chrome (a `file://` URL).
2. The default config (`Local test fixture`) matches `*/sample-form.html`. With a
   profile + CV saved, the form fills, the modal appears, and fields are
   highlighted. The deliberately mis-named "Where are you based?" field will be
   **unmatched (red)** — click **Pick**, then click that field, and it's saved.

### The three hard test sites

`test/fixtures/sites/` contains deliberately awful pages that mirror real-world
pain, with ready configs in `test/fixtures/test-site-configs.json` (paste them
into the options "Site configurations" box, or they're auto-seeded by the E2E):

- **slow-boards.html** — the form is injected ~2s after load (tests `waitFor`).
- **modal-lever.html** — the form is behind an "Apply" modal, and the CV input is
  injected only after clicking "Add résumé"; fields have no id/name, only
  accessible names (tests prep steps + accessible-name matching + CV override).
- **chaos-form.html** — hashed ids, a multi-step form revealed by "Next" (prep),
  and a disguised `city` field that stays **unmatched** so you can Pick it.
- **redirect-board.html** — one board serving both kinds of posting:
  `?job=quick` fills in place, `?job=external` hands off to `ats-form.html` on
  another host (tests the two-step flow below).

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

`src/shared` — types, storage, matcher, selector, URL import, field heuristics,
CV codec (all pure logic is unit-tested). `src/content` — orchestrator + waitFor,
prep, extract, fieldDetect, fill, picker, modal. `src/popup`, `src/options`,
`src/background`.
