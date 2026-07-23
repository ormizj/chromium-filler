/**
 * Core data model shared across content script, popup, options, and background.
 */

import type { ModalLayout } from './modalLayout';

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

/** The stored CV, kept in chrome.storage.local (base64-encoded bytes) plus its metadata. */
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

/**
 * Two-step ("redirect") postings: boards mix quick-apply postings, whose form is
 * on the page, with postings that hand off to an external ATS. This block tells
 * the classifier which shape a given posting has and how to follow the handoff.
 */
export interface RedirectConfig {
  /** The control that leaves for the external application (anchor or JS button). */
  applySelector?: string;
  /** If this resolves, the posting is quick-apply (in-page form). Checked first. */
  quickApplySelector?: string;
  /** A badge/label meaning "external posting", even when the link looks internal. */
  markerSelector?: string;
  /**
   * Steps run on the posting BEFORE following the link — typically clicking the
   * board's own "Save job" so its application tracking records the apply. These
   * are always treated as optional: a failure must never block the handoff.
   */
  beforeFollow?: PrepStep[];
  /** When false, the built-in text/cross-origin heuristic is off. Default true. */
  autoDetect?: boolean;
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
  /** Selectors for pulling the job title, description + requirements into the modal. */
  extract: { jobTitle?: string; jobDescription?: string; jobRequirements?: string };
  /** Explicit selector overrides per field; these always win over heuristics. */
  fieldOverrides?: Partial<Record<FieldKey, string>>;
  /** Override selector for the CV file input. */
  cvUpload?: string;
  /** Steps run by the modal "Submit CV" button (e.g. re-open an attach modal). */
  submitCv?: PrepStep[];
  /** When false, heuristics are disabled and only overrides are used. Default true. */
  autoDetect?: boolean;
  /** Quick-apply vs. external-redirect classification + handoff for this site. */
  redirect?: RedirectConfig;
  /**
   * Selector for the site's "submitted successfully" confirmation element
   * (e.g. a thank-you banner). This is the AUTHORITATIVE "actually sent" signal:
   * when present, auto-close + mark-applied fire only once this element appears,
   * never merely on a submit attempt (which can fail). Omit it only for
   * full-page-navigation flows, where the tab leaves before a confirmation can
   * render and the form `submit` event is used as a fallback.
   */
  successSelector?: string;
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

export type JobUrlStatus = 'new' | 'opened' | 'redirected' | 'applied' | 'skipped';

export interface JobStatusEvent {
  status: JobUrlStatus;
  at: number;
}

export interface JobUrlEntry {
  id: string;
  /** The job URL — the unique key for the database. */
  url: string;
  note?: string;
  status: JobUrlStatus;
  /** For a destination entry: the board posting that redirected here. */
  sourceUrl?: string;
  /** For a source posting: the external application URL it redirected to. */
  redirectUrl?: string;
  addedAt: number;
  updatedAt: number;
  /** First time the tab was opened. */
  openedAt?: number;
  /** First time a submission was detected for this URL. */
  appliedAt?: number;
  /** Full status-transition log (most recent last). */
  history: JobStatusEvent[];
}

export interface JobUrlStats {
  total: number;
  new: number;
  opened: number;
  redirected: number;
  applied: number;
  skipped: number;
}

/** Where a followed external application opens. */
export type RedirectTarget = 'newTabCloseSource' | 'newTab' | 'sameTab';

/** Re-exported so `types.ts` stays the one import for the data model. */
export type { ModalLayout } from './modalLayout';

export interface Settings {
  /** Auto-run the full flow when a matching page finishes loading. */
  autoRunOnLoad: boolean;
  /** Confidence threshold below which matches are reported but not auto-filled. */
  autoFillLowConfidence: boolean;
  /** Close the tab automatically once a submission is detected. */
  closeTabOnSubmit: boolean;
  /** Milliseconds to wait after detecting submit before closing the tab. */
  closeTabDelayMs: number;
  /**
   * Where an external ("two-step") application opens when a redirect posting is
   * followed: a new tab replacing the posting tab (default), a new tab beside
   * it, or in place.
   */
  redirectTarget: RedirectTarget;
  /**
   * How many job tabs a queue session keeps open at once. The session refills
   * back up to this number as you finish each one, so a 60-link import never
   * becomes 60 tabs. Lower it to 1–2 on mobile.
   */
  sessionBatchSize: number;
  /**
   * Where the review modal sits, and how big it is, on desktop. Set from the
   * simulator in Options → Settings, and updated when the modal itself is
   * dragged. Ignored under 640px, where the modal is a full-width bottom sheet.
   * See `shared/modalLayout.ts` — every read is clamped to the viewport.
   */
  modalLayout: ModalLayout;
}

/** Everything persisted in chrome.storage.local (the CV bytes are stored separately, also in chrome.storage.local). */
export interface StoredState {
  profile: Profile;
  siteConfigs: SiteConfig[];
  jobUrls: JobUrlEntry[];
  settings: Settings;
}
