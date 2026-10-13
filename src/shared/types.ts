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
  /** Value for each built-in text field the user has provided. */
  values: Partial<Record<TextFieldKey, string>>;
  /**
   * Extra wordings for the built-in fields, on top of the keyword tables in
   * `fieldKeys.ts` — "Given name" for First name on the one board that says so.
   */
  keywords?: Partial<Record<FieldKey, string[]>>;
  /** The fields the user made — see `CustomField`. */
  customFields?: CustomField[];
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

/**
 * A field the user defined themselves, for the questions the built-in sixteen do
 * not cover — "Years of experience", "Do you need sponsorship?", a salary figure.
 *
 * It is matched by its `keywords`: whole phrases compared against what an input
 * asks (`shared/questionText.ts`), the user's own wording rather than a regex. The
 * label counts as a keyword too, so a field named "Notice period" answers a box
 * labelled "Notice period" with nothing else configured.
 */
export interface CustomField {
  /** `c_` + random — never a `FieldKey`, so the two id spaces cannot meet. */
  id: string;
  label: string;
  /**
   * How the value is edited in Options. Filling does not branch on it: a `yesNo`
   * value is the text "Yes" or "No", which a `<select>`, a radio group or a
   * checkbox each know how to take.
   */
  kind: CustomFieldKind;
  value: string;
  /** Extra question wordings this field answers, beyond its label. */
  keywords: string[];
}

export type CustomFieldKind = 'text' | 'longText' | 'yesNo';

/**
 * What a report row or a lesson can point at: one of the built-in fields, or one
 * the user made. Custom ids always start with `c_`.
 */
export type FieldId = FieldKey | string;

/** What kind of control an input is, as far as matching and filling care. */
export type InputKind =
  | 'text' | 'email' | 'tel' | 'url' | 'number' | 'date'
  | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file' | 'editable';

/**
 * What identifies one input well enough to recognise it again — on this page and
 * on any other site that asks the same question the same way.
 *
 * Only the parts a lesson actually needed are stored (`shared/inputSignature.ts`
 * adds them strongest-first until exactly one input on the page matches), and a
 * lesson matches an input only when *every* stored part is equal. That is the
 * whole collision rule: a lesson taught on "Name" under "Reference 1" carries the
 * section, so it can never fill the "Name" under "Reference 2".
 */
export interface InputSignature {
  /** The normalized question — see `fingerprint` in questionText.ts. */
  question: string;
  kind: InputKind;
  /** Normalized `name` attribute, when the page gave one that looks stable. */
  name?: string;
  /** The nearest legend or heading above the input, normalized. */
  section?: string;
  /** For a select or radio group: its option labels, normalized and joined. */
  options?: string;
  /** Last resort: which of several otherwise-identical inputs, in page order. */
  index?: number;
  /**
   * Only for an input the page says nothing about — no question, no usable name.
   * A lesson keyed on "an unlabelled text box" alone would match one on every site
   * in the world, so it is pinned to the host it was taught on. Never set when the
   * input has words of its own: those lessons are global.
   */
  host?: string;
}

/** What a lesson says an input is. */
export type LessonTarget = { field: FieldId } | { ignore: true };

/**
 * Something the user taught the extension about one input. Global — a lesson is
 * keyed on the input, never on the site, so it applies wherever that input turns up.
 */
export interface Lesson {
  id: string;
  signature: InputSignature;
  target: LessonTarget;
  /** The question as the page worded it, for Options — the signature is normalized. */
  label: string;
  /** Where it was taught, for Options only. Never part of matching. */
  taughtOn?: string;
  createdAt: number;
  /** How many pages it has filled since. */
  hits: number;
}

export type MatchConfidence = 'high' | 'low' | 'none';
/**
 * How an input was recognised: a lesson the user taught, the built-in heuristics,
 * a keyword the user wrote, or not at all.
 */
export type MatchSource = 'lesson' | 'heuristic' | 'keyword' | 'none';

/**
 * One row of the review report: one input on the page, and what became of it.
 *
 * A row per *input*, not per profile field. The report used to list the fields
 * the profile could supply and say which of them the page had; now it lists what
 * the page asks and says which of them the extension could answer — which is the
 * only shape in which "this question was not recognised, teach it" can be a row.
 */
export interface FieldMatch {
  /** Stable for the life of the page — the row's handle for every callback. */
  id: string;
  /** What the input asks, as the page words it (not normalized). */
  question: string;
  kind: InputKind;
  /** The field it was matched to. Absent: not recognised — a row to teach. */
  field?: FieldId;
  /** That field's name, for display — a custom field carries its own. */
  fieldLabel?: string;
  source: MatchSource;
  confidence: MatchConfidence;
  /** The value that was (or would be) filled, for display. */
  valueToFill?: string;
  filled: boolean;
  required: boolean;
  /** Joined the report after the first sweep — a form that appeared later. */
  later?: boolean;
  /**
   * Recognised, and left alone because the input already held a value — typed by
   * the user, restored by the browser or set by the site. Counts as done.
   */
  kept?: boolean;
  /** Taught on this page a moment ago — the row's button retires to "Taught ✓". */
  taught?: boolean;
  /** Taught as "ignore this question". Stays in place, needs nothing. */
  ignored?: boolean;
}

