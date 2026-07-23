/**
 * Background service worker: batch-opens job URLs, opens the options page, and
 * owns the two-step ("redirect") handoff — the one part of the flow a content
 * script cannot see, because the destination is a different page, often in a
 * different tab, reached through tracker/302 hops.
 */

import { MSG, type FollowRedirectResponse, type Message } from '../shared/messages';
import { getSettings, mutateJobUrls } from '../shared/storage';
import { applyStatusChain, linkRedirect } from '../shared/jobUrls';
import { isExternalUrl } from '../shared/redirect';
import { DEFAULT_STATE } from '../shared/defaults';
import {
  onSubmitted, onTabClosed, openUrls, sessionState, skipUrl, startSession, stopSession,
} from './session';

const LOG = '[chromium-filler:bg]';

/** How long a still-navigating tab keeps producing events before we settle on its URL. */
const SETTLE_MS = 1200;
/** A handoff that hasn't landed by now is abandoned (login wall, closed tab, ...). */
const WATCH_TTL_MS = 90_000;

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    const existing = await chrome.storage.local.get('siteConfigs');
    if (!existing.siteConfigs) {
      await chrome.storage.local.set({ ...DEFAULT_STATE });
    }
  }
});

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  if (msg.type === MSG.OPEN_URLS) {
    openUrls(msg.urls)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === MSG.SUBMITTED) {
    handleSubmitted(msg.url, _sender.tab?.id)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === MSG.FOLLOW_REDIRECT) {
    followRedirect(msg.sourceUrl, msg.href, _sender.tab)
      .then(sendResponse)
      .catch((e) => sendResponse({ error: String(e) } satisfies FollowRedirectResponse));
    return true;
  }
  if (msg.type === MSG.SESSION_START) {
    startSession(msg.batchSize).then(sendResponse).catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  if (msg.type === MSG.SESSION_STOP) {
    stopSession().then(sendResponse).catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  if (msg.type === MSG.SESSION_STATE) {
    sessionState().then(sendResponse).catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  if (msg.type === MSG.SESSION_SKIP) {
    skipUrl(msg.url, _sender.tab?.id).then(sendResponse).catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  if (msg.type === MSG.OPEN_OPTIONS) {
    const url = msg.createForUrl
      ? `${chrome.runtime.getURL('src/options/options.html')}#create=${encodeURIComponent(msg.createForUrl)}`
      : undefined;
    if (url) chrome.tabs.create({ url });
    else chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

async function handleSubmitted(url: string, tabId: number | undefined): Promise<void> {
  // Mark the URL applied, and with it the board posting it was reached from —
  // the application belongs to that posting even though it was sent elsewhere.
  await mutateJobUrls((list) => applyStatusChain(list, url, 'applied'));

  // Free this posting's session slot and pull in the next one. This is what
  // makes a session self-refilling: finishing an application is the trigger.
  await onSubmitted(tabId);

  // Optionally close the tab after a short delay so the request completes.
  const settings = await getSettings();
  if (settings.closeTabOnSubmit && tabId != null) {
    const delay = Math.max(0, settings.closeTabDelayMs ?? 1500);
    setTimeout(() => chrome.tabs.remove(tabId).catch(() => {}), delay);
  }
}

/** A closed job tab frees its slot, whether it was submitted, skipped, or given up on. */
chrome.tabs.onRemoved.addListener((tabId) => {
  void onTabClosed(tabId).catch((e) => console.warn(LOG, 'session top-up failed', e));
});

/* ---------------- Two-step (redirect) handoff ---------------- */

interface RedirectWatch {
  /** The board posting that started the handoff. */
  sourceUrl: string;
  sourceTabId: number;
  startedAt: number;
}

const WATCH_KEY = 'redirectWatches';

/**
 * Watches live in session storage, keyed by tab: the service worker can be torn
 * down between the click and the landing, and an in-memory map would take the
 * link with it.
 */
async function getWatches(): Promise<Record<string, RedirectWatch>> {
  const raw = await chrome.storage.session.get(WATCH_KEY);
  return (raw[WATCH_KEY] as Record<string, RedirectWatch>) ?? {};
}

async function setWatches(watches: Record<string, RedirectWatch>): Promise<void> {
  await chrome.storage.session.set({ [WATCH_KEY]: watches });
}

async function armWatch(tabId: number, watch: RedirectWatch): Promise<void> {
  const watches = await getWatches();
  watches[String(tabId)] = watch;
  await setWatches(watches);
}

/** Drop every watch for this handoff (source tab and any tab it opened). */
async function clearWatchesFor(sourceUrl: string): Promise<void> {
  const watches = await getWatches();
  for (const [key, w] of Object.entries(watches)) {
    if (w.sourceUrl === sourceUrl) delete watches[key];
  }
  await setWatches(watches);
}

/** Expire abandoned handoffs; returns the live ones. */
function prune(watches: Record<string, RedirectWatch>, now: number): Record<string, RedirectWatch> {
  const live: Record<string, RedirectWatch> = {};
  for (const [key, w] of Object.entries(watches)) {
    if (now - w.startedAt < WATCH_TTL_MS) live[key] = w;
  }
  return live;
}

/**
 * A posting classified as a redirect is being followed. Arm the watch first —
 * whichever way the navigation happens (we open it, the page clicks it, the
 * site opens its own tab), the landing has to be attributable to this posting.
 */
async function followRedirect(
  sourceUrl: string,
  href: string | undefined,
  tab: chrome.tabs.Tab | undefined,
): Promise<FollowRedirectResponse> {
  const tabId = tab?.id;
  if (tabId == null) return { error: 'no tab' };

  const watch: RedirectWatch = { sourceUrl, sourceTabId: tabId, startedAt: Date.now() };
  await armWatch(tabId, watch);

  const settings = await getSettings();
  const target = settings.redirectTarget ?? 'newTabCloseSource';

  // No URL to open (a JS apply button): let the page click it and watch where
  // that lands — in this tab or in one the site opens itself.
  if (!href) return { click: true };
  if (target === 'sameTab') return { navigate: href };

  const created = await chrome.tabs.create({ url: href, openerTabId: tabId, active: tab?.active ?? false });
  if (created.id != null) await armWatch(created.id, watch);
  return { opened: true };
}

/** A tab opened by a watched tab inherits its watch (target=_blank apply links). */
chrome.tabs.onCreated.addListener((tab) => {
  const opener = tab.openerTabId;
  if (opener == null || tab.id == null) return;
  void (async () => {
    const watches = await getWatches();
    const parent = watches[String(opener)];
    if (parent) await armWatch(tab.id!, parent);
  })();
});

/** Pending settle timers, keyed by tab. Lost on worker restart — see `settle`. */
const settleTimers = new Map<number, ReturnType<typeof setTimeout>>();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' && !changeInfo.url) return;
  void onWatchedTabUpdated(tabId, tab).catch((e) => console.warn(LOG, 'redirect watch failed', e));
});

async function onWatchedTabUpdated(tabId: number, tab: chrome.tabs.Tab): Promise<void> {
  const all = await getWatches();
  if (Object.keys(all).length === 0) return;

  const live = prune(all, Date.now());
  if (Object.keys(live).length !== Object.keys(all).length) await setWatches(live);

  const watch = live[String(tabId)];
  if (!watch) return;

  const url = tab.url;
  if (!url || !/^https?:/i.test(url)) return;
  // Still on the board (in-page navigation, a login step): not a landing.
  if (!isExternalUrl(watch.sourceUrl, url)) return;

  // Chains land in stages — tracker, interstitial, then the real form. Restart
  // the clock on every hop so the last URL standing is the one recorded.
  const existing = settleTimers.get(tabId);
  if (existing) clearTimeout(existing);
  settleTimers.set(tabId, setTimeout(() => {
    settleTimers.delete(tabId);
    void settle(tabId, watch).catch((e) => console.warn(LOG, 'redirect settle failed', e));
  }, SETTLE_MS));
}

/** The handoff has stopped moving: record it, tell the page, tidy the tabs. */
async function settle(tabId: number, watch: RedirectWatch): Promise<void> {
  const watches = await getWatches();
  if (!watches[String(tabId)]) return; // already settled or expired

  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  const finalUrl = tab?.url;
  if (!finalUrl || !isExternalUrl(watch.sourceUrl, finalUrl)) return;

  await mutateJobUrls((list) => linkRedirect(list, watch.sourceUrl, finalUrl));
  await clearWatchesFor(watch.sourceUrl);
  console.info(LOG, 'redirect landed', watch.sourceUrl, '->', finalUrl);

  notifyLanded(tabId, watch.sourceUrl);

  const settings = await getSettings();
  if ((settings.redirectTarget ?? 'newTabCloseSource') === 'newTabCloseSource'
      && watch.sourceTabId !== tabId) {
    chrome.tabs.remove(watch.sourceTabId).catch(() => {});
  }
}

/**
 * Tell the destination page which posting it came from, so it can set itself up
 * and show the provenance. The content script is normally ready by now (it runs
 * at document_idle and we waited out the settle window); one retry covers a slow
 * frame, and a page we can't reach at all is not worth failing the link over.
 */
function notifyLanded(tabId: number, sourceUrl: string): void {
  const send = (retry: boolean) => {
    chrome.tabs.sendMessage(tabId, { type: MSG.REDIRECT_LANDED, sourceUrl }, () => {
      if (chrome.runtime.lastError && retry) setTimeout(() => send(false), 500);
    });
  };
  send(true);
}
