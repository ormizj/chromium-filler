/**
 * DOM builders for the inline help disclosure, shared by the two shadow-DOM
 * surfaces and the light-DOM options page. Styles live in primitives.css.
 *
 * Deliberately dumb: these take a `HelpEntry` and return elements, with no
 * knowledge of storage or of which surface is rendering them — mirroring the
 * local `el()` / `btn()` helpers the setup panel and modal already use.
 */

import type { GroupHelp, HelpEntry } from '../shared/help';

/**
 * The `?` toggle. `onToggle` receives the new open state; the caller owns the
 * panel's visibility, because each surface keeps that state differently (the
 * setup panel re-renders wholesale, the options page does not).
 *
 * The state is read back off `aria-expanded` at click time rather than closed
 * over, so a button that outlives several toggles — the options page never
 * rebuilds its buttons — keeps flipping instead of latching after the first.
 */
export function helpButton(label: string, open: boolean, onToggle: (open: boolean) => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cf-help-btn';
  b.textContent = '?';
  b.setAttribute('aria-expanded', String(open));
  b.setAttribute('aria-label', `What is “${label}”?`);
  b.onclick = (e) => {
    // Inside a <summary> a click would also toggle the <details> it sits in.
    e.preventDefault();
    e.stopPropagation();
    const next = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(next));
    onToggle(next);
  };
  return b;
}

/** The disclosed panel: title, body, per-row lines, "When:", and an example. */
export function helpPanel(entry: HelpEntry | GroupHelp): HTMLElement {
  const box = document.createElement('div');
  box.className = 'cf-help';
  box.setAttribute('role', 'note');

  const title = document.createElement('b');
  title.className = 'cf-help-title';
  title.textContent = entry.title;

  const body = document.createElement('p');
  body.className = 'cf-help-body';
  body.append(...richText(entry.body));

  box.append(title, body);

  const rows = (entry as GroupHelp).rows;
  if (rows?.length) {
    const ul = document.createElement('ul');
    ul.className = 'cf-help-rows';
    for (const row of rows) {
      const li = document.createElement('li');
      const label = document.createElement('b');
      label.textContent = row.label;
      li.append(label, document.createTextNode(' — '), ...richText(row.body));
      ul.append(li);
    }
    box.append(ul);
  }

  if (entry.when) {
    const when = document.createElement('p');
    when.className = 'cf-help-when';
    when.append(...richText(entry.when));
    box.append(when);
  }

  if (entry.example) {
    const example = document.createElement('code');
    example.className = 'cf-help-example';
    example.textContent = entry.example;
    box.append(example);
  }

  return box;
}

/**
 * Renders the catalog's `backtick spans` as real <code>. Built from text nodes
 * rather than innerHTML: this copy is trusted, but the same helper is one edit
 * away from being handed a selector a site supplied.
 */
export function richText(text: string): Node[] {
  const out: Node[] = [];
  // Split on the backticks themselves, so odd-indexed pieces are the code spans.
  const pieces = text.split('`');
  pieces.forEach((piece, i) => {
    if (!piece) return;
    if (i % 2 === 1) {
      const code = document.createElement('code');
      code.textContent = piece;
      out.push(code);
    } else {
      out.push(document.createTextNode(piece));
    }
  });
  return out;
}
