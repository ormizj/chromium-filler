import { defineConfig } from '@playwright/test';

/**
 * E2E tests load the *built* extension (dist/) into a real Chromium and drive
 * the fixture scenarios (`test/fixtures/scenarios.mjs`). Run `npm run build`
 * first. The fixtures are served over HTTP so match-patterns and content scripts
 * behave like the web, on two ports so a handoff can cross real origins.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  webServer: {
    command: 'node e2e/server.mjs',
    url: 'http://localhost:5199/sites/slow-boards.html',
    reuseExistingServer: true,
    env: { PORT: '5199', PORT2: '5200' },
  },
});
