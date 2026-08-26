/**
 * What the recorder saw, and how it becomes a site config.
 *
 * Setting a site up used to mean answering the extension's questions one at a time —
 * pick the description, pick each field, pick the Send button, add a click step,
 * find its target — about twenty-five decisions before anything was known to work,
 * with the two that actually gate Apply (`submitSelector`, `successSelector`) last in
 * the queue. The user already knows how to apply to the job. So they do it once, the
 * page watches, and this turns what happened into the config.
 *
 * A recording is a flat, ordered list of steps. Each is either something the user
 * *did* (a click, a change to a field, a navigation) or something they *said* about
 * an element — a **bind**: "this is the description", "that is the Send button",
 * "that banner is the confirmation". Binds are the whole point. Without them a
 * recording is a macro, and a macro cannot tell the description from the sidebar.
 *
 * This module is pure and holds every rule about what a recording *means*. The
 * numbered rules below each have a `describe` in `recording.test.ts`. Two are worth
 * reading before changing anything here:
 *
 * **Rule 3 is a safety rule, not a tidiness one.** Unbound clicks become `prep`, and
 * `prep` runs automatically on every later visit to the site. So a click that sends
 * an application must never reach a prep list — not when it was bound as the Send
 * button, and not when the user pressed Send and never said so. The second case is
 * the dangerous one, and it is why an unbound click whose label reads like a send is
 * adopted as `submitSelector` rather than replayed. This is *"Never submit
 * unprompted"* expressed where a recording could otherwise break it.
 *
 * **A recording carries where things went, never what was typed.** The user is
 * filling in their real name, address and salary expectation while this runs.
 * `RecordedStep` has no value field, and a test asserts nothing typed survives into
 * the compiled config.
 */

import type { FieldKey, PrepStep, RedirectConfig, SiteConfig } from './types';
import type { SelectorPick } from './selector';
import { looksLikeSend } from './submitDetect';

/* ---------------- The model ---------------- */

/**
 * Where the application gets made: on this site, or on the employer's after a
 * handoff. Chosen before recording starts, because it decides what the recorder bar
 * asks for — but never trusted afterwards, because what actually happened is a fact
 * and the choice was a hint (rule 1).
 */
export type RecordFlow = 'internal' | 'external';

/** Which of an external flow's two pages — and so which config — a step belongs to. */
export type RecordLeg = 'posting' | 'destination';

/** A binding that names a single `SiteConfig` slot. */
export type ConfigBindKey =
  | 'jobTitle' | 'jobDescription' | 'jobRequirements'
  | 'company' | 'location' | 'employmentType'
  | 'submit' | 'success'
  | 'applySelector' | 'quickApplySelector' | 'markerSelector';

/** A binding that names a profile field; `field:resume` is the CV upload. */
export type FieldBindKey = `field:${FieldKey}`;

export type BindKey = ConfigBindKey | FieldBindKey;

export const isFieldBind = (key: BindKey): key is FieldBindKey => key.startsWith('field:');
export const fieldOf = (key: FieldBindKey): FieldKey => key.slice('field:'.length) as FieldKey;

/** The six `extract` slots, so the compiler can route a bind without a switch. */
const EXTRACT_BINDS = new Set<ConfigBindKey>([
  'jobTitle', 'jobDescription', 'jobRequirements', 'company', 'location', 'employmentType',
]);

const REDIRECT_BINDS = new Set<ConfigBindKey>([
  'applySelector', 'quickApplySelector', 'markerSelector',
]);

export interface RecordedStep {
  id: string;
  /** Milliseconds since the recording started — the only source of the wait rule. */
  at: number;
  leg: RecordLeg;
  /** The page it happened on. The destination leg's first URL becomes its config. */
  url: string;
  action: 'click' | 'input' | 'navigate';
  /**
   * How to find the element again, and how much that handle is worth. The strength
   * rides along so the review can show it: "it worked when I picked it" and "it will
   * work next month" are different claims, and only the user can accept the second.
   */
  target?: SelectorPick;
  /** The element's own words, for the review list — and for rule 3's veto. */
  label: string;
  /** What this element *is*. Unset means "replay this as an ordinary click". */
  bind?: BindKey;
  /** A user's choice outranks a guess, which is what lets a later bind correct one. */
  bindSource?: 'auto' | 'user';
  /** `navigate` only: where the page went. */
  to?: string;
}

export interface Recording {
  flow: RecordFlow;
  startedAt: number;
  postingUrl: string;
  destinationUrl?: string;
  steps: RecordedStep[];
}

/* ---------------- The output ---------------- */

/** The part of a `SiteConfig` a recording can speak to. */
export interface ConfigPatch {
  url: string;
  extract: SiteConfig['extract'];
  fieldOverrides: Partial<Record<FieldKey, string>>;
  cvUpload?: string;
  prep: PrepStep[];
  submitCv: PrepStep[];
  submitSelector?: string;
  successSelector?: string;
  redirect?: RedirectConfig;
}

