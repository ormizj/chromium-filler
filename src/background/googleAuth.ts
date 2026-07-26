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
  SYNC_CLIENT_ID, SYNC_CLIENT_SECRET, SYNC_SCOPES, isSyncConfigured,
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

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const data = (await res.json()) as TokenResponse;
  if (!res.ok || data.error) {
    throw new SyncAuthError(data.error_description ?? data.error ?? `Token request failed (${res.status})`);
  }
  return data;
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
  if (!isSyncConfigured()) {
    throw new SyncAuthError('Sync is not configured in this build — see src/shared/syncConfig.ts.');
  }
  const verifier = randomVerifier();
  const redirectUri = chrome.identity.getRedirectURL();
  const url = `${AUTH_ENDPOINT}?${new URLSearchParams({
    client_id: SYNC_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SYNC_SCOPES,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent select_account',
  })}`;

  const redirect = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  if (!redirect) throw new SyncAuthError('Authorization was cancelled.');

  const returned = new URL(redirect).searchParams;
  const error = returned.get('error');
  if (error) throw new SyncAuthError(error);
  const code = returned.get('code');
  if (!code) throw new SyncAuthError('Google did not return an authorization code.');

  const token = await postToken({
    client_id: SYNC_CLIENT_ID,
    client_secret: SYNC_CLIENT_SECRET,
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

/** A usable access token, refreshed if the cached one has run out. */
export async function accessToken(): Promise<string> {
  const auth = await read();
  if (!auth?.refreshToken) throw new SyncAuthError('Not connected to a Google account yet.');
  if (auth.accessToken && auth.expiresAt && auth.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
    return auth.accessToken;
  }

  let token: TokenResponse;
  try {
    token = await postToken({
      client_id: SYNC_CLIENT_ID,
      client_secret: SYNC_CLIENT_SECRET,
      refresh_token: auth.refreshToken,
      grant_type: 'refresh_token',
    });
  } catch (e) {
    // A refresh token dies when consent is revoked — and, if the consent screen
    // was left in Testing, after seven days. Neither is recoverable here, and
    // saying so beats retrying a token that will never work again.
    await disconnect();
    throw new SyncAuthError(`Google sign-in expired — connect again. (${(e as Error).message})`);
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
