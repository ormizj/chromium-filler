/**
 * Where a recording lives while it is being made.
 *
 * Not in the content script, because setting up a two-step posting means recording
 * *across* a handoff: the user presses "Apply on company site", the browser leaves
 * for the employer's ATS, and under the default `newTabCloseSource` the tab they
 * started in is closed behind them. The content script that picks the recording back
 * up is a brand-new one, in a different tab, on a different origin, that has never
 * heard of the posting.
 *
 * So it lives in `chrome.storage.session` keyed by tab — exactly like `applyingTabs`
 * and the redirect watches in `service_worker.ts`, and for both of the same reasons:
 * the worker can be torn down mid-navigation, and tab ids mean nothing after a
 * browser restart, so this must not survive one.
 */

import type { RecordFlow, Recording, RecordedStep } from '../shared/recording';

const KEY = 'recordings';

/** Long enough to fill in a real application; short enough not to haunt the session. */
const TTL_MS = 2 * 60 * 60_000;

async function all(): Promise<Record<string, Recording>> {
  const raw = await chrome.storage.session.get(KEY);
  return (raw[KEY] as Record<string, Recording>) ?? {};
}

async function write(map: Record<string, Recording>): Promise<void> {
  await chrome.storage.session.set({ [KEY]: map });
}

export async function startRecording(
  tabId: number | undefined, flow: RecordFlow, postingUrl: string,
): Promise<void> {
  if (tabId == null) return;
  const map = await all();
  map[String(tabId)] = { flow, startedAt: Date.now(), postingUrl, steps: [] };
  await write(map);
}

export async function getRecording(tabId: number | undefined): Promise<Recording | undefined> {
  if (tabId == null) return undefined;
  const map = await all();
  const rec = map[String(tabId)];
  if (!rec) return undefined;
  if (Date.now() - rec.startedAt > TTL_MS) {
    delete map[String(tabId)];
    await write(map);
    return undefined;
  }
  return rec;
}

/**
 * Append one step.
 *
 * The destination URL is *learned* here rather than announced, because the first
 * step to arrive from the far side of a handoff is the only notice there is that a
 * handoff happened at all — nothing tells the background in advance which click will
 * be the one that leaves.
 */
export async function pushStep(tabId: number | undefined, step: RecordedStep): Promise<void> {
  if (tabId == null) return;
  const map = await all();
  const rec = map[String(tabId)];
  if (!rec) return;
  rec.steps.push(step);
  if (step.leg === 'destination' && !rec.destinationUrl) rec.destinationUrl = step.url;
  await write(map);
}

/** Undo the last step. The bar's Undo, which is the cheap way out of a misclick. */
export async function popStep(tabId: number | undefined): Promise<Recording | undefined> {
  if (tabId == null) return undefined;
  const map = await all();
  const rec = map[String(tabId)];
  if (!rec) return undefined;
  rec.steps.pop();
  await write(map);
  return rec;
}

/**
 * Change what the last step means — the bar's "Mark as…" and "Keep as a step".
 * `null` clears the binding, which is how a guess is refused.
 */
export async function bindLastStep(
  tabId: number | undefined, bind: RecordedStep['bind'] | null,
): Promise<Recording | undefined> {
  if (tabId == null) return undefined;
  const map = await all();
  const rec = map[String(tabId)];
  const last = rec?.steps[rec.steps.length - 1];
  if (!rec || !last) return rec;
  if (bind) {
    last.bind = bind;
    // A user's choice, so it outranks any later guess about the same element.
    last.bindSource = 'user';
  } else {
    delete last.bind;
    delete last.bindSource;
  }
  await write(map);
  return rec;
}

export async function stopRecording(tabId: number | undefined): Promise<Recording | undefined> {
  if (tabId == null) return undefined;
  const map = await all();
  const rec = map[String(tabId)];
  delete map[String(tabId)];
  await write(map);
  return rec;
}

/**
 * A tab opened by a recording tab inherits the recording.
 *
 * The same inheritance the redirect watch does, and what makes recording a two-step
 * posting possible at all: the employer's form usually opens in a *new* tab, and by
 * the time its content script asks, the tab that knew about the recording has often
 * already been closed by `newTabCloseSource`.
 */
export async function inheritRecording(openerTabId: number, tabId: number): Promise<void> {
  const map = await all();
  const parent = map[String(openerTabId)];
  if (!parent) return;
  map[String(tabId)] = parent;
  await write(map);
}
