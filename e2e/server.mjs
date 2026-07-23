/** Tiny static file server for the test fixtures (no dependencies). */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, '../test/fixtures');
const distDir = path.resolve(dirname, '../dist');
const port = Number(process.env.PORT) || 5199;

/** The fixture pages to surface when PRINT_URLS is set (dev, not E2E). */
const SITES = ['slow-boards', 'modal-lever', 'chaos-form', 'redirect-board'];

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
 */
function printSummary() {
  const id = readBuildId() ?? 'pending';
  const [label, ...rest] = id.split(' · ');
  const hash = rest.join(' · ');
  const bar = `${C.mag}${'─'.repeat(46)}${C.reset}`;
  const meta = `${C.dim}v${readVersion()}${hash ? ` · ${hash}` : ''}${C.reset}`;
  const lines = [
    '',
    bar,
    `  ${meta} ${C.dim}·${C.reset} ${C.label} ${label} ${C.reset}`,
    bar,
    ...SITES.map((site) => `  ${C.mag}▸${C.reset} http://localhost:${port}/sites/${site}.html`),
    '',
  ];
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
};

http
  .createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
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
  })
  .listen(port, () => {
    console.log(`fixtures served on http://localhost:${port}`);
    if (process.env.PRINT_URLS) printSummaryAfterBuild();
  });
