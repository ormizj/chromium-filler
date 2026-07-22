/**
 * Waits for slow-loading forms. Resolves when the selector appears (or a generic
 * form/file-input heuristic is satisfied), or after a timeout.
 */

export function waitForSelector(
  selector: string,
  timeoutMs = 15000,
  root: ParentNode = document,
): Promise<Element | null> {
  const existing = safeQuery(root, selector);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let done = false;
    const finish = (el: Element | null) => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(el);
    };

    const observer = new MutationObserver(() => {
      const el = safeQuery(root, selector);
      if (el) finish(el);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    const timer = setTimeout(() => finish(safeQuery(root, selector)), timeoutMs);
  });
}

function safeQuery(root: ParentNode, selector: string): Element | null {
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}

/** Generic readiness: a form containing at least one editable control. */
export function waitForAnyForm(timeoutMs = 15000): Promise<Element | null> {
  return waitForSelector('form input, form textarea, input[type="file"], form select', timeoutMs);
}
