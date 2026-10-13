/**
 * What an input asks — read off the page the way a person reads it.
 *
 * Detection used to read only `<label>`, `aria-labelledby` and a few attributes.
 * That is enough for the sixteen built-in fields, whose names are also in `id`
 * and `name` on most forms, and nowhere near enough for the questions a user
 * teaches: "How did you hear about us?" is routinely a `<div>` above an unlabelled
 * box, and "Do you need sponsorship?" is the legend of a radio group whose
 * `<label>`s say only "Yes" and "No". So this reads, in order: the label, what
 * the input is labelled by, its aria-label, the legend of its group, the text
 * written above it, its placeholder, its title.
 *
 * `fingerprint` turns that into the form two pages can be compared on. It is the
 * only normalization lessons and custom-field keywords are matched with, and the
 * match is exact (or a whole phrase, for keywords) — never fuzzy. A wrong value
 * typed into an employer's form is worse than a box left empty.
 */

import type { InputKind } from './types';
import { normalizeAttr } from './fieldKeys';

/** Long enough for any question; a paragraph above a box is not a question. */
const MAX_QUESTION = 160;
/** How many ancestors the "text above the box" search climbs. */
const MAX_CLIMB = 4;

const SKIP_TEXT = new Set(['SELECT', 'OPTION', 'SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT', 'TEMPLATE']);
const CONTROL_SELECTOR = 'input:not([type="hidden"]), select, textarea, [contenteditable=""], [contenteditable="true"]';

/** A node's visible words, without the words of any control inside it. */
function textOf(node: Node): string {
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      out += n.textContent ?? '';
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as Element;
    if (SKIP_TEXT.has(el.tagName) || el.getAttribute('aria-hidden') === 'true') return;
    for (const child of Array.from(el.childNodes)) walk(child);
    // Block boundaries are word boundaries: `<b>First</b><b>name</b>` is not "Firstname".
    out += ' ';
  };
  walk(node);
  return out;
}

function clean(text: string | null | undefined): string {
  const s = (text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > MAX_QUESTION ? `${s.slice(0, MAX_QUESTION - 1).trimEnd()}…` : s;
}

/** Which kind of control this is — `null` for anything that is never ours to fill. */
export function inputKind(el: Element): InputKind | null {
  if (el instanceof HTMLTextAreaElement) return 'textarea';
  if (el instanceof HTMLSelectElement) return el.multiple ? null : 'select';
  if (el instanceof HTMLInputElement) {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    switch (type) {
      case '': case 'text': return 'text';
      case 'email': return 'email';
      case 'tel': return 'tel';
      case 'url': return 'url';
      case 'number': return 'number';
      case 'date': case 'datetime-local': case 'month': case 'week': case 'time': return 'date';
      case 'radio': return 'radio';
      case 'checkbox': return 'checkbox';
      case 'file': return 'file';
      // password, search, hidden, submit, button, reset, image, range, color
      default: return null;
    }
  }
  const editable = el.getAttribute('contenteditable');
  if (editable === '' || editable === 'true' || editable === 'plaintext-only') {
    // Only the root of an editable region: its descendants are part of the same box.
    const parent = el.parentElement?.closest('[contenteditable]');
    if (!parent || parent.getAttribute('contenteditable') === 'false') return 'editable';
  }
  return null;
}

/** Every radio sharing this one's group — its form and its name. */
export function radioGroup(el: HTMLInputElement): HTMLInputElement[] {
  if (!el.name) return [el];
  const scope: ParentNode = el.form ?? el.ownerDocument;
  return Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
    .filter((r) => r.name === el.name && (r.form ?? null) === (el.form ?? null));
}

/** The smallest element holding the whole group — what its question sits above. */
function groupContainer(group: HTMLElement[]): HTMLElement {
  let node: HTMLElement | null = group[0];
  while (node && !group.every((g) => node!.contains(g))) node = node.parentElement;
  return node ?? group[0];
}

/**
 * The words written above the box: the nearest earlier sibling with text, climbing
 * a few levels — and giving up at the first sibling that holds a control, because
 * from there on the text belongs to some other field.
 */
function precedingText(el: HTMLElement): string {
  let node: HTMLElement | null = el;
  for (let depth = 0; node && depth < MAX_CLIMB; depth++) {
    for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (sib.matches(CONTROL_SELECTOR) || sib.querySelector(CONTROL_SELECTOR)) return '';
      const text = clean(textOf(sib));
      if (text) return text;
    }
    const parent: HTMLElement | null = node.parentElement;
    if (!parent || parent.tagName === 'FORM' || parent === el.ownerDocument.body) break;
    node = parent;
  }
  return '';
}