/**
 * `markedDone` is set only by a user action: Options → Queue's "Mark opened as
 * done", or closing a tab the queue opened (`settings.markDoneOnClose`). The user
 * submits on the site by hand, so the extension cannot know an application went
 * in — this says "I am finished with this one", which is all it can honestly
 * record. Never from a timer or a heuristic.
 *
 * `redirected` and `applied` are no longer assigned by anything automatic — there
 * is no redirect following and no confirmation watch — but both stay: they are in
 * stored and synced histories, and `applied` is still set by hand in Options.
 */
export type JobUrlStatus = 'new' | 'opened' | 'redirected' | 'applied' | 'skipped' | 'markedDone';

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
  markedDone: number;
}

/** Re-exported so `types.ts` stays the one import for the data model. */
export type { ModalLayout } from './modalLayout';
export type { ExportSelection } from './jobExport';

export interface Settings {
  /**
   * Fill every page as it loads, and every input that appears on it afterwards.
   *
   * The engine runs on every site — there is no per-site setup any more — so this is
   * the one switch over all of it. Off, nothing is touched until the popup's Fill is
   * pressed on a page.
   */
  fillAutomatically: boolean;
  /**
   * Open the review card expanded on a tab the queue opened. Everywhere else the
   * card starts folded to its pill: a card over a shop's checkout, because its
   * address form was filled, is the extension talking over a page nobody asked it
   * about. On a queue tab the posting *is* what you asked about.
   */
  openCardOnQueueTabs: boolean;
  /**
   * Closing a tab the queue opened finishes that posting (`markedDone`) and frees
   * its slot for the next one. The user submits on the site by hand now, so closing
   * the tab is the one gesture that says "done with this one" — without this, every
   * posting the queue opened would sit at `opened` for ever.
   *
   * Only ever moves a posting *up* from `opened`: one already skipped or applied is
   * left as it is. Off, closing a tab frees the slot and records nothing.
   */
  markDoneOnClose: boolean;
  /**
   * Close the tab when the review card's Skip is pressed. Turning it off never
   * stalls a queue session — `skipUrl` frees the slot itself rather than waiting
   * for the tab to go.
   */
  closeTabOnSkip: boolean;
  /** Milliseconds to wait before closing the tab after a skip. */
  closeTabDelayMs: number;
  /**
   * Only ever open a queued link as a web page — never let one hand off to a phone
   * app. An `intent://` entry is opened at the `browser_fallback_url` it carries;
   * one with no web address at all is not opened. Off hands the link over as
   * written, for someone who would rather finish in the app.
   *
   * Read in exactly one place — `navigableUrl` in `shared/appLink.ts`.
   */
  keepInBrowser: boolean;
  /**
   * How many job tabs a queue session keeps open at once. The session refills
   * back up to this number as you finish each one, so a 60-link import never
   * becomes 60 tabs. Lower it to 1–2 on mobile.
   */
  sessionBatchSize: number;
  /**
   * Where the review card sits, and how big it is, on desktop.
   *
   * The simulator in Options → Settings is the only thing that writes it: dragging
   * or resizing the card on a page moves it for that page alone, because a nudge to
   * see the field underneath is not a preference.
   * Ignored under 640px, where the card is a full-width bottom sheet.
   * See `shared/modalLayout.ts` — every read is clamped to the viewport.
   */
  modalLayout: ModalLayout;
  /**
   * Open the card filling the whole viewport instead of at `modalLayout`.
   * Toggled from the card's own header button — the one setting the content script
   * writes. It *overrides* `modalLayout` rather than replacing it, so turning it off
   * returns the card to the rectangle the simulator configured.
   */
  modalFullscreen: boolean;
  /**
   * Share the job database with another browser profile through a Google Drive
   * folder only this extension can see.
   *
   * The job database only — the URL list and the captured postings. The profile,
   * the custom fields, the lessons, the CV and these settings are device state and
   * never leave the machine.
   *
   * On by default. That does not make a request on its own: nothing is sent until
   * the user enters an OAuth client in Options → Sync and presses Connect.
   */
  syncEnabled: boolean;
  /**
   * What the Queue tab's Archive button writes out: which columns, which
   * posting statuses, and JSON or CSV. Device state.
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
  lessons: Lesson[];
  jobUrls: JobUrlEntry[];
  settings: Settings;
}
