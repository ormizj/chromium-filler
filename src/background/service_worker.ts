/**
 * Background service worker: batch-opens job URLs in new tabs and opens the
 * options page. The content script handles the per-page fill flow on load.
 */

import { MSG, type Message } from '../shared/messages';
import { getJobUrls, saveJobUrls } from '../shared/storage';
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

async function openUrls(urls: string[]): Promise<void> {
  const list = await getJobUrls();
  const byUrl = new Map(list.map((e) => [e.url, e]));
  for (const url of urls) {
    await chrome.tabs.create({ url, active: false });
    const entry = byUrl.get(url);
    if (entry && entry.status === 'new') entry.status = 'opened';
  }
  await saveJobUrls(list);
}
