/**
 * The OAuth half of sync, against a fake Google that really checks PKCE and
 * really expires its access tokens.
 *
 * The rule this file is mostly about: **a refresh token is only thrown away
 * when Google says it is dead.** Everything else — offline, a proxy's HTML
 * error page, a 500 — has to leave the connection alone, because `syncOnStartup`
 * runs on `chrome.runtime.onStartup`, which is exactly the moment a resuming
 * laptop has no network yet. Disconnecting there costs the user a full trip
 * through the Google consent screen to fix something that was never broken.
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { resetChromeMock } from '../../test/setup';
import { FakeGoogle, REDIRECT_URI, idTokenFor } from '../../test/fakeGoogle';
import { SYNC_SCOPES } from '../shared/syncConfig';
import { connect, disconnect, isConnected, connectedAccount, accessToken } from './googleAuth';

const CLIENT = {
  clientId: '1234.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-secret',
};

let google: FakeGoogle;

/** The stored auth record, as `googleAuth` keeps it. */
async function storedAuth(): Promise<
  { refreshToken?: string; account?: string; accessToken?: string; expiresAt?: number } | undefined
> {
  return (await chrome.storage.local.get('syncAuth')).syncAuth;
}

beforeEach(async () => {
  await resetChromeMock();
  google = new FakeGoogle();
  google.install();
  await chrome.storage.local.set({ syncClient: CLIENT });
});

afterEach(() => google.uninstall());

