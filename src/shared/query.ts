/**
 * The one place a stored selector is resolved against a page.
 *
 * Two jobs. The first is the guard: a selector comes out of storage — hand-edited
 * in the JSON editor, synced from another device, or written by a build that is no
 * longer this one — so it can fail to parse, and `querySelector` throws when it
 * does. Six copies of the same try/catch had grown across `content/` and `shared/`,
 * and `prep.ts` had none at all, so one malformed selector aborted a whole prep list.
 *
 * The second is the grammar. CSS cannot say "the button labelled Apply now", and on
 * a board with no ids, hashed classes and a re-render between visits, the label is
 * the only durable handle there is — the alternative is the structural path that
 * `shared/selector.ts` exists to avoid. So one pseudo is added:
 *
 *     button:-cf-text("Apply now")
 *
 * kept to elements whose collapsed, lowercased text *equals* the literal. Equality
 * rather than "contains", because the posting container's text contains every
 * button label on the page.
 *
 * It is deliberately **terminal-only and at most one per selector**. That is what
 * keeps this a `split` instead of a selector parser, and it costs nothing:
 * `pickSelector` only ever emits it in final position. A selector that breaks the
 * rule resolves to *nothing* rather than to a best guess — the same fail-closed
 * instinct as `findSubmitControl`, and for the same reason: the elements this names
 * are the ones that send an application.
 *
 * Selectors without the marker take the plain path, so the success `MutationObserver`
 * in `content/main.ts` pays nothing for any of this.
 */

const MARKER = ':-cf-text(';

/** `<prefix>:-cf-text("<literal>")` with nothing after it but whitespace. */
const TEXT_RE = /^(.*):-cf-text\("((?:[^"\\]|\\.)*)"\)\s*$/;

/** Whitespace as the page's source indentation never wrote it. */
function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** The form both sides of a text comparison are reduced to before matching. */
export function normalizeText(value: string): string {
  return collapse(value).toLowerCase();
}

/** An element's text as `:-cf-text()` sees it. */
export function elementText(el: Element): string {
  return normalizeText(el.textContent ?? '');
}

/**
 * Build a text selector.
 *
 * The literal is stored collapsed but **not** lowercased. Collapsed because a
 * literal carrying the page's source indentation would match nothing on the page it
 * came from; cased because the config is read by a person — in the JSON editor and
 * in the setup panel's row notes — and `button:-cf-text("apply now")` names a button
 * nobody can find by looking. The case-insensitivity lives in the comparison, which
 * is where it costs nothing.
 */
export function textSelector(compound: string, text: string): string {
  const literal = collapse(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `${compound}${MARKER}"${literal}")`;
}

/** Undo the escaping `textSelector` applied. */
function unescapeLiteral(literal: string): string {
  return literal.replace(/\\(.)/g, '$1');
}

export function queryAll(root: ParentNode, selector: string | undefined): HTMLElement[] {
  if (!selector) return [];

  if (!selector.includes(MARKER)) return safeAll(root, selector);

  // Two markers, or one that is not terminal, is a selector this resolver cannot
  // honour exactly. Refuse it — see the header.
  if (selector.indexOf(MARKER) !== selector.lastIndexOf(MARKER)) return [];
  const parts = TEXT_RE.exec(selector);
  if (!parts) return [];

  const [, prefix, literal] = parts;
  const wanted = normalizeText(unescapeLiteral(literal));
  return safeAll(root, prefix.trim() || '*').filter((el) => elementText(el) === wanted);
}

export function query(root: ParentNode, selector: string | undefined): HTMLElement | null {
  return queryAll(root, selector)[0] ?? null;
}

/**
 * How many elements a selector names. Separate from `queryAll().length` only in
 * intent: this is what `pickSelector` asks to prove a candidate is unique, and
 * reading it as a count at the call site is what makes that code legible.
 */
export function countMatches(root: ParentNode, selector: string | undefined): number {
  return queryAll(root, selector).length;
}

function safeAll(root: ParentNode, selector: string): HTMLElement[] {
  try {
    return Array.from(root.querySelectorAll(selector)) as HTMLElement[];
  } catch {
    return [];
  }
}
