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

import {
  MSG, type SessionState, type StatusResponse, type SyncState,
} from '../src/shared/messages';
import { clientProblem, normalizeClient, type SyncClient } from '../src/shared/syncConfig';
import { DEFAULT_SETTINGS } from '../src/shared/defaults';
import type { JobUrlEntry, Lesson } from '../src/shared/types';
import { applyStatus, makeEntry } from '../src/shared/jobUrls';
import { nextBatch, queueProgress } from '../src/shared/queue';

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

/**
 * `?state=fresh` — the store a brand-new profile has. The seed below ticks four
 * of the getting-started checklist's five steps off, so first-run UI is
 * otherwise unreachable in the harness.
 */
const FRESH = new URLSearchParams(location.search).get('state') === 'fresh';

/** Seed realistic data on first run so the UI isn't empty. */
function seedIfEmpty(): void {
  const all = readAll();
  // Versioned: bump it whenever the seed's shape changes, or a browser that ran the
  // harness before keeps the old store and shows none of the new data.
  const mode = FRESH ? 'fresh' : 'full-v4';
  // Keyed on the mode, not on a bare flag: the two share one localStorage, so
  // `?state=fresh` would otherwise inherit whatever the last page seeded — and
  // the page after it would inherit the empty store.
  if (all.__seeded === mode) return;
  if (FRESH) { writeAll({ __seeded: mode }); return; }
  writeAll({
    __seeded: mode,
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
      keywords: { firstName: ['christian name'] },
      customFields: [
        { id: 'c_exp', label: 'Years of experience', kind: 'text', value: '7', keywords: ['experience in years'] },
        { id: 'c_visa', label: 'Need sponsorship', kind: 'yesNo', value: 'No', keywords: ['visa sponsorship', 'right to work'] },
        { id: 'c_notice', label: 'Notice period', kind: 'text', value: '1 month', keywords: [] },
      ],
    },
    lessons: seedLessons(),
    // A queue with something in it: an empty one hides every session control,
    // which is the part of the UI most worth iterating on.
    jobUrls: seedJobUrls(),
    settings: DEFAULT_SETTINGS,
  });
}

function seedLessons(): Lesson[] {
  const at = Date.now() - 86_400_000;
  return [
    { id: 'l1', signature: { question: 'given name', kind: 'text' }, target: { field: 'firstName' }, label: 'Given name', taughtOn: 'jobs.acme.test', createdAt: at, hits: 4 },
    { id: 'l2', signature: { question: 'where are you based', kind: 'text' }, target: { field: 'city' }, label: 'Where are you based?', taughtOn: 'careers.widget.dev', createdAt: at, hits: 2 },
    { id: 'l3', signature: { question: 'name', kind: 'text', section: 'reference 1' }, target: { field: 'c_ref' }, label: 'Name', taughtOn: 'boards.example', createdAt: at, hits: 0 },
    { id: 'l4', signature: { question: 'how many years have you worked with kubernetes', kind: 'number' }, target: { field: 'c_exp' }, label: 'How many years have you worked with Kubernetes?', taughtOn: 'jobs.acme.test', createdAt: at, hits: 1 },
    { id: 'l5', signature: { question: 'how did you hear about us', kind: 'select' }, target: { ignore: true }, label: 'How did you hear about us?', taughtOn: 'jobs.acme.test', createdAt: at, hits: 6 },
    { id: 'l6', signature: { question: '', kind: 'text', host: 'boards.example' }, target: { field: 'phone' }, label: 'Unlabelled field', taughtOn: 'boards.example', createdAt: at, hits: 1 },
  ];
}

