/**
 * Typed wrappers over chrome.storage.local for the extension's persisted state.
 * The CV binary is stored separately, base64-encoded, in chrome.storage.local (see cvStore.ts).
 *
 * Every save of something sync carries — the profile, the lessons, the settings,
 * the documents — stamps what it changed (`stampedSet`). Writing those keys any
 * other way leaves the change undated, and an undated change loses to the other
 * device at the next sync.
 */

import type { JobUrlEntry, Lesson, Profile, Settings, StoredState } from './types';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS } from './defaults';
import { normalizeEntry } from './jobUrls';
import {
  diffStamps, lessonUnits, profileUnits, settingsUnits, type Stamps,
} from './syncUnits';

const KEYS = {
  profile: 'profile',
  // What the user taught the extension about individual inputs. Global, and synced
  // — see `Lesson` in types.ts and `shared/lessons.ts`.
  lessons: 'lessons',
  jobUrls: 'jobUrls',
  settings: 'settings',
} as const;

/**
 * When each synced unit last changed, one map per domain (`syncUnits.ts`). Kept
 * beside the data rather than inside it, and written in the *same* `set` as the
 * data — so a stamp can never be ahead of, or behind, the value it dates.
 *
 * One map per domain rather than one for everything: the lesson hit counter runs
 * from content scripts on every page, and a single shared map would put every
 * profile save in a read-modify-write race with it.
 */
export const STAMP_KEYS = {
  profile: 'profileStamps',
  lessons: 'lessonStamps',
  settings: 'settingsStamps',
  docs: 'docStamps',
} as const;

export type StampDomain = keyof typeof STAMP_KEYS;

export async function getStamps(domain: StampDomain): Promise<Stamps> {
  const raw = await chrome.storage.local.get(STAMP_KEYS[domain]);
  return (raw[STAMP_KEYS[domain]] as Stamps | undefined) ?? {};
}

/**
 * Write `value` under `key`, stamping every unit that differs between `before`
 * and `after` with now. Every save of synced state goes through here — that is
 * what lets sync tell the newer of two edits apart. Sync itself writes what it
 * merged without it (`syncSnapshot.ts`): adopting the far side's stamps is not
 * an edit, and re-stamping would make every synced value look brand new.
 */
