/**
 * Turns an element into a selector that will still find it on the next visit.
 *
 * Every selector this extension stores comes from here — the setup wizard's picks,
 * the review modal's re-picks, every recorded step — and they are stored, synced and
 * replayed weeks later against a page that has been redeployed since. So the
 * question is never "does this match right now", which any path answers, but "what
 * about this element will still be true".
 *
 * Two rules make that concrete, and the old four-rung ladder honoured neither:
 *
 * **Every candidate is verified.** It has to resolve to exactly one element, and
 * that element has to be the one we were given. The old rungs 1-3 checked
 * uniqueness and the structural fallback did not, so a path whose segments were all
 * un-indexed could quietly match two elements.
 *
 * **A structural path is anchored and capped, not walked to the root.** The old
 * fallback climbed to `<html>` unless it met a stable id, so on any hashed-class SPA
 * a picked element got `html > body > div > div:nth-of-type(2) > …` — the longest
 * and most brittle handle available, for an element that usually had a perfectly
 * good landmark three levels up. Now the walk stops at the nearest ancestor that can
 * name itself, and refuses to emit more than `MAX_TAIL` hops from it.
 *
 * The ladder returns the first verified candidate, strongest first:
 *
 *   id · name · test id · aria-label · text · semantic attribute · class · scoped · path
 *
 * `strength` is carried out with the selector because the recorder's review renders
 * it as a status dot: a handle we had to guess at is a thing the user should see
 * before they trust the site config to it, and "it worked when I picked it" is not
 * the same claim as "it will work next month".
 */

import { countMatches, elementText, query, textSelector } from './query';

const PREFERRED_DATA_ATTRS = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'data-automation-id'];

/**
 * Tags whose text *names* them. An `<input>` has no text and a `<div>`'s text is
 * everything inside it, so neither can be identified this way — only controls and
 * headings, which is exactly where the fragile-path problem bites hardest.
 */
const TEXTY = 'button, a, summary, h1, h2, h3, h4, h5, h6, legend, [role="button"]';

/** Past this a label is a paragraph, and a paragraph is not a name. */
const MAX_TEXT = 60;

/** How far up to look for something that can name itself. */
const MAX_ANCHOR_DEPTH = 6;

/** How many structural hops may hang off an anchor before it stops being a handle. */
const MAX_TAIL = 3;

export type SelectorStrength = 'strong' | 'ok' | 'fragile';

export type SelectorStrategy =
  | 'id' | 'name' | 'testid' | 'aria' | 'text' | 'semantic' | 'class' | 'scoped' | 'path';

export interface SelectorPick {
  selector: string;
  strength: SelectorStrength;
  strategy: SelectorStrategy;
}

/* ---------------- Stability predicates ---------------- */

export function isStableId(id: string): boolean {
  if (!id || id.length > 50) return false;
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) return false; // rejects `:r1:`, leading digits, etc.
  if (/\d{4,}/.test(id)) return false; // long numeric runs => generated
  if (/[a-f0-9]{8,}/i.test(id)) return false; // hex-hash-like runs
  return true;
}

/**
 * Classes that say what a thing *is*, and nothing else.
 *
 * Two kinds are rejected and they fail differently. A generated class
 * (`css-1a2b3c`, `Button_root__x7f2q`) is regenerated on the next deploy, so a
 * selector built on one works until the site ships — worse than a structural path,
 * because it reads as meaningful. A state or layout class (`active`, `row`,
 * `container`) is a real word that is on half the page: unique by luck, and no
 * longer unique the moment the user opens a menu.
 */
const GENERIC_CLASSES = new Set([
  'active', 'open', 'show', 'shown', 'hidden', 'visible', 'selected', 'current', 'disabled',
  'btn', 'button', 'link', 'input', 'field', 'label', 'text', 'title', 'icon', 'image',
  'row', 'col', 'column', 'grid', 'flex', 'container', 'wrapper', 'inner', 'outer',
  'content', 'main', 'body', 'header', 'footer', 'sidebar', 'item', 'list', 'card', 'box',
  'left', 'right', 'top', 'bottom', 'center', 'small', 'large', 'sm', 'md', 'lg', 'xl',
]);

