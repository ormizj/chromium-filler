/**
 * Render-logic tests for the popup — the surface that "passed tests but was
 * unusable" precisely because nothing here was covered. We inject the real
 * popup.html body, drive the chrome mock's tab/content-script responses, import
 * popup.ts fresh, and assert what the user actually sees for each state.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SessionState, StatusResponse } from '../shared/messages';
import { MSG } from '../shared/messages';
import { saveProfile } from '../shared/storage';
import { setCv, clearCv } from '../shared/cvStore';
// Inject the REAL popup markup so the render logic runs against production DOM.
import HTML from './popup.html?raw';

const BODY = HTML.match(/<body[^>]*>([\s\S]*?)<\/body>/i)![1];

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Mount the popup with a canned content-script status (undefined = no script). */
async function mountPopup(
  status: StatusResponse | undefined,
  url = 'https://example.com/sample-form.html',
): Promise<void> {
  document.body.innerHTML = BODY;
  chrome.runtime.lastError = undefined;
  chrome.tabs.query = vi.fn().mockResolvedValue([{ id: 1, url }]) as unknown as typeof chrome.tabs.query;
  chrome.tabs.sendMessage = vi.fn((_tabId: number, _msg: unknown, cb?: (r: unknown) => void) => {
    if (status === undefined) chrome.runtime.lastError = { message: 'no receiving end' };
    cb?.(status);
    chrome.runtime.lastError = undefined;
  }) as unknown as typeof chrome.tabs.sendMessage;

  vi.resetModules();
  await import('./popup');
  await flush();
  await flush();
}

const matched = (over: Partial<StatusResponse> = {}): StatusResponse => ({
  siteMatched: true,
  siteName: 'Local test fixture',
  configId: 'example-fixture',
  filledCount: 0,
  reportedCount: 0,
  hasRun: false,
  ...over,
});

/** Make the background answer SESSION_STATE with this snapshot. */
function mockSession(state: SessionState | undefined): unknown[] {
  const sent: unknown[] = [];
  chrome.runtime.sendMessage = vi.fn((msg: unknown, cb?: (r: unknown) => void) => {
    sent.push(msg);
    cb?.((msg as { type: string }).type === MSG.SESSION_STATE ? state : { ok: true });
  }) as unknown as typeof chrome.runtime.sendMessage;
  return sent;
}

const session = (over: Partial<SessionState['progress']> = {}): SessionState => ({
  active: true,
  batchSize: 5,
  progress: {
    total: 60, queued: 48, inFlight: 5, applied: 6, skipped: 1, done: 7, ratio: 7 / 60, ...over,
  },
});

/** Swap in a recording sendMessage after mount (mountPopup installs its own). */
function recordTabMessages(reply: StatusResponse): unknown[] {
  const sent: unknown[] = [];
  chrome.tabs.sendMessage = vi.fn((_tabId: number, msg: unknown, cb?: (r: unknown) => void) => {
    sent.push(msg);
    cb?.(reply);
  }) as unknown as typeof chrome.tabs.sendMessage;
  return sent;
}