function labelledBy(el: Element): string {
  const ids = el.getAttribute('aria-labelledby');
  if (!ids) return '';
  return clean(ids.split(/\s+/)
    .map((id) => el.ownerDocument.getElementById(id))
    .filter((n): n is HTMLElement => !!n)
    .map(textOf)
    .join(' '));
}

/** The question a radio group (or a checkbox group) asks, rather than its options' names. */
function groupQuestion(el: HTMLInputElement, group: HTMLInputElement[]): string {
  const fieldset = el.closest('fieldset');
  const legend = fieldset?.querySelector(':scope > legend');
  if (legend && group.every((g) => fieldset!.contains(g))) {
    const text = clean(textOf(legend));
    if (text) return text;
  }
  const radiogroup = el.closest('[role="radiogroup"], [role="group"]');
  if (radiogroup) {
    const text = labelledBy(radiogroup) || clean(radiogroup.getAttribute('aria-label'));
    if (text) return text;
  }
  return precedingText(groupContainer(group));
}

/** What this input asks, as the page words it. Empty when the page says nothing. */
export function questionText(el: HTMLElement): string {
  const kind = inputKind(el);
  if (kind === 'radio') {
    const group = radioGroup(el as HTMLInputElement);
    const q = groupQuestion(el as HTMLInputElement, group);
    if (q) return q;
  }

  const labels = (el as HTMLInputElement).labels;
  if (labels?.length) {
    const text = clean(Array.from(labels).map(textOf).join(' '));
    if (text) return text;
  }
  const by = labelledBy(el);
  if (by) return by;
  const aria = clean(el.getAttribute('aria-label'));
  if (aria) return aria;

  const above = precedingText(el);
  if (above) return above;

  return clean(el.getAttribute('placeholder')) || clean(el.getAttribute('title'));
}

const FILLER = [
  /^(please|kindly)\s+/,
  /^(enter|provide|select|choose|specify|type|add|give|tell us|let us know)\s+/,
  /^(what is|what s|what are|whats)\s+/,
  /^(your|you r)\s+/,
];

/**
 * The comparable form of a question: lower case, no diacritics, no punctuation,
 * no "*" or "(optional)", and none of the filler that varies between two boards
 * asking the same thing ("Please enter your email address" / "Email address").
 */
export function fingerprint(text: string): string {
  let s = normalizeAttr(text)
    .replace(/\((optional|required)\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  for (let changed = true; changed;) {
    changed = false;
    for (const re of FILLER) {
      const next = s.replace(re, '');
      if (next !== s && next) { s = next; changed = true; }
    }
  }
  return s.replace(/\s+(optional|required)$/, '').trim();
}

/** Whether `phrase` appears in `text` as whole words. Both already fingerprinted. */
export function phraseIn(text: string, phrase: string): boolean {
  if (!phrase || !text) return false;
  return ` ${text} `.includes(` ${phrase} `);
}

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"]';

/**
 * Which part of the form an input is in — the nearest enclosing legend, or else the
 * nearest heading above it. What tells "Name" under "Reference 1" from "Name" under
 * "Reference 2". A radio group's own legend is its *question*, so it is skipped.
 */
export function sectionText(el: HTMLElement): string | undefined {
  let start: HTMLElement | null = el;
  if (inputKind(el) === 'radio') {
    const fieldset = el.closest('fieldset');
    if (fieldset) start = fieldset.parentElement;
  }

  const fieldset = start?.closest('fieldset');
  const legend = fieldset?.querySelector(':scope > legend');
  if (legend) {
    const text = fingerprint(textOf(legend));
    if (text) return text;
  }

  const root: ParentNode = el.closest('form') ?? el.ownerDocument.body;
  let nearest: Element | undefined;
  for (const h of Array.from(root.querySelectorAll(HEADING_SELECTOR))) {
    if (h.contains(el)) continue;
    if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) nearest = h;
    else break;
  }
  const text = nearest ? fingerprint(textOf(nearest)) : '';
  return text || undefined;
}
