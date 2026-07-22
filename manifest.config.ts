import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Chromium Filler',
  version: '0.1.0',
  description: 'Auto-fills job application forms with per-site config, a review report, and click-to-pick overrides.',
  permissions: ['storage', 'unlimitedStorage', 'tabs', 'scripting', 'activeTab'],
  host_permissions: ['<all_urls>'],
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
