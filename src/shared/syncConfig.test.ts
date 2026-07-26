import { describe, it, expect, beforeEach } from 'vitest';
import { resetChromeMock } from '../../test/setup';
import {
  clientProblem, isSyncConfigured, normalizeClient, readSyncClient, saveSyncClient,
} from './syncConfig';

describe('normalizeClient', () => {
  it('reads a missing or partial client as empty rather than undefined', () => {
    expect(normalizeClient(undefined)).toEqual({ clientId: '', clientSecret: '' });
    expect(normalizeClient({ clientId: 'a.apps.googleusercontent.com' }).clientSecret).toBe('');
  });

  // Both values are pasted out of the Google Cloud console, which wraps them in
  // the page and hands over a trailing newline as often as not.
  it('strips the whitespace a paste brings with it', () => {
    expect(normalizeClient({
      clientId: '  123-abc.apps.googleusercontent.com\n',
      clientSecret: 'GOCSPX-secret ',
    })).toEqual({ clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-secret' });
  });

  it('strips a line break inside a wrapped value', () => {
    expect(normalizeClient({ clientId: '123-abc\n.apps.googleusercontent.com' }).clientId)
      .toBe('123-abc.apps.googleusercontent.com');
  });
});

describe('clientProblem', () => {
  const good = { clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-s' };

  it('accepts a complete client', () => {
    expect(clientProblem(good)).toBeUndefined();
  });

  it('asks for the id first', () => {
    expect(clientProblem({ clientId: '', clientSecret: 'GOCSPX-s' })).toMatch(/client id/i);
  });

  /**
   * The plausible mistake is pasting the project number, or the API key that
   * sits next to it on the same console page — both of which look like
   * credentials and neither of which Google will accept here.
   */
  it('rejects something that is not a Google client id', () => {
    expect(clientProblem({ clientId: '123456789', clientSecret: 'GOCSPX-s' }))
      .toMatch(/apps\.googleusercontent\.com/);
  });

  it('asks for the secret, which this grant requires', () => {
    expect(clientProblem({ ...good, clientSecret: '' })).toMatch(/secret/i);
  });
});

describe('the stored client', () => {
  beforeEach(async () => {
    await resetChromeMock();
  });

  it('is empty, and not configured, until one is saved', async () => {
    expect(await readSyncClient()).toEqual({ clientId: '', clientSecret: '' });
    expect(await isSyncConfigured()).toBe(false);
  });

  it('round-trips normalized', async () => {
    await saveSyncClient({ clientId: ' 1.apps.googleusercontent.com ', clientSecret: ' s ' });
    expect(await readSyncClient()).toEqual({
      clientId: '1.apps.googleusercontent.com',
      clientSecret: 's',
    });
    expect(await isSyncConfigured()).toBe(true);
  });

  // "Configured" is the client id alone: the secret is only needed once the
  // token exchange runs, and a half-entered client should still report that
  // something is set up rather than silently reading as a fresh install.
  it('forgets the client when both fields are cleared', async () => {
    await saveSyncClient({ clientId: '1.apps.googleusercontent.com', clientSecret: 's' });
    await saveSyncClient({ clientId: '', clientSecret: '' });
    expect(await isSyncConfigured()).toBe(false);
    expect(await readSyncClient()).toEqual({ clientId: '', clientSecret: '' });
  });
});
