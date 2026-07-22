/**
 * Vitest global setup. Provides a minimal chrome API mock so modules that
 * reference `chrome.*` can be imported in a jsdom environment.
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

const chromeMock = {
  storage: {
    local: makeStorageArea(),
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
    create: vi.fn(async (props: Record<string, unknown>) => ({ id: 1, ...props })),
    sendMessage: vi.fn(),
    query: vi.fn(async () => []),
  },
};

// @ts-expect-error assigning a partial mock onto the global for tests
globalThis.chrome = chromeMock;
