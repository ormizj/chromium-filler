/**
 * Typed wrappers over chrome.storage.local for the extension's persisted state.
 * The CV binary is stored separately, base64-encoded, in chrome.storage.local (see cvStore.ts).
 */

import type { JobUrlEntry, Profile, Settings, SiteConfig, StoredState } from './types';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS } from './defaults';
import { normalizeEntry } from './jobUrls';
import { configTemplate } from './configTemplate';
import { findMatchingConfig } from './matcher';

const KEYS = {
  profile: 'profile',
  siteConfigs: 'siteConfigs',
  jobUrls: 'jobUrls',
  settings: 'settings',
} as const;

export async function getState(): Promise<StoredState> {
  const raw = await chrome.storage.local.get([
    KEYS.profile, KEYS.siteConfigs, KEYS.jobUrls, KEYS.settings,
  ]);
  return {
    profile: (raw[KEYS.profile] as Profile) ?? DEFAULT_PROFILE,
    siteConfigs: (raw[KEYS.siteConfigs] as SiteConfig[]) ?? [],
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

export async function getSiteConfigs(): Promise<SiteConfig[]> {
  const raw = await chrome.storage.local.get(KEYS.siteConfigs);
  return (raw[KEYS.siteConfigs] as SiteConfig[]) ?? [];
}

export async function saveSiteConfigs(configs: SiteConfig[]): Promise<void> {
  await chrome.storage.local.set({ [KEYS.siteConfigs]: configs });
}

/** Upsert a single config by id, preserving order. */
export async function upsertSiteConfig(config: SiteConfig): Promise<SiteConfig[]> {
  const configs = await getSiteConfigs();
  const idx = configs.findIndex((c) => c.id === config.id);
  if (idx >= 0) configs[idx] = config;
  else configs.push(config);
  await saveSiteConfigs(configs);
  return configs;
}

/** Read-modify-write a single config by id (no-op if the id is unknown). */
export async function mutateSiteConfig(
  configId: string,
  fn: (config: SiteConfig) => void,
): Promise<SiteConfig[]> {
  const configs = await getSiteConfigs();
  const cfg = configs.find((c) => c.id === configId);
  if (cfg) {
    fn(cfg);
    await saveSiteConfigs(configs);
  }
  return configs;
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

/** Return the config matching `url`, creating and persisting a minimal one if none exists. */
export async function ensureConfigForUrl(url: string): Promise<SiteConfig> {
  const configs = await getSiteConfigs();
  const existing = findMatchingConfig(url, configs);
  if (existing) return existing;
  const created = configTemplate(url);
  configs.push(created);
  await saveSiteConfigs(configs);
  return created;
}

export async function getSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get(KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...((raw[KEYS.settings] as Settings) ?? {}) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEYS.settings]: settings });
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

export function onStorageChanged(cb: () => void): void {
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local') cb();
  });
}
