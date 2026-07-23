/**
 * Tiny static file server for the test fixtures (no dependencies).
 *
 * It listens on TWO ports with one handler. `isExternalUrl` compares `URL.host`,
 * which includes the port, so `localhost:5199` (the board), `127.0.0.1:5199` (the
 * employer ATS) and `127.0.0.1:5200` (a tracker / third-party ATS) are three
 * genuinely different sites to the extension — which is what makes the
 * cross-origin handoff real in E2E without touching DNS.
 *
 * Beyond static files it serves three generated things: the scenario index at
 * `/`, a 302 hop at `/r/302?to=…`, and `/queue-seed.txt` for driving a session.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLOWS, HOSTS, SCENARIOS, byFlow, queueSeedUrls } from '../test/fixtures/scenarios.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, '../test/fixtures');
const distDir = path.resolve(dirname, '../dist');
const port = Number(process.env.PORT) || 5199;
/** The second origin, for redirect chains that cross more than one host. */
const port2 = Number(process.env.PORT2) || 5200;

/**
 * The build ID that `stampBuildId` (vite.config.ts) inlines into dist as
 * "<label> · <git-hash>[+]" (label e.g. "swift-lynx-x7", suffix = one letter +
 * one digit). The BUILD_ID identifier is minified away, so we match the value by
 * its distinctive shape: the label plus the " · <hash>" anchor (the `·` is
 * U+00B7, rare in minified JS). Reading it from the freshly-built dist confirms
 * Chrome loads the same code.
 */
const BUILD_ID_RE = /[a-z]+-[a-z]+-(?:[a-z][0-9]|[0-9][a-z]) · [0-9a-f]{6,}\+?/;

/** Recursively scan dist's .js files for the stamped build ID; null if absent. */
function readBuildId(dir = distDir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = readBuildId(full);
      if (found) return found;
    } else if (entry.name.endsWith('.js')) {
      const match = fs.readFileSync(full, 'utf8').match(BUILD_ID_RE);
      if (match) return match[0];
    }
  }
  return null;
}

/** ANSI colors, unless NO_COLOR is set. Keeps the summary readable when piped. */
const C = process.env.NO_COLOR
  ? { reset: '', dim: '', mag: '', label: '' }
  : { reset: '\x1b[0m', dim: '\x1b[2m', mag: '\x1b[35m', label: '\x1b[1m\x1b[97m\x1b[45m' };

/** The extension's version (from package.json), shown alongside the build ID. */
function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(dirname, '../package.json'), 'utf8')).version;
  } catch {
    return '?';
  }
}

/**
 * Print the build ID and fixture URLs — the last thing shown, easy to click.
 * Field order matches how the extension shows it (version, hash, label), with
 * the label last and highlighted since it's the bit you scan for.
 *
 * Every scenario is listed, grouped by flow, because a scenario you cannot see
 * the URL of is a scenario nobody runs — the index page at `/` is the same list
 * with the expected outcome spelled out.
 */
function printSummary() {
  const id = readBuildId() ?? 'pending';
  const [label, ...rest] = id.split(' · ');
  const hash = rest.join(' · ');
  const bar = `${C.mag}${'─'.repeat(60)}${C.reset}`;
  const meta = `${C.dim}v${readVersion()}${hash ? ` · ${hash}` : ''}${C.reset}`;
  const lines = [
    '',
    bar,
    `  ${meta} ${C.dim}·${C.reset} ${C.label} ${label} ${C.reset}`,
    bar,
    `  ${C.mag}▸${C.reset} all scenarios: ${HOSTS.board}/`,
    '',
  ];
  for (const flow of FLOWS) {
    const items = byFlow(flow.id);
    if (items.length === 0) continue;
    lines.push(`  ${C.dim}${flow.title}${C.reset}`);
    for (const s of items) lines.push(`    ${C.mag}·${C.reset} ${s.url}`);
  }
  lines.push('');
  console.log(lines.join('\n'));
}

/**
 * Wait for the concurrent `vite build --watch` to settle before printing, so we
 * report the fresh build rather than a stale dist. Watch dist, debounce writes,
 * then print once; a fallback fires if dist is already built (no write activity).
 */
