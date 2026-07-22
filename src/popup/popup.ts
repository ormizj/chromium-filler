/**
 * Popup: shows whether the current page matches a site config and offers a
 * state-aware Fill / Reset & Re-run button that drives the content script.
 */

import { MSG, type StatusResponse } from '../shared/messages';

const badge = document.getElementById('site-status')!;
const detail = document.getElementById('detail')!;
const primary = document.getElementById('primary') as HTMLButtonElement;
const openOptions = document.getElementById('open-options') as HTMLAnchorElement;

let tabId: number | undefined;
let currentUrl = '';
let status: StatusResponse | undefined;

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function send<T = unknown>(type: string, extra: Record<string, unknown> = {}): Promise<T | undefined> {
  return new Promise((resolve) => {
    if (tabId == null) return resolve(undefined);
    chrome.tabs.sendMessage(tabId, { type, ...extra }, (resp) => {
      if (chrome.runtime.lastError) return resolve(undefined);
      resolve(resp as T);
    });
  });
}

function renderNoContentScript(): void {
  badge.textContent = 'n/a';
  badge.className = 'badge';
  detail.textContent = 'This page can’t be filled (e.g. a browser page). Open a job posting.';
  primary.disabled = true;
}

function render(): void {
  if (!status) return renderNoContentScript();
  if (status.siteMatched) {
    badge.textContent = 'matched';
    badge.className = 'badge matched';
    detail.textContent = status.hasRun
      ? `${status.siteName}: ${status.filledCount}/${status.reportedCount} fields filled.`
      : `${status.siteName}: ready to fill.`;
    primary.disabled = false;
    primary.textContent = status.hasRun ? 'Reset & Re-run' : 'Fill';
  } else {
    badge.textContent = 'no config';
    badge.className = 'badge none';
    detail.textContent = 'No site config matches this URL. Create one to enable filling here.';
    primary.disabled = false;
    primary.textContent = 'Create config for this site';
  }
}

async function refresh(): Promise<void> {
  status = await send<StatusResponse>(MSG.STATUS);
  render();
}

primary.addEventListener('click', async () => {
  if (!status) return;
  if (!status.siteMatched) {
    chrome.runtime.sendMessage({ type: MSG.OPEN_OPTIONS, createForUrl: currentUrl });
    window.close();
    return;
  }
  primary.disabled = true;
  if (status.hasRun) {
    await send(MSG.RESET);
    status = await send<StatusResponse>(MSG.STATUS);
  } else {
    status = await send<StatusResponse>(MSG.RUN);
  }
  render();
});

openOptions.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.sendMessage({ type: MSG.OPEN_OPTIONS });
  window.close();
});

(async () => {
  const tab = await activeTab();
  tabId = tab?.id;
  currentUrl = tab?.url ?? '';
  await refresh();
})();
