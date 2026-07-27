/**
 * One sync, end to end: storage → merge → Drive → storage, against a fake
 * Google.
 *
 * `mergeJobs` is proved correct next door in `syncJobs.test.ts`, and this file
 * deliberately does not re-prove it. What is tested here is the plumbing that
 * had none: the guards, the first-merge gate, the conflict retry, and — the one
 * that costs real money over time — *what actually gets written to the file*.
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { resetChromeMock } from '../../test/setup';
import { FakeGoogle } from '../../test/fakeGoogle';
import { SYNC_SCHEMA, type JobSnapshot } from '../shared/syncJobs';
import type { JobUrlEntry } from '../shared/types';
import { getJobUrls } from '../shared/storage';
import {
  connectAccount, disconnectAccount, setSyncClient, syncNow, syncOnStartup, syncState,
} from './sync';

const CLIENT = {
  clientId: '1234.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-secret',
};

const DAY = 24 * 60 * 60 * 1000;

let google: FakeGoogle;

function entry(url: string, over: Partial<JobUrlEntry> = {}): JobUrlEntry {
  const at = Date.now();
  return {
    id: url,
    url,
    status: 'new',
    addedAt: at,
    updatedAt: at,
    history: [{ status: 'new', at }],
    ...over,
  };
}

/** A tombstone old enough that both devices should have forgotten it. */
function ancientTombstone(url: string): JobUrlEntry {
  const at = Date.now() - 91 * DAY;
  return {
    id: url,
    url,
    status: 'deleted',
    addedAt: at,
    updatedAt: at,
    history: [{ status: 'new', at }, { status: 'deleted', at }],
  };
}

function snapshot(jobUrls: JobUrlEntry[]): JobSnapshot {
  return { schema: SYNC_SCHEMA, jobUrls, jobDetails: {} };
}

/** What the fake now holds, parsed. */
function remote(): JobSnapshot {
  return JSON.parse(google.stored!) as JobSnapshot;
}

async function localUrls(): Promise<string[]> {
  return (await getJobUrls()).map((e) => e.url);
}

/** Configured, connected, and past the first-merge prompt. */
async function ready(): Promise<void> {
  await chrome.storage.local.set({ syncClient: CLIENT, settings: { syncEnabled: true } });
  await connectAccount();
  await chrome.storage.local.set({ syncStatus: { awaitingConfirm: false } });
}

beforeEach(async () => {
  await resetChromeMock();
  google = new FakeGoogle();
  google.install();
});

afterEach(() => google.uninstall());

describe('the guards before anything is sent', () => {
  it('asks for an OAuth client first', async () => {
    const s = await syncNow(true);
    expect(s.lastError).toMatch(/OAuth client/i);
    expect(google.driveCalls).toHaveLength(0);
  });

  it('asks for an account next', async () => {
    await chrome.storage.local.set({ syncClient: CLIENT });
    const s = await syncNow(true);
    expect(s.lastError).toMatch(/Connect a Google account/i);
  });

  it('refuses while the feature is switched off', async () => {
    await chrome.storage.local.set({ syncClient: CLIENT, settings: { syncEnabled: false } });
    await connectAccount();

    const s = await syncNow(true);
    expect(s.lastError).toMatch(/turned off/i);
    expect(google.driveCalls).toHaveLength(0);
  });

  it('reports a failure without ever throwing at the caller', async () => {
    // The options page renders whatever comes back; a rejected promise there
    // would be an unhandled error rather than a message on screen.
    await expect(syncNow(true)).resolves.toMatchObject({ lastError: expect.any(String) });
  });
});

describe('the first merge', () => {
  beforeEach(async () => {
    await chrome.storage.local.set({ syncClient: CLIENT, settings: { syncEnabled: true } });
    await connectAccount();
  });

  it('stops to report both counts instead of merging', async () => {
    await chrome.storage.local.set({ jobUrls: [entry('https://a.example/1')] });
    google.seed(JSON.stringify(snapshot([entry('https://b.example/2'), entry('https://b.example/3')])));

    const s = await syncNow(false);

    expect(s.pending).toEqual({ local: 1, remote: 2 });
    // Nothing was written at either end.
    expect(await localUrls()).toEqual(['https://a.example/1']);
    expect(remote().jobUrls).toHaveLength(2);
  });

  it('merges once it is confirmed, and does not ask again', async () => {
    await chrome.storage.local.set({ jobUrls: [entry('https://a.example/1')] });
    google.seed(JSON.stringify(snapshot([entry('https://b.example/2')])));

    const s = await syncNow(true);

    expect(s.pending).toBeUndefined();
    expect(s.lastError).toBeUndefined();
    expect((await localUrls()).sort()).toEqual(['https://a.example/1', 'https://b.example/2']);
    expect((await syncNow(false)).pending).toBeUndefined();
  });
});

