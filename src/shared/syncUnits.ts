/**
 * Everything sync carries beyond the job list, as a flat map of small *units* —
 * one profile value, one custom field, one lesson, one setting, one document —
 * each with the time it last changed.
 *
 * The job list merges by unioning its status logs (`syncState.ts`). The rest of
 * the app's state has no log, so it gets the next simplest join: a
 * **last-writer-wins register per unit**. Newest `at` wins; a tie goes to a
 * stable content key. That is commutative, associative and idempotent by
 * construction, and keeping the units small is what makes it fair — two devices
 * that changed *different* profile fields both keep their change, because they
 * are different units.
 *
 * The times are written when the change is *saved* (`diffStamps`, called by the
 * storage wrappers), not when it is synced: syncing a week-old edit must not
 * make it look newer than one made this morning on the other device.
 *
 * Pure: no `chrome.*`. The storage edge is `syncSnapshot.ts`.
 */

import type { DocKind, Lesson, Profile, Settings, StoredDoc } from './types';
import { DEFAULT_SETTINGS } from './defaults';
import { signatureKey } from './lessons';

/** Unit key -> when it last changed on some device. Absent: before stamps existed. */
export type Stamps = Record<string, number>;

/** One unit on the wire. `value: null` is a tombstone — the thing was removed. */
export interface Stamped {
  at: number;
  value: unknown;
}

export type UnitMap = Record<string, Stamped>;

/** What sync reads from and writes to a device, besides the job list. */
export interface DeviceState {
  profile: Profile;
  lessons: Lesson[];
  settings: Settings;
  docs: Partial<Record<DocKind, StoredDoc>>;
}

/**
 * The settings that stay on this device.
 *
 * `modalLayout` is a rectangle measured against *one* screen (`sampleScreen`) —
 * replicating it to a phone or a smaller laptop is exactly the stranding
 * `clampLayout` exists to undo. `syncEnabled` is the switch for this very feature: syncing it
 * would let one device turn sync off on the other.
 *
 * Everything else syncs, including any setting added later — it lands here only
 * by being named.
 */
export const LOCAL_SETTINGS = ['modalLayout', 'syncEnabled'] as const satisfies ReadonlyArray<keyof Settings>;

export type LocalSetting = (typeof LOCAL_SETTINGS)[number];
export type SyncedSetting = Exclude<keyof Settings, LocalSetting>;

/** Every setting that travels — derived, so a new setting syncs unless it is named above. */
export const SYNCED_SETTINGS = (Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>)
  .filter((k): k is SyncedSetting => !(LOCAL_SETTINGS as ReadonlyArray<string>).includes(k));

/**
 * The families of units — and so the rows of the Sync tab's "What syncs" list,
 * worded in `help.ts` as a `Record<SyncDomain, …>`. A new family fails
 * `npm run typecheck` until it is worded, and `unitDomain` has to place every
 * unit in one of them (`syncUnits.test.ts`).
 */
export const SYNC_DOMAINS = [
  'jobs', 'profile', 'wordings', 'customFields', 'lessons', 'resume', 'coverLetter', 'settings',
] as const;

export type SyncDomain = (typeof SYNC_DOMAINS)[number];

const VALUE = 'profile.values.';
const WORDING = 'profile.keywords.';
const FIELD = 'customField.';
const LESSON = 'lesson.';
const SETTING = 'settings.';
const DOC = 'doc.';

export function unitDomain(key: string): SyncDomain | undefined {
  if (key.startsWith(VALUE)) return 'profile';
  if (key.startsWith(WORDING)) return 'wordings';
  if (key.startsWith(FIELD)) return 'customFields';
  if (key.startsWith(LESSON)) return 'lessons';
  if (key.startsWith(SETTING)) return 'settings';
  if (key === `${DOC}resume`) return 'resume';
  if (key === `${DOC}coverLetter`) return 'coverLetter';
  return undefined;
}

export function isLessonUnit(key: string): boolean {
  return key.startsWith(LESSON);
}

/**
 * JSON with sorted keys, so two devices holding equal values produce the same
 * string whatever order their objects were built in — the tie-break and the
 * change detection both depend on it.
 */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).filter((k) => obj[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/* ---------------- Device state -> units ---------------- */

export function profileUnits(profile: Profile): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(profile.values ?? {})) if (v) out[VALUE + k] = v;
  for (const [k, v] of Object.entries(profile.keywords ?? {})) if (v?.length) out[WORDING + k] = v;
  for (const f of profile.customFields ?? []) out[FIELD + f.id] = f;
  return out;
}

export function lessonUnits(lessons: readonly Lesson[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const l of lessons) out[LESSON + signatureKey(l.signature)] = l;
  return out;
}

export function settingsUnits(settings: Settings): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of SYNCED_SETTINGS) if (settings[k] !== undefined) out[SETTING + k] = settings[k];
  return out;
}

export function docUnits(docs: DeviceState['docs']): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(docs)) if (v) out[DOC + k] = v;
  return out;
}

/** Every unit a device holds, as plain values. */
export function deviceUnits(state: DeviceState): Record<string, unknown> {
  return {
    ...profileUnits(state.profile),
    ...lessonUnits(state.lessons),
    ...settingsUnits(state.settings),
    ...docUnits(state.docs),
  };
}

