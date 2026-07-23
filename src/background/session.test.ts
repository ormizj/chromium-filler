/**
 * The queue session is a sliding window: at most `batchSize` job tabs exist at
 * once and *finishing one is what opens the next*. Every rule in here was a bug
 * at some point — 60 links once meant 60 tabs — and until now only the E2E suite
 * touched it, because the chrome mock had no `storage.session` and no tab
 * registry to run it against.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  onSubmitted, onTabClosed, openUrls, sessionState, skipUrl, startSession, stopSession, urlForTab,
} from './session';
import { addUrls } from '../shared/jobUrls';
import { getJobUrls, saveJobUrls } from '../shared/storage';
import type { JobUrlStatus } from '../shared/types';
import { closeTab, openTabs, resetChromeMock } from '../../test/setup';

const URLS = ['a://1', 'a://2', 'a://3', 'a://4', 'a://5'];

/** Seed the job database with `n` waiting postings. */
async function seed(n: number): Promise<void> {
  await saveJobUrls(addUrls([], URLS.slice(0, n), 1000).list);
}

/** Run a promise that awaits STAGGER_MS delays, driving the fake clock for it. */
async function settled<T>(promise: Promise<T>): Promise<T> {
  const result = promise;
  await vi.advanceTimersByTimeAsync(10_000);
  return result;
}

async function statuses(): Promise<Record<string, JobUrlStatus>> {
  const list = await getJobUrls();
  return Object.fromEntries(list.map((e) => [e.url, e.status]));
}

/** The tabs the session believes it owns, as `[tabId, url]`. */
async function sessionTabs(): Promise<Array<[number, string]>> {
  const raw = await chrome.storage.session.get('queueTabs');
  const map = (raw.queueTabs as Record<string, string>) ?? {};
  return Object.entries(map).map(([id, url]) => [Number(id), url]);
}

beforeEach(async () => {
  await resetChromeMock();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startSession — the first window', () => {
  it('opens at most batchSize tabs and marks exactly those opened', async () => {
    await seed(5);
    await settled(startSession(2));

    expect(openTabs.size).toBe(2);
    expect(await statuses()).toEqual({
      'a://1': 'opened', 'a://2': 'opened', 'a://3': 'new', 'a://4': 'new', 'a://5': 'new',
    });
  });

  it('reports the window and the progress it opened', async () => {
    await seed(5);
    const state = await settled(startSession(2));
    expect(state.active).toBe(true);
    expect(state.batchSize).toBe(2);
    expect(state.progress.total).toBe(5);
    expect(state.progress.inFlight).toBe(2);
    expect(state.progress.queued).toBe(3);
  });

  it('opens fewer than batchSize when the queue is shorter', async () => {
    await seed(1);
    await settled(startSession(5));
    expect(openTabs.size).toBe(1);
  });

  it('ends the session immediately when there is nothing waiting', async () => {
    await saveJobUrls([]);
    const state = await settled(startSession(3));
    expect(openTabs.size).toBe(0);
    expect(state.active).toBe(false);
  });

  it('leaves a posting queued when its tab could not be opened', async () => {
    // The open is allowed to fail (a malformed URL, a browser refusing the
    // scheme) and the failure is swallowed. Marking it `opened` anyway drops it
    // out of the queue for good: nothing is left to close, so nothing ever tops
    // up, and the posting is silently never applied to.
    await seed(3);
    const create = chrome.tabs.create as unknown as ReturnType<typeof vi.fn>;
    const real = create.getMockImplementation()!;
    create.mockImplementation(async (props: { url: string }) => {
      if (props.url === 'a://2') throw new Error('cannot open');
      return real(props);
    });

    await settled(startSession(3));

    expect(openTabs.size).toBe(2);
    expect((await statuses())['a://2']).toBe('new');
    expect((await sessionTabs()).map(([, url]) => url)).toEqual(['a://1', 'a://3']);
  });
});

