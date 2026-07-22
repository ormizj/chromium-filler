/** Tiny static file server for the test fixtures (no dependencies). */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/fixtures');
const port = Number(process.env.PORT) || 5199;

/** The fixture pages to open in the browser when OPEN_SITES is set (dev, not E2E). */
const SITES = ['slow-boards', 'modal-lever', 'chaos-form'];

/** Open a URL in the OS default browser (macOS/Windows/Linux). */
function openInBrowser(url) {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [url], { shell: process.platform === 'win32', stdio: 'ignore', detached: true }).unref();
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
    if (process.env.OPEN_SITES) {
      for (const site of SITES) openInBrowser(`http://localhost:${port}/sites/${site}.html`);
    }
  });
