/**
 * Per-page harness bootstrap. Loaded by dev/frame.html with `?page=popup` or
 * `?page=options`. It:
 *   1. installs the mock `chrome.*` (import side effect, must be first),
 *   2. pulls the REAL popup/options HTML so there's no markup duplication,
 *   3. injects that page's stylesheet + body markup, then
 *   4. dynamically imports the REAL popup.ts / options.ts to drive it.
 */

import './mock-chrome';

type Page = 'popup' | 'options';

const page = (new URLSearchParams(location.search).get('page') as Page) || 'popup';
const base = `/src/${page}`;

async function boot(): Promise<void> {
  const html = await (await fetch(`${base}/${page}.html`)).text();
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Re-attach the page's own stylesheet(s) with absolute hrefs.
  for (const link of Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))) {
    const href = link.getAttribute('href') || '';
    const abs = href.startsWith('.') ? `${base}/${href.replace(/^\.\//, '')}` : href;
    const el = document.createElement('link');
    el.rel = 'stylesheet';
    el.href = abs;
    document.head.appendChild(el);
  }

  // Inject the markup (innerHTML does NOT run the page's <script>, so popup.ts /
  // options.ts run exactly once — via the dynamic import below).
  document.body.innerHTML = doc.body.innerHTML;

  await import(/* @vite-ignore */ `${base}/${page}.ts`);
}

boot().catch((e) => console.error('[harness] failed to boot', page, e));
