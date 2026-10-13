import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fileToCvFile, cvFileToFile, setCv, getCv, clearCv } from './cvStore';
import {
  saveJobUrls, getJobUrls, getSettings, saveSettings, getProfile, getState,
  getLessons, mutateLessons, mutateProfile, normalizeProfile, dropRetiredKeys,
} from './storage';
import type { Lesson } from './types';

beforeEach(async () => {
  // The mocked chrome.storage.local persists between tests; reset it.
  await chrome.storage.local.clear();
});


function readBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(new Uint8Array(fr.result as ArrayBuffer));
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(blob);
  });
}

describe('settings', () => {
  it('backfills a setting an older install never stored', async () => {
    // Written before sessionBatchSize existed; reading must not yield undefined,
    // or the session would open zero tabs.
    await chrome.storage.local.set({ settings: { keepInBrowser: false } });
    const settings = await getSettings();
    expect(settings.sessionBatchSize).toBe(2);
    expect(settings.keepInBrowser).toBe(false);
    expect(settings.openCardWhenFilled).toBe(false);
  });

  it('keeps a stored batch size over the default', async () => {
    const current = await getSettings();
    await saveSettings({ ...current, sessionBatchSize: 4 });
    expect((await getSettings()).sessionBatchSize).toBe(4);
  });
});

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

describe('profile', () => {
  it('reads an older profile into today\'s shape, dropping the unused custom map', async () => {
    await chrome.storage.local.set({ profile: { values: { email: 'a@b.test' }, custom: { x: 'y' } } });
    expect(await getProfile()).toEqual({ values: { email: 'a@b.test' }, keywords: {}, customFields: [] });
  });

  it('a fresh install has an empty profile with empty lists', async () => {
    expect(normalizeProfile(undefined)).toEqual({ values: {}, keywords: {}, customFields: [] });
  });

  it('mutateProfile read-modify-writes', async () => {
    await mutateProfile((p) => ({
      ...p, customFields: [{ id: 'c_a', label: 'A', kind: 'text', value: '1', keywords: [] }],
    }));
    expect((await getProfile()).customFields?.map((f) => f.id)).toEqual(['c_a']);
  });
});

describe('lessons', () => {
  const lesson: Lesson = {
    id: 'l1', signature: { question: 'q', kind: 'text' }, target: { ignore: true }, label: 'Q', createdAt: 1, hits: 0,
  };

  it('start empty, and come back from getState', async () => {
    expect(await getLessons()).toEqual([]);
    await mutateLessons((l) => [...l, lesson]);
    expect((await getState()).lessons).toEqual([lesson]);
  });

  it('skip the write when the helper returns the same list', async () => {
    await mutateLessons((l) => [...l, lesson]);
    const set = vi.spyOn(chrome.storage.local, 'set');
    await mutateLessons((l) => l);
    expect(set).not.toHaveBeenCalled();
    set.mockRestore();
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

describe('dropRetiredKeys', () => {
  it('forgets the captured postings and the retired settings, and nothing else', async () => {
    await chrome.storage.local.set({
      jobDetails: { 'a://1': { url: 'a://1' } },
      settings: {
        fillAutomatically: false,
        exportOptions: { format: 'csv' },
        autoRunOnLoad: true,
        markDoneOnClose: false,
        closeTabOnSkip: false,
        closeTabDelayMs: 200,
        openCardOnQueueTabs: true,
        modalFullscreen: true,
      },
      profile: { values: { email: 'a@x' } },
    });
    await dropRetiredKeys();
    const raw = await chrome.storage.local.get(null);
    expect(raw.jobDetails).toBeUndefined();
    expect(raw.settings).toEqual({ fillAutomatically: false });
    expect(raw.profile).toEqual({ values: { email: 'a@x' } });
  });
});
