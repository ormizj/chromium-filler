/**
 * A mock `chrome.*` API for the standalone dev harness (see dev/README-less
 * note in the repo README). It lets the REAL popup.ts / options.ts run inside
 * an ordinary browser tab — no extension install — so the UI can be iterated on
 * with instant Vite HMR.
 *
 * IMPORTANT: this is a *simulation*. `chrome.storage.local` is backed by
 * `localStorage` (so edits persist across reloads), and the content script is
 * faked so the popup's Fill / Reset buttons visibly change state. It does NOT
 * exercise real messaging, real content-script injection, or real sites — those
 * are only covered by the load-unpacked flow and the Playwright E2E suite.
 *
 * This module assigns `globalThis.chrome` at import time, so it MUST be imported
 * before any code that reads `chrome.*` (the harness imports it first).
 */

import { MSG, type StatusResponse } from '../src/shared/messages';
import { DEFAULT_SETTINGS, EXAMPLE_SITE_CONFIG } from '../src/shared/defaults';

const LS_KEY = 'cf-dev:store';

function readAll(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeAll(obj: Record<string, unknown>): void {
  localStorage.setItem(LS_KEY, JSON.stringify(obj));
}

/** Seed realistic data on first run so the UI isn't empty. */
function seedIfEmpty(): void {
  const all = readAll();
  if (all.__seeded) return;
  writeAll({
    __seeded: true,
    profile: {
      values: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        fullName: 'Ada Lovelace',
        email: 'ada@example.com',
        phone: '+1 555 123 4567',
        city: 'London',
        coverLetter: 'I love building widgets.',
      },
      custom: {},
    },
    siteConfigs: [EXAMPLE_SITE_CONFIG],
    jobUrls: [],
    settings: DEFAULT_SETTINGS,
  });
}
seedIfEmpty();

type StorageKeys = string | string[] | Record<string, unknown> | null | undefined;

function storageGet(keys: StorageKeys): Promise<Record<string, unknown>> {
  const all = readAll();
  if (keys == null) return Promise.resolve({ ...all });
  const out: Record<string, unknown> = {};
  if (typeof keys === 'string') {
    if (keys in all) out[keys] = all[keys];
  } else if (Array.isArray(keys)) {
    for (const k of keys) if (k in all) out[k] = all[k];
  } else {
    for (const [k, def] of Object.entries(keys)) out[k] = k in all ? all[k] : def;
  }
  return Promise.resolve(out);
}

function storageSet(items: Record<string, unknown>): Promise<void> {
  const all = readAll();
  writeAll({ ...all, ...items });
  return Promise.resolve();
}

function storageRemove(keys: string | string[]): Promise<void> {
  const all = readAll();
  for (const k of Array.isArray(keys) ? keys : [keys]) delete all[k];
  writeAll(all);
  return Promise.resolve();
}

/* --- Fake content script: the popup talks to a "matched" page. --- */

let hasRun = false;
const REPORTED = 6;
const FILLED = 5;

function fakeStatus(): StatusResponse {
  return {
    siteMatched: true,
    siteName: EXAMPLE_SITE_CONFIG.name,
    configId: EXAMPLE_SITE_CONFIG.id,
    filledCount: hasRun ? FILLED : 0,
    reportedCount: hasRun ? REPORTED : 0,
    hasRun,
  };
}

function contentReply(msg: { type?: string }): StatusResponse {
  if (msg?.type === MSG.RUN) hasRun = true;
  if (msg?.type === MSG.RESET) hasRun = false;
  return fakeStatus();
}

const mockChrome = {
  storage: {
    local: {
      get: storageGet,
      set: storageSet,
      remove: storageRemove,
      clear: () => {
        localStorage.removeItem(LS_KEY);
        seedIfEmpty();
        return Promise.resolve();
      },
    },
    onChanged: { addListener() {}, removeListener() {} },
  },
  runtime: {
    // popup -> OPEN_OPTIONS, options -> OPEN_URLS: just log in the harness.
    sendMessage(msg: unknown, cb?: (r: unknown) => void) {
      // eslint-disable-next-line no-console
      console.log('[mock chrome] runtime.sendMessage', msg);
      cb?.({ ok: true });
      return Promise.resolve({ ok: true });
    },
    onMessage: { addListener() {}, removeListener() {} },
    getURL: (p: string) => p,
    openOptionsPage: () => {
      // eslint-disable-next-line no-console
      console.log('[mock chrome] openOptionsPage()');
    },
    lastError: undefined as chrome.runtime.LastError | undefined,
  },
  tabs: {
    query: () =>
      Promise.resolve([
        { id: 1, active: true, url: 'https://example.com/sample-form.html' },
      ]),
    // popup uses the callback form of sendMessage.
    sendMessage(_tabId: number, msg: { type?: string }, cb?: (r: unknown) => void) {
      const reply = contentReply(msg);
      cb?.(reply);
      return Promise.resolve(reply);
    },
    create: (props: unknown) => {
      // eslint-disable-next-line no-console
      console.log('[mock chrome] tabs.create', props);
      return Promise.resolve({ id: Date.now() });
    },
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).chrome = mockChrome;
