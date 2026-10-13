/**
 * The queue session: the background half of "work through 60 job links".
 *
 * The old behaviour was a dump — one `chrome.tabs.create` per URL in a tight
 * loop, so importing 60 postings meant 60 tabs and 60 content scripts filling
 * at once. That is unusable on mobile and unmanageable on desktop, and there
 * was no way to tell where you were or to stop half-way.
 *
 * A session is a sliding window instead: at most `batchSize` job tabs exist at
 * any moment, and *finishing one is what opens the next* — skipping it, or simply
 * closing the tab, which also marks the posting done:
 * the user submits on the site by hand, so closing the tab is the one "done" the
 * extension ever hears. The queue itself is derived from the job-URL database
 * (see `src/shared/queue.ts`), so nothing here duplicates that state.
 *
 * State is split by lifetime: the session's existence lives in
 * `chrome.storage.local` so it survives a browser restart and can be resumed,
 * while the tab↔URL maps live in `chrome.storage.session` because tab ids mean
 * nothing across restarts.
 */

import type { QueueTabState, SessionState } from '../shared/messages';
import type { JobUrlEntry } from '../shared/types';
import { getJobUrls, getSettings, mutateJobUrls } from '../shared/storage';
import { finishOnClose, recordStatus } from '../shared/jobUrls';
import { nextBatch, queueProgress } from '../shared/queue';
import { navigableUrl } from '../shared/appLink';
import { DEFAULT_SETTINGS } from '../shared/defaults';

const LOG = '[chromium-filler:session]';

/** Gap between opens, so a batch doesn't hit the network as one thundering herd. */
const STAGGER_MS = 250;
/**
 * How long a skipped tab stays on screen before it closes: the tab vanishing under
 * the press reads as a crash rather than as the skip landing.
 */
export const SKIP_CLOSE_DELAY_MS = 1500;

const SESSION_KEY = 'queueSession';
const TABS_KEY = 'queueTabs';
/**
 * Tabs opened *from* a queue tab — the employer's form behind "Apply on company
 * website" — mapped to the queue tab they came from. They belong to the posting
 * (the chip, the card's queue strip) but are not slots: closing one finishes
 * nothing, and they never count against `batchSize`.
 */
const CHILDREN_KEY = 'queueChildTabs';

interface SessionRecord {
  active: boolean;
  batchSize: number;
  startedAt: number;
  /**
   * Every posting this session has opened. A posting is `new` until the user
   * finishes it, so status alone cannot say "already had its turn" — and without
   * this, one whose finish lost a race would reopen at the next top-up.
   * Reset when a session starts, so the next one offers the unfinished again.
   */
  opened?: string[];
}

const NO_SESSION: SessionRecord = { active: false, batchSize: DEFAULT_SETTINGS.sessionBatchSize, startedAt: 0 };

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

/** Child tab id -> the queue tab it was opened from. */
async function getChildren(): Promise<Record<string, string>> {
  const raw = await chrome.storage.session.get(CHILDREN_KEY);
  return (raw[CHILDREN_KEY] as Record<string, string>) ?? {};
}

async function setChildren(children: Record<string, string>): Promise<void> {
  await chrome.storage.session.set({ [CHILDREN_KEY]: children });
}

/**
 * The user closed a queue tab, so they are done with its posting — record that.
 * `finishOnClose` only ever moves `new`, so a
 * posting already done (Skip removes the tab from the map first, so this never
 * even runs for it) or set by hand keeps its log as it is.
 */
async function finishPostings(urls: string[]): Promise<void> {
  if (!urls.length) return;
  const now = Date.now();
  await writeJobs((list) => urls.reduce((acc, url) => finishOnClose(acc, url, now), list));
}

/**
 * The session's writes to the job list, one at a time. Two tabs closing together
 * each read-modify-write the whole list, and the second write would put back the
 * first posting's `new` — the one fact that says it still needs doing.
 */
let writes: Promise<unknown> = Promise.resolve();

