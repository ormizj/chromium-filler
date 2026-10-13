/**
 * The storage edge of sync: turning `chrome.storage.local` into a `Snapshot` and
 * back. All the difficulty is next door in syncState.ts and syncUnits.ts — this
 * file only reads, writes, prunes and validates.
 *
 * It reads the keys directly rather than through `getState()`, which leaves out
 * the documents and the stamps, so it is not a sufficient source for anything
 * that has to be complete.
 */

import { DEFAULT_PROFILE, DEFAULT_SETTINGS } from './defaults';
import { DOC_KEYS } from './cvStore';
import { STAMP_KEYS, normalizeProfile, saveJobUrls } from './storage';
import { normalizeEntry, pruneTombstones, TOMBSTONE_TTL_MS } from './jobUrls';
import {
  SYNC_SCHEMA, isSupportedSnapshot, mergeSnapshots, upgradeSnapshot, type Snapshot,
} from './syncState';
import {
  fromUnits, toUnits, unitDomain, type DeviceState, type Stamps, type UnitMap,
} from './syncUnits';
import type { DocKind, JobUrlEntry, Lesson, Settings, StoredDoc } from './types';

const DOC_KINDS = Object.keys(DOC_KEYS) as DocKind[];
const STAMP_DOMAINS = Object.keys(STAMP_KEYS) as Array<keyof typeof STAMP_KEYS>;

/** Which stamp map a unit's stamp is kept in. */
function stampDomainOf(key: string): keyof typeof STAMP_KEYS | undefined {
  switch (unitDomain(key)) {
    case 'profile':
    case 'wordings':
    case 'customFields':
      return 'profile';
    case 'lessons':
      return 'lessons';
    case 'settings':
      return 'settings';
    case 'resume':
    case 'coverLetter':
      return 'docs';
    default:
      return undefined;
  }
}

interface Local {
  jobUrls: JobUrlEntry[];
  device: DeviceState;
  stamps: Stamps;
}

async function readLocal(): Promise<Local> {
  const raw = await chrome.storage.local.get([
    'jobUrls', 'profile', 'lessons', 'settings',
    ...DOC_KINDS.map((k) => DOC_KEYS[k]),
    ...STAMP_DOMAINS.map((d) => STAMP_KEYS[d]),
  ]);
  const docs: DeviceState['docs'] = {};
  for (const kind of DOC_KINDS) {
    const doc = raw[DOC_KEYS[kind]] as StoredDoc | undefined;
    if (doc) docs[kind] = doc;
  }
  const stamps: Stamps = {};
  for (const d of STAMP_DOMAINS) Object.assign(stamps, raw[STAMP_KEYS[d]] as Stamps | undefined);
  return {
    jobUrls: ((raw.jobUrls as JobUrlEntry[] | undefined) ?? []).map(normalizeEntry),
    device: {
      profile: normalizeProfile(raw.profile ?? DEFAULT_PROFILE),
      lessons: (raw.lessons as Lesson[] | undefined) ?? [],
      settings: { ...DEFAULT_SETTINGS, ...((raw.settings as Settings | undefined) ?? {}) },
      docs,
    },
    stamps,
  };
}

/** What this device currently holds — everything that syncs. */
export async function buildSnapshot(): Promise<Snapshot> {
  const local = await readLocal();
  return { schema: SYNC_SCHEMA, jobUrls: local.jobUrls, state: toUnits(local.device, local.stamps) };
}

/**
 * Forget removals old enough that every device has seen them. A tombstone only
 * has to outlive the other device's next sync — the same rule, and the same
 * horizon, as the job list's.
 */
export function pruneUnits(units: UnitMap, now: number, maxAgeMs: number = TOMBSTONE_TTL_MS): UnitMap {
  const out: UnitMap = {};
  for (const [key, unit] of Object.entries(units)) {
    if (unit.value === null && now - unit.at >= maxAgeMs) continue;
    out[key] = unit;
  }
  return out;
}