export function isStableClass(cls: string): boolean {
  if (!cls || cls.length > 40 || cls.length < 3) return false;
  if (GENERIC_CLASSES.has(cls.toLowerCase())) return false;
  if (/\d{4,}/.test(cls)) return false; // grid-1728394857
  if (/[a-f0-9]{8,}/i.test(cls)) return false; // hex-hash-like runs
  if (/^(css|sc|emotion|jsx|glamor|makeStyles)-/i.test(cls)) return false; // emotion / styled-components
  // A CSS-modules suffix, told from an ordinary BEM word by the digit in it:
  // `Button_root__x7f2q` and `styles_field_9ab3c` go, `apply_button` stays.
  if (/_[A-Za-z0-9]*\d[A-Za-z0-9]*$/.test(cls)) return false;
  return true;
}

/* ---------------- Escaping ---------------- */

/** CSS.escape with a minimal fallback for environments (e.g. jsdom) lacking it. */
function cssEscape(value: string): string {
  const g = globalThis as unknown as { CSS?: { escape?: (s: string) => string } };
  if (g.CSS?.escape) return g.CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

function cssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const tagOf = (el: Element) => el.tagName.toLowerCase();

/* ---------------- Candidates ---------------- */

interface Candidate {
  selector: string;
  strategy: SelectorStrategy;
  strength: SelectorStrength;
}

const cand = (
  selector: string, strategy: SelectorStrategy, strength: SelectorStrength = 'strong',
): Candidate => ({ selector, strategy, strength });

/**
 * The attributes that describe a control rather than decorate it, best first.
 * `autocomplete` and `type=file` are the two that survive a redesign, because they
 * are what the browser reads too.
 */
function semanticCandidates(el: Element): Candidate[] {
  const tag = tagOf(el);
  const out: Candidate[] = [];
  const attr = (name: string) => {
    const v = el.getAttribute(name);
    if (v) out.push(cand(`${tag}[${name}="${cssString(v)}"]`, 'semantic', 'ok'));
  };
  attr('autocomplete');
  if (el.matches('input[type="file"]')) out.push(cand('input[type="file"]', 'semantic', 'ok'));
  attr('placeholder');
  attr('role');
  attr('type');
  return out;
}

function classCandidates(el: Element): Candidate[] {
  const tag = tagOf(el);
  const stable = Array.from(el.classList).filter(isStableClass);
  const out = stable.map((c) => cand(`${tag}.${cssEscape(c)}`, 'class', 'ok'));
  // All of them together, for the page that reuses one class and distinguishes with
  // a second (`.field.field-email`).
  if (stable.length > 1) {
    out.push(cand(`${tag}${stable.map((c) => `.${cssEscape(c)}`).join('')}`, 'class', 'ok'));
  }
  return out;
}

/** Everything that can name an element from itself alone, strongest first. */
function selfCandidates(el: Element): Candidate[] {
  const tag = tagOf(el);
  const out: Candidate[] = [];

  if (el.id && isStableId(el.id)) out.push(cand(`#${cssEscape(el.id)}`, 'id'));

  const name = el.getAttribute('name');
  if (name) out.push(cand(`${tag}[name="${cssString(name)}"]`, 'name'));

  for (const attr of PREFERRED_DATA_ATTRS) {
    const v = el.getAttribute(attr);
    if (v != null) out.push(cand(`[${attr}="${cssString(v)}"]`, 'testid'));
  }

  const aria = el.getAttribute('aria-label');
  if (aria?.trim()) out.push(cand(`${tag}[aria-label="${cssString(aria.trim())}"]`, 'aria'));

  if (el.matches(TEXTY)) {
    const text = elementText(el);
    if (text && text.length <= MAX_TEXT) out.push(cand(textSelector(tag, el.textContent ?? ''), 'text'));
  }

  out.push(...semanticCandidates(el));
  out.push(...classCandidates(el));
  return out;
}

/* ---------------- Structure ---------------- */

function nthOfType(el: Element): string {
  const tag = tagOf(el);
  const parent = el.parentElement;
  if (!parent) return tag;
  const sameTag = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
  if (sameTag.length <= 1) return tag;
  return `${tag}:nth-of-type(${sameTag.indexOf(el) + 1})`;
}

/** Verified: exactly one match, and it is the element we were asked about. */
function resolvesTo(root: ParentNode, selector: string, el: Element): boolean {
  return countMatches(root, selector) === 1 && query(root, selector) === el;
}

/**
 * The nearest ancestor that can name itself, and the selector that names it.
 *
 * Deliberately not recursive: an anchor is only useful if it is *simple*, and an
 * anchor that is itself a scoped path just moves the fragility one level up while
 * doubling the length of the result.
 */
function anchorFor(el: Element, root: ParentNode): { selector: string; el: Element } | null {
  let cur = el.parentElement;
  for (let depth = 0; cur && depth < MAX_ANCHOR_DEPTH; depth += 1, cur = cur.parentElement) {
    for (const c of selfCandidates(cur)) {
      if (resolvesTo(root, c.selector, cur)) return { selector: c.selector, el: cur };
    }
  }
  return null;
}

/** `<anchor> > tag > tag:nth-of-type(2)`, or nothing if that is further than MAX_TAIL. */
function scopedCandidate(el: Element, root: ParentNode): Candidate | null {
  const anchor = anchorFor(el, root);
  if (!anchor) return null;

  const hops: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== anchor.el) {
    hops.unshift(nthOfType(cur));
    if (hops.length > MAX_TAIL) return null;
    cur = cur.parentElement;
  }
  if (!hops.length) return null;

  // Two hops off a named ancestor is a handle; three is a shape, and the review
  // should say so rather than present it as settled.
  const strength: SelectorStrength = hops.length <= 2 ? 'ok' : 'fragile';
  return cand(`${anchor.selector} > ${hops.join(' > ')}`, 'scoped', strength);
}

