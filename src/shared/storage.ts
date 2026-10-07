/**
 * Typed wrappers over chrome.storage.local for the extension's persisted state.
 * The CV binary is stored separately, base64-encoded, in chrome.storage.local (see cvStore.ts).
 */

import type {
  JobUrlEntry, Profile, Settings, SiteConfig, StoredSiteConfig, StoredState,
} from './types';
import type { JobDetailsMap } from './jobDetails';
import type { ConfigPatch } from './recording';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS } from './defaults';
import { normalizeEntry } from './jobUrls';
import { configTemplate } from './configTemplate';
import { findMatchingConfig } from './matcher';
import { currentFormFactor } from './formFactor';
import {
  migrateLegacy, newStoredConfig, resolveSiteConfig, writeSetup, type ConfigTombstones,
} from './siteConfigs';

const KEYS = {
  profile: 'profile',
  siteConfigs: 'siteConfigs',
  // Ids of configs deleted here, kept so a sync does not bring them back. See
  // syncConfigs.ts; pruned at the sync edge after the same 90 days as jobUrls'.
  deletedSiteConfigs: 'deletedSiteConfigs',
  jobUrls: 'jobUrls',
  // Deliberately not part of `jobUrls`: that list is read and rewritten whole on
  // every status change, session tick and queue render, and the posting text is
  // orders of magnitude bigger than the entry it belongs to. See jobDetails.ts.
  jobDetails: 'jobDetails',
  settings: 'settings',
} as const;

export async function getState(): Promise<StoredState> {
  const raw = await chrome.storage.local.get([
    KEYS.profile, KEYS.siteConfigs, KEYS.jobUrls, KEYS.settings,
  ]);
  return {
    profile: (raw[KEYS.profile] as Profile) ?? DEFAULT_PROFILE,
    siteConfigs: resolveAll(raw[KEYS.siteConfigs]),
    jobUrls: (raw[KEYS.jobUrls] as JobUrlEntry[]) ?? [],
    settings: { ...DEFAULT_SETTINGS, ...((raw[KEYS.settings] as Settings) ?? {}) },
  };
}

export async function getProfile(): Promise<Profile> {
  const raw = await chrome.storage.local.get(KEYS.profile);
  return (raw[KEYS.profile] as Profile) ?? DEFAULT_PROFILE;
}

export async function saveProfile(profile: Profile): Promise<void> {
  await chrome.storage.local.set({ [KEYS.profile]: profile });
}

/**
 * Site configs are stored as a shell plus a desktop and a mobile half
 * (`shared/siteConfigs.ts`). Everything outside storage and sync reads the flat
 * view for *this* device, so these two are the only readers of the raw shape.
 *
 * Legacy flat configs are migrated on read, into this device's half — the
 * service worker also migrates them once on update, but a reader must not
 * depend on that having happened yet (an E2E or an import can seed the old shape).
 */
export async function getStoredSiteConfigs(): Promise<StoredSiteConfig[]> {
  const raw = await chrome.storage.local.get(KEYS.siteConfigs);
  return migrateAll(raw[KEYS.siteConfigs]);
}

export async function saveStoredSiteConfigs(configs: StoredSiteConfig[]): Promise<void> {
  await chrome.storage.local.set({ [KEYS.siteConfigs]: configs });
}

function migrateAll(raw: unknown): StoredSiteConfig[] {
  const ff = currentFormFactor();
  return ((raw as StoredSiteConfig[] | undefined) ?? []).map((c) => migrateLegacy(c, ff));
}

function resolveAll(raw: unknown): SiteConfig[] {
  const ff = currentFormFactor();
  return migrateAll(raw).map((c) => resolveSiteConfig(c, ff));
}

/** This device's view of every site config. */
export async function getSiteConfigs(): Promise<SiteConfig[]> {
  const raw = await chrome.storage.local.get(KEYS.siteConfigs);
  return resolveAll(raw[KEYS.siteConfigs]);
}

export async function getDeletedSiteConfigs(): Promise<ConfigTombstones> {
  const raw = await chrome.storage.local.get(KEYS.deletedSiteConfigs);
  return (raw[KEYS.deletedSiteConfigs] as ConfigTombstones) ?? {};
}

