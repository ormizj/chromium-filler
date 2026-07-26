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
import { isAppLink } from '../shared/appLink';
import { normalizeAttr } from '../shared/fieldKeys';

// Declared in `shared/redirect.ts` (the setup snapshot carries it), re-exported
// here so it stays importable from the detector that produces it.
export type { PostingKind } from '../shared/redirect';
import type { PostingKind } from '../shared/redirect';

export interface RedirectDetection {
  kind: PostingKind;
  /** The control to click when following (only set for `redirect`). */
  element?: HTMLElement;
  /** Absolute destination URL, when the control is a plain link. */
  href?: string;
  /**
   * The app-handoff URL this page's apply control has, when it has no web form
   * to reach instead — a bare `linkedin://…` rather than an `intent://…` whose
   * `browser_fallback_url` could be used.
   *
   * Set only when `keepInBrowser` refused it, which is what makes every consumer
   * unconditional: with the setting off the URL resolves normally, so `href` is
   * populated and this stays undefined. Its two jobs are to stop `followRedirect`
   * clicking a control it knows leaves the browser, and to let the modal say why
   * the apply control was ignored instead of silently filling the page.
   */
  appLink?: string;
  source: 'override' | 'heuristic' | 'none';
  /** Human-readable why, shown in the setup panel and logged on follow. */
  reason: string;
}

export interface RedirectDetectOptions {
  root: ParentNode;
  /** The URL of the page being classified (external-ness is relative to it). */
  pageUrl: string;
  config?: RedirectConfig;
  /**
   * `settings.keepInBrowser`. Defaults to on so callers that do not care (and the
   * unit tests) get the fail-closed behaviour.
   */
  keepInBrowser?: boolean;
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

function hrefOf(el: HTMLElement, pageUrl: string, keepInBrowser: boolean): string | undefined {
  return resolveHref(pageUrl, el.getAttribute('href'), keepInBrowser);
}

/**
 * The app-handoff URL a control points at, when that is *why* it has no usable
 * href. Reached only with `keepInBrowser` on, because otherwise `hrefOf` resolves
 * the same link and there is nothing to report.
 */
function appLinkOf(el: HTMLElement, pageUrl: string, keepInBrowser: boolean): string | undefined {
  const raw = el.getAttribute('href')?.trim();
  if (!raw || hrefOf(el, pageUrl, keepInBrowser) || !isAppLink(raw)) return undefined;
  return raw;
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

interface Scan {
  candidates: Candidate[];
  /** Distinct app-handoff destinations that read as an apply control. */
  appLinks: string[];
}

/**
 * Controls that leave this host to apply. Both web rules require a cross-origin
 * href: a label alone is not enough to give up on filling in place.
 *
 * App-handoff links are collected separately rather than simply skipped. They
 * cannot be followed — that is the point — but a page whose only apply control
 * leaves the browser has to be able to say so, or it fills in place with the
 * greyed Apply unexplained, which is the silence `flowState.ts` exists to end.
 */
function externalApplyCandidates(root: ParentNode, pageUrl: string, keepInBrowser: boolean): Scan {
  const candidates: Candidate[] = [];
  const appLinks = new Set<string>();
  root.querySelectorAll(CONTROL_SELECTOR).forEach((node) => {
    const el = node as HTMLElement;
    if (isHiddenish(el)) return;
    const label = controlText(el);
    const href = hrefOf(el, pageUrl, keepInBrowser);
    if (!href) {
      // A bare "apply" label is enough here, where it is not for a web link: the
      // scheme itself already proves the control leaves, so it needs none of the
      // cross-origin corroboration the heuristic normally insists on. Requiring
      // *some* apply wording still keeps a "Share on LinkedIn" button out.
      const app = appLinkOf(el, pageUrl, keepInBrowser);
      if (app && (looksLikeExternalApply(label) || /\bapply\b/.test(normalizeAttr(label)))) {
        appLinks.add(app);
      }
      return;
    }
    if (!isExternalUrl(pageUrl, href, keepInBrowser)) return;
    const newTabApply = el.getAttribute('target') === '_blank' && /\bapply\b/.test(normalizeAttr(label));
    if (looksLikeExternalApply(label) || newTabApply) candidates.push({ el, href, label });
  });
  return { candidates, appLinks: [...appLinks] };
}

export function detectRedirect(opts: RedirectDetectOptions): RedirectDetection {
  const { root, pageUrl, config, keepInBrowser = true } = opts;

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
      href: applyEl ? hrefOf(applyEl, pageUrl, keepInBrowser) : undefined,
      appLink: applyEl ? appLinkOf(applyEl, pageUrl, keepInBrowser) : undefined,
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
      href: hrefOf(applyEl, pageUrl, keepInBrowser),
      appLink: appLinkOf(applyEl, pageUrl, keepInBrowser),
      source: 'override',
      reason: 'configured external apply link',
    };
  }

  if (config?.autoDetect === false) {
    return { kind: 'unknown', source: 'none', reason: 'heuristic disabled for this site' };
  }

  // 4. Heuristic. One unambiguous destination only — a listing page full of
  //    external apply links must never auto-follow one of them.
  const { candidates, appLinks } = externalApplyCandidates(root, pageUrl, keepInBrowser);
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

  // 5. Nothing followable, but one apply control that hands off to an app. Still
  //    `unknown` — the page gets the ordinary fill path, which is the best that
  //    can be done — and the modal explains the control it left alone.
  if (appLinks.length === 1) {
    return {
      kind: 'unknown',
      appLink: appLinks[0],
      source: 'heuristic',
      reason: 'the apply link opens an app, not a web page',
    };
  }

  return { kind: 'unknown', source: 'none', reason: 'no external apply link found' };
}
