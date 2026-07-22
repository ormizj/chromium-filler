import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    target: 'es2022',
    // MV3 content scripts must not rely on runtime ESM imports; @crxjs handles
    // wrapping, but keep chunking predictable for the service worker/content.
    rollupOptions: {},
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
});
