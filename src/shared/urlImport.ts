/**
 * Extracts job URLs from an arbitrary pasted text blob.
 *
 * Tolerant of surrounding prose, bullet points, markdown links, quotes and
 * trailing punctuation. Normalizes each URL (via the URL constructor, which
 * lower-cases scheme + host while preserving path/query/fragment case) and
 * dedupes, keeping the first occurrence in order.
 */

/** A run of non-whitespace beginning with an http(s) scheme or a bare `www.`. */
const URL_TOKEN = /(?:https?:\/\/|www\.)[^\s]+/gi;

/** Trailing wrappers/punctuation to trim off a captured token. */
const TRAILING = /[)\].,;:!?'"<>}]+$/;

export function extractUrls(rawText: string): string[] {
  if (!rawText) return [];
  const matches = rawText.match(URL_TOKEN);
  if (!matches) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const match of matches) {
    let token = match.replace(TRAILING, '');
    if (!token) continue;
    // Bare `www.` host -> assume https.
    if (!/^https?:\/\//i.test(token)) token = `https://${token}`;

    let normalized: string;
    try {
      normalized = new URL(token).href;
    } catch {
      continue;
    }

    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}
