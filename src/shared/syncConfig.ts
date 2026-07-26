/**
 * The OAuth client sync authorizes through — **entered by the user**, in
 * Options → Sync, and kept in `chrome.storage.local` like every other piece of
 * device state.
 *
 * It used to be a pair of build-time constants, which meant an installed build
 * with nothing pasted into them could only ever say "sync is not configured in
 * this build" and send its user to a source file they may not have. A Google
 * Cloud project is per-person anyway — there is no client anyone could ship here
 * that two strangers should share — so the credential belongs with the account
 * it is for, on the device, behind a form.
 *
 * The steps are written for the user in `CONCEPT_HELP.syncClient`, not here:
 * this is a thing the extension explains to the person doing it.
 *
 * `clientSecret` is not a secret in an installed application — Google requires
 * it on this grant and assumes anyone holding the build can read it. It gains an
 * attacker nothing on its own: the redirect URI is bound to this extension's ID,
 * and PKCE binds the code to the request that asked for it.
 *
 * It is deliberately **not** part of the sync snapshot. Nothing but the job
 * database crosses between devices, and the second browser needs its own
 * redirect URI on the client anyway, so there is a setup step there regardless.
 */

export interface SyncClient {
  /** `…apps.googleusercontent.com`, from an OAuth client of type Web application. */
  clientId: string;
  clientSecret: string;
}

const KEY = 'syncClient';

const NONE: SyncClient = { clientId: '', clientSecret: '' };

/** What a Google OAuth client id always ends with. */
const CLIENT_ID_SUFFIX = '.apps.googleusercontent.com';

/**
 * Both fields arrive by copy-paste out of a console that wraps them, so every
 * kind of whitespace goes — including a line break landed in the middle of a
 * value, which is invisible in an input and fails at Google as an unreadable
 * `invalid_client`.
 */
export function normalizeClient(input: Partial<SyncClient> | null | undefined): SyncClient {
  const clean = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, '') : '');
  return { clientId: clean(input?.clientId), clientSecret: clean(input?.clientSecret) };
}

/**
 * What is wrong with this client, in one sentence, or `undefined`.
 *
 * Checked before it is stored rather than at Google, because everything that
 * goes wrong here comes back as `invalid_client` however it was wrong — and the
 * console page these are copied from carries a project number and an API key
 * next to them, both of which look exactly as much like a credential.
 */
export function clientProblem(client: SyncClient): string | undefined {
  const { clientId, clientSecret } = normalizeClient(client);
  if (!clientId) return 'Paste the client ID from your Google Cloud OAuth client.';
  if (!clientId.endsWith(CLIENT_ID_SUFFIX)) {
    return `That does not look like a client ID — Google's end with ${CLIENT_ID_SUFFIX}.`;
  }
  if (!clientSecret) return 'Paste the client secret too — Google requires it on this grant.';
  return undefined;
}

/** The client this device is set up with, or empty strings if none is. */
export async function readSyncClient(): Promise<SyncClient> {
  const raw = await chrome.storage.local.get(KEY);
  return normalizeClient(raw[KEY] as Partial<SyncClient> | undefined);
}

/**
 * Store a client, or forget it when both fields are cleared — an empty form is
 * how the user takes a credential back off a machine, and writing two empty
 * strings would leave a key behind that reads as a configured-but-broken client.
 */
export async function saveSyncClient(input: Partial<SyncClient>): Promise<SyncClient> {
  const client = normalizeClient(input);
  if (!client.clientId && !client.clientSecret) {
    await chrome.storage.local.remove(KEY);
    return NONE;
  }
  await chrome.storage.local.set({ [KEY]: client });
  return client;
}

/**
 * The client id alone. The secret only matters once the token exchange runs, and
 * a half-entered client should report itself as set up and failing rather than
 * as a fresh install with nothing to say.
 */
export async function isSyncConfigured(): Promise<boolean> {
  return (await readSyncClient()).clientId.length > 0;
}

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
