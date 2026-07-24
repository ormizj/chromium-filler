/**
 * Finds the control that sends the application — the button the review modal's
 * "Apply" presses on the user's behalf.
 *
 * Getting this wrong is not a cosmetic failure. Every application form on every
 * board carries a "Save job" or "Save as draft" button an inch from the real
 * one, and pressing that instead loses the application silently. So the policy
 * here is deliberately lopsided: a saved selector always wins, a negative label
 * is disqualifying no matter what else the element has going for it, and a page
 * where nothing scores returns `none` rather than the best of a bad set. A grey
 * Apply that explains itself is a far better outcome than a confident click on
 * the wrong control.
 *
 * Scoring mirrors `src/content/fieldDetect.ts`: a weight per source, the
 * strongest source wins, and everything is compared through `normalizeAttr` so
 * case, punctuation and diacritics do not matter.
 */

import { normalizeAttr } from './fieldKeys';
import { isDisplayed } from './visible';

export interface SubmitControl {
  element: HTMLElement | null;
  source: 'override' | 'heuristic' | 'none';
  /** The selector that found it, when one was saved. */
  selectorUsed?: string;
}

/**
 * Labels that mean "send it". Space-based, because `normalizeAttr` turns
 * separators into spaces; `\b` anchors keep `apply` from matching "reapply" and
 * `send` from matching "resend".
 */
const SEND_PATTERNS: RegExp[] = [
  /\bsubmit\b/,
  /\bapply\b/,
  /\bsend\b/,
  /\bfinish\b/,
  /\bsoumettre\b/,
  /\bbewerbung absenden\b/,
];

/**
 * Labels that disqualify a control outright, checked before anything else. A
 * couple of these ("apply filters", "save job") would otherwise *match* a send
 * pattern, which is exactly why they are a veto rather than a low score.
 */
const NEVER_PATTERNS: RegExp[] = [
  /\bsave\b/,
  /\bdraft\b/,
  /\bcancel\b/,
  /\bback\b/,
  /\bclose\b/,
  /\bsearch\b/,
  /\bfilter/,
  /\bupload\b/,
  /\bbrowse\b/,
  /\bchoose file\b/,
  /\battach\b/,
  /\bsign in\b/,
  /\blog ?in\b/,
  /\bregister\b/,
];

const WEIGHT = { ariaLabel: 6, text: 6, value: 6, name: 4, id: 4 };
/** A real `type=submit` is corroborating evidence, never evidence on its own. */
const SUBMIT_TYPE_BONUS = 2;

const CANDIDATE_SELECTOR = [
  'button',
  'input[type="submit"]',
  'input[type="button"]',
  'input[type="image"]',
  '[role="button"]',
].join(', ');

/** Every string that might name this control, strongest source first. */
function sourcesFor(el: HTMLElement): Array<[string, number]> {
  const value = el instanceof HTMLInputElement ? el.value : '';
  return [
    [normalizeAttr(el.getAttribute('aria-label')), WEIGHT.ariaLabel],
    [normalizeAttr(el.textContent), WEIGHT.text],
    [normalizeAttr(value), WEIGHT.value],
    [normalizeAttr(el.getAttribute('name')), WEIGHT.name],
    [normalizeAttr(el.id), WEIGHT.id],
  ];
}

function isSubmitType(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement) return el.type === 'submit' || el.type === 'image';
  if (el instanceof HTMLButtonElement) return el.type === 'submit';
  return false;
}

/** 0 when the control is vetoed or says nothing; higher is a better candidate. */
function score(el: HTMLElement): number {
  const sources = sourcesFor(el);
  for (const [text] of sources) {
    if (text && NEVER_PATTERNS.some((re) => re.test(text))) return 0;
  }

  let best = 0;
  for (const [text, weight] of sources) {
    if (!text) continue;
    if (SEND_PATTERNS.some((re) => re.test(text))) best = Math.max(best, weight);
  }
  if (best === 0) return 0;
  return best + (isSubmitType(el) ? SUBMIT_TYPE_BONUS : 0);
}

function isDisabled(el: HTMLElement): boolean {
  if ('disabled' in el && (el as HTMLButtonElement).disabled) return true;
  return el.getAttribute('aria-disabled') === 'true';
}

/**
 * The forms the just-filled fields live in. A board page is a search form plus
 * an application form, and scoring alone would happily return the header's
 * "Apply filters" — so a candidate belonging to a form we actually filled beats
 * one that does not, whatever its label says.
 */
function formsOf(within: HTMLElement[]): Set<HTMLFormElement> {
  const forms = new Set<HTMLFormElement>();
  for (const el of within) {
    const form = ('form' in el ? (el as HTMLInputElement).form : null) ?? el.closest('form');
    if (form) forms.add(form);
  }
  return forms;
}

function ownerForm(el: HTMLElement): HTMLFormElement | null {
  // `form` covers the `form="id"` attribute, which puts a button outside the
  // element it submits — common when the button is pinned to a sticky footer.
  if ('form' in el && (el as HTMLInputElement).form) return (el as HTMLInputElement).form;
  return el.closest('form');
}

/**
 * @param root    where to search — normally `document`.
 * @param override the site config's `submitSelector`, if one was saved.
 * @param within  elements that were filled, used to prefer their form.
 */
export function findSubmitControl(
  root: ParentNode,
  override?: string,
  within: HTMLElement[] = [],
): SubmitControl {
  if (override) {
    let el: HTMLElement | null = null;
    try {
      el = root.querySelector(override) as HTMLElement | null;
    } catch {
      el = null; // a malformed saved selector falls through to the heuristic
    }
    // A saved selector is the user's own answer, so it is taken as given — no
    // label check, no veto. It is deliberately not required to be *visible*:
    // some sites reveal the button only as the form is completed, and a saved
    // selector going grey between renders would make Apply flicker.
    if (el) return { element: el, source: 'override', selectorUsed: override };
  }

  const preferred = formsOf(within);
  let best: HTMLElement | null = null;
  let bestScore = 0;
  let bestPreferred = false;

  for (const node of Array.from(root.querySelectorAll(CANDIDATE_SELECTOR))) {
    const el = node as HTMLElement;
    if (isDisabled(el) || !isDisplayed(el)) continue;
    const weight = score(el);
    if (weight === 0) continue;

    const form = ownerForm(el);
    const inPreferred = !!form && preferred.has(form);
    // Belonging to a filled form outranks any label; within the same tier the
    // higher score wins, and the first in document order breaks a tie.
    const better = inPreferred !== bestPreferred ? inPreferred : weight > bestScore;
    if (best === null || better) {
      best = el;
      bestScore = weight;
      bestPreferred = inPreferred;
    }
  }

  return best ? { element: best, source: 'heuristic' } : { element: null, source: 'none' };
}