export async function saveDeletedSiteConfigs(deleted: ConfigTombstones): Promise<void> {
  await chrome.storage.local.set({ [KEYS.deletedSiteConfigs]: deleted });
}

/** Record deletions, keeping the latest time per id. */
export async function addDeletedSiteConfigs(deleted: ConfigTombstones): Promise<void> {
  if (!Object.keys(deleted).length) return;
  const all = await getDeletedSiteConfigs();
  for (const [id, at] of Object.entries(deleted)) all[id] = Math.max(all[id] ?? at, at);
  await saveDeletedSiteConfigs(all);
}

/**
 * Write a flat config as *this device's* view of it: the shell, and this
 * device's half. The other half is left as it was.
 */
export async function upsertSiteConfig(config: SiteConfig): Promise<SiteConfig[]> {
  const ff = currentFormFactor();
  const now = Date.now();
  const configs = await getStoredSiteConfigs();
  const idx = configs.findIndex((c) => c.id === config.id);
  if (idx >= 0) {
    configs[idx] = writeSetup(configs[idx], ff, (c) => {
      for (const k of Object.keys(c)) delete (c as unknown as Record<string, unknown>)[k];
      Object.assign(c, structuredClone(config));
    }, now);
  } else {
    configs.push(newStoredConfig(config, ff, now));
  }
  await saveStoredSiteConfigs(configs);
  return configs.map((c) => resolveSiteConfig(c, ff));
}

/**
 * Read-modify-write a single config by id (no-op if the id is unknown), through
 * this device's flat view — so every slot writer below edits this device's half
 * and nothing else, and stamps it for sync.
 */
export async function mutateSiteConfig(
  configId: string,
  fn: (config: SiteConfig) => void,
): Promise<SiteConfig[]> {
  const ff = currentFormFactor();
  const configs = await getStoredSiteConfigs();
  const idx = configs.findIndex((c) => c.id === configId);
  if (idx >= 0) {
    const next = writeSetup(configs[idx], ff, fn, Date.now());
    if (next !== configs[idx]) {
      configs[idx] = next;
      await saveStoredSiteConfigs(configs);
    }
  }
  return configs.map((c) => resolveSiteConfig(c, ff));
}

/**
 * Write what a recording compiled to into a site config.
 *
 * The rule throughout is **a patch only ever speaks about what it saw**. Recording a
 * site a second time to mark the description you forgot must not wipe the Send
 * button you got right the first time, and re-recording the quick-apply half of a
 * board must not delete the handoff steps from a two-step posting on the same site.
 * So:
 *
 * - maps (`extract`, `fieldOverrides`) **merge**, key by key;
 * - sequences (`prep`, `submitCv`, `beforeFollow`) **replace, but only when the
 *   recording produced one** — a sequence is an ordering, and half of two recordings
 *   interleaved is not a thing anyone meant;
 * - single selectors overwrite only when the patch has one.
 *
 * The same forward-compatible instinct as `resolveExport`: absence means "no
 * opinion", never "clear it".
 */
export async function applyConfigPatch(configId: string, patch: ConfigPatch): Promise<void> {
  await mutateSiteConfig(configId, (c) => {
    c.extract = { ...c.extract, ...patch.extract };
    if (Object.keys(patch.fieldOverrides).length) {
      c.fieldOverrides = { ...c.fieldOverrides, ...patch.fieldOverrides };
    }
    if (patch.cvUpload) c.cvUpload = patch.cvUpload;
    if (patch.prep.length) c.prep = patch.prep;
    if (patch.submitCv.length) c.submitCv = patch.submitCv;
    if (patch.submitSelector) c.submitSelector = patch.submitSelector;
    if (patch.successSelector) c.successSelector = patch.successSelector;

    if (patch.redirect) {
      const { beforeFollow, ...selectors } = patch.redirect;
      c.redirect = { ...c.redirect, ...selectors };
      if (beforeFollow?.length) c.redirect.beforeFollow = beforeFollow;
    }
  });
}

/** Save an override selector for one field of a config, creating the map as needed. */
export async function saveFieldOverride(
  configId: string,
  field: string,
  selector: string,
): Promise<void> {
  await mutateSiteConfig(configId, (cfg) => {
    if (field === 'resume') {
      cfg.cvUpload = selector;
    } else {
      cfg.fieldOverrides = { ...cfg.fieldOverrides, [field]: selector };
    }
  });
}