/**
 * A unit's content as a stable string, for change detection and for the merge's
 * tie-break. A lesson's hit counter is left out of it: a hit is not a change, and
 * the merge settles hits on their own (the higher count), so letting them into
 * the tie-break would make it depend on which merge ran first.
 */
export function comparable(key: string, value: unknown): string {
  if (value && isLessonUnit(key)) {
    const { hits: _hits, ...rest } = value as Lesson;
    return canonical(rest);
  }
  return canonical(value ?? null);
}

/**
 * Stamp every unit that differs between `before` and `after` — added, changed or
 * removed — with `now`. The same `stamps` object back when nothing changed, so
 * the caller can skip the write.
 */
export function diffStamps(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  stamps: Stamps,
  now: number,
): Stamps {
  let out = stamps;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (comparable(key, before[key]) === comparable(key, after[key])) continue;
    if (out === stamps) out = { ...stamps };
    out[key] = now;
  }
  return out;
}

/**
 * Whether an unstamped unit is worth sending. A setting still at its default was
 * never chosen, and must not exist as a unit: at time 0 it would tie — and could
 * win — against a value the other device's user actually picked.
 */
function isDefault(key: string, value: unknown): boolean {
  if (!key.startsWith(SETTING)) return false;
  const k = key.slice(SETTING.length) as keyof Settings;
  return canonical(value) === canonical(DEFAULT_SETTINGS[k]);
}

/** This device's state as wire units: everything it holds, plus a tombstone per removal. */
export function toUnits(state: DeviceState, stamps: Stamps): UnitMap {
  const values = deviceUnits(state);
  const out: UnitMap = {};
  for (const [key, value] of Object.entries(values)) {
    const at = stamps[key];
    if (at === undefined && isDefault(key, value)) continue;
    out[key] = { at: at ?? 0, value };
  }
  for (const [key, at] of Object.entries(stamps)) {
    if (!(key in values) && unitDomain(key) && !isLocalSettingKey(key)) out[key] = { at, value: null };
  }
  return out;
}

function isLocalSettingKey(key: string): boolean {
  return key.startsWith(SETTING)
    && (LOCAL_SETTINGS as ReadonlyArray<string>).includes(key.slice(SETTING.length));
}

/* ---------------- Units -> device state ---------------- */

/**
 * Keep the receiving device's order for what it already had, and append what is
 * new in key order — a list that reshuffled on every sync would move rows under
 * the user's finger. Done here, at the edge, so the merge itself stays a map.
 */
function ordered<T>(local: readonly T[], incoming: Map<string, T>, keyOf: (t: T) => string): T[] {
  const out: T[] = [];
  const placed = new Set<string>();
  for (const item of local) {
    const key = keyOf(item);
    const next = incoming.get(key);
    if (next !== undefined && !placed.has(key)) {
      out.push(next);
      placed.add(key);
    }
  }
  for (const key of [...incoming.keys()].sort()) if (!placed.has(key)) out.push(incoming.get(key)!);
  return out;
}

/**
 * Rebuild a device's state from merged units. `local` supplies what does not
 * travel — the local settings, and the order lists are shown in. A unit this
 * build cannot place (a newer peer's) is left out of the state; the caller keeps
 * it in the snapshot it uploads, so it survives the round trip.
 */
export function fromUnits(units: UnitMap, local: DeviceState): { state: DeviceState; stamps: Stamps } {
  const values: Profile['values'] = {};
  const keywords: NonNullable<Profile['keywords']> = {};
  const fields = new Map<string, NonNullable<Profile['customFields']>[number]>();
  const lessons = new Map<string, Lesson>();
  const settings = { ...local.settings } as Settings & Record<string, unknown>;
  for (const k of SYNCED_SETTINGS) (settings as Record<string, unknown>)[k] = DEFAULT_SETTINGS[k];
  const docs: DeviceState['docs'] = {};
  const stamps: Stamps = {};

  for (const [key, { at, value }] of Object.entries(units)) {
    const domain = unitDomain(key);
    if (!domain || isLocalSettingKey(key)) continue;
    if (at > 0) stamps[key] = at;
    if (value === null || value === undefined) continue;
    if (key.startsWith(VALUE)) (values as Record<string, unknown>)[key.slice(VALUE.length)] = value;
    else if (key.startsWith(WORDING)) (keywords as Record<string, unknown>)[key.slice(WORDING.length)] = value;
    else if (key.startsWith(FIELD)) fields.set(key.slice(FIELD.length), value as never);
    else if (key.startsWith(LESSON)) lessons.set(key.slice(LESSON.length), value as Lesson);
    else if (key.startsWith(SETTING)) {
      const k = key.slice(SETTING.length);
      // A setting this build has never heard of is a newer peer's; it is not ours to store.
      if ((SYNCED_SETTINGS as string[]).includes(k)) settings[k] = value;
    } else if (key.startsWith(DOC)) docs[key.slice(DOC.length) as DocKind] = value as StoredDoc;
  }

  return {
    state: {
      profile: {
        values,
        keywords,
        customFields: ordered(local.profile.customFields ?? [], fields, (f) => f.id),
      },
      lessons: ordered(local.lessons, lessons, (l) => signatureKey(l.signature)),
      settings,
      docs,
    },
    stamps,
  };
}