function writeJobs(fn: (list: JobUrlEntry[]) => JobUrlEntry[]): Promise<unknown> {
  writes = writes.then(() => mutateJobUrls(fn), () => mutateJobUrls(fn));
  return writes;
}

/**
 * Drop tabs the user closed while the worker was asleep. Without this a dead
 * tab keeps occupying a slot forever and the session quietly stalls — and its
 * posting is finished exactly as `onTabClosed` would have finished it.
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
  if (Object.keys(live).length !== ids.length) {
    await setTabs(live);
    await finishPostings(ids.filter((id) => !(id in live)).map((id) => tabs[id]));
  }
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

/**
 * Open one queued posting, or nothing when its URL would leave the browser.
 *
 * The check is here rather than in `urlImport.ts` on purpose: the job database is
 * data and `keepInBrowser` is behaviour, so filtering on the way in would destroy
 * a URL that turning the setting off ought to bring back. An `intent://` entry
 * that carries a web address is opened at that address.
 */
async function openJobTab(url: string, keepInBrowser: boolean): Promise<chrome.tabs.Tab | undefined> {
  const target = navigableUrl(url, undefined, keepInBrowser);
  if (!target) {
    console.warn(LOG, 'not opening a posting that hands off to an app —', url);
    return undefined;
  }
  return chrome.tabs.create({ url: target, active: false }).catch((e) => {
    console.warn(LOG, 'could not open', url, e);
    return undefined;
  });
}

/** Open enough waiting postings to bring the window back up to `batchSize`. */
async function topUp(): Promise<void> {
  const record = await getRecord();
  if (!record.active) return;

  const tabs = await liveTabs();
  const inFlight = Object.values(tabs);
  const list = await getJobUrls();
  const urls = nextBatch(list, inFlight, record.batchSize, record.opened ?? []);
  if (urls.length === 0) {
    // Nothing left to open and nothing still open: the session is finished.
    if (inFlight.length === 0) {
      await setRecord({ ...record, active: false });
      console.info(LOG, 'queue drained — session complete');
    }
    return;
  }

  const next = { ...tabs };
  // A posting that failed to open has no tab in the map, so it stays waiting and
  // the next top-up tries it again. Nothing is written to the database here: a
  // posting with a tab on it is still `new` until the user finishes it.
  const opened: string[] = [];
  const { keepInBrowser } = await getSettings();
  for (const url of urls) {
    const tab = await openJobTab(url, keepInBrowser);
    if (tab?.id != null) {
      next[String(tab.id)] = url;
      opened.push(url);
      // Recorded per tab, the moment it exists — not once the whole batch has
      // opened. The page asks "did the queue open me?" as soon as it loads, and a
      // map written after the stagger would answer no to every tab but the last.
      await setTabs(next);
    }
    await delay(STAGGER_MS);
  }
  await setTabs(next);
  // Re-read: a Stop pressed during the stagger must not be written back over.
  const latest = await getRecord();
  await setRecord({ ...latest, opened: [...(latest.opened ?? []), ...opened] });
  console.info(LOG, `opened ${opened.length}, ${Object.keys(next).length} in flight`);
}

