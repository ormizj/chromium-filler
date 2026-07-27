/**
 * The Drive client, against a fake app folder whose `version` really moves.
 *
 * Two things here are worth more than the rest: an upload must lose to a writer
 * that got there first (that is the whole compare-and-swap), and it must *not*
 * lose to a precondition the client invented for itself.
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { resetChromeMock } from '../../test/setup';
import { FakeGoogle } from '../../test/fakeGoogle';
import { connect } from './googleAuth';
import { RemoteConflictError, download, upload } from './drive';

let google: FakeGoogle;

beforeEach(async () => {
  await resetChromeMock();
  google = new FakeGoogle();
  google.install();
  await chrome.storage.local.set({
    syncClient: { clientId: '1234.apps.googleusercontent.com', clientSecret: 'GOCSPX-x' },
  });
  await connect();
});

afterEach(() => google.uninstall());

describe('download', () => {
  it('reports an account that has never synced as empty, not as an error', async () => {
    // No 404 to handle: the list simply comes back with nothing in it.
    await expect(download()).resolves.toEqual({});
  });

  it('returns the file, its id and the version to write against', async () => {
    const seeded = google.seed('{"schema":1}');

    const doc = await download();
    expect(doc.text).toBe('{"schema":1}');
    expect(doc.file?.id).toBe(seeded.id);
    expect(doc.file?.version).toBe(String(seeded.version));
  });

  it('looks only in the app folder, and only for jobs.json', async () => {
    google.seed('{"schema":1}');
    await download();

    const list = google.driveCalls.find((c) => c.url.includes('/drive/v3/files?'))!;
    const params = new URL(list.url).searchParams;
    expect(params.get('spaces')).toBe('appDataFolder');
    expect(params.get('q')).toContain("name = 'jobs.json'");
    expect(params.get('q')).toContain('trashed = false');
  });

  it('surfaces a refusal rather than returning empty', async () => {
    google.seed('{}');
    google.revokedRefreshTokens.add(google.refreshToken);
    google.expireAccessTokens();

    await expect(download()).rejects.toThrow(/connect again/i);
  });
});

describe('upload', () => {
  it('creates the file in the app folder on the first ever sync', async () => {
    const file = await upload('{"schema":1,"jobUrls":[]}');

    expect(google.files).toHaveLength(1);
    expect(google.files[0].name).toBe('jobs.json');
    expect(google.files[0].parents).toEqual(['appDataFolder']);
    expect(google.stored).toBe('{"schema":1,"jobUrls":[]}');
    expect(file.id).toBe(google.files[0].id);
  });

  it('refuses to create a second copy when the other device got there first', async () => {
    // Both machines connect the same account and sync together; this one lost.
    // Creating anyway would leave two `jobs.json` in the folder, and `locate`
    // would then return an arbitrary one per device — a split brain that
    // nothing downstream can see.
    google.seed('{"schema":1}');

    await expect(upload('{"schema":1}')).rejects.toBeInstanceOf(RemoteConflictError);
    expect(google.files).toHaveLength(1);
  });

  it('writes over the version it was handed', async () => {
    google.seed('{"old":true}');
    const doc = await download();

    await upload('{"new":true}', doc.file);
    expect(google.stored).toBe('{"new":true}');
  });

  it('does not fail a precondition of its own invention', async () => {
    // Regression: the file's write token is `version`, re-read immediately
    // before the PATCH. An `If-Match` built from the *list* response's ETag
    // describes the query, not the file, so honouring it would 412 every write
    // on a single device — "The other device wrote first", for ever, alone.
    google.seed('{"old":true}');
    const doc = await download();

    await expect(upload('{"new":true}', doc.file)).resolves.toBeDefined();
    await expect(upload('{"newer":true}', await download().then((d) => d.file)))
      .resolves.toBeDefined();
    expect(google.stored).toBe('{"newer":true}');
  });

  it('loses to the device that wrote first, rather than erasing it', async () => {
    google.seed('{"old":true}');
    const doc = await download();

    // The other machine writes while this one is merging — the race the
    // compare-and-swap exists for. Without it this upload would land on top and
    // their work would be gone with no trace.
    google.files[0].content = '{"theirs":true}';
    google.files[0].version = 99;

    await expect(upload('{"ours":true}', doc.file)).rejects.toBeInstanceOf(RemoteConflictError);
    expect(google.stored).toBe('{"theirs":true}');
  });

  it('treats a file that has gone as a conflict rather than a crash', async () => {
    google.seed('{"old":true}');
    const doc = await download();
    google.files.length = 0;

    await expect(upload('{"ours":true}', doc.file)).rejects.toBeInstanceOf(RemoteConflictError);
  });
});

describe('when the app folder somehow holds two copies', () => {
  it('picks the same one every device would', async () => {
    // Two machines that first synced simultaneously can each have created one.
    // An arbitrary pick per device is the bad case: both sync happily, for ever,
    // against different files.
    const second = google.seed('{"second":true}');
    const first = google.seed('{"first":true}');
    // Whichever order the listing happens to come back in.
    google.files = [second, first].sort((a, b) => b.id.localeCompare(a.id));

    const chosen = await download();
    const again = await download();

    expect(chosen.file?.id).toBe(again.file?.id);
    expect(chosen.file?.id).toBe(
      [second.id, first.id].sort((a, b) => a.localeCompare(b))[0],
    );
  });
});

describe('a stale access token', () => {
  it('is refreshed and the request retried, not replayed until it expires', async () => {
    // `accessToken()` trusts `expiresAt` on the local clock alone, so a skewed
    // clock or a token Google retired early stays "valid" here for up to an
    // hour. Drive is the only thing that knows better, and it says 401.
    google.seed('{"schema":1}');
    google.expireAccessTokens();

    await expect(download()).resolves.toMatchObject({ text: '{"schema":1}' });
    expect(google.tokenCalls.some((c) => c.grant_type === 'refresh_token')).toBe(true);
  });

  it('gives up when a fresh token is refused too', async () => {
    google.seed('{"schema":1}');
    google.expireAccessTokens();
    google.revokedRefreshTokens.add(google.refreshToken);

    await expect(download()).rejects.toThrow();
  });
});
