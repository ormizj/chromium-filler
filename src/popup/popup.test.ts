/**
 * Render-logic tests for the popup — the surface that "passed tests but was
 * unusable" precisely because nothing here was covered. We inject the real
 * popup.html body, drive the chrome mock's tab/content-script responses, import
 * popup.ts fresh, and assert what the user actually sees for each state.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { StatusResponse } from '../shared/messages';
import { MSG } from '../shared/messages';
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

  it('no config: prompts to create one, button enabled', async () => {
    await mountPopup(matched({ siteMatched: false, siteName: undefined }));
    const badge = document.getElementById('site-status')!;
    const primary = document.getElementById('primary') as HTMLButtonElement;
    expect(badge.textContent).toBe('no config');
    expect(badge.className).toContain('none');
    expect(primary.textContent).toBe('Create config for this site');
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

  it('clicking the button with no config asks the background to open options', async () => {
    await mountPopup(matched({ siteMatched: false, siteName: undefined }));
    (document.getElementById('primary') as HTMLButtonElement).click();
    await flush();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: MSG.OPEN_OPTIONS, createForUrl: 'https://example.com/sample-form.html' }),
    );
  });
});
