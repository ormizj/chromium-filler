/**
 * The setup wizard's step model: what the six steps are, in what order, and how
 * much work each one still has outstanding.
 *
 * Pure, because the answer decides two things a renderer must not guess at —
 * which step the panel opens on, and what each rail dot says to a screen reader.
 * It used to live inline in `setupPanel.buildCard` as three `filter` calls with
 * long comments and no test under them; the comments are the rules, so they are
 * asserted here instead (see `setupSteps.test.ts`).
 *
 * Every rule below is the same shape of decision: **a healthy site must report
 * no work**. A panel that puts an "N to do" chip on a site that is perfectly
 * configured teaches the user to ignore the chip, and then the one step that
 * really is unfinished goes unread too.
 */

import type { PrepAction } from './types';

/* ---------------- Rows (shared with the panel that renders them) ---------------- */

/** Dot colour: high = matched (green), low = weak match (yellow), none = nothing (grey). */
export type RowStatus = 'high' | 'low' | 'none';

export interface SetupRow {
  /** ContainerKey for job-info rows, FieldKey for form-field rows. */
  key: string;
  label: string;
  status: RowStatus;
  /** Detail line, e.g. "auto · #email" or "saved · h1.title" or "not found". */
  note: string;
  /** Whether an explicit selector is saved for this row (enables Clear + "Re-pick"). */
  hasSave: boolean;
}

/** One prerequisite step, in run order. */
export interface PrepRow {
  action: PrepAction;
  selector?: string;
  ms?: number;
  /** Whether the step's target currently resolves on the page (for the status dot). */
  resolves?: boolean;
}

export type ContainerKey = 'jobTitle' | 'jobDescription' | 'jobRequirements';

/**
 * Which step list a prep row belongs to: pre-fill steps, pre-handoff steps, or
 * the CV-confirmation steps the review modal's Apply runs before sending.
 */
export type PrepListKey = 'prep' | 'beforeFollow' | 'submitCv';

/** Everything the wizard reads. `SetupData` is this plus the sheet's geometry. */
export interface SetupSnapshot {
  name: string;
  urlPattern: string;
  prep: PrepRow[];
  containers: SetupRow[];
  fields: SetupRow[];
  /** Live quick-apply vs. external-redirect verdict for the page being set up. */
  verdict: string;
  /** Redirect-classification selectors (apply link, quick-apply / external markers). */
  redirect: SetupRow[];
  /** Steps run on the posting before following an external apply link. */
  beforeFollow: PrepRow[];
  /** Steps Apply runs after attaching the CV, before it presses Send. */
  submitCv: PrepRow[];
  /** The site's Send button — the control the review modal's Apply presses. */
  submit: SetupRow;
  /** The site's confirmation element: what marks a posting applied. */
  success: SetupRow;
}

/* ---------------- Steps ---------------- */

export type SetupStepKey = 'site' | 'prep' | 'kind' | 'info' | 'fields' | 'send';

/**
 * The order the extension itself does things in: identify the site, prepare the
 * page, work out where the application lives, read the posting, fill it, send
 * it. A wizard whose steps do not follow the flow is just a list with arrows.
 */
export const SETUP_STEP_ORDER: readonly SetupStepKey[] =
  ['site', 'prep', 'kind', 'info', 'fields', 'send'] as const;

/**
 * The mark the rail draws for each step, as a token name resolved against
 * `tokens.css`. Which step a rail node is has to be legible *without* reading it
 * — six identical dots were six anonymous circles, and the step's name was only
 * ever in the `aria-label` and in the title of whichever step was open.
 *
 * Typed `Record<SetupStepKey, …>` for the same reason `SETUP_STEP_TITLES` is: a
 * seventh step fails `npm run typecheck` until it has a mark. That the name it
 * is given is a token that actually exists — and that no two steps share one —
 * is what `ui/designSystem.test.ts` asserts, since the type system cannot see
 * inside a stylesheet.
 *
 * The mark says *which* step; the `.cf-dot` below it still says how that step is
 * doing. They are two signals and they need two shapes.
 */
export const SETUP_STEP_ICONS: Record<SetupStepKey, string> = {
  site: '--icon-step-site',
  prep: '--icon-step-prep',
  kind: '--icon-step-kind',
  info: '--icon-step-info',
  fields: '--icon-step-fields',
  send: '--icon-step-send',
};

/**
 * `warn` = work outstanding, `ok` = settled, `none` = optional and untouched.
 * `none` is not a failure here — it is what "not set" means throughout this
 * panel, and `setupPanel.css` recolours `.cf-dot.none` to say exactly that.
 */
export type StepTone = 'ok' | 'warn' | 'none';

export interface StepState {
  key: SetupStepKey;
  /** Position in `SETUP_STEP_ORDER`, so the rail need not look it up. */
  index: number;
  tone: StepTone;
  /** How many decisions this step still needs from the user. */
  todo: number;
  /** One short line, for the rail dot's accessible name. Never colour alone. */
  summary: string;
}

