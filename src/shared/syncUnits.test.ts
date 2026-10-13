import { describe, it, expect } from 'vitest';
import {
  LOCAL_SETTINGS, SYNCED_SETTINGS, SYNC_DOMAINS, deviceUnits, diffStamps, fromUnits, toUnits,
  unitDomain, type DeviceState,
} from './syncUnits';
import { DEFAULT_SETTINGS } from './defaults';
import { signatureKey } from './lessons';
import type { Lesson, Settings } from './types';

const T = 1_700_000_000_000;

function lesson(question: string, over: Partial<Lesson> = {}): Lesson {
  return {
    id: `l-${question}`,
    signature: { question, kind: 'text' },
    target: { field: 'email' },
    label: question,
    createdAt: T,
    hits: 0,
    ...over,
  };
}

function device(over: Partial<DeviceState> = {}): DeviceState {
  return {
    profile: { values: {}, keywords: {}, customFields: [] },
    lessons: [],
    settings: { ...DEFAULT_SETTINGS },
    docs: {},
    ...over,
  };
}

const full = (): DeviceState => device({
  profile: {
    values: { email: 'me@x.test', firstName: 'Ada' },
    keywords: { firstName: ['given name'] },
    customFields: [
      { id: 'c_b', label: 'Notice', kind: 'text', value: '1 month', keywords: [] },
      { id: 'c_a', label: 'Visa', kind: 'yesNo', value: 'No', keywords: ['sponsorship'] },
    ],
  },
  lessons: [lesson('work email'), lesson('your mail')],
  settings: { ...DEFAULT_SETTINGS, sessionBatchSize: 4, modalLayout: { right: 40, bottom: 40, width: 500, height: 600 } },
  docs: { resume: { name: 'cv.pdf', type: 'application/pdf', dataBase64: 'QUJD' } },
});

describe('the settings split', () => {
  it('keeps the card layout and the sync switch on the device', () => {
    expect([...LOCAL_SETTINGS].sort()).toEqual(['modalLayout', 'syncEnabled']);
  });

  it('puts every other setting on the synced side, and none on both', () => {
    const all = Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>;
    for (const k of all) {
      const synced = (SYNCED_SETTINGS as string[]).includes(k);
      const local = (LOCAL_SETTINGS as readonly string[]).includes(k);
      expect(synced !== local, k).toBe(true);
    }
  });
});

describe('unitDomain — every unit belongs to a family the Sync tab lists', () => {
  it('names a listed domain for every unit a full device produces', () => {
    for (const key of Object.keys(deviceUnits(full()))) {
      expect(SYNC_DOMAINS, key).toContain(unitDomain(key));
    }
  });
});

