/**
 * Core data model shared across content script, popup, options, and background.
 */

import type { ModalLayout } from './modalLayout';
import type { ExportSelection } from './jobExport';

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

/**
 * The documents that can be uploaded to a form. Both are device state — see
 * `cvStore.ts`. The cover letter is *also* a `TextFieldKey`: a site takes it as
 * a file or as prose, and the user may supply either or both.
 */
export type DocKind = 'resume' | 'coverLetter';

/** A stored document, kept in chrome.storage.local (base64-encoded bytes) plus its metadata. */
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
  /**
   * Selectors for pulling the posting into the modal: the title, description and
   * requirements containers, plus optional overrides for the three meta facts
   * (company / location / employment type). The meta three are read from the page's
   * JSON-LD by default (`shared/jobMeta.ts`) and only need a selector on a board
   * that publishes none or publishes it wrong.
   */
  extract: {
    jobTitle?: string;
    jobDescription?: string;
    jobRequirements?: string;
    company?: string;
    location?: string;
    employmentType?: string;
  };
  /** Explicit selector overrides per field; these always win over heuristics. */
  fieldOverrides?: Partial<Record<FieldKey, string>>;
  /** Override selector for the CV file input. */
  cvUpload?: string;
  /**
   * Steps run as the first phase of the modal's Apply (e.g. re-open and confirm
   * an attach dialog), for sites that only record the CV once it is confirmed.
   */
  submitCv?: PrepStep[];
  /**
   * The site's own Send button — the control Apply presses. Omit it and the
   * heuristic in `shared/submitDetect.ts` looks for it; save one when the page
   * has several plausible buttons, or when nothing is found and Apply greys out.
   */
  submitSelector?: string;
  /** When false, heuristics are disabled and only overrides are used. Default true. */
  autoDetect?: boolean;
  /** Quick-apply vs. external-redirect classification + handoff for this site. */
  redirect?: RedirectConfig;
  /**
   * Selector for the site's "submitted successfully" confirmation element
   * (e.g. a thank-you banner). This is the ONLY "actually sent" signal: auto-close
   * + mark-applied fire once this element becomes *visible*, never merely on a
   * submit attempt (which can fail).
   *
   * There is deliberately no `submit`-event fallback — the event fires before the
   * server answers, and a site that validates in JS sees it and *then* rejects the
   * form, which recorded applications that never happened. So this is required
   * rather than optional: without it `Controller.applyState` reads `noConfirmation`
   * and Apply refuses to press Send at all.
   */
  successSelector?: string;
}

/**
 * Which half of a site's setup applies on this device. Read off the user agent
 * (`shared/formFactor.ts`), because that is what the site's server sees when it
 * decides which page to send — a board that serves a phone a different DOM does
 * so on the strength of the UA, not of the window's width.
 */
export type FormFactor = 'desktop' | 'mobile';

/** The four keys of a `SiteConfig` that say *which* site it is, not how to work it. */
export type SiteShellKey = 'id' | 'name' | 'urlPatterns' | 'autoDetect';

/**
 * Everything a recording, a Pick or the wizard writes: a `SiteConfig` minus its
 * shell. One per form factor, kept fully separate — a desktop recording never
 * reads as the mobile setup, and the other way round.
 */
export type SiteSetup = Omit<SiteConfig, SiteShellKey> & {
  /** When this half last changed — sync merges each half on its own stamp. */
  updatedAt?: number;
};

/**
 * A site config as it is *stored* (and synced): the shell once, and a setup for
 * each form factor. Nothing outside storage and sync reads this shape — every
 * consumer is handed `SiteConfig`, the view resolved for this device by
 * `resolveSiteConfig` (`shared/siteConfigs.ts`).
 */
