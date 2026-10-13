import { beforeEach, describe, it, expect, vi, afterEach } from 'vitest';
import { resetChromeMock } from '../../test/setup';
import {
  applySnapshot, buildSnapshot, mergeIntoLocal, parseSnapshot, pruneUnits, snapshotFilename,
  summarize, UnsupportedSnapshotError,
} from './syncSnapshot';
import { SYNC_SCHEMA, emptySnapshot, type Snapshot } from './syncState';
import {
  getLessons, getProfile, getSettings, getStamps, mutateLessons, saveLessons, saveProfile, saveSettings,
} from './storage';
import { getDoc, setDoc, clearDoc } from './cvStore';
import { recordHits, signatureKey } from './lessons';
import { TOMBSTONE_TTL_MS } from './jobUrls';
import type { Lesson } from './types';

const T = 1_700_000_000_000;

function lesson(over: Partial<Lesson> = {}): Lesson {
  return {
    id: 'l1',
    signature: { question: 'work email', kind: 'email' },
    target: { field: 'email' },
    label: 'Work email',
    createdAt: T,
    hits: 0,
    ...over,
  };
}

beforeEach(async () => {
  await resetChromeMock();
  // The clock only: reading a `File` in jsdom runs on real timers.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T);
});

afterEach(() => vi.useRealTimers());

describe('saving stamps what changed', () => {
  it('dates a profile edit, and only the field that moved', async () => {
    await saveProfile({ values: { email: 'a@x' }, keywords: {}, customFields: [] });
    vi.setSystemTime(T + 10);
    await saveProfile({ values: { email: 'a@x', city: 'Oslo' }, keywords: {}, customFields: [] });
    expect(await getStamps('profile')).toEqual({ 'profile.values.email': T, 'profile.values.city': T + 10 });
  });

  it('dates a setting that syncs, and never one that stays here', async () => {
    const s = await getSettings();
    await saveSettings({ ...s, sessionBatchSize: 5, modalLayout: { right: 40, bottom: 40, width: 500, height: 600 } });
    expect(await getStamps('settings')).toEqual({ 'settings.sessionBatchSize': T });
  });

  it('does not date a lesson for counting a hit', async () => {
    await saveLessons([lesson()]);
    vi.setSystemTime(T + 50);
    await mutateLessons((ls) => recordHits(ls, ['l1']));
    const key = `lesson.${signatureKey(lesson().signature)}`;
    expect(await getStamps('lessons')).toEqual({ [key]: T });
  });

  it('dates a document, and its removal', async () => {
    await setDoc('resume', new File(['abc'], 'cv.pdf', { type: 'application/pdf' }));
    vi.setSystemTime(T + 5);
    await clearDoc('resume');
    expect(await getStamps('docs')).toEqual({ 'doc.resume': T + 5 });
    expect((await buildSnapshot()).state['doc.resume']).toEqual({ at: T + 5, value: null });
  });
});

