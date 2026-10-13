/**
 * Background service worker: the queue session (`session.ts`), the sync
 * (`sync.ts`), and opening the options page. Nothing here fills, follows or sends
 * anything — that was the automation era. What it still owns is the one thing a
 * content script cannot see: which tabs belong to the queue, and what closing one
 * of them means.
 */

import { MSG, type Message } from '../shared/messages';
import { DEFAULT_STATE } from '../shared/defaults';
import {
  adoptChildTab, onTabClosed, openUrls, queueTab, sessionState, skipUrl, startSession, stopSession,
} from './session';
import {
  connectAccount, disconnectAccount, setSyncClient, syncNow, syncOnStartup, syncState,
} from './sync';

const LOG = '[chromium-filler:bg]';

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    const existing = await chrome.storage.local.get(['profile', 'settings']);
    if (!existing.profile && !existing.settings) await chrome.storage.local.set({ ...DEFAULT_STATE });
  }
});

// Pull once per browser start, so a profile that was left behind is current
// before the first posting is opened. There is no timer beyond this — sync is
// otherwise only what the user asks for, which is why there is no `alarms`
// permission.
chrome.runtime.onStartup.addListener(() => {
  void syncOnStartup().catch((e) => console.warn(LOG, 'startup sync failed', e));
});

chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  if (msg.type === MSG.OPEN_URLS) {
    openUrls(msg.urls)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === MSG.QUEUE_TAB) {
    // The sender's own tab, never one named in the message: a page may only ask
    // about itself.
    queueTab(sender.tab?.id).then(sendResponse).catch(() => sendResponse({ inQueue: false }));
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
    skipUrl(msg.url, sender.tab?.id).then(sendResponse).catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  // The Sync tab renders these straight into its status line, so they are the
  // message and not `String(e)` — which prefixes a literal "Error: " that the
  // wording next to it (all of it written as a sentence to the user) does not.
  if (msg.type === MSG.SYNC_STATE) {
    syncState().then(sendResponse).catch((e) => sendResponse({ error: (e as Error).message }));
    return true;
  }
  if (msg.type === MSG.SYNC_CONNECT) {
    connectAccount().then(sendResponse).catch((e) => sendResponse({ error: (e as Error).message }));
    return true;
  }
  if (msg.type === MSG.SYNC_DISCONNECT) {
    disconnectAccount().then(sendResponse).catch((e) => sendResponse({ error: (e as Error).message }));
    return true;
  }
  if (msg.type === MSG.SYNC_SET_CLIENT) {
    setSyncClient({ clientId: msg.clientId, clientSecret: msg.clientSecret })
      .then(sendResponse)
      .catch((e) => sendResponse({ error: (e as Error).message }));
    return true;
  }
  if (msg.type === MSG.SYNC_NOW) {
    syncNow(msg.confirmed).then(sendResponse).catch((e) => sendResponse({ error: (e as Error).message }));
    return true;
  }
  if (msg.type === MSG.OPEN_OPTIONS) {
    // Every deep link is a hash on the options URL; `openOptionsPage` cannot
    // carry one, so anything targeted has to go through `tabs.create`.
    const parts: string[] = [];
    if (msg.hash) parts.push(msg.hash);
    // `at`/`focus` are additions to whichever tab was named, so they follow it.
    if (msg.at) parts.push(`at=${encodeURIComponent(msg.at)}`);
    if (msg.focus) parts.push(`focus=${encodeURIComponent(msg.focus)}`);
    const url = parts.length
      ? `${chrome.runtime.getURL('src/options/options.html')}#${parts.join('&')}`
      : undefined;
    if (url) chrome.tabs.create({ url });
    else chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

/**
 * A closed job tab frees its slot — and, under `markDoneOnClose`, finishes its
 * posting. The user submits on the site by hand, so closing the tab is the one
 * thing the extension ever hears that means "done with this one".
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  void onTabClosed(tabId).catch((e) => console.warn(LOG, 'session top-up failed', e));
});

/**
 * A tab opened from a queue tab belongs to the same posting — the employer's form
 * behind "Apply on company website". It carries the chip and fills like its parent,
 * but takes no slot and finishes nothing when it closes.
 */
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id == null || tab.openerTabId == null) return;
  void adoptChildTab(tab.id, tab.openerTabId).catch((e) => console.warn(LOG, 'could not adopt tab', e));
});