/** The last resort: a root-anchored path, always available and never trustworthy. */
function structuralPath(el: Element, root: ParentNode): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1) {
    if (cur.id && isStableId(cur.id) && resolvesTo(root, `#${cssEscape(cur.id)}`, cur)) {
      parts.unshift(`#${cssEscape(cur.id)}`);
      break;
    }
    parts.unshift(nthOfType(cur));
    if (!cur.parentElement) break;
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}

/**
 * A candidate that is not unique on its own but becomes unique inside its anchor.
 * `input[name="q"]` on a page with a search form and an application form is the
 * everyday case: the name is right, it just needs saying where.
 */
function scopedSelfCandidates(el: Element, root: ParentNode): Candidate[] {
  const anchor = anchorFor(el, root);
  if (!anchor) return [];
  return selfCandidates(el).map((c) => ({
    ...c,
    selector: `${anchor.selector} ${c.selector}`,
    // Qualified by where it is, so a shade weaker than the same handle standing alone.
    strength: c.strength === 'strong' ? 'ok' : c.strength,
  }));
}

/* ---------------- The ladder ---------------- */

export function pickSelector(el: Element, root: ParentNode = el.ownerDocument ?? document): SelectorPick {
  for (const c of selfCandidates(el)) {
    if (resolvesTo(root, c.selector, el)) return c;
  }

  for (const c of scopedSelfCandidates(el, root)) {
    if (resolvesTo(root, c.selector, el)) return c;
  }

  const scoped = scopedCandidate(el, root);
  if (scoped && resolvesTo(root, scoped.selector, el)) return scoped;

  return { selector: structuralPath(el, root), strategy: 'path', strength: 'fragile' };
}

/**
 * The selector alone. Kept because a dozen call sites only ever wanted the string,
 * and because `SiteConfig` stores strings — the strength is a fact about *choosing*
 * a selector, not about having one.
 */
export function generateSelector(el: Element, root: ParentNode = el.ownerDocument ?? document): string {
  return pickSelector(el, root).selector;
}
