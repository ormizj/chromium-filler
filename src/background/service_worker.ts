/**
 * Background service worker: batch-opens job URLs in new tabs and opens the
 * options page. The content script handles the per-page fill flow on load.
 */

import { MSG, type Message } from '../shared/messages';
import { getSettings, mutateJobUrls } from '../shared/storage';
import { applyStatus } from '../shared/jobUrls';
import { DEFAULT_STATE } from '../shared/defaults';

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
  // Mark the matching saved URL applied (records appliedAt + history).
  await mutateJobUrls((list) => applyStatus(list, url, 'applied'));

  // Optionally close the tab after a short delay so the request completes.
  const settings = await getSettings();
  if (settings.closeTabOnSubmit && tabId != null) {
    const delay = Math.max(0, settings.closeTabDelayMs ?? 1500);
    setTimeout(() => chrome.tabs.remove(tabId).catch(() => {}), delay);
  }
}

async function openUrls(urls: string[]): Promise<void> {
  for (const url of urls) {
    await chrome.tabs.create({ url, active: false });
  }
  await mutateJobUrls((list) => urls.reduce((acc, url) => applyStatus(acc, url, 'opened'), list));
}
