import type { Profile, Settings, StoredState } from './types';
import { DEFAULT_MODAL_LAYOUT } from './modalLayout';

export const DEFAULT_PROFILE: Profile = {
  values: {},
  keywords: {},
  customFields: [],
};

export const DEFAULT_SETTINGS: Settings = {
  fillAutomatically: true,
  // Off: a pill in the corner says the page was filled without covering it.
  openCardWhenFilled: false,
  // On: filling is impossible inside a phone app, so this is the only setting under
  // which a queued posting can be filled at all.
  keepInBrowser: true,
  // Two: a phone cannot hold more job pages in memory, and on a laptop two tabs
  // is still one to work in and one loading behind it.
  sessionBatchSize: 2,
  modalLayout: DEFAULT_MODAL_LAYOUT,
  // On: it does nothing at all until a client is entered and an account
  // connected, so the first request is still one the user asked for.
  syncEnabled: true,
};

export const DEFAULT_STATE: StoredState = {
  profile: DEFAULT_PROFILE,
  lessons: [],
  jobUrls: [],
  settings: DEFAULT_SETTINGS,
};
