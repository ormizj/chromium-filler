/**
 * Authorizing a Google account to sync the job database through.
 *
 * `chrome.identity.launchWebAuthFlow` rather than `getAuthToken`, and the
 * difference is the whole feature: `getAuthToken` returns a token for whatever
 * account the *browser profile* is signed into, so two profiles would end up
 * with two separate Drives and nothing would ever sync. This flow shows the
 * account chooser, so the same account can be picked deliberately on both
 * machines.
 *
 * Authorization code + PKCE, so there is a refresh token and syncing at browser
 * startup does not need the user present.
 */

import {
  SYNC_SCOPES, clientProblem, readSyncClient, type SyncClient,
} from '../shared/syncConfig';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const KEY = 'syncAuth';

/** Access tokens are refreshed a minute early rather than on expiry. */
const EXPIRY_MARGIN_MS = 60_000;

interface StoredAuth {
  refreshToken: string;
  account?: string;
  accessToken?: string;
  expiresAt?: number;
}

export class SyncAuthError extends Error {}

/**
 * Google has refused the grant itself — revoked consent, or a client that no
 * longer exists. Distinguished from every other failure because it is the only
 * one where forgetting the refresh token is the right answer: retrying will
 * never work, and saying so beats replaying a dead token for ever.
 */
export class SyncAuthRevokedError extends SyncAuthError {}

/** The OAuth error codes that mean exactly that. */
const DEAD_GRANT = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client']);

/**
 * The user's OAuth client, refused rather than sent half-filled.
 *
 * Read on every call instead of once at load: the service worker outlives the
 * options page it was entered on, and a client pasted a minute ago must be the
 * one the next Connect uses.
 */
async function requireClient(): Promise<SyncClient> {
  const client = await readSyncClient();
  const problem = clientProblem(client);
  if (problem) {
    throw new SyncAuthError(`${problem} Options → Sync → Google OAuth client.`);
  }
  return client;
}

async function read(): Promise<StoredAuth | undefined> {
  const raw = await chrome.storage.local.get(KEY);
  return raw[KEY] as StoredAuth | undefined;
}

async function write(auth: StoredAuth): Promise<void> {
  await chrome.storage.local.set({ [KEY]: auth });
}

export async function connectedAccount(): Promise<string | undefined> {
  return (await read())?.account;
}

export async function isConnected(): Promise<boolean> {
  return !!(await read())?.refreshToken;
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(64)));
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/**
 * The email inside the id_token. Read without verifying the signature on
 * purpose: it arrived over TLS directly from Google's token endpoint, so there
 * is no third party in a position to have forged it, and it is used only to show
 * which account this browser is pointed at.
 */
function accountFromIdToken(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  try {
    const payload = idToken.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return (JSON.parse(json) as { email?: string }).email;
  } catch {
    return undefined;
  }
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  error?: string;
  error_description?: string;
}

/**
 * Read as text and parse defensively, rather than `res.json()` on the way past.
 *
 * Not every answer on this endpoint comes from Google: a captive portal or a
 * proxy returns an HTML 502, and parsing that first threw a `SyntaxError` that
 * carried no status and — because the caller could not tell it apart from a
 * refusal — used to cost the user their refresh token.
 */
async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });

  const raw = await res.text();
  let data: TokenResponse | undefined;
  try {
    data = raw ? (JSON.parse(raw) as TokenResponse) : {};
  } catch {
    /* not JSON — something between here and Google answered instead. */
  }

  if (res.ok && data && !data.error) return data;

  const detail = data?.error_description ?? data?.error ?? `Token request failed (${res.status})`;
  if (data?.error && DEAD_GRANT.has(data.error)) throw new SyncAuthRevokedError(detail);
  throw new SyncAuthError(detail);
}

/**
 * Run the consent flow and remember the refresh token.
 *
 * `prompt=consent select_account` every time, deliberately: the chooser is how
 * the *same* account gets picked on the second machine, and skipping it is how
 * someone ends up with two half-synced databases. `consent` also guarantees a
 * refresh token comes back — Google omits it on a repeat authorization.
 */
export async function connect(): Promise<string | undefined> {
  const client = await requireClient();
  const verifier = randomVerifier();
  const redirectUri = chrome.identity.getRedirectURL();
  const url = `${AUTH_ENDPOINT}?${new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SYNC_SCOPES,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent select_account',
  })}`;

  // Closing the window *rejects* under the MV3 promise API rather than
  // resolving undefined, so this — not the falsy check below — is the branch a
  // cancelled authorization really takes. Left in place for the callback-style
  // shim, where it resolves empty instead.
  let redirect: string | undefined;
  try {
    redirect = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  } catch (e) {
    throw new SyncAuthError(`Authorization was cancelled. (${(e as Error).message})`);
  }
  if (!redirect) throw new SyncAuthError('Authorization was cancelled.');

  const returned = new URL(redirect).searchParams;
  const error = returned.get('error');
  if (error) throw new SyncAuthError(error);
  const code = returned.get('code');
  if (!code) throw new SyncAuthError('Google did not return an authorization code.');

  const token = await postToken({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  if (!token.refresh_token) {
    throw new SyncAuthError('Google did not return a refresh token. Re-authorize and grant offline access.');
  }

  const account = accountFromIdToken(token.id_token);
  await write({
    refreshToken: token.refresh_token,
    account,
    accessToken: token.access_token,
    expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
  });
  return account;
}

/** Forget the tokens. The job database itself is untouched. */
export async function disconnect(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}

/**
 * A usable access token, refreshed if the cached one has run out.
 *
 * `forceRefresh` is for the caller that has been *told* the token is no good —
 * Drive answering 401 — because expiry is judged on this machine's clock alone,
 * and a clock running fast (or a token Google retired early) stays "valid" here
 * long after it has stopped working.
 */
export async function accessToken(forceRefresh = false): Promise<string> {
  const auth = await read();
  if (!auth?.refreshToken) throw new SyncAuthError('Not connected to a Google account yet.');
  if (
    !forceRefresh
    && auth.accessToken && auth.expiresAt && auth.expiresAt - EXPIRY_MARGIN_MS > Date.now()
  ) {
    return auth.accessToken;
  }

  const client = await requireClient();
  let token: TokenResponse;
  try {
    token = await postToken({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: auth.refreshToken,
      grant_type: 'refresh_token',
    });
  } catch (e) {
    // A refresh token dies when consent is revoked — and, if the consent screen
    // was left in Testing, after seven days. Neither is recoverable here, and
    // saying so beats retrying a token that will never work again.
    //
    // **Only Google saying so ends the connection.** Offline, a proxy's HTML
    // error page and a 500 are all temporary, and `syncOnStartup` runs on
    // `chrome.runtime.onStartup` — the one moment a resuming laptop is most
    // likely to hit exactly those. Forgetting the token there sent the user
    // back through the consent screen to repair something that was never broken.
    if (e instanceof SyncAuthRevokedError) {
      await disconnect();
      throw new SyncAuthError(`Google sign-in expired — connect again. (${e.message})`);
    }
    if (e instanceof SyncAuthError) throw e;
    throw new SyncAuthError(`Could not reach Google to refresh the sign-in. (${(e as Error).message})`);
  }
  if (!token.access_token) throw new SyncAuthError('Google did not return an access token.');

  await write({
    ...auth,
    account: accountFromIdToken(token.id_token) ?? auth.account,
    accessToken: token.access_token,
    expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
  });
  return token.access_token;
}
