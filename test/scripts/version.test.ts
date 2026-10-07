import {
  parseVersion,
  compareVersions,
  readManifestVersion,
  replaceManifestVersion,
  replaceListingVersion,
  nextPatch,
} from '../../scripts/version.mjs';

describe('parseVersion', () => {
  it.each(['1', '0.1.2', '1.2.3.4', '65535.0'])('accepts %s', (s) => {
    expect(() => parseVersion(s)).not.toThrow();
  });

  it('returns the parts as numbers', () => {
    expect(parseVersion('0.10.2')).toEqual([0, 10, 2]);
  });

  it.each(['', '01.2', '1.2.3.4.5', '65536', '1.2-beta', 'v1.2', '1..2', '1.2.'])(
    'rejects %j',
    (s) => {
      expect(() => parseVersion(s)).toThrow();
    },
  );
});

describe('compareVersions', () => {
  it('orders numerically, not lexically', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.1', '0.2')).toBeLessThan(0);
  });

  it('treats missing parts as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.0.1', '1.2')).toBeGreaterThan(0);
  });
});

const MANIFEST = `export default defineManifest({
  manifest_version: 3,
  name: 'Chromium Filler',
  version: '0.1.1',
  description: 'x',
});
`;

describe('manifest version', () => {
  it('reads the version line and not manifest_version', () => {
    expect(readManifestVersion(MANIFEST)).toBe('0.1.1');
  });

  it('replaces only the version line', () => {
    const out = replaceManifestVersion(MANIFEST, '0.1.2');
    expect(readManifestVersion(out)).toBe('0.1.2');
    expect(out).toContain('manifest_version: 3,');
    expect(out.replace("'0.1.2'", "'0.1.1'")).toBe(MANIFEST);
  });

  it('throws when there is no version line', () => {
    expect(() => readManifestVersion('export default {}')).toThrow();
  });
});

describe('replaceListingVersion', () => {
  it('rewrites every zip name of the old version', () => {
    const md = 'Upload `chromium-filler-v0.1.1-store.zip`.\n**Not** `chromium-filler-v0.1.1.zip`.';
    expect(replaceListingVersion(md, '0.1.1', '0.1.2')).toBe(
      'Upload `chromium-filler-v0.1.2-store.zip`.\n**Not** `chromium-filler-v0.1.2.zip`.',
    );
  });

  it('does not treat dots as wildcards', () => {
    expect(replaceListingVersion('chromium-filler-v0x1x1.zip', '0.1.1', '0.1.2')).toBe(
      'chromium-filler-v0x1x1.zip',
    );
  });
});

describe('nextPatch', () => {
  it('bumps the last part of a three-part version', () => {
    expect(nextPatch('0.1.2')).toBe('0.1.3');
    expect(nextPatch('0.1.9')).toBe('0.1.10');
  });

  it('pads a short version to three parts first', () => {
    expect(nextPatch('1')).toBe('1.0.1');
    expect(nextPatch('1.2')).toBe('1.2.1');
  });

  it('bumps the fourth part when there is one', () => {
    expect(nextPatch('1.2.3.4')).toBe('1.2.3.5');
  });
});
