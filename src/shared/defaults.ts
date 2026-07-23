import type { Profile, Settings, SiteConfig, StoredState } from './types';

export const DEFAULT_PROFILE: Profile = {
  values: {},
  custom: {},
};

export const DEFAULT_SETTINGS: Settings = {
  autoRunOnLoad: true,
  autoFillLowConfidence: false,
  closeTabOnSubmit: false,
  closeTabDelayMs: 1500,
  redirectTarget: 'newTabCloseSource',
};

/**
 * A ready-to-tweak example config. Also matches the local test fixture so the
 * extension does something useful out of the box.
 */
export const EXAMPLE_SITE_CONFIG: SiteConfig = {
  id: 'example-fixture',
  name: 'Local test fixture',
  urlPatterns: ['*://*/sample-form.html', '/sample-form\\.html/'],
  waitFor: 'form',
  waitTimeoutMs: 15000,
  prep: [{ action: 'click', selector: '#expand-description', optional: true }],
  extract: { jobTitle: '#job-title', jobDescription: '#job-description' },
  autoDetect: true,
};

export const DEFAULT_STATE: StoredState = {
  profile: DEFAULT_PROFILE,
  siteConfigs: [EXAMPLE_SITE_CONFIG],
  jobUrls: [],
  settings: DEFAULT_SETTINGS,
};
