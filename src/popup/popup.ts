/**
 * Popup: shows whether the current page matches a site config and offers a
 * state-aware Fill / Reset & Re-run button that drives the content script.
 */

import { MSG, type StatusResponse } from '../shared/messages';
import { BUILD_ID, BUILD_LABEL } from '../shared/buildId';

const badge = document.getElementById('site-status')!;
const detail = document.getElementById('detail')!;
const primary = document.getElementById('primary') as HTMLButtonElement;
const reconfigure = document.getElementById('reconfigure') as HTMLAnchorElement;
const openOptions = document.getElementById('open-options') as HTMLAnchorElement;

let tabId: number | undefined;
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
    reconfigure.hidden = false;
  } else {
    badge.textContent = 'no config';
    badge.className = 'badge none';
    detail.textContent = 'No site config matches this URL. Set it up visually to enable filling here.';
    primary.disabled = false;
    primary.textContent = 'Set up this site';
    reconfigure.hidden = true;
  }
}

/** Open the on-page visual Setup panel in the active tab, then close the popup. */
async function enterSetup(): Promise<void> {
  await send(MSG.SETUP);
  window.close();
}

async function refresh(): Promise<void> {
  status = await send<StatusResponse>(MSG.STATUS);
  render();
}

primary.addEventListener('click', async () => {
  if (!status) return;
  if (!status.siteMatched) {
    await enterSetup();
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

reconfigure.addEventListener('click', async (e) => {
  e.preventDefault();
  await enterSetup();
});

openOptions.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.sendMessage({ type: MSG.OPEN_OPTIONS });
  window.close();
});

{
  const span = (cls: string, text: string): HTMLSpanElement => {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  };
  const hash = BUILD_ID.slice(BUILD_LABEL.length).replace(/^ · /, '');
  const parts = [
    span('build-version', `v${chrome.runtime.getManifest().version}`),
    ...(hash ? [span('build-hash', hash)] : []),
    span('build-label', BUILD_LABEL),
  ];
  document.getElementById('build')!.replaceChildren(
    ...parts.flatMap((p, i) => (i ? [span('build-sep', '·'), p] : [p])),
  );
}

(async () => {
  const tab = await activeTab();
  tabId = tab?.id;
  await refresh();
})();