describe('a sync', () => {
  beforeEach(ready);

  it('creates the file on an account that has never synced', async () => {
    await chrome.storage.local.set({ jobUrls: [entry('https://a.example/1')] });

    const s = await syncNow(true);

    expect(s.lastError).toBeUndefined();
    expect(s.lastSyncAt).toBeGreaterThan(0);
    expect(remote().jobUrls.map((e) => e.url)).toEqual(['https://a.example/1']);
  });

  it('leaves both ends holding the union', async () => {
    await chrome.storage.local.set({ jobUrls: [entry('https://a.example/1')] });
    google.seed(JSON.stringify(snapshot([entry('https://b.example/2')])));

    await syncNow(true);

    const expected = ['https://a.example/1', 'https://b.example/2'];
    expect((await localUrls()).sort()).toEqual(expected);
    expect(remote().jobUrls.map((e) => e.url).sort()).toEqual(expected);
  });

  it('changes nothing when run twice', async () => {
    await chrome.storage.local.set({ jobUrls: [entry('https://a.example/1')] });
    await syncNow(true);
    const first = google.stored;

    await syncNow(true);
    expect(google.stored).toBe(first);
  });

  it('does not write a database it merely failed to understand', async () => {
    await chrome.storage.local.set({ jobUrls: [entry('https://a.example/1')] });
    google.seed('{"schema":999,"jobUrls":[]}');

    const s = await syncNow(true);

    expect(s.lastError).toMatch(/newer version/i);
    expect(remote().schema).toBe(999);
    expect(await localUrls()).toEqual(['https://a.example/1']);
  });

  it('starts over on a remote file that was left empty', async () => {
    // A zero-byte file is what an interrupted create leaves behind. Refusing it
    // for ever is a dead end with no reset anywhere in the UI — and unlike
    // unreadable *content*, there is nothing here that could be destroyed.
    await chrome.storage.local.set({ jobUrls: [entry('https://a.example/1')] });
    google.seed('   ');

    const s = await syncNow(true);

    expect(s.lastError).toBeUndefined();
    expect(remote().jobUrls.map((e) => e.url)).toEqual(['https://a.example/1']);
  });
});

describe('what gets written to the file', () => {
  beforeEach(ready);

  it('carries no tombstone that this device has already forgotten', async () => {
    // `applySnapshot` prunes what it stores locally, and the *unpruned* merge
    // used to be what went up — so the remote file grew for ever, carrying
    // deletions both devices had long since dropped, plus the captured job text
    // hanging off them.
    await chrome.storage.local.set({
      jobUrls: [entry('https://a.example/1'), ancientTombstone('https://gone.example/9')],
    });

    await syncNow(true);

    expect(await localUrls()).toEqual(['https://a.example/1']);
    expect(remote().jobUrls.map((e) => e.url)).toEqual(['https://a.example/1']);
  });

  it('keeps a tombstone that is still doing its job', async () => {
    const at = Date.now() - DAY;
    await chrome.storage.local.set({
      jobUrls: [{
        ...entry('https://recent.example/1'),
        status: 'deleted',
        updatedAt: at,
        history: [{ status: 'new', at }, { status: 'deleted', at }],
      }],
    });

    await syncNow(true);

    // The other device has not seen this deletion yet; dropping it now would
    // let the entry come straight back on the next merge.
    expect(remote().jobUrls.map((e) => e.url)).toEqual(['https://recent.example/1']);
  });

  it('is what the far side reads back verbatim', async () => {
    await chrome.storage.local.set({ jobUrls: [entry('https://a.example/1')] });
    await syncNow(true);

    expect(remote().schema).toBe(SYNC_SCHEMA);
    expect(remote()).toHaveProperty('jobDetails');
  });
});