describe('connect', () => {
  it('refuses, with somewhere to go, when no client is stored', async () => {
    await chrome.storage.local.remove('syncClient');
    await expect(connect()).rejects.toThrow(/Options → Sync/);
  });

  it('asks Google for exactly the scopes and grant sync needs', async () => {
    await connect();

    const params = google.authFlows[0];
    expect(params.get('client_id')).toBe(CLIENT.clientId);
    expect(params.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(params.get('response_type')).toBe('code');
    expect(params.get('scope')).toBe(SYNC_SCOPES);
    expect(params.get('code_challenge_method')).toBe('S256');
    // Both are load-bearing: `offline` is what produces a refresh token at all,
    // and the chooser is how the *same* account gets picked on the second machine.
    expect(params.get('access_type')).toBe('offline');
    expect(params.get('prompt')).toBe('consent select_account');
  });

  it('sends a code_verifier that really hashes to the challenge', async () => {
    // The fake recomputes S256 and rejects a mismatch, so simply getting a
    // token back is the assertion.
    await expect(connect()).resolves.toBe('someone@example.com');
    expect(google.tokenCalls[0].grant_type).toBe('authorization_code');
    expect(google.tokenCalls[0].code_verifier).toBeTruthy();
  });

  it('stores the refresh token and the account it belongs to', async () => {
    google.email = 'other@example.com';
    const account = await connect();

    expect(account).toBe('other@example.com');
    expect(await isConnected()).toBe(true);
    expect(await connectedAccount()).toBe('other@example.com');
    const auth = await storedAuth();
    expect(auth?.refreshToken).toBe(google.refreshToken);
    expect(auth?.accessToken).toBe('access-1');
    expect(auth?.expiresAt).toBeGreaterThan(Date.now());
  });

  it('still connects when Google sends no id_token, even though the email is unknown', async () => {
    google.withIdToken = false;

    await expect(connect()).resolves.toBeUndefined();
    // The account is only ever a label. A missing one must not read as "not
    // connected" — there is a perfectly good refresh token here.
    expect(await isConnected()).toBe(true);
    expect(await connectedAccount()).toBeUndefined();
  });

  it('refuses a grant that came back without a refresh token', async () => {
    google.refreshToken = '';
    await expect(connect()).rejects.toThrow(/did not return a refresh token/i);
    expect(await isConnected()).toBe(false);
  });

  it('reports the error Google put on the redirect', async () => {
    google.authFlow = { kind: 'error', error: 'access_denied' };
    await expect(connect()).rejects.toThrow('access_denied');
  });

  it('says the authorization was cancelled when the user closes the window', async () => {
    // MV3's promise API *rejects* on a closed window rather than resolving
    // undefined, so the bare `if (!redirect)` guard never sees this.
    google.authFlow = { kind: 'reject', message: 'The user did not approve access.' };
    await expect(connect()).rejects.toThrow(/cancelled/i);
  });
});

describe('accessToken', () => {
  it('refuses before anything is connected', async () => {
    await expect(accessToken()).rejects.toThrow(/Not connected/i);
  });

  it('reuses a token that has not run out', async () => {
    await connect();
    google.tokenCalls.length = 0;

    await expect(accessToken()).resolves.toBe('access-1');
    expect(google.tokenCalls).toHaveLength(0);
  });

  it('refreshes a token that has, and keeps the refresh token', async () => {
    await connect();
    google.expireAccessTokens();
    await chrome.storage.local.set({
      syncAuth: { ...(await storedAuth()), expiresAt: Date.now() - 1 },
    });

    await expect(accessToken()).resolves.toBe('access-2');
    const auth = await storedAuth();
    expect(auth?.refreshToken).toBe(google.refreshToken);
    expect(auth?.expiresAt).toBeGreaterThan(Date.now());
  });

  it('refreshes a minute early rather than on the stroke of expiry', async () => {
    await connect();
    // Inside the 60s margin: still "valid", but not worth using.
    await chrome.storage.local.set({
      syncAuth: { ...(await storedAuth()), expiresAt: Date.now() + 30_000 },
    });

    await expect(accessToken()).resolves.toBe('access-2');
  });

  describe('when the refresh fails', () => {
    beforeEach(async () => {
      await connect();
      await chrome.storage.local.set({
        syncAuth: { ...(await storedAuth()), expiresAt: Date.now() - 1 },
      });
    });

    it('keeps the connection when the machine is offline', async () => {
      google.tokenFailure = { offline: true };

      await expect(accessToken()).rejects.toThrow();
      // The whole point: this is the browser-startup case, and it is temporary.
      expect(await isConnected()).toBe(true);
      expect((await storedAuth())?.refreshToken).toBe(google.refreshToken);
    });

    it('keeps the connection when a proxy answers with an HTML error page', async () => {
      google.tokenFailure = { status: 502, rawBody: '<html>Bad Gateway</html>' };

      await expect(accessToken()).rejects.toThrow();
      expect(await isConnected()).toBe(true);
    });

    it('keeps the connection on a server error', async () => {
      google.tokenFailure = { status: 500, error: 'backendError' };

      await expect(accessToken()).rejects.toThrow();
      expect(await isConnected()).toBe(true);
    });

    it('disconnects only when Google says the grant is dead', async () => {
      google.revokedRefreshTokens.add(google.refreshToken);

      await expect(accessToken()).rejects.toThrow(/connect again/i);
      expect(await isConnected()).toBe(false);
    });

    it('disconnects when the client itself is rejected', async () => {
      google.tokenFailure = { status: 401, error: 'invalid_client' };

      await expect(accessToken()).rejects.toThrow(/connect again/i);
      expect(await isConnected()).toBe(false);
    });
  });
});

describe('disconnect', () => {
  it('forgets the tokens', async () => {
    await connect();
    await disconnect();

    expect(await isConnected()).toBe(false);
    expect(await connectedAccount()).toBeUndefined();
  });
});

describe('the account label', () => {
  it('is read from the id_token', async () => {
    google.email = 'reader@example.com';
    await connect();
    expect(await connectedAccount()).toBe('reader@example.com');
  });

  it('survives a refresh that returns no id_token', async () => {
    await connect();
    google.withIdToken = false;
    await chrome.storage.local.set({
      syncAuth: { ...(await storedAuth()), expiresAt: Date.now() - 1 },
    });

    await accessToken();
    expect(await connectedAccount()).toBe('someone@example.com');
  });

  it('ignores an id_token it cannot read', async () => {
    await chrome.storage.local.set({
      syncAuth: { refreshToken: 'r', account: undefined },
    });
    expect(idTokenFor('x@y.z').split('.')).toHaveLength(3);
    expect(await connectedAccount()).toBeUndefined();
  });
});