/** Remove a field's override (or the CV upload selector). */
export async function clearFieldOverride(configId: string, field: string): Promise<void> {
  await mutateSiteConfig(configId, (cfg) => {
    if (field === 'resume') {
      delete cfg.cvUpload;
    } else if (cfg.fieldOverrides) {
      const next = { ...cfg.fieldOverrides };
      delete next[field as keyof typeof next];
      cfg.fieldOverrides = next;
    }
  });
}

/** Save the control the modal's Apply presses — the site's own Send button. */
export async function saveSubmitSelector(configId: string, selector: string): Promise<void> {
  await mutateSiteConfig(configId, (cfg) => {
    cfg.submitSelector = selector;
  });
}

/** Forget the saved Send button and go back to the heuristic. */
export async function clearSubmitSelector(configId: string): Promise<void> {
  await mutateSiteConfig(configId, (cfg) => {
    delete cfg.submitSelector;
  });
}

/** Save the site's confirmation element — the only thing that marks it applied. */
export async function saveSuccessSelector(configId: string, selector: string): Promise<void> {
  await mutateSiteConfig(configId, (cfg) => {
    cfg.successSelector = selector;
  });
}

/** Forget it, which also greys Apply out again: nothing unverifiable is sent. */
export async function clearSuccessSelector(configId: string): Promise<void> {
  await mutateSiteConfig(configId, (cfg) => {
    delete cfg.successSelector;
  });
}

/** Save one of the job-info container selectors into a config's `extract` map. */
export async function saveExtractSelector(
  configId: string,
  key: 'jobTitle' | 'jobDescription' | 'jobRequirements',
  selector: string,
): Promise<void> {
  await mutateSiteConfig(configId, (cfg) => {
    cfg.extract = { ...cfg.extract, [key]: selector };
  });
}

/** Remove one of the job-info container selectors from a config's `extract` map. */
export async function clearExtractSelector(
  configId: string,
  key: 'jobTitle' | 'jobDescription' | 'jobRequirements',
): Promise<void> {
  await mutateSiteConfig(configId, (cfg) => {
    const { [key]: _drop, ...rest } = cfg.extract;
    cfg.extract = rest;
  });
}

export type RedirectSelectorKey = 'applySelector' | 'quickApplySelector' | 'markerSelector';

/** Save one of the redirect-classification selectors on a config. */
export async function saveRedirectSelector(
  configId: string,
  key: RedirectSelectorKey,
  selector: string,
): Promise<void> {
  await mutateSiteConfig(configId, (cfg) => {
    cfg.redirect = { ...cfg.redirect, [key]: selector };
  });
}

/** Remove one of the redirect-classification selectors from a config. */
export async function clearRedirectSelector(
  configId: string,
  key: RedirectSelectorKey,
): Promise<void> {
  await mutateSiteConfig(configId, (cfg) => {
    if (!cfg.redirect) return;
    const { [key]: _drop, ...rest } = cfg.redirect;
    cfg.redirect = rest;
  });
}

/**
 * `id` is what every other writer here resolves a config by, so it has to stay
 * unique. The template derives it from the host, and a host can legitimately
 * need a second config — an existing one whose pattern covers only part of the
 * host does not match the rest of it. Suffix until free.
 */
function uniqueId(preferred: string, configs: SiteConfig[]): string {
  const taken = new Set(configs.map((c) => c.id));
  if (!taken.has(preferred)) return preferred;
  let n = 2;
  while (taken.has(`${preferred}-${n}`)) n++;
  return `${preferred}-${n}`;
}

/** Return the config matching `url`, creating and persisting a minimal one if none exists. */
export async function ensureConfigForUrl(url: string): Promise<SiteConfig> {
  const ff = currentFormFactor();
  const stored = await getStoredSiteConfigs();
  const configs = stored.map((c) => resolveSiteConfig(c, ff));
  const existing = findMatchingConfig(url, configs);
  if (existing) return existing;
  const template = configTemplate(url);
  const created: SiteConfig = { ...template, id: uniqueId(template.id, configs) };
  stored.push(newStoredConfig(created, ff, Date.now()));
  await saveStoredSiteConfigs(stored);
  return created;
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