export interface CompiledSetup {
  /** What the recording turned out to be, which may not be what was chosen. */
  flow: RecordFlow;
  flowCorrected?: boolean;
  posting: ConfigPatch;
  destination?: ConfigPatch;
  /** Everything the review has to say out loud before the user presses Save. */
  warnings: string[];
}

/**
 * Kept together so the review renders them and the tests name them, rather than
 * matching on prose. These are diagnostics about one recording — the same kind of
 * thing as `RedirectDetection.reason` — so they live with the logic that produces
 * them, not in the help catalog, which explains features.
 */
export const RECORDING_WARNINGS = {
  noSubmit: 'No Send button was marked, so Apply will stay greyed out on this site.',
  noSuccess: 'No confirmation element was marked. Without one nothing can be recorded '
    + 'as applied, and Apply refuses to send — mark it while a confirmation is on screen.',
  adoptedSubmit: 'A button that looks like it sends the application was treated as the '
    + 'Send button rather than replayed as a step. Check it is the right one.',
  sendOnWrongLeg: 'The Send button or confirmation was marked on the posting, but this '
    + 'application is made on the employer’s site. Those marks were dropped.',
  fragileTargets: 'Some steps could only be identified by their position on the page, '
    + 'which breaks when the site changes. Re-pick them if you can.',
} as const;

/* ---------------- Waits ---------------- */

/** Below this, a pause is just how fast a person clicks. */
const WAIT_THRESHOLD_MS = 1200;
/** `prep.ts` already waits this long for a click target; less is not worth storing. */
const MIN_WAIT_MS = 5000;
const MAX_WAIT_MS = 30000;

function waitFor(gap: number): number | undefined {
  if (gap <= WAIT_THRESHOLD_MS) return undefined;
  return Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, gap * 2));
}

/* ---------------- Compiling ---------------- */

const selectorOf = (s: RecordedStep): string | undefined => s.target?.selector;

/**
 * A double press is one step. Only consecutive, only unbound, only the same target:
 * a repeat with something in between is a page that genuinely wanted pressing twice.
 */
function collapseRepeats(steps: RecordedStep[]): RecordedStep[] {
  return steps.filter((s, i) => {
    const prev = steps[i - 1];
    if (!prev || s.action !== 'click' || prev.action !== 'click') return true;
    if (s.bind || prev.bind) return true;
    return !(s.leg === prev.leg && selectorOf(s) != null && selectorOf(s) === selectorOf(prev));
  });
}

interface LegOptions {
  url: string;
  /** Whether the application is sent on this leg — see rule 10. */
  sends: boolean;
  /** The posting leg carries the redirect block; the destination never does. */
  isPosting: boolean;
  /** True once the recording is known to hand off. */
  external: boolean;
  warn: (w: string) => void;
}