describe('when the other device writes first', () => {
  beforeEach(ready);

  it('re-reads, re-merges and succeeds', async () => {
    await chrome.storage.local.set({ jobUrls: [entry('https://a.example/1')] });
    google.seed(JSON.stringify(snapshot([entry('https://b.example/2')])));

    // Each attempt lists twice: once to download, once to re-read the version
    // before writing. The other device lands on that second read, exactly once.
    google.beforeList = (nth) => {
      if (nth !== 2) return;
      google.files[0].content = JSON.stringify(snapshot([entry('https://c.example/3')]));
      google.files[0].version = 500;
    };

    const s = await syncNow(true);

    expect(s.lastError).toBeUndefined();
    // Nothing was lost in the collision — the late arrival is in the answer.
    expect(remote().jobUrls.map((e) => e.url).sort()).toEqual([
      'https://a.example/1', 'https://b.example/2', 'https://c.example/3',
    ]);
  });

  it('gives up rather than spinning when it never gets a turn', async () => {
    await chrome.storage.local.set({ jobUrls: [entry('https://a.example/1')] });
    google.seed(JSON.stringify(snapshot([])));

    let collisions = 0;
    google.beforeList = (nth) => {
      // Every pre-write re-read finds the version has moved again.
      if (nth % 2 !== 0) return;
      collisions++;
      google.files[0].version = 1000 + collisions;
    };

    const s = await syncNow(true);

    expect(s.lastError).toMatch(/other device wrote first/i);
    expect(collisions).toBe(3);
  });
});

describe('syncState', () => {
  it('reports a connected account whose email never arrived', async () => {
    // The options page disables *Disconnect* on this, so inferring it from the
    // display email left a real refresh token with no way to clear it.
    await chrome.storage.local.set({ syncClient: CLIENT });
    google.withIdToken = false;
    await connectAccount();

    const s = await syncState();
    expect(s.connected).toBe(true);
    expect(s.account).toBeUndefined();
  });

  it('reports not-connected before anything is authorized', async () => {
    await chrome.storage.local.set({ syncClient: CLIENT });
    expect((await syncState()).connected).toBe(false);
  });

  it('reports whether a client has been entered at all', async () => {
    expect((await syncState()).configured).toBe(false);
    await chrome.storage.local.set({ syncClient: CLIENT });
    expect((await syncState()).configured).toBe(true);
  });
});

describe('the OAuth client', () => {
  it('drops the tokens when the client id changes', async () => {
    await chrome.storage.local.set({ syncClient: CLIENT });
    await connectAccount();

    const s = await setSyncClient({
      clientId: '9999.apps.googleusercontent.com',
      clientSecret: 'GOCSPX-other',
    });

    // A refresh token belongs to the client that issued it.
    expect(s.connected).toBe(false);
  });

  it('keeps them when only the secret is re-entered', async () => {
    await chrome.storage.local.set({ syncClient: CLIENT });
    await connectAccount();

    const s = await setSyncClient({ ...CLIENT, clientSecret: 'GOCSPX-rotated' });
    expect(s.connected).toBe(true);
  });

  it('refuses something that is not a client id', async () => {
    await expect(setSyncClient({ clientId: 'nope', clientSecret: 'x' })).rejects.toThrow(/client ID/i);
  });
});

describe('disconnecting', () => {
  it('forgets the account and leaves the database alone', async () => {
    await ready();
    await chrome.storage.local.set({ jobUrls: [entry('https://a.example/1')] });
    await syncNow(true);

    const s = await disconnectAccount();

    expect(s.connected).toBe(false);
    expect(s.lastSyncAt).toBeUndefined();
    expect(await localUrls()).toEqual(['https://a.example/1']);
  });
});

describe('syncOnStartup', () => {
  it('runs the sync when everything is in place', async () => {
    await ready();
    await chrome.storage.local.set({ jobUrls: [entry('https://a.example/1')] });

    await syncOnStartup();
    expect(google.stored).toBeDefined();
  });

  it('stays quiet while the first merge is unconfirmed', async () => {
    await chrome.storage.local.set({ syncClient: CLIENT, settings: { syncEnabled: true } });
    await connectAccount();

    await syncOnStartup();
    expect(google.driveCalls).toHaveLength(0);
  });

  it('stays quiet when the feature is off, unconfigured, or not connected', async () => {
    await syncOnStartup();
    expect(google.driveCalls).toHaveLength(0);

    await chrome.storage.local.set({ syncClient: CLIENT, settings: { syncEnabled: false } });
    await connectAccount();
    await syncOnStartup();
    expect(google.driveCalls).toHaveLength(0);
  });
});
