/**
 * Popup: what the extension did on this page, a Fill button that works on any
 * page, Teach (point at a field the card did not list), and where you are in a
 * running queue session.
 */

import { MSG, type SessionState, type StatusResponse } from '../shared/messages';
import { ACTION_LABELS } from '../shared/labels';
import { BUILD_ID, BUILD_LABEL } from '../shared/buildId';
import { getProfile } from '../shared/storage';
import { getCv } from '../shared/cvStore';

const badge = document.getElementById('site-status')!;
const detail = document.getElementById('detail')!;
const primary = document.getElementById('primary') as HTMLButtonElement;
const teachLink = document.getElementById('teach') as HTMLAnchorElement;
const resetBtn = document.getElementById('reset') as HTMLButtonElement;
const openOptions = document.getElementById('open-options') as HTMLAnchorElement;
const openQueue = document.getElementById('open-queue') as HTMLAnchorElement;
const sessionBox = document.getElementById('session')!;
const sessionCount = document.getElementById('session-count')!;
const sessionTotal = document.getElementById('session-total')!;
const sessionDetail = document.getElementById('session-detail')!;
const sessionBar = document.getElementById('session-bar')!;
const sessionChips = document.getElementById('session-chips')!;
const sessionSkip = document.getElementById('session-skip') as HTMLButtonElement;
const nudge = document.getElementById('nudge') as HTMLAnchorElement;

// The same control the review modal's footer draws during a session, so it takes
// the same words from labels.ts. Written into popup.html it had already drifted
// — "Skip & next" here against "Skip → next" there, for one action.
sessionSkip.textContent = ACTION_LABELS.skipNext;

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
  badge.className = 'chip';
  detail.textContent = 'This page can’t be filled (e.g. a browser page). Open a job posting.';
  primary.disabled = true;
}

function render(): void {
  renderSession();
  if (!status) return renderNoContentScript();
  const { filledCount, toTeach, hasRun, inQueue } = status;
  badge.textContent = inQueue ? 'queue' : hasRun && filledCount ? 'filled' : 'ready';
  badge.className = inQueue ? 'chip accent' : hasRun && filledCount ? 'chip ok' : 'chip';
  if (!hasRun) {
    detail.textContent = 'Nothing filled on this page yet.';
  } else if (filledCount || toTeach) {
    const teach = toTeach ? ` · ${toTeach} to teach` : '';
    detail.textContent = `${filledCount} filled${teach} on this page. Submit on the site when you are ready.`;
  } else {
    detail.textContent = 'No fields for the extension on this page.';
  }
  primary.disabled = false;
  // With the card folded, bringing it back is the useful press; "Fill" also
  // brings it back, but after sweeping the page again.
  primary.textContent = status.modalMinimized ? 'Show report' : 'Fill';
  resetBtn.hidden = !(hasRun && filledCount > 0);
}

function renderSession(): void {
  const p = session?.progress;
  const active = !!session?.active;
  sessionBox.hidden = !active;

  if (!active || !p) return;
  // The prominent progress card: a big done/total number, a caption, and the
  // fill bar — the reference's popup lead. The breakdown moves to the chips
  // below, where open / waiting read at a glance.
  sessionCount.textContent = `${p.done}`;
  sessionTotal.textContent = ` / ${p.total}`;
  // "in the queue", not "this session": `queueProgress` counts done postings
  // across the whole visible database against its whole length
  // (`shared/queue.ts`), not against the postings this session has opened. Read
  // as a session tally it told anyone with a backlog that 40 of their 60
  // postings were done before the session's first one had been looked at.
  sessionDetail.textContent = 'postings done in the queue';
  sessionBar.style.width = `${Math.round(p.ratio * 100)}%`;
  renderSessionChips(p.inFlight, p.queued);
  // Only offer Skip on a page that is one of the session's postings — the
  // background answers that from the tab, and the content script passes it on.
  sessionSkip.disabled = !status?.inQueue;
}

/**
 * open / waiting, as the tinted chips the reference popup shows. A posting is
 * new or done, and done is the big number above — so the chips split what is
 * left: the tabs on it now, and the postings still to come.
 */
function renderSessionChips(open: number, queued: number): void {
  const chip = (cls: string, text: string): HTMLSpanElement => {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  };
  sessionChips.replaceChildren(
    chip('chip ok', `${open} open`),
    chip('chip', `${queued} waiting`),
  );
}

/** Point at a field on the page to teach it, then close the popup. */
async function enterTeach(): Promise<void> {
  await send(MSG.TEACH);
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
 * no CV, so there is nothing to fill any page with — and the work to do is in the
 * options page, not on this page.
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
  primary.disabled = true;
  if (status.modalMinimized) {
    await send(MSG.SHOW_REPORT);
    window.close();
    return;
  }
  // Filling moves the work to the page, where the card reports it in full.
  await send(MSG.RUN);
  window.close();
});

resetBtn.addEventListener('click', async () => {
  // Reset leaves the popup open on Fill: the press that follows is the point of
  // having pressed this one.
  resetBtn.disabled = true;
  await send(MSG.RESET);
  status = await send<StatusResponse>(MSG.STATUS);
  resetBtn.disabled = false;
  render();
});

sessionSkip.addEventListener('click', async () => {
  if (!tabUrl || !status?.inQueue) return;
  sessionSkip.disabled = true;
  await sendBg(MSG.SESSION_SKIP, { url: tabUrl });
  window.close();
});

teachLink.addEventListener('click', async (e) => {
  e.preventDefault();
  await enterTeach();
});

// The queue *is* the links, so this lands on the box you paste them into rather
// than on the tab that happens to contain it. Opening the options page on its
// default tab was indistinguishable from pressing Options beside it.
openQueue.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.sendMessage({
    type: MSG.OPEN_OPTIONS, hash: 'queue', at: 'import-section', focus: '#urls-paste',
  });
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
