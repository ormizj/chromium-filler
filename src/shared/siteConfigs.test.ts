import { describe, it, expect } from 'vitest';
import {
  canonical, isEmptySetup, migrateLegacy, newStoredConfig, pruneConfigTombstones,
  resolveSiteConfig, stampChanges, writeSetup,
} from './siteConfigs';
import type { SiteConfig, StoredSiteConfig } from './types';

const T = 1_700_000_000_000;

function stored(over: Partial<StoredSiteConfig> = {}): StoredSiteConfig {
  return { id: 'acme', name: 'acme.com', urlPatterns: ['*://acme.com/*'], updatedAt: T, ...over };
}

describe('canonical', () => {
  it('does not depend on key order, and drops undefined', () => {
    expect(canonical({ b: 1, a: { d: 2, c: [3, { y: 1, x: 2 }] } }))
      .toBe(canonical({ a: { c: [3, { x: 2, y: 1 }], d: 2 }, b: 1, z: undefined }));
  });
});

describe('resolveSiteConfig', () => {
  it('reads only the half for the form factor asked about', () => {
    const s = stored({
      desktop: { submitSelector: '#send', extract: { jobTitle: 'h1' }, updatedAt: T },
      mobile: { submitSelector: '.m-send', extract: {}, updatedAt: T },
    });
    expect(resolveSiteConfig(s, 'desktop').submitSelector).toBe('#send');
    expect(resolveSiteConfig(s, 'mobile').submitSelector).toBe('.m-send');
  });

  it('resolves an absent half to an unconfigured site, never to the other half', () => {
    const s = stored({ desktop: { submitSelector: '#send', successSelector: '.ok', extract: {} } });
    const m = resolveSiteConfig(s, 'mobile');
    expect(m.submitSelector).toBeUndefined();
    expect(m.successSelector).toBeUndefined();
    expect(m.extract).toEqual({});
    expect(m).toMatchObject({ id: 'acme', name: 'acme.com', urlPatterns: ['*://acme.com/*'] });
  });

  it('carries no stamp into the flat view', () => {
    const r = resolveSiteConfig(stored({ desktop: { extract: {}, updatedAt: T } }), 'desktop');
    expect('updatedAt' in r).toBe(false);
  });
});

describe('writeSetup', () => {
  it('writes the half for this form factor and stamps it and the config', () => {
    const before = stored({ mobile: { submitSelector: '.m', extract: {}, updatedAt: T } });
    const after = writeSetup(before, 'desktop', (c) => { c.submitSelector = '#send'; }, T + 5);
    expect(after.desktop).toMatchObject({ submitSelector: '#send', updatedAt: T + 5 });
    expect(after.mobile).toEqual(before.mobile);
    expect(after.updatedAt).toBe(T + 5);
  });

  it('changes nothing, stamps included, when the mutator changes nothing', () => {
    const before = stored({ desktop: { extract: { jobTitle: 'h1' }, updatedAt: T } });
    expect(writeSetup(before, 'desktop', () => {}, T + 5)).toEqual(before);
  });

  it('writes shell keys to the shell', () => {
    const after = writeSetup(stored(), 'mobile', (c) => { c.name = 'Acme'; }, T + 1);
    expect(after.name).toBe('Acme');
    expect(after.updatedAt).toBe(T + 1);
    expect(after.mobile).toBeUndefined();
  });

  it('keeps fields this build has never heard of', () => {
    const before = { ...stored(), future: 1 } as StoredSiteConfig;
    const after = writeSetup(before, 'desktop', (c) => { c.cvUpload = '#cv'; }, T + 1);
    expect((after as unknown as { future: number }).future).toBe(1);
  });
});

describe('migrateLegacy', () => {
  const legacy: SiteConfig = {
    id: 'acme', name: 'acme.com', urlPatterns: ['*://acme.com/*'], autoDetect: true,
    waitFor: 'form', prep: [{ action: 'click', selector: '#more' }], extract: { jobTitle: 'h1' },
    submitSelector: '#send',
  };

  it('moves a flat config into the half for this device', () => {
    const m = migrateLegacy(legacy, 'mobile');
    expect(m.desktop).toBeUndefined();
    expect(m.mobile).toMatchObject({ waitFor: 'form', submitSelector: '#send', extract: { jobTitle: 'h1' } });
    expect(m).toMatchObject({ id: 'acme', autoDetect: true });
    expect(resolveSiteConfig(m, 'mobile')).toEqual(legacy);
  });

  it('is idempotent on a config already stored in halves', () => {
    const m = migrateLegacy(legacy, 'desktop');
    expect(migrateLegacy(m, 'mobile')).toEqual(m);
  });
});

describe('newStoredConfig', () => {
  it('puts the template setup in this half only', () => {
    const s = newStoredConfig({ id: 'x', name: 'x', urlPatterns: ['*://x/*'], extract: {}, waitFor: 'form' }, 'desktop', T);
    expect(s.desktop).toMatchObject({ waitFor: 'form', updatedAt: T });
    expect(s.mobile).toBeUndefined();
    expect(s.updatedAt).toBe(T);
  });
});

describe('isEmptySetup', () => {
  it('treats a half with nothing a site can be worked by as empty', () => {
    expect(isEmptySetup(undefined)).toBe(true);
    expect(isEmptySetup({ extract: {}, prep: [], fieldOverrides: {}, updatedAt: T })).toBe(true);
    expect(isEmptySetup({ extract: {}, submitSelector: '#s' })).toBe(false);
  });
});

describe('stampChanges', () => {
  it('stamps exactly the halves that changed, and the config with them', () => {
    const before = [stored({ desktop: { extract: {}, updatedAt: T }, mobile: { extract: {}, updatedAt: T } })];
    const after = [stored({ desktop: { extract: {}, updatedAt: T }, mobile: { extract: { jobTitle: 'h1' }, updatedAt: T } })];
    const { configs, deleted } = stampChanges(before, after, T + 9);
    expect(configs[0].desktop?.updatedAt).toBe(T);
    expect(configs[0].mobile?.updatedAt).toBe(T + 9);
    expect(configs[0].updatedAt).toBe(T + 9);
    expect(deleted).toEqual({});
  });

  it('keeps the stored stamp when only a stamp was edited by hand', () => {
    const before = [stored({ desktop: { extract: {}, updatedAt: T } })];
    const after = [stored({ updatedAt: 1, desktop: { extract: {}, updatedAt: 1 } })];
    const { configs } = stampChanges(before, after, T + 9);
    expect(configs[0]).toEqual(before[0]);
  });

  it('stamps a new config and tombstones a removed one', () => {
    const before = [stored()];
    const after = [stored({ id: 'new', desktop: { extract: {} } })];
    const { configs, deleted } = stampChanges(before, after, T + 9);
    expect(configs[0].updatedAt).toBe(T + 9);
    expect(configs[0].desktop?.updatedAt).toBe(T + 9);
    expect(deleted).toEqual({ acme: T + 9 });
  });
});

describe('pruneConfigTombstones', () => {
  it('forgets tombstones after 90 days', () => {
    const day = 24 * 60 * 60 * 1000;
    expect(pruneConfigTombstones({ old: T, fresh: T + 89 * day }, T + 91 * day)).toEqual({ fresh: T + 89 * day });
  });
});
