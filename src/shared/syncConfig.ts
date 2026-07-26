/**
 * The one thing sync needs that cannot be written here: an OAuth client.
 *
 * Fill these in from a Google Cloud project of your own, then rebuild. Until
 * then Connect reports that sync is not configured rather than failing at the
 * Google end with something unreadable, and the backup file in Options →
 * Settings → Sync still moves the database by hand.
 *
 * Setting it up, once:
 *
 * 1. Pin this extension's ID by putting a `key` in `manifest.config.ts`. An
 *    unpacked extension's ID is derived from its install path, so without this
 *    the two machines are two different applications to Google and the redirect
 *    URI below only matches one of them.
 * 2. In Google Cloud → APIs & Services, enable the **Google Drive API**.
 * 3. Create an OAuth client of type **Web application**, and add
 *    `https://<extension-id>.chromiumapp.org/` as an authorized redirect URI —
 *    `chrome.identity.getRedirectURL()` prints exactly this string.
 * 4. On the consent screen add the scopes below, then **publish** it. Left in
 *    Testing, Google expires refresh tokens after seven days, which means
 *    re-authorizing every week. Published-but-unverified costs one
 *    "Advanced → continue" the first time instead.
 *
 * `CLIENT_SECRET` is not a secret in an installed application — Google requires
 * it on this grant and assumes anyone holding the build can read it. It gains an
 * attacker nothing on its own: the redirect URI is bound to this extension's ID,
 * and PKCE binds the code to the request that asked for it.
 */

export const SYNC_CLIENT_ID = '';
export const SYNC_CLIENT_SECRET = '';

/**
 * `drive.appdata` is a hidden per-application folder: this extension cannot see
 * any other file in the user's Drive, and the user will not see this one in the
 * Drive UI. `openid email` is what lets the options page name the account being
 * synced to — the thing most likely to be wrong is having picked a different
 * account on the second machine, and it is invisible without this.
 */
export const SYNC_SCOPES = [
  'https://www.googleapis.com/auth/drive.appdata',
  'openid',
  'email',
].join(' ');

/** The one file in the app folder. The CV and the profile never go near it. */
export const SYNC_FILENAME = 'jobs.json';

export function isSyncConfigured(): boolean {
  return SYNC_CLIENT_ID.length > 0;
}
