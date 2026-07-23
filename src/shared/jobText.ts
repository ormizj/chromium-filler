/**
 * Turns a job-posting container into readable blocks.
 *
 * The modal used to show `container.textContent`, which is two bugs in one: every
 * heading, paragraph and bullet welds into a single string, and the HTML source's
 * own newlines and indentation survive into a `pre-wrap` box — so a posting
 * rendered as a ragged wall of text in a 160px window. Reading the posting is the
 * main thing the modal is for, so the structure has to survive the extraction.
 *
 * The other half of the job is exclusion. The generic `jobDescription` fallbacks
 * in content/extract.ts (`main`, `article`, `[class*="content"]`) routinely
 * swallow the application form and the "similar jobs" sidebar, and quoting the
 * user's own field labels back at them is noise at best — at worst, as in
 * test/fixtures/sites/quick-board.html, it is a decoy "Apply on company website"
 * link presented as part of the posting.
 */

export type JobBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'list'; items: string[] };

/**
 * Chrome, not part of the posting. `form` and its controls are the description
 * container's most common contamination; `aside`/`nav`/`footer` are the next.
 */
const SKIP_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'svg', 'iframe', 'canvas', 'video', 'audio',
  'form', 'input', 'textarea', 'select', 'option', 'label', 'button', 'fieldset', 'legend',
  'nav', 'aside', 'footer', 'header',
]);

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const LIST_TAGS = new Set(['ul', 'ol']);

/**
 * Elements that own their own line. A leaf for our purposes is an element with no
 * block-level element children — that is what decides recurse-vs-emit, and it is
 * why a wrapper div and the paragraph inside it do not both emit the same text.
 */
const BLOCK_TAGS = new Set([
  'address', 'article', 'blockquote', 'details', 'dialog', 'dd', 'div', 'dl', 'dt',
  'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'li', 'main',
  'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th',
  'thead', 'tr', 'ul',
]);

/** Bullet glyphs boards use when they ship list items as sibling paragraphs. */
const BULLET = /^\s*[•·‣◦▪–—*-]\s+/;

/** A container this large is a layout mistake, not a posting; stop rather than hang. */
const MAX_BLOCKS = 400;

/** Collapse every run of whitespace — including the source's indentation. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function isSkipped(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName.toLowerCase())) return true;
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return true;
  // Only inline styles are checked: a content script sees the page's stylesheets,
  // but this also runs in jsdom (tests) and over detached nodes, where computed
  // styles are meaningless. Inline display:none is what pages actually use to
  // hide a pre-rendered block.
  const style = (el as HTMLElement).style;
  return style?.display === 'none' || style?.visibility === 'hidden';
}

/**
 * Text of a leaf, with `<br>` promoted to a line break.
 *
 * The break marker is a sentinel, not `\n`: the source's own newlines and
 * indentation are whitespace to be collapsed, and splitting on `\n` would turn
 * every hand-wrapped line of the HTML into its own paragraph — the exact ragged
 * rendering this module exists to end. It is a private-use codepoint, and it is
 * swapped in over the DOM rather than over `innerHTML`, because the HTML parser
 * is entitled to rewrite what it is handed (it drops U+0000 outright).
 */
const BREAK = '\uE000';

function leafLines(el: Element): string[] {
  const clone = el.cloneNode(true) as Element;
  for (const br of Array.from(clone.querySelectorAll('br'))) {
    br.replaceWith(el.ownerDocument.createTextNode(BREAK));
  }
  return (clone.textContent ?? '').split(BREAK).map(normalize).filter(Boolean);
}

function hasBlockChild(el: Element): boolean {
  for (const child of Array.from(el.children)) {
    if (BLOCK_TAGS.has(child.tagName.toLowerCase())) return true;
  }
  return false;
}

/** Depth-first walk, appending into `out` in document order. */
function walk(el: Element, out: JobBlock[]): void {
  for (const child of Array.from(el.children)) {
    if (out.length >= MAX_BLOCKS) return;
    if (isSkipped(child)) continue;

    const tag = child.tagName.toLowerCase();

    if (LIST_TAGS.has(tag)) {
      const items = Array.from(child.children)
        .filter((li) => li.tagName.toLowerCase() === 'li' && !isSkipped(li))
        .map((li) => normalize(li.textContent ?? ''))
        .filter((t) => t.length > 1);
      if (items.length) out.push({ kind: 'list', items });
      continue;
    }

    if (HEADING_TAGS.has(tag)) {
      const text = normalize(child.textContent ?? '');
      if (text.length > 1) out.push({ kind: 'heading', text });
      continue;
    }

    if (hasBlockChild(child)) {
      walk(child, out);
      continue;
    }

    for (const line of leafLines(child)) {
      if (line.length > 1) out.push({ kind: 'para', text: line });
    }
  }

  // Text sitting directly in this element, with no wrapper of its own.
  if (!hasBlockChild(el) && el.children.length === 0) {
    for (const line of leafLines(el)) {
      if (line.length > 1) out.push({ kind: 'para', text: line });
    }
  }
}

/** Drop consecutive duplicates — boilerplate repeats far more than prose does. */
function dedupe(blocks: JobBlock[]): JobBlock[] {
  const out: JobBlock[] = [];
  let last = '';
  for (const b of blocks) {
    const key = b.kind === 'list' ? `list:${b.items.join('|')}` : `${b.kind}:${b.text}`;
    if (key === last) continue;
    last = key;
    out.push(b);
  }
  return out;
}

/**
 * Fold runs of bullet-prefixed paragraphs into a real list. Six one-line
 * paragraphs read as a wall; the same six as a list read as a list.
 */
function foldBullets(blocks: JobBlock[]): JobBlock[] {
  const out: JobBlock[] = [];
  let run: string[] = [];
  const flush = () => {
    if (!run.length) return;
    // A lone bulleted line is just a sentence; two or more is a list.
    if (run.length > 1) out.push({ kind: 'list', items: run });
    else out.push({ kind: 'para', text: run[0] });
    run = [];
  };

  for (const b of blocks) {
    if (b.kind === 'para' && BULLET.test(b.text)) {
      run.push(b.text.replace(BULLET, ''));
      continue;
    }
    flush();
    out.push(b);
  }
  flush();
  return out;
}

/** The posting inside `root`, as blocks, in document order. */
export function extractBlocks(root: HTMLElement): JobBlock[] {
  const raw: JobBlock[] = [];
  walk(root, raw);
  return foldBullets(dedupe(raw)).slice(0, MAX_BLOCKS);
}

/**
 * One clean line per block. This is what the Setup panel's container snippets and
 * any plain-text consumer want — the same text the modal renders, minus the
 * typography.
 */
export function blocksToText(blocks: JobBlock[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    if (b.kind === 'list') lines.push(...b.items);
    else lines.push(b.text);
  }
  return lines.join('\n');
}