type Part = Omit<StepState, 'key' | 'index'>;

/** Rows are work whenever they are not a confident match — the job-info rule. */
function fromRows(rows: SetupRow[]): Part {
  if (!rows.length) return { tone: 'none', todo: 0, summary: 'nothing to set' };
  const todo = rows.filter((r) => r.status !== 'high').length;
  if (todo) return { tone: 'warn', todo, summary: `${todo} to do` };
  return { tone: 'ok', todo: 0, summary: 'all found' };
}

function site(s: SetupSnapshot): Part {
  // A config with no pattern matches no page at all, so nothing else in the
  // wizard can ever run against this site. That is the only work on this step.
  if (!s.urlPattern.trim()) return { tone: 'warn', todo: 1, summary: 'no URL pattern' };
  return { tone: 'ok', todo: 0, summary: s.name.trim() || s.urlPattern };
}

/**
 * Prep steps are **never** work. A `waitFor` whose target has not appeared yet
 * is the normal state of a page whose form is behind a click — that is the whole
 * reason the step exists — so an unresolved target here means nothing is wrong.
 */
function prep(s: SetupSnapshot): Part {
  const n = s.prep.length;
  if (!n) return { tone: 'none', todo: 0, summary: 'nothing to run' };
  return { tone: 'ok', todo: 0, summary: `${n} step${n === 1 ? '' : 's'}` };
}

/**
 * Redirect selectors are corrections to an automatic guess, so "not set"
 * everywhere is the ordinary healthy state of a quick-apply site. Only a
 * selector the user saved that no longer matches is a real fault: their
 * correction has silently stopped applying.
 */
function kind(s: SetupSnapshot): Part {
  const todo = s.redirect.filter((r) => r.status === 'low').length;
  if (todo) return { tone: 'warn', todo, summary: `${todo} to do` };
  const saved = s.redirect.filter((r) => r.hasSave).length;
  if (saved) return { tone: 'ok', todo: 0, summary: `${saved} saved` };
  return { tone: 'none', todo: 0, summary: 'guessed automatically' };
}

/**
 * The one row list where an unmatched row is **not** work.
 *
 * `main.ts` runs detection over all fifteen text fields plus `resume`, and a
 * field the page simply does not ask for comes back `'none'`. A posting with
 * four inputs therefore has twelve unmatched rows and nothing wrong with it —
 * counted the way `fromRows` counts, this step said "12 to do" on every site in
 * the world, which is the cry-wolf failure every other rule here is written
 * against.
 *
 * The CV is the exception, and the reason the step is worth a chip at all: an
 * application sent without the document attached is the failure this whole
 * surface exists to prevent. A `low` row counts too — found but not fillable is
 * not found — and so does a page with no `resume` row, which is the same answer
 * reached from the other side.
 */
function fields(s: SetupSnapshot): Part {
  if (!s.fields.length) return { tone: 'none', todo: 0, summary: 'nothing to set' };
  const cv = s.fields.find((r) => r.key === 'resume');
  if (!cv || cv.status !== 'high') return { tone: 'warn', todo: 1, summary: 'no CV upload found' };
  const matched = s.fields.filter((r) => r.status === 'high').length;
  return { tone: 'ok', todo: 0, summary: `${matched} matched` };
}

/**
 * The two rows that decide whether Apply can run at all, which is why they are
 * their own step rather than the tail of a sixteen-row field list.
 *
 * A Send button found by its *label* is healthy — most sites need no override —
 * so only "none found" counts. The confirmation element is the exception to
 * every other row in the wizard: there is no healthy unset. Without it nothing
 * here can ever be recorded as applied, and Apply refuses to send.
 */
function send(s: SetupSnapshot): Part {
  const missing: string[] = [];
  if (s.submit.status === 'none') missing.push('no Send button');
  if (s.success.status === 'none') missing.push('no confirmation element');
  if (!missing.length) return { tone: 'ok', todo: 0, summary: 'ready to apply' };
  return { tone: 'warn', todo: missing.length, summary: missing.join(', ') };
}

const PARTS: Record<SetupStepKey, (s: SetupSnapshot) => Part> = {
  site,
  prep,
  kind,
  info: (s) => fromRows(s.containers),
  fields,
  send,
};

/** Every step's state, in wizard order. */
export function stepStates(s: SetupSnapshot): StepState[] {
  return SETUP_STEP_ORDER.map((key, index) => ({ key, index, ...PARTS[key](s) }));
}

/**
 * Where the panel should open for a returning user: the earliest step with
 * something outstanding, or `-1` when the site is fully configured.
 */
export function firstStepWithWork(states: StepState[]): number {
  return states.findIndex((s) => s.todo > 0);
}
