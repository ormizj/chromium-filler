/**
 * Waits for slow-loading forms. Resolves when the selector appears (or a generic
 * form/file-input heuristic is satisfied), or after a timeout.
 */

import { query } from '../shared/query';

export function waitForSelector(
  selector: string,
  timeoutMs = 15000,
  root: ParentNode = document,
): Promise<HTMLElement | null> {
  const existing = query(root, selector);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let done = false;
    const finish = (el: HTMLElement | null) => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(el);
    };

    const observer = new MutationObserver(() => {
      const el = query(root, selector);
      if (el) finish(el);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    const timer = setTimeout(() => finish(query(root, selector)), timeoutMs);
  });
}

/** Generic readiness: a form containing at least one editable control. */
export function waitForAnyForm(timeoutMs = 15000): Promise<Element | null> {
  return waitForSelector('form input, form textarea, input[type="file"], form select', timeoutMs);
}
