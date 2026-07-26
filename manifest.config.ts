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
  // applications to Google and only one of them matches the OAuth client's
  // redirect URI. Paste the "key" field from a packed .crx, or from
  // `chrome://extensions` → Pack extension, before setting up sync.
  // key: '<base64 public key>',
  action: {
    default_popup: 'src/popup/popup.html',
    default_title: 'Chromium Filler',
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