describe('buildSnapshot / applySnapshot', () => {
  it('carries the profile, lessons, settings and documents', async () => {
    await saveProfile({ values: { email: 'a@x' }, keywords: {}, customFields: [] });
    await saveLessons([lesson()]);
    await saveSettings({ ...(await getSettings()), openCardWhenFilled: true });
    await setDoc('resume', new File(['abc'], 'cv.pdf', { type: 'application/pdf' }));
    const snap = await buildSnapshot();
    expect(Object.keys(snap.state).sort()).toEqual([
      'doc.resume',
      `lesson.${signatureKey(lesson().signature)}`,
      'profile.values.email',
      'settings.openCardWhenFilled',
    ]);
  });

  /** The backup round trip: everything comes back onto a wiped device. */
  it('restores a wiped device from its own snapshot', async () => {
    await saveProfile({ values: { email: 'a@x' }, keywords: {}, customFields: [] });
    await saveLessons([lesson()]);
    await setDoc('coverLetter', new File(['hi'], 'cl.txt', { type: 'text/plain' }));
    const settings = await getSettings();
    await saveSettings({ ...settings, sessionBatchSize: 7, modalLayout: { right: 40, bottom: 40, width: 500, height: 600 } });
    const snap = await buildSnapshot();

    await resetChromeMock();
    const here = (await getSettings()).modalLayout;
    await mergeIntoLocal(parseSnapshot(JSON.stringify(snap)));

    expect((await getProfile()).values.email).toBe('a@x');
    expect(await getLessons()).toEqual([lesson()]);
    expect((await getDoc('coverLetter'))?.name).toBe('cl.txt');
    expect((await getSettings()).sessionBatchSize).toBe(7);
    // The card's rectangle belongs to this screen, and stays as this device had it.
    expect((await getSettings()).modalLayout).toEqual(here);
  });

  it('adopts the far side\'s stamps rather than dating its values now', async () => {
    const remote: Snapshot = {
      ...emptySnapshot(),
      state: { 'profile.values.city': { at: T - 1000, value: 'Bergen' } },
    };
    await applySnapshot(remote);
    expect(await getStamps('profile')).toEqual({ 'profile.values.city': T - 1000 });
  });

  it('a newer edit here survives a sync with an older one there', async () => {
    await saveProfile({ values: { city: 'Oslo' }, keywords: {}, customFields: [] });
    await mergeIntoLocal({ ...emptySnapshot(), state: { 'profile.values.city': { at: T - 1, value: 'Bergen' } } });
    expect((await getProfile()).values.city).toBe('Oslo');
  });

  it('removes a document the far side removed later', async () => {
    await setDoc('resume', new File(['abc'], 'cv.pdf', { type: 'application/pdf' }));
    await mergeIntoLocal({ ...emptySnapshot(), state: { 'doc.resume': { at: T + 1, value: null } } });
    expect(await getDoc('resume')).toBeNull();
  });

  it('returns what it stored — tombstones past their time pruned', async () => {
    const old = T - TOMBSTONE_TTL_MS - 1;
    const out = await applySnapshot({ ...emptySnapshot(), state: { 'customField.c_x': { at: old, value: null } } });
    expect(out.state).toEqual({});
    expect(await getStamps('profile')).toEqual({});
  });

  it('sends back a unit only a newer build understands', async () => {
    const out = await mergeIntoLocal({ ...emptySnapshot(), state: { 'gadget.x': { at: T, value: 1 } } });
    expect(out.state['gadget.x']).toEqual({ at: T, value: 1 });
  });
});

describe('pruneUnits', () => {
  it('keeps a fresh tombstone and every live unit, however old', () => {
    const units = {
      a: { at: T, value: null },
      b: { at: 0, value: 'x' },
      c: { at: T - TOMBSTONE_TTL_MS, value: null },
    };
    expect(Object.keys(pruneUnits(units, T))).toEqual(['a', 'b']);
  });
});

describe('summarize', () => {
  it('counts postings, filled-in fields and lessons', () => {
    const s: Snapshot = {
      schema: SYNC_SCHEMA,
      jobUrls: [],
      state: {
        'profile.values.email': { at: 1, value: 'a' },
        'customField.c_x': { at: 1, value: {} },
        'customField.c_y': { at: 1, value: null },
        'lesson.k': { at: 1, value: {} },
        'settings.openCardWhenFilled': { at: 1, value: true },
      },
    };
    expect(summarize(s)).toEqual({ postings: 0, fields: 2, lessons: 1 });
  });
});

describe('parseSnapshot', () => {
  it('accepts a snapshot this build wrote', () => {
    const parsed = parseSnapshot(JSON.stringify(emptySnapshot()));
    expect(parsed.schema).toBe(SYNC_SCHEMA);
    expect(parsed.jobUrls).toEqual([]);
  });

  /** A backup taken before the whole state travelled, with the old statuses in it. */
  it('reads a schema-2 backup, statuses and all', async () => {
    const at = T - 100;
    const old = {
      schema: 2,
      jobUrls: ['applied', 'skipped', 'opened'].map((status, i) => ({
        id: `x${i}`, url: `a://${i}`, status, addedAt: at, updatedAt: at, history: [{ status, at }],
      })),
      jobDetails: {},
      siteConfigs: [],
      deletedSiteConfigs: {},
    };
    const merged = await mergeIntoLocal(parseSnapshot(JSON.stringify(old)));
    expect(merged.jobUrls.map((e) => e.status)).toEqual(['done', 'done', 'new']);
  });

  it('refuses a newer schema, and says to update this device', () => {
    const future = JSON.stringify({ schema: SYNC_SCHEMA + 1, jobUrls: [], state: {} });
    expect(() => parseSnapshot(future)).toThrow(UnsupportedSnapshotError);
    expect(() => parseSnapshot(future)).toThrow(/newer version/i);
  });

  it('refuses a file that is not a snapshot at all', () => {
    expect(() => parseSnapshot('[]')).toThrow(UnsupportedSnapshotError);
    expect(() => parseSnapshot('not json')).toThrow(UnsupportedSnapshotError);
  });
});

describe('snapshotFilename', () => {
  it('is dated, so successive backups do not overwrite each other', () => {
    expect(snapshotFilename(new Date('2026-07-26T12:00:00Z'))).toBe('job-filler-backup-2026-07-26.json');
  });
});
