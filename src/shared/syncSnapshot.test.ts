import { describe, it, expect } from 'vitest';
import { parseSnapshot, snapshotFilename, UnsupportedSnapshotError } from './syncSnapshot';
import { SYNC_SCHEMA, emptySnapshot } from './syncJobs';

describe('parseSnapshot', () => {
  it('accepts a snapshot this build wrote', () => {
    const parsed = parseSnapshot(JSON.stringify(emptySnapshot()));
    expect(parsed.schema).toBe(SYNC_SCHEMA);
    expect(parsed.jobUrls).toEqual([]);
  });

  it('refuses a newer schema, and says to update this device', () => {
    const future = JSON.stringify({ schema: SYNC_SCHEMA + 1, jobUrls: [], jobDetails: {} });
    expect(() => parseSnapshot(future)).toThrow(UnsupportedSnapshotError);
    expect(() => parseSnapshot(future)).toThrow(/newer version/i);
  });

  it('refuses a file that is not a snapshot at all', () => {
    expect(() => parseSnapshot('[]')).toThrow(UnsupportedSnapshotError);
    expect(() => parseSnapshot('not json')).toThrow(UnsupportedSnapshotError);
    // The human-facing export, which is a different shape on purpose.
    expect(() => parseSnapshot('[{"url":"a://1","status":"applied"}]')).toThrow();
  });
});

describe('snapshotFilename', () => {
  it('is dated, so successive backups do not overwrite each other', () => {
    expect(snapshotFilename(new Date('2026-07-26T12:00:00Z'))).toBe('job-database-2026-07-26.json');
  });
});
