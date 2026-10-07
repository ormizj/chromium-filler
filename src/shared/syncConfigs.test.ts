import { describe, it, expect } from 'vitest';
import { mergeSiteConfigs, type ConfigSet } from './syncConfigs';
import { canonical } from './siteConfigs';
import type { StoredSiteConfig } from './types';

const T = 1_700_000_000_000;

function cfg(id: string, at: number, over: Partial<StoredSiteConfig> = {}): StoredSiteConfig {
  return { id, name: id, urlPatterns: [`*://${id}/*`], updatedAt: at, ...over };
}

function set(siteConfigs: StoredSiteConfig[], deletedSiteConfigs: Record<string, number> = {}): ConfigSet {
  return { siteConfigs, deletedSiteConfigs };
}

const eq = (x: ConfigSet, y: ConfigSet) => expect(canonical(x)).toBe(canonical(y));

describe('mergeSiteConfigs — the halves are independent', () => {
  it('keeps a desktop edit from one device and a mobile edit from the other', () => {
    const a = set([cfg('acme', T + 2, { desktop: { submitSelector: '#d', extract: {}, updatedAt: T + 2 } })]);
    const b = set([cfg('acme', T + 3, { mobile: { submitSelector: '.m', extract: {}, updatedAt: T + 3 } })]);
    const m = mergeSiteConfigs(a, b).siteConfigs[0];
    expect(m.desktop?.submitSelector).toBe('#d');
    expect(m.mobile?.submitSelector).toBe('.m');
    expect(m.updatedAt).toBe(T + 3);
  });

  it('takes the newer copy of the same half', () => {
    const a = set([cfg('acme', T + 1, { desktop: { submitSelector: '#old', extract: {}, updatedAt: T + 1 } })]);
    const b = set([cfg('acme', T + 5, { desktop: { submitSelector: '#new', extract: {}, updatedAt: T + 5 } })]);
    expect(mergeSiteConfigs(a, b).siteConfigs[0].desktop?.submitSelector).toBe('#new');
  });

  it('takes the shell from the newest copy, and keeps unknown keys', () => {
    const a = set([{ ...cfg('acme', T + 1, { name: 'old' }), future: 'x' } as StoredSiteConfig]);
    const b = set([cfg('acme', T + 4, { name: 'new' })]);
    const m = mergeSiteConfigs(a, b).siteConfigs[0] as StoredSiteConfig & { future?: string };
    expect(m.name).toBe('new');
    expect(m.future).toBe('x');
  });

  it('adds a config only one side has', () => {
    const m = mergeSiteConfigs(set([cfg('a', T)]), set([cfg('b', T)]));
    expect(m.siteConfigs.map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('mergeSiteConfigs — deletion', () => {
  it('drops a config whose tombstone is newer than every write', () => {
    const m = mergeSiteConfigs(set([cfg('acme', T)]), set([], { acme: T + 1 }));
    expect(m.siteConfigs).toEqual([]);
    expect(m.deletedSiteConfigs).toEqual({ acme: T + 1 });
  });

  it('lets a later re-creation beat the tombstone, without the halves from before it', () => {
    const old = cfg('acme', T, { desktop: { submitSelector: '#old', extract: {}, updatedAt: T } });
    const recreated = cfg('acme', T + 5, { mobile: { extract: { jobTitle: 'h1' }, updatedAt: T + 5 } });
    const m = mergeSiteConfigs(set([old]), set([recreated], { acme: T + 2 })).siteConfigs[0];
    expect(m.desktop).toBeUndefined();
    expect(m.mobile?.extract).toEqual({ jobTitle: 'h1' });
  });

  it('unions tombstones by their latest time', () => {
    const m = mergeSiteConfigs(set([], { x: T, y: T + 9 }), set([], { x: T + 3 }));
    expect(m.deletedSiteConfigs).toEqual({ x: T + 3, y: T + 9 });
  });
});

describe('mergeSiteConfigs — algebra', () => {
  const a = set(
    [
      cfg('acme', T + 4, { name: 'A', desktop: { submitSelector: '#a', extract: {}, updatedAt: T + 4 } }),
      cfg('beta', T + 1, { mobile: { extract: {}, cvUpload: '#cv', updatedAt: T + 1 } }),
    ],
    { gone: T + 2 },
  );
  const b = set(
    [
      cfg('acme', T + 4, { name: 'B', mobile: { submitSelector: '.m', extract: {}, updatedAt: T + 3 } }),
      cfg('gone', T + 1),
    ],
    { beta: T },
  );
  const c = set(
    [
      cfg('acme', T + 2, { desktop: { submitSelector: '#c', extract: {}, updatedAt: T + 2 } }),
      cfg('delta', T),
    ],
    { acme: T + 1 },
  );

  it('is commutative', () => {
    eq(mergeSiteConfigs(a, b), mergeSiteConfigs(b, a));
    eq(mergeSiteConfigs(a, c), mergeSiteConfigs(c, a));
  });

  it('is associative', () => {
    eq(
      mergeSiteConfigs(mergeSiteConfigs(a, b), c),
      mergeSiteConfigs(a, mergeSiteConfigs(b, c)),
    );
  });

  it('is idempotent', () => {
    const ab = mergeSiteConfigs(a, b);
    eq(mergeSiteConfigs(ab, ab), ab);
    eq(mergeSiteConfigs(ab, a), ab);
  });

  it('breaks a same-instant tie on content, not on argument order', () => {
    expect(mergeSiteConfigs(a, b).siteConfigs.find((x) => x.id === 'acme')?.name)
      .toBe(mergeSiteConfigs(b, a).siteConfigs.find((x) => x.id === 'acme')?.name);
  });
});
