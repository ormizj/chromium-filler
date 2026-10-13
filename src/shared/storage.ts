/**
 * Typed wrappers over chrome.storage.local for the extension's persisted state.
 * The CV binary is stored separately, base64-encoded, in chrome.storage.local (see cvStore.ts).
 */

import type { JobUrlEntry, Lesson, Profile, Settings, StoredState } from './types';
import type { JobDetailsMap } from './jobDetails';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS } from './defaults';
import { normalizeEntry } from './jobUrls';

const KEYS = {
  profile: 'profile',
  // What the user taught the extension about individual inputs. Global and device
  // state — see `Lesson` in types.ts and `shared/lessons.ts`.
  lessons: 'lessons',
  jobUrls: 'jobUrls',
  // Deliberately not part of `jobUrls`: that list is read and rewritten whole on
  // every status change, session tick and queue render, and the posting text is
  // orders of magnitude bigger than the entry it belongs to. See jobDetails.ts.
  jobDetails: 'jobDetails',
  settings: 'settings',
} as const;

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
  await chrome.storage.local.set({ [KEYS.profile]: profile });
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
  await chrome.storage.local.set({ [KEYS.lessons]: lessons });
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
  await chrome.storage.local.set({ [KEYS.settings]: settings });
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

/** The captured posting text, keyed by URL. See jobDetails.ts. */
export async function getJobDetails(): Promise<JobDetailsMap> {
  const raw = await chrome.storage.local.get(KEYS.jobDetails);
  return (raw[KEYS.jobDetails] as JobDetailsMap) ?? {};
}

export async function saveJobDetails(map: JobDetailsMap): Promise<void> {
  await chrome.storage.local.set({ [KEYS.jobDetails]: map });
}

/**
 * Read-modify-write helper for the captured postings. The pure helpers return
 * the map unchanged when there is nothing to do, so an unchanged result skips
 * the write — this runs from a content script on every posting.
 */
export async function mutateJobDetails(
  fn: (map: JobDetailsMap) => JobDetailsMap,
): Promise<JobDetailsMap> {
  const before = await getJobDetails();
  const next = fn(before);
  if (next !== before) await saveJobDetails(next);
  return next;
}

export function onStorageChanged(cb: () => void): void {
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local') cb();
  });
}