function printSummaryAfterBuild() {
  let done = false;
  const finish = (watcher) => {
    if (done) return;
    done = true;
    try {
      watcher?.close();
    } catch {
      /* ignore */
    }
    printSummary();
  };

  let watcher;
  let settle;
  try {
    watcher = fs.watch(distDir, { recursive: true }, () => {
      clearTimeout(settle);
      settle = setTimeout(() => finish(watcher), 600);
    });
  } catch {
    /* dist may not exist yet; the fallback still prints */
  }
  setTimeout(() => finish(watcher), 3000);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.mjs': 'text/javascript',
  '.txt': 'text/plain; charset=utf-8',
};

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

/**
 * The scenario index: every addressable scenario with the outcome you should see,
 * grouped by flow. This is the page to keep open while working on the extension —
 * it is generated from the catalog, so it can never drift from what E2E drives.
 */
function indexPage() {
  const groups = FLOWS.map((flow) => {
    const items = byFlow(flow.id);
    if (items.length === 0) return '';
    const cards = items.map((s) => `
      <li class="card">
        <a href="${escapeHtml(s.url)}">${escapeHtml(s.title)}</a>
        <p class="expect">${escapeHtml(s.expect)}</p>
        <p class="meta"><code>${escapeHtml(s.url)}</code>${
          s.config ? ` · config <code>${escapeHtml(s.config)}</code>` : ' · <em>no config — created on landing</em>'
        }</p>
      </li>`).join('');
    return `<section><h2>${escapeHtml(flow.title)}</h2><ul>${cards}</ul></section>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="data:," />
    <title>Chromium Filler — fixture scenarios</title>
    <style>
      body { font: 15px/1.6 system-ui, sans-serif; max-width: 780px; margin: 0 auto; padding: 24px 16px 64px; color: #111827; }
      h1 { font-size: 20px; margin: 0 0 4px; }
      .lead { color: #6b7280; margin: 0 0 24px; }
      h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; margin: 28px 0 8px; }
      ul { list-style: none; margin: 0; padding: 0; }
      .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; margin: 8px 0; }
      .card a { font-weight: 600; color: #4f46e5; text-decoration: none; }
      .card a:hover { text-decoration: underline; }
      .expect { margin: 4px 0 6px; }
      .meta { margin: 0; color: #6b7280; font-size: 12px; word-break: break-all; }
      code { background: #f3f4f6; padding: 1px 4px; border-radius: 4px; }
      .hosts { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 14px; font-size: 13px; }
      @media (prefers-color-scheme: dark) {
        body { background: #0b0f19; color: #e5e7eb; }
        .card, .hosts { border-color: #1f2937; }
        .hosts { background: #111827; }
        code { background: #1f2937; }
        .card a { color: #a5b4fc; }
      }
    </style>
  </head>
  <body>
    <h1>Chromium Filler — fixture scenarios</h1>
    <p class="lead">One entry per addressable scenario. Load the unpacked extension from
      <code>dist/</code> with the configs from <code>test/fixtures/test-site-configs.json</code>,
      then work down the list: each card says what should happen.</p>
    <p class="hosts">
      board <code>${escapeHtml(HOSTS.board)}</code> ·
      employer <code>${escapeHtml(HOSTS.employer)}</code> ·
      tracker <code>${escapeHtml(HOSTS.tracker)}</code><br />
      Different ports are different hosts to the extension, which is what makes the
      cross-origin handoff real here.
    </p>
    ${groups}
  </body>
</html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'content-type': TYPES['.html'] });
    return res.end(indexPage());
  }

  // A real server redirect, so a chain has a hop that never renders — the final
  // URL, not this one, is what the extension must record.
  if (pathname === '/r/302') {
    const to = url.searchParams.get('to') ?? '';
    if (!/^https?:\/\//i.test(to)) {
      res.writeHead(400);
      return res.end('bad ?to=');
    }
    res.writeHead(302, { location: to });
    return res.end();
  }

  if (pathname === '/queue-seed.txt') {
    res.writeHead(200, { 'content-type': TYPES['.txt'] });
    return res.end(`${queueSeedUrls().join('\n')}\n`);
  }

  const file = path.join(root, pathname);
  if (!file.startsWith(root)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`fixtures served on http://localhost:${port} (${SCENARIOS.length} scenarios)`);
  if (process.env.PRINT_URLS) printSummaryAfterBuild();
});

// The same handler on a second port: one server object cannot listen twice, so
// the tracker origin gets its own, sharing every route above.
http.createServer((req, res) => server.emit('request', req, res)).listen(port2, () => {
  console.log(`fixtures also served on http://127.0.0.1:${port2} (tracker origin)`);
});
