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
  filledCount: 0,
  reportedCount: 0,
  toTeach: 0,
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
    total: 60, queued: 48, inFlight: 5, done: 7, ratio: 7 / 60, ...over,
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
  it('before anything was filled: says so, with an enabled Fill', async () => {
    await mountPopup(matched());
    const badge = document.getElementById('site-status')!;
    const primary = document.getElementById('primary') as HTMLButtonElement;
    expect(badge.textContent).toBe('ready');
    expect(document.getElementById('detail')!.textContent).toMatch(/nothing filled/i);
    expect(primary.textContent).toBe('Fill');
    expect(primary.disabled).toBe(false);
    expect((document.getElementById('reset') as HTMLButtonElement).hidden).toBe(true);
  });

  it('after a fill: the counts, a reminder to submit, and a Reset beside them', async () => {
    await mountPopup(matched({ hasRun: true, filledCount: 5, reportedCount: 7, toTeach: 2 }));
    const detail = document.getElementById('detail')!.textContent!;
    expect(detail).toContain('5 filled · 2 to teach');
    expect(detail).toMatch(/submit on the site/i);
    expect(document.getElementById('site-status')!.className).toContain('ok');
    expect((document.getElementById('primary') as HTMLButtonElement).textContent).toBe('Fill');
    expect((document.getElementById('reset') as HTMLButtonElement).hidden).toBe(false);
  });

  it('marks a tab the queue opened', async () => {
    await mountPopup(matched({ inQueue: true }));
    const badge = document.getElementById('site-status')!;
    expect(badge.textContent).toBe('queue');
    expect(badge.className).toContain('accent');
  });

  it('no content script: shows the un-fillable message and disables the button', async () => {
    await mountPopup(undefined);
    const badge = document.getElementById('site-status')!;
    const primary = document.getElementById('primary') as HTMLButtonElement;
    expect(badge.textContent).toBe('n/a');
    expect(document.getElementById('detail')!.textContent).toMatch(/can.t be filled/i);
    expect(primary.disabled).toBe(true);
  });

  it('Fill runs the page and closes the popup', async () => {
    await mountPopup(matched());
    const sent = recordTabMessages(matched({ hasRun: true, filledCount: 3, reportedCount: 5 }));
    (document.getElementById('primary') as HTMLButtonElement).click();
    await flush();
    expect(sent).toContainEqual(expect.objectContaining({ type: MSG.RUN }));
    expect(window.close).toHaveBeenCalled();
  });

  /** Reset leaves the popup open: the press that follows is the point of it. */
  it('Reset empties the page and leaves the popup open', async () => {
    await mountPopup(matched({ hasRun: true, filledCount: 3, reportedCount: 5 }));
    const sent = recordTabMessages(matched());
    (document.getElementById('reset') as HTMLButtonElement).click();
    await flush();
    expect(sent).toContainEqual(expect.objectContaining({ type: MSG.RESET }));
    expect(window.close).not.toHaveBeenCalled();
    expect((document.getElementById('reset') as HTMLButtonElement).hidden).toBe(true);
  });

  it('Teach starts pointing at a field in the tab', async () => {
    await mountPopup(matched());
    const sent = recordTabMessages(matched());
    (document.getElementById('teach') as HTMLAnchorElement).click();
    await flush();
    expect(sent).toContainEqual(expect.objectContaining({ type: MSG.TEACH }));
    expect(window.close).toHaveBeenCalled();
  });

  /** The action rows are furniture, not a report on the page: always all there. */
  it('keeps every action visible whatever the page and the session are doing', async () => {
    const visible = () => ['primary', 'open-queue', 'teach', 'open-options']
      .filter((id) => !(document.getElementById(id) as HTMLElement).hidden);

    await mountPopup(matched());
    expect(visible()).toHaveLength(4);

    mockSession(session());
    await mountPopup(matched({ hasRun: true, inQueue: true }));
    expect(visible()).toHaveLength(4);
  });

  it('puts Teach, Queue and Options in one row, in order', async () => {
    await mountPopup(matched());
    expect([...document.querySelector('.links')!.children].map((el) => el.id))
      .toEqual(['teach', 'open-queue', 'open-options']);
    expect([...document.querySelector('.actions')!.children].map((el) => el.id))
      .toEqual(['primary']);
  });
});

