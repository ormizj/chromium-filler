# Chromium Filler

A Manifest V3 Chrome extension that auto-fills job application forms with
per-site config, a review report, and click-to-pick overrides.

## Overview

You open a job application URL and the extension does the tedious part:

1. A content script matches the page against a saved **per-site config**.
2. It waits for the (often slow) form to render, then runs any prep steps
   (e.g. expand the description, open the CV upload modal).
3. It shows a Shadow-DOM modal with the **job title**, a scrollable
   **description**, and a **field report**.
4. It **auto-fills high-confidence fields** — including CV upload via
   `DataTransfer`.

You only ever press the site's own **Send** button. The extension never
auto-submits.

## Key constraint: never silently miss a field

Filling is automatic, but the report always tells you exactly what happened:

- 🟢 **Filled** — matched with high confidence.
- 🟡 **Low confidence** — filled but worth a glance.
- 🔴 **Unmatched** — needs your attention.

For anything unmatched or wrong, create an **override** by click/tap-to-pick
on the real element; the generated selector is saved into that site's config.

## Tech

- **TypeScript + Vite** via [`@crxjs/vite-plugin`](https://crxjs.dev/), MV3.
- Data in `chrome.storage.local`; the CV binary lives in **IndexedDB**.
- URL import: paste messy text → extract / normalize / dedupe URLs.
- **Tests:** Vitest + jsdom, written test-first (TDD) for pure logic
  (parsers, matchers, selector generators, heuristics, storage codecs).
- **Mobile-friendly:** responsive bottom-sheet modal; targets Kiwi Browser
  since stock Chrome for Android has no extension support.

## Scripts

| Command             | Description                              |
| ------------------- | ---------------------------------------- |
| `npm run dev`       | Start Vite in dev/watch mode.            |
| `npm run build`     | Type-check then build the extension.     |
| `npm test`          | Run Vitest in watch mode.                |
| `npm run test:run`  | Run the test suite once.                 |
| `npm run typecheck` | Type-check with `tsc --noEmit`.          |

## Install (unpacked)

```bash
npm install
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load
unpacked**, and select the generated `dist/` directory.

## Permissions

Declared in `manifest.config.ts`: `storage`, `tabs`, `scripting`, and
`activeTab`, plus `<all_urls>` host access so it can run on any job site.

## License

Released under the [MIT License](LICENSE).
