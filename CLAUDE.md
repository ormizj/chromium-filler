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

E2E loads the built extension into real Chromium (`npx playwright install chromium`
once). Always `npm run build` before `npm run test:e2e` — the suite loads `dist/`.

## Architecture

MV3 Chrome extension that auto-fills job-application forms. It **never submits** —
the user presses the site's own Send button. Filling is automatic but **never
silent**: a Shadow-DOM review modal reports every field as filled (green) /
low-confidence (yellow) / unmatched (red).

Three runtime contexts, all sharing `src/shared` (which holds every piece of
pure, unit-tested logic):

- **`src/content`** — the per-page orchestrator (`main.ts` `Controller`). On a
  matching page: wait for slow form (`waitForForm.ts`) → run prep steps
  (`prep.ts`) → extract job title/description (`extract.ts`) → detect fields
  (`fieldDetect.ts`) → fill high-confidence only, incl. CV via DataTransfer
  (`fill.ts`) → show modal (`modal/`). `picker.ts` = click/tap-to-pick override.
- **`src/background/service_worker.ts`** — batch-opens job URLs, opens options,
  handles the `SUBMITTED` message (mark URL applied + optional tab close).
- **`src/popup`, `src/options`** — popup triggers run/reset; options manages
  profile, CV, site configs, behavior settings, and the job-URL dashboard.

Cross-context messaging goes through the typed `MSG` contract in
`src/shared/messages.ts` (payloads must be structured-clone friendly).

### Data model & storage
`src/shared/types.ts` is the source of truth: `Profile`, `SiteConfig`,
`JobUrlEntry`, `Settings`, `StoredState`. Everything persists in
`chrome.storage.local` via typed wrappers in `storage.ts`. `FieldKey` enumerates
every fillable field (`resume` = the CV file).

`SiteConfig` drives per-site behavior: `urlPatterns` (match-pattern or `/regex/`),
`waitFor`, `prep`, `extract`, `fieldOverrides` (beat the heuristics), `cvUpload`,
`submitCv`, `autoDetect`, `successSelector`.

### Job-URL database
`src/shared/jobUrls.ts` (pure) — `addUrls` dedupes by URL (the unique key),
`applyStatus` records status transitions with timestamped history
(new → opened → applied / skipped), `jobUrlStats` aggregates for the dashboard.
`urlImport.ts` extracts/normalizes/dedupes URLs from a pasted text blob.

## Non-obvious constraints (do not regress)

- **Content scripts share the PAGE's origin**, not the extension's — so the CV
  is stored in `chrome.storage.local` (base64, needs `unlimitedStorage`), NOT
  extension IndexedDB. See `cvStore.ts`.
- **`successSelector` must be VISIBLE**, not merely present — sites pre-render
  hidden success nodes. The `MutationObserver` in `main.ts` watches `style`/
  `class`/`hidden` attribute flips. This is the authoritative "actually sent"
  signal; a bare `submit` event is only the fallback for full-page-nav flows
  (AJAX fires `submit` before the server confirms and may still fail).
- **Never auto-submit.** Only fill and report.
- Field matching normalizes attributes with diacritics stripped, so "Résumé"
  matches "resume" (`normalizeAttr` in `src/shared/fieldKeys.ts`).
- **Playwright must use `channel: 'chromium'`** — the headless shell can't load
  extensions. `worker.url()` is a method, not a property.

## Testing conventions

TDD: for pure/testable logic (parsers, matchers, selector generators,
heuristics, storage codecs) write the failing Vitest test first, then implement.
Vitest runs under jsdom with a small `chrome.*` mock in `test/setup.ts`.
`*.test.ts` files sit next to the code they cover in `src/shared` and
`src/content`. The three hard fixture sites (`test/fixtures/sites/`,
configs in `test-site-configs.json`) mirror real-world pain and are the E2E
confidence signal — keep them green.