function buildPatch(steps: RecordedStep[], opts: LegOptions): ConfigPatch {
  const patch: ConfigPatch = {
    url: opts.url, extract: {}, fieldOverrides: {}, prep: [], submitCv: [],
  };

  // --- Binds. Later wins, so re-binding a slot is how a mistake is corrected. ---
  const binds = new Map<BindKey, string>();
  const bindIndex = new Map<BindKey, number>();
  steps.forEach((s, i) => {
    const sel = selectorOf(s);
    if (!s.bind || !sel) return;
    binds.set(s.bind, sel);
    bindIndex.set(s.bind, i);
  });

  /** Selectors bound to a field: clicking one is focusing it, not a step. */
  const fieldSelectors = new Set<string>();

  for (const [key, sel] of binds) {
    if (isFieldBind(key)) {
      fieldSelectors.add(sel);
      const field = fieldOf(key);
      if (field === 'resume') patch.cvUpload = sel;
      else patch.fieldOverrides[field] = sel;
      continue;
    }
    if (EXTRACT_BINDS.has(key)) {
      patch.extract[key as keyof SiteConfig['extract']] = sel;
      continue;
    }
    if (REDIRECT_BINDS.has(key)) {
      if (opts.isPosting) patch.redirect = { ...patch.redirect, [key]: sel };
      continue;
    }
    // `submit` / `success` — rule 10: only on the leg that actually sends.
    if (!opts.sends) {
      opts.warn(RECORDING_WARNINGS.sendOnWrongLeg);
      continue;
    }
    if (key === 'submit') patch.submitSelector = sel;
    if (key === 'success') patch.successSelector = sel;
  }

  // --- Rule 3: nothing send-shaped is ever replayed. ---
  const sendShaped = new Set<number>();
  steps.forEach((s, i) => {
    if (s.action === 'click' && !s.bind && looksLikeSend(s.label)) sendShaped.add(i);
  });
  let submitIndex = bindIndex.get('submit') ?? -1;
  if (opts.sends && !patch.submitSelector && sendShaped.size) {
    const last = Math.max(...sendShaped);
    patch.submitSelector = selectorOf(steps[last]);
    submitIndex = last;
    opts.warn(RECORDING_WARNINGS.adoptedSubmit);
  }

  // --- The handoff, on the posting leg of an external recording. ---
  let handoffIndex = -1;
  if (opts.isPosting && opts.external) {
    const navIndex = steps.findIndex((s) => s.action === 'navigate');
    handoffIndex = bindIndex.get('applySelector') ?? -1;
    if (handoffIndex < 0 && navIndex > 0) {
      // Nobody said which control it was, so it is the one they pressed to leave.
      const before = steps.slice(0, navIndex).reverse().find((s) => s.action === 'click' && selectorOf(s));
      if (before) {
        handoffIndex = steps.indexOf(before);
        patch.redirect = { ...patch.redirect, applySelector: selectorOf(before) };
      }
    }
    if (handoffIndex < 0) handoffIndex = navIndex;
  }

  // --- Rule 4/5: where each remaining click goes. ---
  const cvIndex = bindIndex.get('field:resume') ?? -1;
  let prevAt: number | undefined;

  steps.forEach((s, i) => {
    if (s.action !== 'click' || s.bind) return;
    const selector = selectorOf(s);
    if (!selector) return;
    if (sendShaped.has(i)) return;              // rule 3
    if (fieldSelectors.has(selector)) return;   // clicking a field is not a step

    const gap = prevAt === undefined ? 0 : s.at - prevAt;
    prevAt = s.at;
    const ms = waitFor(gap);
    const base: PrepStep = { action: 'click', selector, ...(ms ? { ms } : {}) };

    if (opts.isPosting && opts.external) {
      // The click that leaves is the apply link, which the config already holds as
      // `redirect.applySelector` — replaying it *before* following it would open the
      // employer's form twice.
      if (i === handoffIndex) return;
      // Everything before leaving is a courtesy to the board — never a blocker.
      if (handoffIndex >= 0 && i > handoffIndex) return;
      patch.redirect = {
        ...patch.redirect,
        beforeFollow: [...(patch.redirect?.beforeFollow ?? []), { ...base, optional: true }],
      };
      return;
    }

    if (submitIndex >= 0 && i > submitIndex) return; // after the application went in
    if (cvIndex >= 0 && i > cvIndex) patch.submitCv.push(base);
    else patch.prep.push(base);
  });

  return patch;
}

export function compileRecording(rec: Recording): CompiledSetup {
  const steps = collapseRepeats(rec.steps);

  // Rule 1: what happened outranks what was chosen, in both directions. A
  // `navigate` counts as evidence alongside a destination-leg step, so a handoff
  // the user marked and then left without touching still compiles as one.
  const external = steps.some((s) => s.leg === 'destination' || s.action === 'navigate');
  const flow: RecordFlow = external ? 'external' : 'internal';

  const warnings: string[] = [];
  const warn = (w: string) => { if (!warnings.includes(w)) warnings.push(w); };

  const postingSteps = steps.filter((s) => s.leg === 'posting');
  const destSteps = steps.filter((s) => s.leg === 'destination');

  const posting = buildPatch(postingSteps, {
    url: rec.postingUrl, sends: !external, isPosting: true, external, warn,
  });

  const destination = external
    ? buildPatch(destSteps, {
      url: rec.destinationUrl ?? destSteps[0]?.url ?? '',
      sends: true,
      isPosting: false,
      external,
      warn,
    })
    : undefined;

  const sendPatch = destination ?? posting;
  if (!sendPatch.submitSelector) warn(RECORDING_WARNINGS.noSubmit);
  if (!sendPatch.successSelector) warn(RECORDING_WARNINGS.noSuccess);

  // Rule 8: a fragile handle is kept — it is the only one there is — but the review
  // must say so, because it is the thing most likely to stop working silently.
  const compiled = new Set<string>(collectSelectors(posting).concat(collectSelectors(destination)));
  if (steps.some((s) => s.target?.strength === 'fragile' && compiled.has(s.target.selector))) {
    warn(RECORDING_WARNINGS.fragileTargets);
  }

  return {
    flow,
    ...(flow !== rec.flow ? { flowCorrected: true } : {}),
    posting,
    ...(destination ? { destination } : {}),
    warnings,
  };
}

/** Every selector a patch actually kept — what the fragility warning is about. */
function collectSelectors(patch: ConfigPatch | undefined): string[] {
  if (!patch) return [];
  const steps = [...patch.prep, ...patch.submitCv, ...(patch.redirect?.beforeFollow ?? [])];
  return [
    ...Object.values(patch.extract),
    ...Object.values(patch.fieldOverrides),
    patch.cvUpload,
    patch.submitSelector,
    patch.successSelector,
    patch.redirect?.applySelector,
    patch.redirect?.quickApplySelector,
    patch.redirect?.markerSelector,
    ...steps.map((s) => s.selector),
  ].filter((s): s is string => !!s);
}