describe('finishing a posting opens the next one', () => {
  it('a closed tab frees exactly one slot and pulls in exactly one replacement', async () => {
    await seed(4);
    await settled(startSession(2));
    const [[firstTab]] = await sessionTabs();

    closeTab(firstTab);
    await settled(onTabClosed(firstTab));

    expect(openTabs.size).toBe(2);
    const urls = (await sessionTabs()).map(([, url]) => url);
    expect(urls).toEqual(['a://2', 'a://3']);
  });

  it('a submission frees the slot even when the tab is left open', async () => {
    // closeTabOnSubmit is a setting; the posting is finished either way.
    await seed(4);
    await settled(startSession(2));
    const [[firstTab]] = await sessionTabs();

    await settled(onSubmitted(firstTab));

    expect((await sessionTabs()).map(([, url]) => url)).toEqual(['a://2', 'a://3']);
  });

  it('two finishes landing together do not both claim the same slot', async () => {
    // The reason top-ups are serialized: each event must open one posting, not
    // two, and never the same posting twice.
    await seed(5);
    await settled(startSession(2));
    const [[t1], [t2]] = await sessionTabs();

    closeTab(t1);
    await settled(Promise.all([onTabClosed(t1), onSubmitted(t2)]));

    const urls = (await sessionTabs()).map(([, url]) => url);
    expect(urls).toEqual(['a://3', 'a://4']);
    expect(new Set(urls).size).toBe(2);
  });

  it('ignores a tab that was never part of the session', async () => {
    await seed(4);
    await settled(startSession(1));
    const before = await sessionTabs();

    await settled(onTabClosed(9999));
    await settled(onSubmitted(9999));

    expect(await sessionTabs()).toEqual(before);
    expect(openTabs.size).toBe(1);
  });

  it('reclaims a slot from a tab closed while the worker was asleep', async () => {
    // The worker can be torn down mid-session, so a tab can vanish without
    // anything hearing about it. A dead tab that keeps its slot stalls the queue.
    await seed(4);
    await settled(startSession(2));
    const [[t1], [t2]] = await sessionTabs();

    closeTab(t1); // no event delivered
    closeTab(t2);
    await settled(onTabClosed(t2));

    expect((await sessionTabs()).map(([, url]) => url)).toEqual(['a://3', 'a://4']);
  });

  it('ends the session once the queue drains and the last tab closes', async () => {
    await seed(1);
    await settled(startSession(2));
    const [[tab]] = await sessionTabs();

    closeTab(tab);
    await settled(onTabClosed(tab));

    expect((await sessionState()).active).toBe(false);
  });
});

describe('skipUrl', () => {
  it('marks the posting skipped, closes its tab, and opens the next', async () => {
    await seed(3);
    await settled(startSession(1));
    const [[tab, url]] = await sessionTabs();

    await settled(skipUrl(url, tab));

    expect((await statuses())[url]).toBe('skipped');
    expect(openTabs.has(tab)).toBe(false);
    expect((await sessionTabs()).map(([, u]) => u)).toEqual(['a://2']);
  });

  it('works when the caller does not know its own tab id', async () => {
    await seed(2);
    await settled(startSession(1));
    const [[tab, url]] = await sessionTabs();

    await settled(skipUrl(url));

    expect((await statuses())[url]).toBe('skipped');
    expect(openTabs.has(tab)).toBe(false);
  });
});

describe('stopSession', () => {
  it('stops refilling but leaves the open tabs alone — the user is mid-application', async () => {
    await seed(4);
    await settled(startSession(2));
    const [[t1]] = await sessionTabs();

    await stopSession();
    closeTab(t1);
    await settled(onTabClosed(t1));

    expect(openTabs.size).toBe(1);
    expect((await statuses())['a://3']).toBe('new');
  });

  it('a stopped session can be resumed, keeping the tabs it still has', async () => {
    await seed(4);
    await settled(startSession(2));
    await stopSession();

    const state = await settled(startSession(2));
    expect(state.active).toBe(true);
    expect(openTabs.size).toBe(2); // already full, nothing extra opened
  });
});

describe('urlForTab', () => {
  it('attributes a tab to the posting it was opened for', async () => {
    await seed(2);
    await settled(startSession(1));
    const [[tab, url]] = await sessionTabs();
    expect(await urlForTab(tab)).toBe(url);
    expect(await urlForTab(9999)).toBeUndefined();
  });
});

describe('openUrls — the "open these now" path outside a session', () => {
  it('opens every URL and marks them opened', async () => {
    await seed(3);
    await settled(openUrls(['a://1', 'a://2']));
    expect(openTabs.size).toBe(2);
    expect(await statuses()).toEqual({ 'a://1': 'opened', 'a://2': 'opened', 'a://3': 'new' });
  });

  it('leaves a URL untouched when its tab could not be opened', async () => {
    await seed(2);
    const create = chrome.tabs.create as unknown as ReturnType<typeof vi.fn>;
    const real = create.getMockImplementation()!;
    create.mockImplementation(async (props: { url: string }) => {
      if (props.url === 'a://1') throw new Error('cannot open');
      return real(props);
    });

    await settled(openUrls(['a://1', 'a://2']));

    expect(await statuses()).toEqual({ 'a://1': 'new', 'a://2': 'opened' });
  });
});
