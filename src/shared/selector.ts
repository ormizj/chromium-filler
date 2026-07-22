/**
 * Generates a robust, unique CSS selector for an element — used by click-to-pick
 * so an override can be saved and re-resolve the same control on later visits.
 *
 * Preference order: stable unique id -> name -> stable data-* attribute ->
 * structural nth-of-type path. Framework-generated / hashed ids are rejected.
 */

const PREFERRED_DATA_ATTRS = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'data-automation-id'];

/** CSS.escape with a minimal fallback for environments (e.g. jsdom) lacking it. */
function cssEscape(value: string): string {
  const g = globalThis as unknown as { CSS?: { escape?: (s: string) => string } };
  if (g.CSS?.escape) return g.CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

export function isStableId(id: string): boolean {
  if (!id || id.length > 50) return false;
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) return false; // rejects `:r1:`, leading digits, etc.
  if (/\d{4,}/.test(id)) return false; // long numeric runs => generated
  if (/[a-f0-9]{8,}/i.test(id)) return false; // hex-hash-like runs
  return true;
}

function isUnique(root: ParentNode, selector: string): boolean {
  try {
    return root.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function cssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function nthOfType(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (!parent) return tag;
  const sameTag = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
  if (sameTag.length <= 1) return tag;
  return `${tag}:nth-of-type(${sameTag.indexOf(el) + 1})`;
}

function structuralPath(el: Element, root: ParentNode): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1) {
    if (cur.id && isStableId(cur.id) && isUnique(root, `#${cssEscape(cur.id)}`)) {
      parts.unshift(`#${cssEscape(cur.id)}`);
      break;
    }
    parts.unshift(nthOfType(cur));
    if (!cur.parentElement) break;
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}

export function generateSelector(el: Element, root: ParentNode = el.ownerDocument!): string {
  // 1. Stable, unique id.
  if (el.id && isStableId(el.id)) {
    const sel = `#${cssEscape(el.id)}`;
    if (isUnique(root, sel)) return sel;
  }

  // 2. name attribute.
  const name = el.getAttribute('name');
  if (name) {
    const sel = `[name="${cssString(name)}"]`;
    if (isUnique(root, sel)) return sel;
  }

  // 3. Stable data-* attribute.
  for (const attr of PREFERRED_DATA_ATTRS) {
    const v = el.getAttribute(attr);
    if (v != null) {
      const sel = `[${attr}="${cssString(v)}"]`;
      if (isUnique(root, sel)) return sel;
    }
  }

  // 4. Structural path.
  return structuralPath(el, root);
}
