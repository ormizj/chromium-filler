/**
 * Core data model shared across content script, popup, options, and background.
 */

/** Every user-profile field the filler knows how to place. `resume` is the CV file. */
export type FieldKey =
  | 'firstName'
  | 'lastName'
  | 'fullName'
  | 'email'
  | 'phone'
  | 'linkedin'
  | 'github'
  | 'website'
  | 'portfolio'
  | 'address'
  | 'city'
  | 'state'
  | 'zip'
  | 'country'
  | 'coverLetter'
  | 'resume';

/** Text-valued field keys (everything except the CV file). */
export type TextFieldKey = Exclude<FieldKey, 'resume'>;

export interface Profile {
  /** Value for each text field the user has provided. */
  values: Partial<Record<TextFieldKey, string>>;
  /** Extra site-specific key -> value pairs the user maintains manually. */
  custom: Record<string, string>;
}

/** The stored CV, kept in IndexedDB (bytes) plus its metadata. */
export interface CvFile {
  name: string;
  type: string;
  /** Raw file bytes. */
  data: ArrayBuffer;
}

export type PrepAction = 'click' | 'waitFor' | 'scrollIntoView' | 'delay';

export interface PrepStep {
  action: PrepAction;
  /** CSS selector the action targets (for click/waitFor/scrollIntoView). */
  selector?: string;
  /** Milliseconds, used by `delay` and as a per-step timeout for `waitFor`. */
  ms?: number;
  /** If true, a failure/timeout is logged and skipped instead of aborting. */
  optional?: boolean;
}

export interface SiteConfig {
  id: string;
  name: string;
  /** Match patterns (`*://host/*`) or `/regex/` strings tested against the URL. */
  urlPatterns: string[];
  /** Selector to await before acting; forms load slowly. */
  waitFor?: string;
  /** Max ms to wait for `waitFor` before proceeding anyway. Default ~15000. */
  waitTimeoutMs?: number;
  /** Prerequisite steps run automatically before filling. */
  prep?: PrepStep[];
  /** Selectors for pulling the job title + description into the modal. */
  extract: { jobTitle?: string; jobDescription?: string };
  /** Explicit selector overrides per field; these always win over heuristics. */
  fieldOverrides?: Partial<Record<FieldKey, string>>;
  /** Override selector for the CV file input. */
  cvUpload?: string;
  /** Steps run by the modal "Submit CV" button (e.g. re-open an attach modal). */
  submitCv?: PrepStep[];
  /** When false, heuristics are disabled and only overrides are used. Default true. */
  autoDetect?: boolean;
}

export type MatchConfidence = 'high' | 'low' | 'none';
export type MatchSource = 'override' | 'heuristic' | 'none';

/** One row of the review report shown in the modal. */
export interface FieldMatch {
  field: FieldKey;
  selectorUsed?: string;
  source: MatchSource;
  confidence: MatchConfidence;
  valueToFill?: string;
  filled: boolean;
  required: boolean;
}

export type JobUrlStatus = 'new' | 'opened' | 'applied' | 'skipped';

export interface JobUrlEntry {
  id: string;
  url: string;
  note?: string;
  status: JobUrlStatus;
  addedAt: number;
}

export interface Settings {
  /** Auto-run the full flow when a matching page finishes loading. */
  autoRunOnLoad: boolean;
  /** Confidence threshold below which matches are reported but not auto-filled. */
  autoFillLowConfidence: boolean;
}

/** Everything persisted in chrome.storage.local (CV bytes live in IndexedDB). */
export interface StoredState {
  profile: Profile;
  siteConfigs: SiteConfig[];
  jobUrls: JobUrlEntry[];
  settings: Settings;
}