function seedJobUrls(): JobUrlEntry[] {
  const hosts = ['boards.example', 'jobs.acme.test', 'careers.widget.dev'];
  const now = Date.now();
  return Array.from({ length: 14 }, (_, i) => {
    const entry = makeEntry(`https://${hosts[i % hosts.length]}/postings/${1000 + i}`, now - i * 3600_000);
    if (i < 4) return applyStatus([entry], entry.url, 'done', now - i * 3600_000 + 600_000)[0];
    return entry;
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
    filledCount: hasRun ? FILLED : 0,
    reportedCount: hasRun ? REPORTED : 0,
    toTeach: hasRun ? REPORTED - FILLED : 0,
    hasRun,
    inQueue: sessionActive,
  };
}

function contentReply(msg: { type?: string }): StatusResponse {
  if (msg?.type === MSG.RUN) hasRun = true;
  if (msg?.type === MSG.RESET) hasRun = false;
  return fakeStatus();
}

/* --- Fake queue session: enough to drive the options queue UI. --- */

let sessionActive = false;
let sessionBatch = DEFAULT_SETTINGS.sessionBatchSize;
/** URLs the simulated session has "open"; no real tabs exist in the harness. */
let openUrls: string[] = [];

function readJobUrls(): JobUrlEntry[] {
  return (readAll().jobUrls as JobUrlEntry[]) ?? [];
}

function writeJobUrls(list: JobUrlEntry[]): void {
  writeAll({ ...readAll(), jobUrls: list });
  changeListeners.forEach((fn) => fn({}, 'local'));
}

function sessionSnapshot(): SessionState {
  return {
    active: sessionActive,
    batchSize: sessionBatch,
    progress: queueProgress(readJobUrls(), openUrls),
  };
}

/** Mirror the background's top-up: open enough postings to fill the window. */
function topUp(): void {
  if (!sessionActive) return;
  const urls = nextBatch(readJobUrls(), openUrls, sessionBatch);
  if (urls.length === 0) return;
  openUrls = [...openUrls, ...urls];
  // eslint-disable-next-line no-console
  console.log('[mock chrome] session opened', urls);
}

/* --- Fake sync: enough to walk through entering an OAuth client. --- */

function readSyncClientSync(): SyncClient {
  return normalizeClient(readAll().syncClient as Partial<SyncClient> | undefined);
}

function fakeSyncState(): SyncState {
  const { clientId } = readSyncClientSync();
  // Never connected: there is no OAuth flow behind the harness, and pretending
  // otherwise would show a Sync tab offering to sync through nothing.
  return { configured: clientId.length > 0, connected: false, clientId };
}

function backgroundReply(
  msg: { type?: string; batchSize?: number; url?: string; clientId?: string; clientSecret?: string },
): unknown {
  switch (msg?.type) {
    case MSG.SYNC_STATE:
      return fakeSyncState();
    case MSG.SYNC_SET_CLIENT: {
      const client = normalizeClient({ clientId: msg.clientId, clientSecret: msg.clientSecret });
      const clearing = !client.clientId && !client.clientSecret;
      const problem = clearing ? undefined : clientProblem(client);
      if (problem) return { error: problem };
      writeAll({ ...readAll(), syncClient: clearing ? undefined : client });
      return fakeSyncState();
    }
    case MSG.SESSION_START:
      sessionActive = true;
      if (msg.batchSize) sessionBatch = msg.batchSize;
      topUp();
      return sessionSnapshot();
    case MSG.SESSION_STOP:
      sessionActive = false;
      return sessionSnapshot();
    case MSG.SESSION_SKIP:
      if (msg.url) {
        openUrls = openUrls.filter((u) => u !== msg.url);
        writeJobUrls(applyStatus(readJobUrls(), msg.url, 'done'));
      }
      topUp();
      return sessionSnapshot();
    case MSG.SESSION_STATE:
      return sessionSnapshot();
    case MSG.QUEUE_TAB:
      return { inQueue: sessionActive, progress: sessionSnapshot().progress };
    default:
      return { ok: true };
  }
}

type ChangeListener = (changes: Record<string, unknown>, area: string) => void;
const changeListeners: ChangeListener[] = [];

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
    onChanged: {
      addListener(fn: ChangeListener) { changeListeners.push(fn); },
      removeListener(fn: ChangeListener) {
        const i = changeListeners.indexOf(fn);
        if (i >= 0) changeListeners.splice(i, 1);
      },
    },
  },
  runtime: {
    // Session messages get a simulated background; the rest just log.
    sendMessage(msg: unknown, cb?: (r: unknown) => void) {
      // eslint-disable-next-line no-console
      console.log('[mock chrome] runtime.sendMessage', msg);
      const reply = backgroundReply(msg as { type?: string });
      cb?.(reply);
      return Promise.resolve(reply);
    },
    onMessage: { addListener() {}, removeListener() {} },
    // The popup renders the build stamp from the manifest; without this the
    // whole popup throws before its first render.
    getManifest: () => ({ version: '0.0.0-dev' }),
    getURL: (p: string) => p,
    openOptionsPage: () => {
      // eslint-disable-next-line no-console
      console.log('[mock chrome] openOptionsPage()');
    },
    lastError: undefined as chrome.runtime.LastError | undefined,
  },
  // The Sync tab shows the redirect URI to paste into Google Cloud, and reads it
  // at init — without this the whole options page throws before its first render.
  identity: {
    getRedirectURL: () => 'https://dev-extension-id.chromiumapp.org/',
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