/** Begin (or resize) a session and fill the first window. */
export async function startSession(batchSize?: number): Promise<SessionState> {
  const settings = await getSettings();
  const size = Math.max(1, batchSize ?? settings.sessionBatchSize);
  const record = await getRecord();
  // A resize keeps the running session's history; a fresh start forgets it.
  await setRecord(record.active
    ? { ...record, batchSize: size }
    : { active: true, batchSize: size, startedAt: Date.now(), opened: [] });
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

/**
 * Mark a posting done, close its tab, and pull in the next one.
 *
 * `recordStatus`, not `applyStatus`: Skip is a button in the review modal, so it
 * is pressed just as often on a posting the user opened by hand as on a queued
 * one, and the latter is not in the database yet.
 *
 * The slot is freed here rather than by waiting for `onRemoved`, because the tab
 * closes only after `SKIP_CLOSE_DELAY_MS` — and a skip from a hand-opened tab
 * closes nothing the session owns.
 */
export async function skipUrl(url: string, senderTabId?: number): Promise<SessionState> {
  await writeJobs((list) => recordStatus(list, url, 'done'));

  const tabs = await getTabs();
  // Skipped from the employer's form in a child tab: the slot is its parent's.
  const children = await getChildren();
  const sender = senderTabId != null ? (children[String(senderTabId)] ?? String(senderTabId)) : undefined;
  const tabId = Number(sender ?? Object.keys(tabs).find((id) => tabs[id] === url) ?? NaN);
  if (Number.isFinite(tabId)) {
    delete tabs[String(tabId)];
    await setTabs(tabs);
    setTimeout(() => chrome.tabs.remove(tabId).catch(() => {}), SKIP_CLOSE_DELAY_MS);
  }
  // Closing the tab fires onRemoved, which tops up — but only if the tab was
  // ours to begin with, so top up here too. `serialize` keeps that idempotent.
  await serialize(topUp);
  return sessionState();
}

/**
 * A tab closed. A queue tab finishes its posting and
 * frees its slot for the next; a child tab just stops being one.
 */
export async function onTabClosed(tabId: number): Promise<void> {
  const key = String(tabId);
  const children = await getChildren();
  if (key in children) {
    delete children[key];
    await setChildren(children);
    return;
  }
  const tabs = await getTabs();
  if (!(key in tabs)) return;
  const url = tabs[key];
  delete tabs[key];
  await setTabs(tabs);
  // Its children outlive it as ordinary tabs: the posting they belonged to is done.
  for (const [child, parent] of Object.entries(children)) if (parent === key) delete children[child];
  await setChildren(children);
  await finishPostings([url]);
  await serialize(topUp);
}

/** Whether a tab belongs to the current session (used to attribute a skip). */
export async function urlForTab(tabId: number): Promise<string | undefined> {
  return (await getTabs())[String(tabId)];
}

/**
 * A tab was opened from another. If that one is a queue tab (or one of its
 * children), the new tab belongs to the same posting — always recorded against the
 * queue tab itself, so a chain of handoffs still points at the slot.
 */
export async function adoptChildTab(tabId: number, openerTabId: number): Promise<void> {
  const [tabs, children] = await Promise.all([getTabs(), getChildren()]);
  const opener = String(openerTabId);
  const root = opener in tabs ? opener : children[opener];
  if (!root) return;
  children[String(tabId)] = root;
  await setChildren(children);
}

/**
 * The page's question: did the queue open me? Answered for the sender's own tab
 * only, with the posting it belongs to and the queue's progress for the chip.
 */
export async function queueTab(tabId: number | undefined): Promise<QueueTabState> {
  if (tabId == null) return { inQueue: false };
  const [tabs, children, list] = await Promise.all([getTabs(), getChildren(), getJobUrls()]);
  const key = String(tabId);
  const root = key in tabs ? key : children[key];
  const url = root ? tabs[root] : undefined;
  if (!url) return { inQueue: false };
  return {
    inQueue: true,
    child: root !== key,
    url,
    progress: queueProgress(list, Object.values(tabs)),
  };
}

/**
 * `batchSize` is the running window while a session is active, and the saved
 * setting otherwise. The record keeps the last session's size after it stops,
 * and reporting that put the old number back in the Queue tab's field on every
 * reload — so a size chosen there looked as though it had never been saved.
 */
export async function sessionState(): Promise<SessionState> {
  const [record, tabs, list, settings] = await Promise.all([getRecord(), getTabs(), getJobUrls(), getSettings()]);
  return {
    active: record.active,
    batchSize: record.active ? record.batchSize : settings.sessionBatchSize,
    progress: queueProgress(list, Object.values(tabs)),
  };
}

/**
 * Open an explicit set of URLs (the "open these now" path, outside a session).
 * Staggered like a session batch so a hand-picked selection of 40 still doesn't
 * open as one burst.
 */
export async function openUrls(urls: string[]): Promise<void> {
  const { keepInBrowser } = await getSettings();
  for (const url of urls) {
    await openJobTab(url, keepInBrowser);
    await delay(STAGGER_MS);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