/**
 * Replace this device's copy with a merged one.
 *
 * Pruning happens here rather than in the merge because it depends on `now`, and
 * a merge whose result changed with the clock could not be idempotent.
 *
 * Written raw, not through the stamping wrappers in storage.ts: these values
 * arrive *with* their stamps, and re-stamping them would date every synced value
 * to this moment. What the settings do not carry — the local ones — is kept.
 */
export async function applySnapshot(snapshot: Snapshot, now: number = Date.now()): Promise<Snapshot> {
  const jobUrls = pruneTombstones(snapshot.jobUrls, now);
  const state = pruneUnits(snapshot.state, now);
  const local = await readLocal();
  const { state: device, stamps } = fromUnits(state, local.device);

  const byDomain: Record<keyof typeof STAMP_KEYS, Stamps> = { profile: {}, lessons: {}, settings: {}, docs: {} };
  for (const [key, at] of Object.entries(stamps)) {
    const domain = stampDomainOf(key);
    if (domain) byDomain[domain][key] = at;
  }

  await saveJobUrls(jobUrls);
  await chrome.storage.local.set({
    profile: device.profile,
    lessons: device.lessons,
    settings: device.settings,
    ...Object.fromEntries(STAMP_DOMAINS.map((d) => [STAMP_KEYS[d], byDomain[d]])),
    ...Object.fromEntries(DOC_KINDS.filter((k) => device.docs[k]).map((k) => [DOC_KEYS[k], device.docs[k]])),
  });
  const gone = DOC_KINDS.filter((k) => !device.docs[k]).map((k) => DOC_KEYS[k]);
  if (gone.length) await chrome.storage.local.remove(gone);

  // Returned, not just stored: the far side wants the same answer this device
  // just settled on. Writing the *unpruned* merge back instead meant the remote
  // file never shed a tombstone. `state` is the merged map rather than one rebuilt
  // from storage, so a unit only a newer peer understands still goes back up.
  return { schema: SYNC_SCHEMA, jobUrls, state };
}

/**
 * Fold an incoming snapshot into this device and return the result — which is
 * also what should be written back to the far side, since the merge is
 * symmetric and both ends want the same answer.
 */
export async function mergeIntoLocal(incoming: Snapshot): Promise<Snapshot> {
  return applySnapshot(mergeSnapshots(await buildSnapshot(), incoming));
}

/** How much a snapshot holds, in the words the first-merge question uses. */
export interface SnapshotSummary {
  postings: number;
  fields: number;
  lessons: number;
}

export function summarize(s: Snapshot): SnapshotSummary {
  const live = Object.entries(s.state).filter(([, u]) => u.value !== null).map(([k]) => unitDomain(k));
  return {
    postings: s.jobUrls.filter((e) => e.status !== 'deleted').length,
    fields: live.filter((d) => d === 'profile' || d === 'customFields').length,
    lessons: live.filter((d) => d === 'lessons').length,
  };
}

export class UnsupportedSnapshotError extends Error {
  constructor(readonly schema: unknown) {
    super(
      typeof schema === 'number' && schema > SYNC_SCHEMA
        ? 'This backup was written by a newer version. Update this device first.'
        : 'That file is not a backup from this extension.',
    );
    this.name = 'UnsupportedSnapshotError';
  }
}

/**
 * Parse a snapshot, refusing anything this build cannot interpret.
 *
 * Refusing is the safe failure: merging is all-or-nothing, so a version it does
 * not understand leaves both the local state and the remote file exactly as they
 * were. An out-of-date device can be blocked; it must never corrupt.
 */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new UnsupportedSnapshotError(undefined);
  }
  if (!isSupportedSnapshot(raw)) {
    throw new UnsupportedSnapshotError((raw as { schema?: unknown })?.schema);
  }
  return upgradeSnapshot(raw);
}

export function snapshotFilename(now: Date): string {
  return `job-filler-backup-${now.toISOString().slice(0, 10)}.json`;
}
