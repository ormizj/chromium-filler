import type { Profile, Settings, StoredState } from './types';
import { DEFAULT_MODAL_LAYOUT } from './modalLayout';

export const DEFAULT_PROFILE: Profile = {
  values: {},
  keywords: {},
  customFields: [],
};

export const DEFAULT_SETTINGS: Settings = {
  fillAutomatically: true,
  openCardOnQueueTabs: true,
  // On: the user submits by hand, so closing the tab is the only "done" the
  // extension ever hears — off, a queue session leaves every posting at `opened`.
  markDoneOnClose: true,
  // On: skipping *is* the decision to be done with a posting, so leaving its tab
  // open only makes work.
  closeTabOnSkip: true,
  closeTabDelayMs: 1500,
  // On: filling is impossible inside a phone app, so this is the only setting under
  // which a queued posting can be filled at all.
  keepInBrowser: true,
  // Two: a phone cannot hold more job pages in memory, and on a laptop two tabs
  // is still one to work in and one loading behind it.
  sessionBatchSize: 2,
  modalLayout: DEFAULT_MODAL_LAYOUT,
  modalFullscreen: false,
  // On: it does nothing at all until a client is entered and an account
  // connected, so the first request is still one the user asked for.
  syncEnabled: true,
  // Empty means "no decisions taken yet", which resolves to every column, the
  // applied postings, as JSON — see `resolveExport`. Spelling those out here
  // instead would freeze today's schema into every fresh install.
  exportOptions: {},
};

export const DEFAULT_STATE: StoredState = {
  profile: DEFAULT_PROFILE,
  lessons: [],
  jobUrls: [],
  settings: DEFAULT_SETTINGS,
};
