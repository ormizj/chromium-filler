import { describe, it, expect, beforeEach } from 'vitest';
import { fileToCvFile, cvFileToFile, setCv, getCv, clearCv } from './cvStore';
import { upsertSiteConfig, saveJobUrls, getJobUrls, getSiteConfigs, saveFieldOverride } from './storage';
import type { SiteConfig } from './types';

beforeEach(async () => {
  // The mocked chrome.storage.local persists between tests; reset it.
  await chrome.storage.local.clear();
});

const cfg = (id: string): SiteConfig => ({ id, name: id, urlPatterns: [`*://${id}/*`], extract: {} });

function readBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(new Uint8Array(fr.result as ArrayBuffer));
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(blob);
  });
}

describe('cv codec (File <-> CvFile)', () => {
  it('round-trips name, type, and bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 250]);
    const file = new File([bytes], 'cv.pdf', { type: 'application/pdf' });

    const cv = await fileToCvFile(file);
    expect(cv.name).toBe('cv.pdf');
    expect(cv.type).toBe('application/pdf');
    expect(new Uint8Array(cv.data)).toEqual(bytes);

    const back = cvFileToFile(cv);
    expect(back.name).toBe('cv.pdf');
    expect(back.type).toBe('application/pdf');
    expect(await readBytes(back)).toEqual(bytes);
  });

  it('setCv/getCv round-trip through chrome.storage (base64)', async () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255, 128]);
    await setCv(new File([bytes], 'me.pdf', { type: 'application/pdf' }));
    const got = await getCv();
    expect(got?.name).toBe('me.pdf');
    expect(got?.type).toBe('application/pdf');
    expect(new Uint8Array(got!.data)).toEqual(bytes);
    await clearCv();
    expect(await getCv()).toBeNull();
  });
});

describe('site config upsert', () => {
  it('adds a new config and updates an existing one by id', async () => {
    await upsertSiteConfig(cfg('a'));
    await upsertSiteConfig(cfg('b'));
    let all = await getSiteConfigs();
    expect(all.map((c) => c.id)).toEqual(['a', 'b']);

    const updated = { ...cfg('a'), name: 'Renamed' };
    await upsertSiteConfig(updated);
    all = await getSiteConfigs();
    expect(all).toHaveLength(2);
    expect(all.find((c) => c.id === 'a')?.name).toBe('Renamed');
  });

  it('saveFieldOverride writes fieldOverrides and cvUpload', async () => {
    await upsertSiteConfig(cfg('a'));
    await saveFieldOverride('a', 'email', '#candidate_email');
    await saveFieldOverride('a', 'resume', 'input.cv');
    const all = await getSiteConfigs();
    const a = all.find((c) => c.id === 'a')!;
    expect(a.fieldOverrides?.email).toBe('#candidate_email');
    expect(a.cvUpload).toBe('input.cv');
  });
});

describe('job urls', () => {
  it('persists and reloads the list', async () => {
    await saveJobUrls([
      { id: '1', url: 'https://x.com/1', status: 'new', addedAt: 1, updatedAt: 1, history: [{ status: 'new', at: 1 }] },
    ]);
    const list = await getJobUrls();
    expect(list).toHaveLength(1);
    expect(list[0].url).toBe('https://x.com/1');
  });
});
