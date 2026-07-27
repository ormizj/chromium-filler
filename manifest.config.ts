import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Chromium Filler',
  version: '0.1.0',
  description: 'Auto-fills job application forms with per-site config, a review report, and click-to-pick overrides.',
  // `identity` is for syncing the job database through a Google Drive app folder
  // (see src/shared/syncConfig.ts). Deliberately no `alarms`: sync runs when the
  // user presses Sync now and once at browser startup, never on a timer.
  permissions: ['storage', 'unlimitedStorage', 'tabs', 'scripting', 'activeTab', 'identity'],
  // Already broad enough for googleapis.com; nothing was added for sync.
  host_permissions: ['<all_urls>'],
  // A `key` pins the extension ID. Unpacked, the ID is derived from the install
  // path, so without one the same extension on two machines is two different
  // applications to Google, with a redirect URI each. Optional: Options → Sync
  // shows this browser's URI to copy, and adding both to the same OAuth client
  // works as well. Paste the "key" field from a packed .crx, or from
  // `chrome://extensions` → Pack extension, to avoid that.
  // key: '<base64 public key>',
  // The three review statuses — filled / to check / unmatched — as the report's own
  // bars, on the warm-ink tile. Sources and the reasoning are in `design/icon/`.
  // Chrome does not swap the action icon per toolbar theme, so one tile has to
  // survive both: the bars carry the DARK-block `--ok`/`--warn`/`--err`, because
  // the surface they sit on is dark.
  //
  // These four PNGs are GENERATED. `design/icon/icon.svg` is the only file to edit;
  // `npm run icons` re-derives every size from it (scripts/generate-icons.mjs, which
  // documents the rounding rules). Chrome will not take an SVG here, which is the
  // only reason bitmaps exist at all. Do not hand-edit a PNG — the next run of the
  // script silently overwrites it.
  //
  // Below 64px the script re-derives the geometry on that size's own pixel grid
  // rather than scaling: a scaled edge lands on a fractional pixel and renders as a
  // grey smear, which at 16 is a fifth of the icon. There were hand-drawn per-size
  // SVGs for a while and they are gone on purpose — three copies of one design is
  // three things to remember to redraw together, and the first eyeballed 16 came
  // out wider and stretched and read as a different icon beside the others.
  //
  // Worth knowing before optimising the 16: at 2x device pixel ratio Chrome draws
  // the toolbar button from icon-32.png, so on any HiDPI screen the 16 is only ever
  // seen on the extensions page.
  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },
  action: {
    default_popup: 'src/popup/popup.html',
    default_title: 'Chromium Filler',
    // Same four files as `icons`. Both keys are needed: `icons` is the extensions
    // page, the store listing and the puzzle-piece menu; `default_icon` is the
    // toolbar button. Omit this one and the toolbar falls back to a grey initial.
    default_icon: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
  },
  options_page: 'src/options/options.html',
  background: {
    service_worker: 'src/background/service_worker.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/main.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
});