export interface StoredSiteConfig {
  id: string;
  name: string;
  urlPatterns: string[];
  autoDetect?: boolean;
  /** When the shell (name, patterns, autoDetect) last changed. */
  updatedAt?: number;
  desktop?: SiteSetup;
  mobile?: SiteSetup;
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

/**
 * A status as it appears in the log — deliberately *open*, and the openness is
 * load-bearing for sync.
 *
 * Two things widen it beyond `JobUrlStatus`:
 *
 * `'deleted'` is a tombstone. Sync merges two databases by unioning their logs,
 * and a union can only grow, so a removed posting would come back on the next
 * sync. Recording the removal as another timestamped event means it needs no
 * special merge rule — it wins if it is newest, and a later un-delete beats it.
 * It is never rendered as a status; a tombstoned entry is simply not shown.
 *
 * `(string & {})` — which keeps literal autocomplete while accepting any string
 * — is forward compatibility, and it can only be bought *now*. A peer running a
 * newer build may log a status this one has never heard of, and whether that
 * survives is decided by code in the *older* build, which is frozen the moment
 * it is installed. So an unrecognised status is carried through the log
 * untouched rather than validated away, and `npm run typecheck` fails on any
 * consumer that assumes the set is closed.
 */
export type JobLogStatus = JobUrlStatus | 'deleted' | (string & {});

export interface JobStatusEvent {
  status: JobLogStatus;
  at: number;
}

export interface JobUrlEntry {
  id: string;
  /** The job URL — the unique key for the database. */
  url: string;
  note?: string;
  /**
   * The current status — a *cache* of `history`, which is the truth. Sync
   * re-derives it from the merged log, so it is safe for a build that does not
   * recognise the newest event to render it plainly and move on: the log still
   * carries it, and a build that does understand it will derive the same value.
   */
  status: JobLogStatus;
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
export type { ExportSelection } from './jobExport';

export interface Settings {
  /** Auto-run the full flow when a matching page finishes loading. */
  autoRunOnLoad: boolean;
  /** Close the tab automatically once a submission is detected. */
  closeTabOnSubmit: boolean;
  /**
   * Close the tab when the review modal's Skip is pressed. Shares
   * `closeTabDelayMs` with the submit path deliberately: two timeouts for the
   * same "tidy this tab away" behaviour is a distinction nobody wants to make.
   * Turning it off never stalls a queue session — `skipUrl` frees the slot
   * itself rather than waiting for the tab to go.
   */
  closeTabOnSkip: boolean;
  /** Milliseconds to wait before closing the tab, after a submit or a skip. */
  closeTabDelayMs: number;
  /**
   * Let Apply send on a site whose confirmation element is not set yet, and ask the
   * user to point at the site's reply afterwards.
   *
   * This is the second half of setting a site up, and it is deliberately the one
   * place the "nothing is sent to a site whose outcome cannot be read back" rule
   * bends. It has to bend somewhere: the confirmation element does not exist until an
   * application has really gone in, so requiring it before sending is a deadlock that
   * left `successSelector` unset on nearly every site. The outcome is still read
   * back — by the person who pressed Apply, once, so that the extension can read it
   * for itself every time after. Nothing is recorded as applied unless they point at
   * something.
   *
   * Off restores the strict behaviour exactly: `applyState` reads `noConfirmation`,
   * Apply is greyed, and the element is set by hand in the setup panel.
   */
  finishSetupOnApply: boolean;
  /**
   * Where an external ("two-step") application opens when a redirect posting is
   * followed: a new tab replacing the posting tab (default), a new tab beside
   * it, or in place.
   */
  redirectTarget: RedirectTarget;
  /**
   * Only ever open a link as a web page — never let one hand off to a phone app.
   *
   * An "Apply" control is sometimes an `intent://` or `linkedin://` link, which
   * Android resolves by launching the app. That is always a dead end here: the
   * extension cannot fill a form or watch for a `successSelector` inside an app,
   * so the redirect watch expires and the posting stays `opened` for ever. Same
   * reasoning as Apply requiring `successSelector` — if the outcome cannot be read
   * back, do not go.
   *
   * On, an `intent://` link is rewritten to the `browser_fallback_url` it carries,
   * so the ATS form opens and fills as normal; one with no web form at all is left
   * alone and the modal says so. Off hands the link over as the page wrote it, for
   * someone who would rather finish in the app by hand.
   *
   * Read in exactly one place — `navigableUrl` in `shared/appLink.ts`. Everything
   * downstream consumes its result, which is why no other file tests this flag.
   */
  keepInBrowser: boolean;
  /**
   * How many job tabs a queue session keeps open at once. The session refills
   * back up to this number as you finish each one, so a 60-link import never
   * becomes 60 tabs. Lower it to 1–2 on mobile.
   */
  sessionBatchSize: number;
  /**
   * Where an on-page sheet sits, and how big it is, on desktop.
   *
   * Both of them: the review modal and the setup panel are one object with two
   * renderings, and at most one is expanded at a time (`content/sheet.ts`), so
   * there is one slot on the page and one rectangle describing it. The name is
   * historical — this predates the setup panel joining it, and renaming a stored
   * key buys nothing a sentence here does not.
   *
   * The simulator in Options → Settings is the only thing that writes it: dragging
   * or resizing a sheet on a job page moves it for that page alone, because a
   * nudge to see the field underneath is not a preference.
   * Ignored under 640px, where both sheets are a full-width bottom sheet.
   * See `shared/modalLayout.ts` — every read is clamped to the viewport.
   */
  modalLayout: ModalLayout;
  /**
   * Open an on-page sheet filling the whole viewport instead of at `modalLayout`.
   * Toggled from a sheet's own header button — the one setting the content script
   * writes, because it is answering "I want to read this posting", which is a
   * thing you decide while looking at a posting.
   *
   * It *overrides* `modalLayout` rather than replacing it, so turning it off
   * returns the card to the rectangle the simulator configured. Not the
   * browser's Fullscreen API: the card is a shadow root on someone else's page,
   * which can refuse the request, and whose Escape would cancel it silently.
   */
  modalFullscreen: boolean;
  /**
   * Whether the user has dismissed the setup panel's legend. The basics (what
   * the dots mean, auto vs. saved, what Pick does) are explained on top of the
   * panel until then, and one tap away afterwards — re-explaining them on every
   * posting would be the same wall of text sixty times in a session.
   */
  helpSeen: boolean;
  /**
   * Share the job database with another browser profile through a Google Drive
   * folder only this extension can see.
   *
   * The job database — the URL list and the captured postings — and, under
   * `syncSiteConfigs`, the site configs. The profile, the CV and the rest of these
   * settings are device state and never leave the machine. `modalLayout` alone
   * would be reason enough: it is a rectangle measured against *this* screen.
   *
   * On by default, matching `syncSiteConfigs`. That does not make a request on
   * its own: nothing is sent until the user enters an OAuth client in Options →
   * Sync and presses Connect, so the first request the extension ever makes is
   * still one the user asked for. Off by default, it was the last switch of a
   * finished setup, and the one most often missed.
   */
  syncEnabled: boolean;
  /**
   * Carry the site configs in the sync as well — both halves, desktop and mobile,
   * each merged on its own stamp (`shared/syncConfigs.ts`), so a site recorded on
   * one computer is set up on the other, and a phone's mobile setup and a laptop's
   * desktop one never overwrite each other.
   *
   * On by default (it only matters once `syncEnabled` is). Off, this device sends
   * none and takes none, and the far side's configs pass through untouched — so
   * turning it off here never deletes them over there.
   */
  syncSiteConfigs: boolean;
  /**
   * What the Queue tab's Archive button writes out: which columns, which
   * posting statuses, and JSON or CSV. Device state, like everything else here —
   * it is a preference about a download, not part of the job database, so it is
   * never in the sync snapshot.
   *
   * Stored as *sparse overrides* (`shared/jobExport.ts`), not as the resolved
   * lists: a key this build has never heard of is ignored, and a column added by
   * a later build takes its own default instead of being silently missing from
   * every selection saved before it existed.
   */
  exportOptions: ExportSelection;
}

/** Everything persisted in chrome.storage.local (the CV bytes are stored separately, also in chrome.storage.local). */
export interface StoredState {
  profile: Profile;
  siteConfigs: SiteConfig[];
  jobUrls: JobUrlEntry[];
  settings: Settings;
}
