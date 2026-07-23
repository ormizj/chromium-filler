/**
 * Small URL helpers shared by every surface. `hostOf` in particular had grown
 * three identical private copies (content script, popup, options).
 */

/** Host of a URL, for display; the raw string if it doesn't parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
