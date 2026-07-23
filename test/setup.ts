/**
 * Vitest global setup. Provides a minimal chrome API mock so modules that
 * reference `chrome.*` can be imported in a jsdom environment.
 *
 * `storage.session` and the tab registry are here because the background half of
 * the extension is built on them: the queue session keeps its tab↔URL map in
 * session storage and asks `tabs.get` which of those tabs are still alive, so
 * without both it cannot be loaded at all, let alone tested.
 */
import { vi } from 'vitest';

function makeStorageArea() {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
      if (keys == null) return Object.fromEntries(store);
      const out: Record<string, unknown> = {};
      if (typeof keys === 'string') {
        if (store.has(keys)) out[keys] = store.get(keys);
      } else if (Array.isArray(keys)) {
        for (const k of keys) if (store.has(k)) out[k] = store.get(k);
      } else {
        for (const [k, def] of Object.entries(keys)) {
          out[k] = store.has(k) ? store.get(k) : def;
        }
      }
      return out;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) store.set(k, v);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const k of arr) store.delete(k);
    }),
    clear: vi.fn(async () => store.clear()),
    _store: store,
  };
}

export interface FakeTab {
  id: number;
  url?: string;
  active?: boolean;
  openerTabId?: number;
}

/** Tabs the mock believes are open, keyed by id — the test's window on the browser. */
export const openTabs = new Map<number, FakeTab>();
const removedListeners = new Set<(tabId: number) => void>();
let nextTabId = 1;

/** Close a tab the way the user would: it disappears and `onRemoved` fires. */
export function closeTab(tabId: number): void {
  openTabs.delete(tabId);
  for (const fn of removedListeners) fn(tabId);
}

/* The tab API's behaviour, kept as named functions so `resetChromeMock` can put
 * them back after a test has overridden one (e.g. to make an open fail). */
const TAB_IMPL = {
  create: async (props: Record<string, unknown>) => {
    const tab: FakeTab = { id: nextTabId++, ...props };
    openTabs.set(tab.id, tab);
    return tab;
  },
  // The real API rejects for an id that is gone; `liveTabs` depends on that.
  get: async (tabId: number) => {
    const tab = openTabs.get(tabId);
    if (!tab) throw new Error(`No tab with id: ${tabId}`);
    return tab;
  },
  remove: async (tabId: number) => {
    if (!openTabs.has(tabId)) throw new Error(`No tab with id: ${tabId}`);
    closeTab(tabId);
  },
  query: async () => [],
};

const chromeMock = {
  storage: {
    local: makeStorageArea(),
    session: makeStorageArea(),
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  runtime: {
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    getURL: vi.fn((p: string) => `chrome-extension://test/${p}`),
    getManifest: vi.fn(() => ({ version: '0.0.0-test' })),
    lastError: undefined,
  },
  tabs: {
    create: vi.fn(TAB_IMPL.create),
    get: vi.fn(TAB_IMPL.get),
    remove: vi.fn(TAB_IMPL.remove),
    sendMessage: vi.fn(),
    query: vi.fn(TAB_IMPL.query),
    onRemoved: {
      addListener: vi.fn((fn: (tabId: number) => void) => { removedListeners.add(fn); }),
      removeListener: vi.fn((fn: (tabId: number) => void) => { removedListeners.delete(fn); }),
    },
    onCreated: { addListener: vi.fn(), removeListener: vi.fn() },
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
};

/**
 * Wipe every bit of mock state — storage areas, tabs, call history, and any
 * per-test `mockImplementation`, so a test that makes `tabs.create` fail cannot
 * leak that into the next one.
 */
export async function resetChromeMock(): Promise<void> {
  vi.clearAllMocks();
  chromeMock.tabs.create.mockImplementation(TAB_IMPL.create);
  chromeMock.tabs.get.mockImplementation(TAB_IMPL.get);
  chromeMock.tabs.remove.mockImplementation(TAB_IMPL.remove);
  chromeMock.tabs.query.mockImplementation(TAB_IMPL.query);
  await chromeMock.storage.local.clear();
  await chromeMock.storage.session.clear();
  openTabs.clear();
  removedListeners.clear();
  nextTabId = 1;
}

// @ts-expect-error assigning a partial mock onto the global for tests
globalThis.chrome = chromeMock;
