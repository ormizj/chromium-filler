/**
 * Telling one input from every other — the key a lesson is stored under.
 *
 * A lesson is global: taught once, it applies on every site that asks the same
 * question. That only works if the key names *one* input. Wording alone collides
 * all the time — a form asks "Name" for you and again for each referee, "Phone"
 * for home and for mobile — and a lesson that filled both would put your number in
 * your referee's box. So the key is built the way `pickSelector` builds a
 * selector: start from what the input asks, add a part at a time (strongest
 * first), and stop at the first form that matches exactly one input on the page it
 * was taught on. On any later page a lesson matches an input only when every part
 * it stored is equal — and when it still matches two, it fills neither.
 *
 * Everything except `signatureParts` is pure over the parts, so the rules are
 * tested without a page.
 */

import type { InputKind, InputSignature } from './types';
import { normalizeAttr } from './fieldKeys';
import { fingerprint, inputKind, questionText, radioGroup, sectionText } from './questionText';

/** Every part an input has, before any lesson chose which of them it needs. */
export type SignatureParts = Omit<InputSignature, 'index' | 'host'>;

/** The parts, strongest first, that `uniqueSignature` adds until one input is left. */
const LADDER = ['name', 'section', 'options'] as const;

/** A `name` attribute that will still be there next week. */
function stableName(name: string | null): string | undefined {
  if (!name || name.length > 80) return undefined;
  if (/\d{4,}/.test(name)) return undefined; // question_88231947
  if (/[a-f0-9]{8,}/i.test(name)) return undefined; // hashes
  if (/^[:_]?r\d+[:_]?$/.test(name)) return undefined; // React's useId
  const n = normalizeAttr(name.replace(/[[\]]+/g, ' '));
  return n || undefined;
}

function optionsOf(el: HTMLElement, kind: InputKind): string | undefined {
  let labels: string[] = [];
  if (kind === 'select') {
    labels = Array.from((el as HTMLSelectElement).options)
      .filter((o) => o.value !== '' && !o.disabled)
      .map((o) => o.text);
  } else if (kind === 'radio') {
    labels = radioGroup(el as HTMLInputElement).map((r) => {
      const own = r.labels?.length ? Array.from(r.labels).map((l) => l.textContent ?? '').join(' ') : '';
      return own || r.value;
    });
  }
  const out = labels.map(fingerprint).filter(Boolean);
  return out.length ? out.join('|') : undefined;
}

/** Read every part of an input's signature off the page. */
export function signatureParts(el: HTMLElement): SignatureParts {
  const kind = inputKind(el) ?? 'text';
  const parts: SignatureParts = { question: fingerprint(questionText(el)), kind };
  const name = stableName(el.getAttribute('name'));
  if (name) parts.name = name;
  const section = sectionText(el);
  if (section) parts.section = section;
  const options = optionsOf(el, kind);
  if (options) parts.options = options;
  return parts;
}

/** Whether an input with these parts is the one a signature names (ignoring `index`). */
export function signatureMatches(sig: InputSignature, parts: SignatureParts, host: string): boolean {
  if (sig.question !== parts.question || sig.kind !== parts.kind) return false;
  for (const key of LADDER) {
    if (sig[key] !== undefined && sig[key] !== parts[key]) return false;
  }
  if (sig.host !== undefined && sig.host !== host) return false;
  return true;
}

/**
 * The shortest signature naming `all[target]` alone among `all` — every input on
 * the page it is being taught on, in page order.
 */
export function uniqueSignature(all: SignatureParts[], target: number, host: string): InputSignature {
  const t = all[target];
  const sig: InputSignature = { question: t.question, kind: t.kind };
  // Nothing the input says about itself: a global lesson on it would match every
  // unlabelled box anywhere, so it belongs to this site.
  if (!t.question && !t.name) sig.host = host;

  const matching = () => all.filter((p) => signatureMatches(sig, p, host));
  if (matching().length <= 1) return sig;
  for (const key of LADDER) {
    if (t[key] === undefined) continue;
    sig[key] = t[key] as never;
    if (matching().length <= 1) return sig;
  }
  // Still several identical inputs: which one, by position among them.
  const same = all.map((p, i) => (signatureMatches(sig, p, host) ? i : -1)).filter((i) => i >= 0);
  sig.index = same.indexOf(target);
  return sig;
}

/** How many parts a signature pins down — the more specific lesson wins. */
function specificity(sig: InputSignature): number {
  return Object.values(sig).filter((v) => v !== undefined && v !== '').length;
}

/**
 * The lesson for `all[target]`, if one applies — or `'ambiguous'` when the best
 * lesson for it also matches another input on the page and stored no position to
 * choose between them. That case fills nothing, on purpose.
 */
export function lessonFor<L extends { id: string; signature: InputSignature }>(
  lessons: readonly L[],
  all: SignatureParts[],
  target: number,
  host: string,
): L | 'ambiguous' | undefined {
  const own = lessons
    .filter((l) => signatureMatches(l.signature, all[target], host))
    .sort((a, b) => specificity(b.signature) - specificity(a.signature));

  for (const lesson of own) {
    const same = all.map((p, i) => (signatureMatches(lesson.signature, p, host) ? i : -1)).filter((i) => i >= 0);
    const { index } = lesson.signature;
    if (index !== undefined) {
      if (same[index] === target) return lesson;
      continue; // a positional lesson about one of the other identical inputs
    }
    return same.length === 1 ? lesson : 'ambiguous';
  }
  return undefined;
}

/** Leans on a position, or on one site — worth a flag in Options. */
export function isFragile(sig: InputSignature): boolean {
  return sig.index !== undefined || sig.host !== undefined;
}
