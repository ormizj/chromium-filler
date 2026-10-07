#!/usr/bin/env node
/**
 * Decides which version `npm run package` builds, and bumps it when asked.
 *
 *     node scripts/version.mjs            # the current version, checked
 *     node scripts/version.mjs 0.1.2      # bump to 0.1.2, then print it
 *
 * The version lives in four files and nothing derives one from another:
 *
 *   package.json         names the zips
 *   package-lock.json    mirrors it (root and packages[""])
 *   manifest.config.ts   the one Chrome reads, and the only one the store compares
 *                        against what is already published
 *   design/store/LISTING.md   names the upload by filename
 *
 * So a bump writes all four, and every run — bump or not — first refuses a
 * package.json and a manifest that disagree: that is a zip named one version
 * carrying a manifest that says another.
 *
 * The format is Chrome's manifest rule, which is stricter than npm's: one to four
 * dot-separated integers, each 0–65535, no leading zeros. A `-beta` suffix is
 * valid semver and an invalid extension, so it is refused here rather than at
 * upload.
 *
 * A lower version is refused. The same version is allowed with a notice — a
 * re-package is ordinary, but the store will not take a version it already has.
 *
 * Messages go to stderr; the version to package is the only thing on stdout, so
 * package.sh can capture it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const MAX_PART = 65535;
const MANIFEST_VERSION = /^(\s*version:\s*')([^']*)(',?\s*)$/m;

/** The parts of a Chrome extension version, or throws saying what is wrong. */
export function parseVersion(s) {
  if (typeof s !== 'string' || s === '') throw new Error('the version is empty');
  const parts = s.split('.');
  if (parts.length > 4) throw new Error(`"${s}" has more than four parts`);
  return parts.map((p) => {
    if (!/^\d+$/.test(p)) {
      throw new Error(`"${s}" must be dot-separated integers (no prefix or suffix)`);
    }
    if (p.length > 1 && p.startsWith('0')) throw new Error(`"${s}" has a leading zero`);
    const n = Number(p);
    if (n > MAX_PART) throw new Error(`"${s}" has a part above ${MAX_PART}`);
    return n;
  });
}

/** Negative, zero or positive, as `a` is below, equal to or above `b`. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function readManifestVersion(src) {
  const m = MANIFEST_VERSION.exec(src);
  if (!m) throw new Error("manifest.config.ts has no `version: '…'` line");
  return m[2];
}

export function replaceManifestVersion(src, version) {
  readManifestVersion(src);
  return src.replace(MANIFEST_VERSION, `$1${version}$3`);
}

export function replaceListingVersion(md, from, to) {
  const escaped = from.replace(/\./g, '\\.');
  return md.replace(new RegExp(`chromium-filler-v${escaped}(?=[-.])`, 'g'), `chromium-filler-v${to}`);
}

function main(requested) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const file = (p) => join(root, p);
  const read = (p) => readFileSync(file(p), 'utf8');
  const readJson = (p) => JSON.parse(read(p));
  const writeJson = (p, data) => writeFileSync(file(p), `${JSON.stringify(data, null, 2)}\n`);

  const current = readJson('package.json').version;
  const manifestSrc = read('manifest.config.ts');
  const inManifest = readManifestVersion(manifestSrc);
  if (current !== inManifest) {
    throw new Error(
      `package.json says ${current} but manifest.config.ts says ${inManifest}. ` +
        'Make them agree before packaging.',
    );
  }
  parseVersion(current);

  if (!requested) return current;

  parseVersion(requested);
  const order = compareVersions(requested, current);
  if (order < 0) {
    throw new Error(`${requested} is lower than the current version ${current}.`);
  }
  if (order === 0) {
    console.error(
      `Notice: re-packaging v${current} — the version is unchanged. ` +
        'The Chrome Web Store will reject an upload of a version it already has.',
    );
    return current;
  }

  const pkg = readJson('package.json');
  pkg.version = requested;
  writeJson('package.json', pkg);

  const lock = readJson('package-lock.json');
  lock.version = requested;
  if (lock.packages?.['']) lock.packages[''].version = requested;
  writeJson('package-lock.json', lock);

  writeFileSync(file('manifest.config.ts'), replaceManifestVersion(manifestSrc, requested));

  const listing = 'design/store/LISTING.md';
  writeFileSync(file(listing), replaceListingVersion(read(listing), current, requested));

  console.error(`Version ${current} → ${requested}`);
  return requested;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(main(process.argv[2]));
  } catch (err) {
    console.error(`FAILED: ${err.message}`);
    process.exit(1);
  }
}