export async function stampedSet(
  domain: StampDomain,
  key: string,
  value: unknown,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<void> {
  const stamps = await getStamps(domain);
  const next = diffStamps(before, after, stamps, Date.now());
  const dated = next === stamps ? {} : { [STAMP_KEYS[domain]]: next };
  // `undefined` removes the key — the stamp is what carries the removal.
  if (value === undefined) {
    if (next !== stamps) await chrome.storage.local.set(dated);
    await chrome.storage.local.remove(key);
    return;
  }
  await chrome.storage.local.set({ [key]: value, ...dated });
}

/**
 * A stored profile in today's shape, whatever build wrote it.
 *
 * Older builds wrote `custom: Record<string, string>`, which nothing ever read or
 * filled, and no `keywords`/`customFields`. The missing lists are filled in empty;
 * `custom` is dropped, there being nothing in it any surface ever let anyone write.
 */
export function normalizeProfile(raw: unknown): Profile {
  const p = (raw ?? {}) as Partial<Profile> & { custom?: unknown };
  return {
    values: { ...(p.values ?? {}) },
    keywords: { ...(p.keywords ?? {}) },
    customFields: Array.isArray(p.customFields) ? p.customFields.map((f) => ({ ...f, keywords: [...(f.keywords ?? [])] })) : [],
  };
}

export async function getState(): Promise<StoredState> {
  const raw = await chrome.storage.local.get([
    KEYS.profile, KEYS.lessons, KEYS.jobUrls, KEYS.settings,
  ]);
  return {
    profile: normalizeProfile(raw[KEYS.profile] ?? DEFAULT_PROFILE),
    lessons: (raw[KEYS.lessons] as Lesson[] | undefined) ?? [],
    jobUrls: (raw[KEYS.jobUrls] as JobUrlEntry[]) ?? [],
    settings: { ...DEFAULT_SETTINGS, ...((raw[KEYS.settings] as Settings) ?? {}) },
  };
}

export async function getProfile(): Promise<Profile> {
  const raw = await chrome.storage.local.get(KEYS.profile);
  return normalizeProfile(raw[KEYS.profile] ?? DEFAULT_PROFILE);
}

export async function saveProfile(profile: Profile): Promise<void> {
  const before = await getProfile();
  await stampedSet('profile', KEYS.profile, profile, profileUnits(before), profileUnits(profile));
}

/** Read-modify-write the profile — the Options editors and the card's "New field". */
export async function mutateProfile(fn: (profile: Profile) => Profile): Promise<Profile> {
  const next = fn(await getProfile());
  await saveProfile(next);
  return next;
}

export async function getLessons(): Promise<Lesson[]> {
  const raw = await chrome.storage.local.get(KEYS.lessons);
  return (raw[KEYS.lessons] as Lesson[] | undefined) ?? [];
}

export async function saveLessons(lessons: Lesson[]): Promise<void> {
  const before = await getLessons();
  await stampedSet('lessons', KEYS.lessons, lessons, lessonUnits(before), lessonUnits(lessons));
}

/**
 * Read-modify-write the lessons. Pure helpers in `lessons.ts` return the list
 * unchanged when there is nothing to do, and an unchanged list skips the write —
 * the hit counter runs from a content script on every page.
 */
export async function mutateLessons(fn: (lessons: Lesson[]) => Lesson[]): Promise<Lesson[]> {
  const before = await getLessons();
  const next = fn(before);
  if (next !== before) await saveLessons(next);
  return next;
}

export async function getSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get(KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...((raw[KEYS.settings] as Settings) ?? {}) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  const before = await getSettings();
  await stampedSet('settings', KEYS.settings, settings, settingsUnits(before), settingsUnits(settings));
}

/**
 * Change some settings without writing back the ones you did not change.
 *
 * For callers holding a *snapshot* — the content script reads `settings` once at
 * page load and a posting can sit open for an hour, so saving the whole object
 * back would undo anything the user changed in Options meanwhile. Re-reading
 * immediately before the write keeps the blast radius to the keys in `patch`.
 */
export async function patchSettings(patch: Partial<Settings>): Promise<void> {
  await saveSettings({ ...(await getSettings()), ...patch });
}

export async function getJobUrls(): Promise<JobUrlEntry[]> {
  const raw = await chrome.storage.local.get(KEYS.jobUrls);
  const list = (raw[KEYS.jobUrls] as JobUrlEntry[]) ?? [];
  return list.map(normalizeEntry);
}

export async function saveJobUrls(urls: JobUrlEntry[]): Promise<void> {
  await chrome.storage.local.set({ [KEYS.jobUrls]: urls });
}

/** Read-modify-write helper for the job-URL list. */
export async function mutateJobUrls(
  fn: (list: JobUrlEntry[]) => JobUrlEntry[],
): Promise<JobUrlEntry[]> {
  const next = fn(await getJobUrls());
  await saveJobUrls(next);
  return next;
}

/**
 * Settings earlier builds stored and nothing reads any more: the submit and
 * redirect switches, the archive export's column choices, and the queue switches
 * that became fixed behaviour (closing a queue tab always finishes it; Skip always
 * closes its tab).
 */
export const RETIRED_SETTINGS = [
  'autoRunOnLoad', 'closeTabOnSubmit', 'finishSetupOnApply', 'redirectTarget', 'helpSeen',
  'syncSiteConfigs', 'exportOptions', 'markDoneOnClose', 'closeTabOnSkip', 'closeTabDelayMs',
  'openCardOnQueueTabs', 'modalFullscreen',
] as const;

/**
 * Forget what earlier builds stored and nothing reads any more: the captured
 * posting text (the archive export was its only reader) and `RETIRED_SETTINGS`.
 * Run on update. Written raw — removing a key no build syncs is not an edit to date.
 */
export async function dropRetiredKeys(): Promise<void> {
  await chrome.storage.local.remove(['jobDetails', 'siteConfigs', 'deletedSiteConfigs']);
  const raw = await chrome.storage.local.get(KEYS.settings);
  const settings = raw[KEYS.settings] as Record<string, unknown> | undefined;
  if (!settings || !RETIRED_SETTINGS.some((k) => k in settings)) return;
  const rest = { ...settings };
  for (const k of RETIRED_SETTINGS) delete rest[k];
  await chrome.storage.local.set({ [KEYS.settings]: rest });
}

export function onStorageChanged(cb: () => void): void {
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local') cb();
  });
}
