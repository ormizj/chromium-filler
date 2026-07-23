/**
 * The queue session: the background half of "work through 60 job links".
 *
 * The old behaviour was a dump — one `chrome.tabs.create` per URL in a tight
 * loop, so importing 60 postings meant 60 tabs and 60 content scripts filling
 * at once. That is unusable on mobile and unmanageable on desktop, and there
 * was no way to tell where you were or to stop half-way.
 *
 * A session is a sliding window instead: at most `batchSize` job tabs exist at
 * any moment, and *finishing one is what opens the next* — submitting, skipping,
 * or simply closing the tab. The queue itself is derived from the job-URL
 * database (see `src/shared/queue.ts`), so nothing here duplicates that state.
 *
 * State is split by lifetime, mirroring the redirect watches in
 * `service_worker.ts`: the session's existence lives in `chrome.storage.local`
 * so it survives a browser restart and can be resumed, while the tab↔URL map
 * lives in `chrome.storage.session` because tab ids mean nothing across restarts.
 */

import type { SessionState } from '../shared/messages';
import { getJobUrls, getSettings, mutateJobUrls } from '../shared/storage';
import { applyStatus } from '../shared/jobUrls';
import { nextBatch, queueProgress } from '../shared/queue';

const LOG = '[chromium-filler:session]';

/** Gap between opens, so a batch doesn't hit the network as one thundering herd. */
const STAGGER_MS = 250;

const SESSION_KEY = 'queueSession';
const TABS_KEY = 'queueTabs';

interface SessionRecord {
  active: boolean;
  batchSize: number;
  startedAt: number;
}

const NO_SESSION: SessionRecord = { active: false, batchSize: 5, startedAt: 0 };

async function getRecord(): Promise<SessionRecord> {
  const raw = await chrome.storage.local.get(SESSION_KEY);
  return (raw[SESSION_KEY] as SessionRecord) ?? NO_SESSION;
}

async function setRecord(record: SessionRecord): Promise<void> {
  await chrome.storage.local.set({ [SESSION_KEY]: record });
}

/** Tab id (as a string key) -> the job URL it was opened for. */
async function getTabs(): Promise<Record<string, string>> {
  const raw = await chrome.storage.session.get(TABS_KEY);
  return (raw[TABS_KEY] as Record<string, string>) ?? {};
}

async function setTabs(tabs: Record<string, string>): Promise<void> {
  await chrome.storage.session.set({ [TABS_KEY]: tabs });
}

/**
 * Drop tabs the user closed while the worker was asleep. Without this a dead
 * tab keeps occupying a slot forever and the session quietly stalls.
 */
async function liveTabs(): Promise<Record<string, string>> {
  const tabs = await getTabs();
  const ids = Object.keys(tabs);
  if (ids.length === 0) return tabs;

  const live: Record<string, string> = {};
  await Promise.all(ids.map(async (id) => {
    const tab = await chrome.tabs.get(Number(id)).catch(() => undefined);
    if (tab) live[id] = tabs[id];
  }));
  if (Object.keys(live).length !== ids.length) await setTabs(live);
  return live;
}

/**
 * Serializes top-ups within this worker's lifetime. Two events landing together
 * (a tab closing while a submit is being recorded) would otherwise each see the
 * same free slot and open the same posting twice.
 */
let chain: Promise<void> = Promise.resolve();

function serialize(fn: () => Promise<void>): Promise<void> {
  chain = chain.then(fn, fn);
  return chain;
}