describe('toUnits / fromUnits — the round trip', () => {
  it('gives back the same device state', () => {
    const state = full();
    const units = toUnits(state, {});
    // Received by a device that lists the same things in the same order.
    const back = fromUnits(units, { ...state, settings: { ...DEFAULT_SETTINGS } }).state;
    expect(back.profile).toEqual(state.profile);
    expect(back.lessons).toEqual(state.lessons);
    expect(back.docs).toEqual(state.docs);
    // The synced settings travel; the local ones stay whatever the receiver had.
    expect(back.settings.sessionBatchSize).toBe(4);
    expect(back.settings.modalLayout).toEqual(DEFAULT_SETTINGS.modalLayout);
  });

  it('never carries a local setting', () => {
    const units = toUnits(full(), { 'settings.modalLayout': T });
    for (const k of LOCAL_SETTINGS) expect(units[`settings.${k}`], k).toBeUndefined();
  });

  /**
   * Unstamped means "not touched since the upgrade". A default nobody touched must
   * not exist as a unit, or on the first merge it would race — at time 0 — a value
   * the other device's user actually chose.
   */
  it('leaves out a setting still at its default unless it was stamped', () => {
    const units = toUnits(device(), {});
    expect(units['settings.sessionBatchSize']).toBeUndefined();
    expect(toUnits(device(), { 'settings.sessionBatchSize': T })['settings.sessionBatchSize'])
      .toEqual({ at: T, value: DEFAULT_SETTINGS.sessionBatchSize });
  });

  it('carries an unstamped change made before the upgrade, at time 0', () => {
    expect(toUnits(full(), {})['settings.sessionBatchSize']).toEqual({ at: 0, value: 4 });
  });

  it('turns a stamp with nothing behind it into a tombstone', () => {
    const units = toUnits(device(), { 'customField.c_gone': T });
    expect(units['customField.c_gone']).toEqual({ at: T, value: null });
    expect(fromUnits(units, device()).state.profile.customFields).toEqual([]);
  });

  it('keys a lesson by its signature, so two devices teaching one input converge', () => {
    const units = toUnits(device({ lessons: [lesson('email')] }), {});
    expect(Object.keys(units)).toEqual([`lesson.${signatureKey({ question: 'email', kind: 'text' })}`]);
  });

  it('lists what the receiver had never seen in key order', () => {
    const fields = fromUnits(toUnits(full(), {}), device()).state.profile.customFields!;
    expect(fields.map((f) => f.id)).toEqual(['c_a', 'c_b']);
  });

  it('keeps the receiving device\'s own order and appends what is new', () => {
    const local = device({ lessons: [lesson('b'), lesson('a')] });
    const units = { ...toUnits(local, {}), ...toUnits(device({ lessons: [lesson('c')] }), {}) };
    expect(fromUnits(units, local).state.lessons.map((l) => l.label)).toEqual(['b', 'a', 'c']);
  });

  it('returns a stamp for every unit that carries one, tombstones included', () => {
    const units = { ...toUnits(full(), { 'profile.values.email': T }), 'doc.coverLetter': { at: T + 1, value: null } };
    const { stamps } = fromUnits(units, device());
    expect(stamps['profile.values.email']).toBe(T);
    expect(stamps['doc.coverLetter']).toBe(T + 1);
    expect(stamps['profile.values.firstName']).toBeUndefined();
  });

  it('ignores a unit from a newer build it cannot place', () => {
    const units = { 'gadget.x': { at: T, value: 1 }, 'settings.notYetInvented': { at: T, value: true } };
    const back = fromUnits(units, device()).state;
    expect(back.settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe('diffStamps — what a save stamps', () => {
  it('stamps exactly the units that changed', () => {
    const before = full();
    const after = full();
    after.profile.values.email = 'new@x.test';
    const out = diffStamps(deviceUnits(before), deviceUnits(after), { 'profile.values.firstName': 1 }, T);
    expect(out).toEqual({ 'profile.values.firstName': 1, 'profile.values.email': T });
  });

  it('stamps a removal, so it can travel as a tombstone', () => {
    const before = full();
    const after = full();
    after.profile.customFields = after.profile.customFields!.filter((f) => f.id !== 'c_a');
    expect(diffStamps(deviceUnits(before), deviceUnits(after), {}, T)).toEqual({ 'customField.c_a': T });
  });

  it('hands back the same map when nothing changed, so the caller can skip the write', () => {
    const stamps = { x: 1 };
    expect(diffStamps(deviceUnits(full()), deviceUnits(full()), stamps, T)).toBe(stamps);
  });

  /**
   * The hit counter is bumped from every page a lesson fills. Stamping it would
   * let a hit on one device outvote a re-teach made a minute earlier on the other.
   */
  it('does not stamp a lesson whose hit count alone moved', () => {
    const before = device({ lessons: [lesson('email')] });
    const after = device({ lessons: [lesson('email', { hits: 9 })] });
    expect(diffStamps(deviceUnits(before), deviceUnits(after), {}, T)).toEqual({});
  });

  it('treats an emptied text field as removed', () => {
    const before = full();
    const after = full();
    after.profile.values.email = '';
    expect(diffStamps(deviceUnits(before), deviceUnits(after), {}, T)).toEqual({ 'profile.values.email': T });
  });
});