describe('queue session', () => {
  it('hides the session strip when no session is running', async () => {
    mockSession({ active: false, batchSize: 5, progress: {
      total: 0, queued: 0, inFlight: 0, done: 0, ratio: 0,
    } });
    await mountPopup(matched());
    expect(document.getElementById('session')!.hidden).toBe(true);
  });

  it('shows progress through the queue while a session runs', async () => {
    mockSession(session());
    await mountPopup(matched());
    expect(document.getElementById('session')!.hidden).toBe(false);
    // Big done/total number in the progress card, per-status breakdown in chips.
    expect(document.getElementById('session-count')!.textContent).toBe('7');
    expect(document.getElementById('session-total')!.textContent).toBe(' / 60');
    const chips = document.getElementById('session-chips')!.textContent;
    // Not "filled": in this extension "filled" is a field that took a value.
    expect(chips).toContain('5 open');
    expect(chips).not.toContain('filled');
    expect(chips).toContain('48 waiting');
  });

  it('offers Skip only on a tab the queue opened', async () => {
    mockSession(session());
    await mountPopup(matched());
    expect((document.getElementById('session-skip') as HTMLButtonElement).disabled).toBe(true);
    mockSession(session());
    await mountPopup(matched({ inQueue: true }));
    expect((document.getElementById('session-skip') as HTMLButtonElement).disabled).toBe(false);
  });

  it('skipping reports this posting to the background so the next one opens', async () => {
    const sent = mockSession(session());
    await mountPopup(matched({ inQueue: true }), 'https://boards.example/job/7');
    (document.getElementById('session-skip') as HTMLButtonElement).click();
    await flush();
    expect(sent).toContainEqual(
      expect.objectContaining({ type: MSG.SESSION_SKIP, url: 'https://boards.example/job/7' }),
    );
  });

  // The queue *is* the links. Sending a bare OPEN_OPTIONS made this button
  // indistinguishable from the Options one beside it — both landed on the
  // default tab, and neither reached the box you paste into.
  it('sends the queue button to the URL importer, not just to the options page', async () => {
    const sent = mockSession(session());
    await mountPopup(matched());
    (document.getElementById('open-queue') as HTMLAnchorElement).click();
    await flush();
    expect(sent).toContainEqual(expect.objectContaining({
      type: MSG.OPEN_OPTIONS, hash: 'queue', at: 'import-section', focus: '#urls-paste',
    }));
  });
});

/**
 * A brand-new install has no profile and no CV, so there is nothing to fill any
 * page with — and the place to fix that is Options, not the page.
 */
describe('first-run nudge', () => {
  const nudge = () => document.getElementById('nudge') as HTMLAnchorElement;

  it('names the missing details rather than only the missing config', async () => {
    await saveProfile({ values: {} });
    await clearCv();
    await mountPopup(matched());
    expect(nudge().hidden).toBe(false);
    expect(nudge().textContent).toMatch(/details/i);
  });

  it('moves on to the CV once the profile is filled in', async () => {
    await saveProfile({ values: { email: 'ada@example.com' } });
    await clearCv();
    await mountPopup(matched());
    expect(nudge().hidden).toBe(false);
    expect(nudge().textContent).toMatch(/cv/i);
  });

  it('stays out of the way once both are set up', async () => {
    await saveProfile({ values: { email: 'ada@example.com' } });
    await setCv(new File(['cv'], 'cv.pdf', { type: 'application/pdf' }));
    await mountPopup(matched());
    expect(nudge().hidden).toBe(true);
  });
});

describe('minimized report', () => {
  /**
   * The close button used to destroy the report, leaving "Reset" — a
   * destructive action — as the only way back. Collapsed now means restorable.
   */
  it('offers Show report instead of Fill when the card is collapsed', async () => {
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