/** Open enough waiting postings to bring the window back up to `batchSize`. */
async function topUp(): Promise<void> {
  const record = await getRecord();
  if (!record.active) return;

  const tabs = await liveTabs();
  const inFlight = Object.values(tabs);
  const list = await getJobUrls();
  const urls = nextBatch(list, inFlight, record.batchSize);
  if (urls.length === 0) {
    // Nothing left to open and nothing still open: the session is finished.
    if (inFlight.length === 0) {
      await setRecord({ ...record, active: false });
      console.info(LOG, 'queue drained — session complete');
    }
    return;
  }

  const next = { ...tabs };
  // Only a posting that actually got a tab counts as opened. Marking one that
  // failed to open leaves the queue with nothing to close and nothing to top up
  // from — the posting would silently never be applied to.
  const opened: string[] = [];
  for (const url of urls) {
    const tab = await chrome.tabs.create({ url, active: false }).catch((e) => {
      console.warn(LOG, 'could not open', url, e);
      return undefined;
    });
    if (tab?.id != null) {
      next[String(tab.id)] = url;
      opened.push(url);
    }
    await delay(STAGGER_MS);
  }
  await setTabs(next);
  await mutateJobUrls((all) => opened.reduce((acc, url) => applyStatus(acc, url, 'opened'), all));
  console.info(LOG, `opened ${opened.length}, ${Object.keys(next).length} in flight`);
}

/** Begin (or resize) a session and fill the first window. */
export async function startSession(batchSize?: number): Promise<SessionState> {
  const settings = await getSettings();
  const size = Math.max(1, batchSize ?? settings.sessionBatchSize);
  await setRecord({ active: true, batchSize: size, startedAt: Date.now() });
  await serialize(topUp);
  return sessionState();
}

/**
 * Stop refilling. Tabs already open are deliberately left alone — the user is
 * probably mid-application in one of them.
 */
export async function stopSession(): Promise<SessionState> {
  const record = await getRecord();
  await setRecord({ ...record, active: false });
  return sessionState();
}

/** Mark a posting skipped, close its tab, and pull in the next one. */
export async function skipUrl(url: string, senderTabId?: number): Promise<SessionState> {
  await mutateJobUrls((list) => applyStatus(list, url, 'skipped'));

  const tabs = await getTabs();
  const tabId = senderTabId ?? Number(
    Object.keys(tabs).find((id) => tabs[id] === url) ?? NaN,
  );
  if (Number.isFinite(tabId)) {
    delete tabs[String(tabId)];
    await setTabs(tabs);
    await chrome.tabs.remove(tabId).catch(() => {});
  }
  // Closing the tab fires onRemoved, which tops up — but only if the tab was
  // ours to begin with, so top up here too. `serialize` keeps that idempotent.
  await serialize(topUp);
  return sessionState();
}

/** A session tab closed (submitted, skipped, or dismissed): open the next. */
export async function onTabClosed(tabId: number): Promise<void> {
  const tabs = await getTabs();
  if (!(String(tabId) in tabs)) return;
  delete tabs[String(tabId)];
  await setTabs(tabs);
  await serialize(topUp);
}

/**
 * A submission was recorded. The tab may or may not close itself (that is the
 * `closeTabOnSubmit` setting), so free its slot either way — the posting is
 * finished regardless of whether its tab lingers.
 */
export async function onSubmitted(tabId: number | undefined): Promise<void> {
  if (tabId == null) return;
  const tabs = await getTabs();
  if (!(String(tabId) in tabs)) return;
  delete tabs[String(tabId)];
  await setTabs(tabs);
  await serialize(topUp);
}

/** Whether a tab belongs to the current session (used to attribute a skip). */
export async function urlForTab(tabId: number): Promise<string | undefined> {
  return (await getTabs())[String(tabId)];
}

export async function sessionState(): Promise<SessionState> {
  const [record, tabs, list] = await Promise.all([getRecord(), getTabs(), getJobUrls()]);
  return {
    active: record.active,
    batchSize: record.batchSize,
    progress: queueProgress(list, Object.values(tabs)),
  };
}

/**
 * Open an explicit set of URLs (the "open these now" path, outside a session).
 * Staggered like a session batch so a hand-picked selection of 40 still doesn't
 * open as one burst.
 */
export async function openUrls(urls: string[]): Promise<void> {
  const opened: string[] = [];
  for (const url of urls) {
    const tab = await chrome.tabs.create({ url, active: false }).catch((e) => {
      console.warn(LOG, 'could not open', url, e);
      return undefined;
    });
    if (tab) opened.push(url); // a posting with no tab is still waiting
    await delay(STAGGER_MS);
  }
  await mutateJobUrls((list) => opened.reduce((acc, url) => applyStatus(acc, url, 'opened'), list));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
