import { defineConfig, type Plugin } from 'vite';
import { execSync } from 'node:child_process';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

/**
 * Replaces the `__BUILD_ID__` sentinel (see src/shared/buildId.ts) with a fresh
 * "<label> · <git-hash>" on every build — including each incremental rebuild
 * under `vite build --watch` (dev:all), since `buildStart`/`renderChunk` run per
 * build. The random label changes every build, so it (not a timestamp) is how
 * you tell what code Chrome is actually running.
 */
const ADJECTIVES = ['brave', 'calm', 'clever', 'eager', 'fuzzy', 'jolly', 'lucky', 'mighty', 'nimble', 'quiet', 'rapid', 'sly', 'sunny', 'swift', 'witty', 'zesty'];
const ANIMALS = ['otter', 'lynx', 'panda', 'falcon', 'koala', 'gecko', 'moose', 'raven', 'shark', 'tiger', 'walrus', 'yak', 'badger', 'heron', 'newt', 'quokka'];
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
/**
 * A memorable random label (e.g. "swift-lynx-x7") so builds are distinct at a
 * glance. Suffix is always one digit + one letter in a random order (never two
 * of the same kind), so it stays easy to read aloud.
 */
const randomLabel = (): string => {
  const digit = '0123456789'[Math.floor(Math.random() * 10)];
  const letter = 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)];
  const suffix = Math.random() < 0.5 ? `${digit}${letter}` : `${letter}${digit}`;
  return `${pick(ADJECTIVES)}-${pick(ANIMALS)}-${suffix}`;
};

function stampBuildId(): Plugin {
  let id = '';
  const git = (args: string): string => {
    try {
      return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return '';
    }
  };
  return {
    name: 'stamp-build-id',
    buildStart() {
      const hash = git('rev-parse --short HEAD');
      const dirty = git('status --porcelain').length > 0;
      // No timestamp — the random label is the freshness signal; the git hash
      // tells you the commit. A date added noise without being useful.
      id = `${randomLabel()}${hash ? ` · ${hash}${dirty ? '+' : ''}` : ''}`;
    },
    renderChunk(code) {
      if (!code.includes('__BUILD_ID__')) return null;
      return { code: code.replaceAll('__BUILD_ID__', id), map: null };
    },
  };
}

/**
 * `--mode store` is the Chrome Web Store build (see scripts/package.sh). The
 * only thing it changes is minification, and the reason is the review: minified
 * code is allowed — obfuscation is what the policy bans — but "hard-to-review
 * code" is named in Chrome's own review-process page as a thing that draws extra
 * scrutiny, and this extension already asks for `<all_urls>`. So the archive a
 * reviewer opens carries the code as authored. Every other build stays minified.
 *
 * A mode rather than an env var because `types` in tsconfig.json deliberately
 * excludes Node's globals, so `process.env` does not type-check here.
 */
export default defineConfig(({ mode }) => ({
  plugins: [crx({ manifest }), stampBuildId()],
  build: {
    target: 'es2022',
    minify: mode === 'store' ? false : 'esbuild',
    // MV3 content scripts must not rely on runtime ESM imports; @crxjs handles
    // wrapping, but keep chunking predictable for the service worker/content.
    rollupOptions: {},
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
}));