beforeEach(() => {
  chrome.runtime.sendMessage = vi.fn();
  vi.spyOn(window, 'close').mockImplementation(() => {});
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('popup render', () => {
  it('matched, not run: shows "ready to fill" and an enabled Fill button', async () => {
    await mountPopup(matched());
    const badge = document.getElementById('site-status')!;
    const primary = document.getElementById('primary') as HTMLButtonElement;
    expect(badge.textContent).toBe('matched');
    expect(badge.className).toContain('matched');
    expect(document.getElementById('detail')!.textContent).toContain('ready to fill');
    expect(primary.textContent).toBe('Fill');
    expect(primary.disabled).toBe(false);
  });

  it('matched, has run: shows filled/reported counts and Reset & Re-run', async () => {
    await mountPopup(matched({ hasRun: true, filledCount: 5, reportedCount: 6 }));
    expect(document.getElementById('detail')!.textContent).toContain('5/6 fields filled');
    expect((document.getElementById('primary') as HTMLButtonElement).textContent).toBe('Reset & Re-run');
  });

  it('no config: prompts to set one up visually, button enabled', async () => {
    await mountPopup(matched({ siteMatched: false, siteName: undefined }));
    const badge = document.getElementById('site-status')!;
    const primary = document.getElementById('primary') as HTMLButtonElement;
    expect(badge.textContent).toBe('no config');
    expect(badge.className).toContain('none');
    expect(primary.textContent).toBe('Set up this site');
    expect(primary.disabled).toBe(false);
  });

  it('no content script: shows the un-fillable message and disables the button', async () => {
    await mountPopup(undefined);
    const badge = document.getElementById('site-status')!;
    const primary = document.getElementById('primary') as HTMLButtonElement;
    expect(badge.textContent).toBe('n/a');
    expect(document.getElementById('detail')!.textContent).toMatch(/can.t be filled/i);
    expect(primary.disabled).toBe(true);
  });

  it('clicking the button with no config enters on-page setup in the tab', async () => {
    const noCfg = matched({ siteMatched: false, siteName: undefined });
    await mountPopup(noCfg);
    const sent = recordTabMessages(noCfg);
    (document.getElementById('primary') as HTMLButtonElement).click();
    await flush();
    expect(sent).toContainEqual(expect.objectContaining({ type: MSG.SETUP }));
  });

  it('matched: exposes a Reconfigure link that enters setup in the tab', async () => {
    await mountPopup(matched());
    const link = document.getElementById('reconfigure') as HTMLAnchorElement;
    expect(link.hidden).toBe(false);
    const sent = recordTabMessages(matched());
    link.click();
    await flush();
    expect(sent).toContainEqual(expect.objectContaining({ type: MSG.SETUP }));
  });
});

describe('queue session', () => {
  it('hides the session strip when no session is running', async () => {
    mockSession({ active: false, batchSize: 5, progress: {
      total: 0, queued: 0, inFlight: 0, applied: 0, skipped: 0, done: 0, ratio: 0,
    } });
    await mountPopup(matched());
    expect(document.getElementById('session')!.hidden).toBe(true);
  });

  it('shows progress through the queue while a session runs', async () => {
    mockSession(session());
    await mountPopup(matched());
    expect(document.getElementById('session')!.hidden).toBe(false);
    expect(document.getElementById('session-count')!.textContent).toBe('7 of 60 done');
    expect(document.getElementById('session-detail')!.textContent)
      .toContain('48 waiting · 5 open · 6 applied');
  });

  it('skipping reports this posting to the background so the next one opens', async () => {
    const sent = mockSession(session());
    await mountPopup(matched(), 'https://boards.example/job/7');
    (document.getElementById('session-skip') as HTMLButtonElement).click();
    await flush();
    expect(sent).toContainEqual(
      expect.objectContaining({ type: MSG.SESSION_SKIP, url: 'https://boards.example/job/7' }),
    );
  });

  it('offers the queue when postings are waiting but no session is running', async () => {
    mockSession({ active: false, batchSize: 5, progress: {
      total: 10, queued: 10, inFlight: 0, applied: 0, skipped: 0, done: 0, ratio: 0,
    } });
    await mountPopup(matched());
    expect((document.getElementById('open-queue') as HTMLAnchorElement).hidden).toBe(false);
  });
});

/**
 * A brand-new install has no profile and no CV, so every page it opens reports
 * "no site config matches this URL" — accurate, and the wrong place to look.
 */
describe('first-run nudge', () => {
  const nudge = () => document.getElementById('nudge') as HTMLAnchorElement;

  it('names the missing details rather than only the missing config', async () => {
    await saveProfile({ values: {}, custom: {} });
    await clearCv();
    await mountPopup(matched());
    expect(nudge().hidden).toBe(false);
    expect(nudge().textContent).toMatch(/details/i);
  });

  it('moves on to the CV once the profile is filled in', async () => {
    await saveProfile({ values: { email: 'ada@example.com' }, custom: {} });
    await clearCv();
    await mountPopup(matched());
    expect(nudge().hidden).toBe(false);
    expect(nudge().textContent).toMatch(/cv/i);
  });

  it('stays out of the way once both are set up', async () => {
    await saveProfile({ values: { email: 'ada@example.com' }, custom: {} });
    await setCv(new File(['cv'], 'cv.pdf', { type: 'application/pdf' }));
    await mountPopup(matched());
    expect(nudge().hidden).toBe(true);
  });
});

describe('minimized report', () => {
  /**
   * The close button used to destroy the report, leaving "Reset & Re-run" — a
   * destructive action — as the only way back. Collapsed now means restorable.
   */
  it('offers Show report instead of Reset & Re-run when the modal is collapsed', async () => {
    await mountPopup(matched({ hasRun: true, filledCount: 5, reportedCount: 6, modalMinimized: true }));
    expect((document.getElementById('primary') as HTMLButtonElement).textContent).toBe('Show report');
  });

  it('restores the report without resetting the fields', async () => {
    const status = matched({ hasRun: true, filledCount: 5, reportedCount: 6, modalMinimized: true });
    await mountPopup(status);
    const sent = recordTabMessages(status);
    (document.getElementById('primary') as HTMLButtonElement).click();
    await flush();
    expect(sent).toContainEqual(expect.objectContaining({ type: MSG.SHOW_REPORT }));
    expect(sent).not.toContainEqual(expect.objectContaining({ type: MSG.RESET }));
  });
});
