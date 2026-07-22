/** Tiny static file server for the test fixtures (no dependencies). */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/fixtures');
const port = Number(process.env.PORT) || 5199;
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
  .listen(port, () => console.log(`fixtures served on http://localhost:${port}`));
