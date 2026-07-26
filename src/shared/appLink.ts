/**
 * Whether a link can be opened as a web page, and what its web form is.
 *
 * This exists because `resolveHref` used to be a *blocklist* — it rejected
 * `mailto|tel|javascript|data|blob|about` and let everything else through
 * `new URL()`. An `intent://…` or `linkedin://…` apply link is a perfectly valid
 * URL with a host, so it read as cross-origin, got nominated as the page's one
 * external apply link, and was handed to `chrome.tabs.create` — which on
 * Android/Kiwi is the app launch, not a navigation.
 *
 * That is always a dead end for this extension: it cannot fill a form or watch
 * for a `successSelector` inside a native app, so the redirect watch just expires
 * and the posting sits at `opened` for ever. Same reasoning as "Apply requires
 * `successSelector`" — if the outcome cannot be read back, do not go.
 *
 * So the rule is an **allowlist**: only `http:`/`https:` survive. The two
 * app-handoff schemes that carry their own web equivalent are rewritten to it
 * rather than merely refused, because that turns a blocked posting into one that
 * fills normally.
 *
 * Pure, no DOM — every decision in `shared/` is unit-tested, and this one is the
 * gate every URL the extension opens passes through.
 */

/** The only two schemes this extension can do anything with. */
const WEB_SCHEME = /^https?:$/;

/**
 * Schemes that never navigate anywhere *and* never mean "an app will handle
 * this". Refused under either setting, and deliberately not reported as an app
 * link: a `mailto:` on a posting is a recruiter's address, not a broken handoff.
 */
const MUNDANE_SCHEME = /^(mailto|tel|sms|javascript|data|blob|about|file|chrome|chrome-extension|view-source|ws|wss):$/;

function parse(href: string, base?: string): URL | undefined {
  try {
    return new URL(href, base);
  } catch {
    return undefined;
  }
}

/** Trim, and reject the hrefs that are not a destination at all. */
function candidate(href: string | null | undefined): string | undefined {
  const trimmed = href?.trim();
  if (!trimmed || trimmed.startsWith('#')) return undefined;
  return trimmed;
}

/** `http(s)` only — used for the *result* of a rewrite, which is not trusted. */
function webOnly(href: string | null | undefined, base?: string): string | undefined {
  const trimmed = candidate(href);
  if (!trimmed) return undefined;
  const url = parse(trimmed, base);
  if (!url || !WEB_SCHEME.test(url.protocol)) return undefined;
  return url.href;
}

/**
 * `intent://host/path#Intent;…;end` — Android's own format. Two ways out, in
 * order of trust: the `S.browser_fallback_url` the link itself supplies, then
 * `scheme=`, which covers the commonest real shape where the app URL and the web
 * URL differ by nothing but the scheme.
 */
function fromIntent(url: URL, base?: string): string | undefined {
  const parts = url.hash.replace(/^#/, '').split(';');
  const value = (key: string): string | undefined => {
    const hit = parts.find((p) => p.startsWith(`${key}=`));
    return hit?.slice(key.length + 1) || undefined;
  };

  const fallback = value('S.browser_fallback_url');
  if (fallback) {
    // Re-checked through `webOnly`, never taken on trust: a fallback is not a web
    // URL just because the key it arrived under promises one, and a fallback that
    // is itself an app link would reintroduce exactly the bug being fixed.
    let decoded = fallback;
    try {
      decoded = decodeURIComponent(fallback);
    } catch {
      /* a malformed escape means take it literally; `webOnly` still decides. */
    }
    return webOnly(decoded, base);
  }

  const scheme = value('scheme');
  if (!scheme || !WEB_SCHEME.test(`${scheme}:`)) return undefined;
  return webOnly(`${scheme}://${url.host}${url.pathname}${url.search}`);
}

/** `android-app://com.pkg/https/host/path` — the scheme is the first segment. */
function fromAndroidApp(url: URL): string | undefined {
  const [, scheme, host, ...rest] = url.pathname.split('/');
  if (!scheme || !host || !WEB_SCHEME.test(`${scheme}:`)) return undefined;
  return webOnly(`${scheme}://${host}/${rest.join('/')}`);
}

/**
 * The web URL for `href`, or undefined when it has none. Absolutized against
 * `base`; an app-handoff scheme is rewritten to its web equivalent where the link
 * carries one, and refused where it does not.
 */
export function webUrl(href: string | null | undefined, base?: string): string | undefined {
  const trimmed = candidate(href);
  if (!trimmed) return undefined;
  const url = parse(trimmed, base);
  if (!url) return undefined;
  if (WEB_SCHEME.test(url.protocol)) return url.href;
  if (url.protocol === 'intent:') return fromIntent(url, base);
  if (url.protocol === 'android-app:') return fromAndroidApp(url);
  return undefined;
}

/**
 * True when `href` hands off to a native app — i.e. it is not a web URL and not
 * one of the mundane schemes that are simply ignored. Drives wording only: it is
 * how the modal can say "this posting applies in an app" instead of filling the
 * board page with no explanation.
 */
export function isAppLink(href: string | null | undefined): boolean {
  const trimmed = candidate(href);
  if (!trimmed) return false;
  // A base is supplied so a relative href resolves to `https:` and is judged a
  // web URL, rather than being read as some scheme-less unknown.
  const url = parse(trimmed, 'https://relative.invalid/');
  if (!url) return false;
  return !WEB_SCHEME.test(url.protocol) && !MUNDANE_SCHEME.test(url.protocol);
}

/**
 * Where a link may be opened, under `settings.keepInBrowser`.
 *
 * **The one place that setting is consulted.** Everything downstream —
 * `resolveHref`, the detector, the background's tab open, the session's queue
 * opens — is unconditional and just consumes the result, which is what keeps a
 * single flag from sprouting an `if` in six files. It is also why nothing else
 * has to check it: with the setting off an app scheme comes back as a normal
 * href, so the "we refused this" state is simply never reached.
 */
export function navigableUrl(
  href: string | null | undefined,
  base: string | undefined,
  keepInBrowser: boolean,
): string | undefined {
  if (keepInBrowser) return webUrl(href, base);
  // Off restores the old blocklist exactly: the app gets the link as the page
  // wrote it — not its fallback, since the point of turning this off is to reach
  // the app — while what could never navigate stays refused.
  const trimmed = candidate(href);
  if (!trimmed) return undefined;
  const url = parse(trimmed, base);
  if (!url || MUNDANE_SCHEME.test(url.protocol)) return undefined;
  return url.href;
}
