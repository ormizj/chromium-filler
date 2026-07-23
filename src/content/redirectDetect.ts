/**
 * Classifies a posting as quick-apply (form on this page) or a two-step
 * redirect (an "Apply on company website" handoff to an external ATS). Boards
 * mix both shapes, so this runs per page, not per site.
 *
 * Per-site selectors win, then a deliberately narrow heuristic — the same
 * override-then-heuristic shape as `fieldDetect.ts`. Anything the heuristic is
 * not sure about is `unknown`, which takes the ordinary fill path: a false
 * positive here would navigate away from a page the user could have filled.
 */

import type { RedirectConfig } from '../shared/types';
import { isExternalUrl, looksLikeExternalApply, resolveHref } from '../shared/redirect';
import { normalizeAttr } from '../shared/fieldKeys';

export type PostingKind = 'quickApply' | 'redirect' | 'unknown';

export interface RedirectDetection {
  kind: PostingKind;
  /** The control to click when following (only set for `redirect`). */
  element?: HTMLElement;
  /** Absolute destination URL, when the control is a plain link. */
  href?: string;
  source: 'override' | 'heuristic' | 'none';
  /** Human-readable why, shown in the setup panel and logged on follow. */
  reason: string;
}

export interface RedirectDetectOptions {
  root: ParentNode;
  /** The URL of the page being classified (external-ness is relative to it). */
  pageUrl: string;
  config?: RedirectConfig;
}

const CONTROL_SELECTOR = 'a[href], button, [role="button"]';

function safeQuery(root: ParentNode, selector: string | undefined): HTMLElement | null {
  if (!selector) return null;
  try {
    return root.querySelector(selector) as HTMLElement | null;
  } catch {
    return null;
  }
}

/** Cheap visibility test — layout is unavailable in tests and costly at scale. */
function isHiddenish(el: HTMLElement): boolean {
  if (el.closest('[hidden], [aria-hidden="true"]')) return true;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  return style?.display === 'none' || style?.visibility === 'hidden';
}

/** Everything a user would read on the control. */
function controlText(el: HTMLElement): string {
  return [
    el.textContent,
    el.getAttribute('aria-label'),
    el.getAttribute('title'),
    (el as HTMLInputElement).value,
  ].filter(Boolean).join(' ');
}

function hrefOf(el: HTMLElement, pageUrl: string): string | undefined {
  return resolveHref(pageUrl, el.getAttribute('href'));
}

function clip(text: string, n = 40): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
}

interface Candidate {
  el: HTMLElement;
  href: string;
  label: string;
}

/**
 * Controls that leave this host to apply. Both rules require a cross-origin
 * href: a label alone is not enough to give up on filling in place.
 */
function externalApplyCandidates(root: ParentNode, pageUrl: string): Candidate[] {
  const out: Candidate[] = [];
  root.querySelectorAll(CONTROL_SELECTOR).forEach((node) => {
    const el = node as HTMLElement;
    if (isHiddenish(el)) return;
    const href = hrefOf(el, pageUrl);
    if (!href || !isExternalUrl(pageUrl, href)) return;
    const label = controlText(el);
    const newTabApply = el.getAttribute('target') === '_blank' && /\bapply\b/.test(normalizeAttr(label));
    if (looksLikeExternalApply(label) || newTabApply) out.push({ el, href, label });
  });
  return out;
}

export function detectRedirect(opts: RedirectDetectOptions): RedirectDetection {
  const { root, pageUrl, config } = opts;

  // 1. An explicit quick-apply marker settles it: the form is on this page.
  const quickApply = safeQuery(root, config?.quickApplySelector);
  if (quickApply) {
    return { kind: 'quickApply', source: 'override', reason: 'quick-apply marker on the page' };
  }

  const applyEl = safeQuery(root, config?.applySelector);

  // 2. An "external posting" badge, even when the apply link itself looks internal.
  const marker = safeQuery(root, config?.markerSelector);
  if (marker) {
    return {
      kind: 'redirect',
      element: applyEl ?? undefined,
      href: applyEl ? hrefOf(applyEl, pageUrl) : undefined,
      source: 'override',
      reason: 'external marker on the page',
    };
  }

  // 3. The configured apply control. Trusted as-is — it may be a JS button with
  //    no href, in which case following means clicking it.
  if (applyEl) {
    return {
      kind: 'redirect',
      element: applyEl,
      href: hrefOf(applyEl, pageUrl),
      source: 'override',
      reason: 'configured external apply link',
    };
  }

  if (config?.autoDetect === false) {
    return { kind: 'unknown', source: 'none', reason: 'heuristic disabled for this site' };
  }

  // 4. Heuristic. One unambiguous destination only — a listing page full of
  //    external apply links must never auto-follow one of them.
  const candidates = externalApplyCandidates(root, pageUrl);
  const destinations = new Set(candidates.map((c) => c.href));
  if (destinations.size > 1) {
    return {
      kind: 'unknown',
      source: 'none',
      reason: `ambiguous — ${destinations.size} external apply links on this page`,
    };
  }
  if (candidates.length > 0) {
    const best = candidates[0];
    return {
      kind: 'redirect',
      element: best.el,
      href: best.href,
      source: 'heuristic',
      reason: `matched “${clip(best.label)}” → ${new URL(best.href).host}`,
    };
  }

  return { kind: 'unknown', source: 'none', reason: 'no external apply link found' };
}
