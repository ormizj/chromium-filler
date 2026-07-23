/**
 * Popup: shows whether the current page matches a site config, offers a
 * state-aware Fill / Show report / Reset & Re-run button, and reports where you
 * are in a running queue session.
 */

import { MSG, type SessionState, type StatusResponse } from '../shared/messages';
import { BUILD_ID, BUILD_LABEL } from '../shared/buildId';
import { hostOf } from '../shared/url';
import { getProfile } from '../shared/storage';
import { getCv } from '../shared/cvStore';

const badge = document.getElementById('site-status')!;
const detail = document.getElementById('detail')!;
const primary = document.getElementById('primary') as HTMLButtonElement;
const reconfigure = document.getElementById('reconfigure') as HTMLAnchorElement;
const openOptions = document.getElementById('open-options') as HTMLAnchorElement;
const openQueue = document.getElementById('open-queue') as HTMLAnchorElement;
const sessionBox = document.getElementById('session')!;
const sessionCount = document.getElementById('session-count')!;
const sessionDetail = document.getElementById('session-detail')!;
const sessionBar = document.getElementById('session-bar')!;
const sessionSkip = document.getElementById('session-skip') as HTMLButtonElement;
const nudge = document.getElementById('nudge') as HTMLAnchorElement;

let tabId: number | undefined;
let tabUrl: string | undefined;
let status: StatusResponse | undefined;
let session: SessionState | undefined;

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

function sendBg<T = unknown>(type: string, extra: Record<string, unknown> = {}): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...extra }, (resp) => {
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
  renderSession();
  if (!status) return renderNoContentScript();
  if (status.siteMatched) {
    badge.textContent = 'matched';
    badge.className = 'badge matched';
    const via = status.landedFrom ? ` (via ${hostOf(status.landedFrom)})` : '';
    detail.textContent = status.postingKind === 'redirect'
      ? `${status.siteName}: applies on ${status.redirectHref ? hostOf(status.redirectHref) : 'the employer’s site'} — external application.`
      : status.hasRun
        ? `${status.siteName}${via}: ${status.filledCount}/${status.reportedCount} fields filled.`
        : `${status.siteName}${via}: ready to fill.`;
    primary.disabled = false;
    // With the report collapsed, the useful action is to bring it back — not to
    // wipe every field that was just filled, which is what re-running does.
    primary.textContent = status.hasRun
      ? (status.modalMinimized ? 'Show report' : 'Reset & Re-run')
      : 'Fill';
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

function renderSession(): void {
  const p = session?.progress;
  const active = !!session?.active;
  sessionBox.hidden = !active;
  openQueue.hidden = active || !p || p.queued === 0;

  if (!active || !p) return;
  sessionCount.textContent = `${p.done} of ${p.total} done`;
  sessionDetail.textContent = `${p.queued} waiting · ${p.inFlight} open · ${p.applied} applied`;
  sessionBar.style.width = `${Math.round(p.ratio * 100)}%`;
  // Only offer Skip for a page that is actually one of the session's postings.
  sessionSkip.disabled = !tabUrl;
}

/** Open the on-page visual Setup panel in the active tab, then close the popup. */
async function enterSetup(): Promise<void> {
  await send(MSG.SETUP);
  window.close();
}

/**
 * Page status first, session second: the popup must paint as soon as the content
 * script answers, rather than waiting on a background worker that may be asleep
 * (or, on a page with no session, has nothing interesting to say).
 */
async function refresh(): Promise<void> {
  status = await send<StatusResponse>(MSG.STATUS);
  render();
  session = await sendBg<SessionState>(MSG.SESSION_STATE);
  render();
}

/**
 * The first thing still missing, named. A brand-new install has no profile and
 * no CV, so every page it opens reports "no site config matches this URL" —
 * true, and useless: the work to do is in the options page, not on this page.
 */
async function renderNudge(): Promise<void> {
  const [profile, cv] = await Promise.all([getProfile(), getCv()]);
  const missing = Object.values(profile.values).some((v) => v?.trim())
    ? (cv ? undefined : 'Upload your CV →')
    : 'Add your details first →';

  nudge.hidden = !missing;
  if (missing) nudge.textContent = missing;
}

primary.addEventListener('click', async () => {
  if (!status) return;
  if (!status.siteMatched) {
    await enterSetup();
    return;
  }
  primary.disabled = true;
  if (status.hasRun && status.modalMinimized) {
    await send(MSG.SHOW_REPORT);
    window.close();
    return;
  }
  if (status.hasRun) {
    await send(MSG.RESET);
    status = await send<StatusResponse>(MSG.STATUS);
  } else {
    status = await send<StatusResponse>(MSG.RUN);
  }
  render();
});

sessionSkip.addEventListener('click', async () => {
  if (!tabUrl) return;
  sessionSkip.disabled = true;
  await sendBg(MSG.SESSION_SKIP, { url: tabUrl });
  window.close();
});

reconfigure.addEventListener('click', async (e) => {
  e.preventDefault();
  await enterSetup();
});

openQueue.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.sendMessage({ type: MSG.OPEN_OPTIONS });
  window.close();
});

openOptions.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.sendMessage({ type: MSG.OPEN_OPTIONS });
  window.close();
});

nudge.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.sendMessage({ type: MSG.OPEN_OPTIONS, hash: 'profile' });
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
  // Storage only, so it neither waits for the content script nor for a service
  // worker that may be asleep — and "add your details first" is exactly what a
  // brand-new install needs before either of those has anything to say.
  void renderNudge();

  const tab = await activeTab();
  tabId = tab?.id;
  tabUrl = tab?.url;
  await refresh();
})();
