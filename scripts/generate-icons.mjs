#!/usr/bin/env node
/**
 * Generates every extension icon PNG from the ONE master, `design/icon/icon.svg`.
 *
 *     npm run icons
 *
 * Chrome will not take an SVG for `manifest.icons`, so bitmaps have to exist; this
 * is how they get made. Run it after editing the master, and commit what changes.
 *
 * ## Why this is not just "scale the master down"
 *
 * Handing a 128 drawing to a rasteriser at 16 puts every edge on a fractional
 * pixel, and a fractional edge is a grey smear. Measured as the share of opaque
 * pixels that are neither the tile colour nor a bar colour:
 *
 *              scaled      snapped
 *      16px    20.9%   ->   5.1%
 *      32px     9.4%   ->   2.5%
 *      48px     6.3%   ->   2.9%
 *
 * So for the small sizes this re-derives the geometry on that size's own pixel
 * grid — same proportions, rounded so the edges land on whole pixels. From
 * SNAP_BELOW up the master is scaled verbatim, because by then the fractions are
 * a sub-pixel of a large shape and snapping would only introduce drift.
 *
 * ## Why it is a script and not hand-drawn files
 *
 * There were per-size SVGs for 16/32/48 for a while. Three hand-drawn copies of
 * one design is three things to remember to redraw together, and the first
 * eyeballed 16 came out wider, tighter-margined and stretched down the canvas —
 * it read as a different icon next to the others. Deriving them means the master
 * is the only file anyone edits, and the sizes cannot drift apart.
 *
 * ## Rounding rules (each one is a decision, not an accident)
 *
 * - Side margins are rounded once and used on BOTH sides, so the longest bar is
 *   whatever is left over. Rounding each edge independently makes them unequal.
 * - The shorter bars keep their RATIO to the longest (1 : .744 : .488), not their
 *   own fraction of the canvas — that is what holds the stepped shape together.
 * - Leftover vertical space splits with the extra pixel at the BOTTOM, which is
 *   the master's own bias (19 above, 20 below).
 * - Bar caps stay fully round (rx = h/2) at every size. At 16 a 3px bar has no
 *   pixels to curve through and the ends soften; that is accepted. Square ends
 *   make the pixels pure and read as hard and wrong beside the other sizes.
 */
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MASTER = join(ROOT, 'design/icon/icon.svg');

/** Sizes Chrome is given, and where each one goes. */
const TARGETS = [
  { size: 16, dir: 'public/icons' },
  { size: 32, dir: 'public/icons' },
  { size: 48, dir: 'public/icons' },
  { size: 128, dir: 'public/icons' },
  // Not in the manifest — the Chrome Web Store listing wants a big one.
  { size: 512, dir: 'design/icon' },
];

/** Below this, re-derive on the target's pixel grid; at or above it, scale. */
const SNAP_BELOW = 64;

/** Pull the tile and the three bars out of the master rather than duplicating them. */
async function readMaster() {
  const svg = await readFile(MASTER, 'utf8');
  const box = Number(/viewBox="0 0 (\d+)/.exec(svg)?.[1]);
  const rects = [...svg.matchAll(/<rect([^>]*)\/>/g)].map(([, attrs]) => {
    const at = (k) => {
      const m = new RegExp(`${k}="([^"]+)"`).exec(attrs);
      return m ? m[1] : undefined;
    };
    return {
      x: Number(at('x') ?? 0), y: Number(at('y') ?? 0),
      w: Number(at('width')), h: Number(at('height')),
      rx: Number(at('rx') ?? 0), fill: at('fill'),
    };
  });
  const [tile, ...bars] = rects;
  if (!box || bars.length !== 3) throw new Error(`${MASTER}: expected a tile + 3 bars`);
  return { box, tile, bars };
}

/** The master's numbers, re-rounded onto an n-pixel grid. */
function snap({ box, tile, bars }, n) {
  const k = n / box;
  const margin = Math.round(bars[0].x * k);
  const long = n - margin * 2;
  const ratio = bars.map((b) => b.w / bars[0].w);
  const h = Math.round(bars[0].h * k);
  const pitch = Math.round((bars[1].y - bars[0].y) * k);
  // Centre the stack, and give the odd pixel to the bottom (as the master does).
  const top = Math.floor((n - (h + pitch * 2)) / 2);
  return {
    n,
    tileRx: Math.round(tile.rx * k * 2) / 2,
    bars: bars.map((b, i) => ({
      x: margin, y: top + pitch * i,
      w: i === 0 ? long : Math.round(long * ratio[i]),
      h, rx: h / 2, fill: b.fill,
    })),
    tileFill: tile.fill,
  };
}

const toSvg = ({ n, tileRx, tileFill, bars }) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}" viewBox="0 0 ${n} ${n}">` +
  `<rect width="${n}" height="${n}" rx="${tileRx}" fill="${tileFill}"/>` +
  bars.map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${b.rx}" fill="${b.fill}"/>`).join('') +
  `</svg>`;

const master = await readMaster();
const masterSvg = await readFile(MASTER, 'utf8');
// Rasterising through Playwright's Chromium rather than adding an image library:
// it is already a devDependency for the e2e suite, and it is the same renderer
// Chrome will use, so what this writes is what the browser would have drawn.
// Needs `npx playwright install chromium` once (the e2e suite needs it anyway).
// CHROME_PATH overrides the binary, for environments with one already on disk.
const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
);
const tmp = join(ROOT, 'node_modules/.cache/icon-src.html');
await mkdir(dirname(tmp), { recursive: true });

for (const { size, dir } of TARGETS) {
  const svg = size < SNAP_BELOW
    ? toSvg(snap(master, size))
    : masterSvg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);

  await writeFile(tmp, `<html><body style="margin:0">${svg}</body></html>`);
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.goto(`file://${tmp}`);
  await mkdir(join(ROOT, dir), { recursive: true });
  await page.screenshot({ path: join(ROOT, dir, `icon-${size}.png`), omitBackground: true });
  await page.close();

  console.log(`  ${dir}/icon-${size}.png`.padEnd(34) + (size < SNAP_BELOW ? 'snapped to grid' : 'scaled from master'));
}

await browser.close();
await unlink(tmp).catch(() => {});
console.log('\nIcons regenerated from design/icon/icon.svg');
