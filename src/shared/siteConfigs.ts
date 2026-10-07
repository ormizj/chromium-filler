/**
 * Site configs as they are stored, and the one translation to the shape every
 * consumer reads.
 *
 * A config is a **shell** — which site it is (`id`, `name`, `urlPatterns`,
 * `autoDetect`) — and **two fully separate setups**, one per `FormFactor`. A
 * board that sends a phone a different page needs different prep clicks and
 * different selectors there, and a desktop recording replayed on a phone clicks
 * the wrong things. So the halves never fall back to each other: a site recorded
 * on desktop reads as unconfigured on a phone until it is recorded there too.
 * Layering one over the other was the alternative, and it made every Pick and
 * every Clear on the setup panel ask which layer it meant.
 *
 * Nothing outside storage and sync sees `StoredSiteConfig`. Everything else is
 * handed the flat `SiteConfig` that `resolveSiteConfig` builds for this device,
 * which is why content/, the setup steps and the help catalog did not change.
 *
 * **Stamps.** Each half carries its own `updatedAt`, so a desktop edit and a
 * mobile edit made on two devices never overwrite each other when synced. The
 * config's own `updatedAt` is bumped by *every* write, half included: that is
 * the invariant `syncConfigs.ts` needs to stay associative across a deletion (a
 * config is live exactly while its shell outlives its tombstone, and the shell
 * is never older than either half).
 *
 * Pure: no `chrome.*`, no clock — `now` is passed in.
 */

import type {
  FormFactor, SiteConfig, SiteSetup, SiteShellKey, StoredSiteConfig,
} from './types';
import { TOMBSTONE_TTL_MS } from './jobUrls';
import { FORM_FACTORS } from './formFactor';

const SHELL_KEYS: readonly SiteShellKey[] = ['id', 'name', 'urlPatterns', 'autoDetect'];
/** Top-level keys of a stored config that are not part of the shell's content. */
const STORED_ONLY = new Set<string>(['updatedAt', 'desktop', 'mobile']);

/** Deleted config ids → when. Unioned by sync, pruned at the storage edge. */
export type ConfigTombstones = Record<string, number>;

/**
 * A stable serialization: keys sorted at every depth, `undefined` dropped. Used
 * wherever two copies are compared — a diff, or a sync tie-break — because
 * `JSON.stringify` depends on insertion order, and two devices holding equal
 * data must agree that it is equal.
 */
export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = sortKeys(v);
    }
    return out;
  }
  return value;
}

function withoutStamp<T extends { updatedAt?: number }>(x: T | undefined): Omit<T, 'updatedAt'> | undefined {
  if (!x) return undefined;
  const { updatedAt: _drop, ...rest } = x;
  return rest;
}

/** The shell's content — every top-level key that is not a half or the stamp. */
export function shellOf(s: StoredSiteConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) if (!STORED_ONLY.has(k)) out[k] = v;
  return out;
}

/** Split a flat view into the shell keys and everything else. */
function split(flat: SiteConfig): { shell: Partial<SiteConfig>; setup: SiteSetup } {
  const shell: Record<string, unknown> = {};
  const setup: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) {
    if (k === 'updatedAt') continue;
    if ((SHELL_KEYS as readonly string[]).includes(k)) shell[k] = v;
    else setup[k] = v;
  }
  return { shell: shell as Partial<SiteConfig>, setup: setup as SiteSetup };
}

/**
 * The config as this device uses it. An absent half resolves to a site nobody
 * has taught anything — `extract: {}` because consumers read it unguarded — and
 * never to the other half.
 */
export function resolveSiteConfig(s: StoredSiteConfig, ff: FormFactor): SiteConfig {
  const half = withoutStamp(s[ff]) ?? {};
  const out: SiteConfig = {
    extract: {},
    ...half,
    id: s.id,
    name: s.name,
    urlPatterns: s.urlPatterns,
  };
  if (s.autoDetect !== undefined) out.autoDetect = s.autoDetect;
  return out;
}

/**
 * Read-modify-write one half, through the flat view every writer already speaks.
 * Stamps the half (and, always with it, the config) only when something really
 * changed — a no-op write must not make this copy win a sync it has no news for.
 */
export function writeSetup(
  s: StoredSiteConfig,
  ff: FormFactor,
  fn: (c: SiteConfig) => void,
  now: number,
): StoredSiteConfig {
  const before = resolveSiteConfig(s, ff);
  const view = structuredClone(before);
  fn(view);
  const a = split(before);
  const b = split(view);
  const shellChanged = canonical(a.shell) !== canonical(b.shell);
  const setupChanged = canonical(a.setup) !== canonical(b.setup);
  if (!shellChanged && !setupChanged) return s;

  const next: StoredSiteConfig = { ...s, ...(b.shell as StoredSiteConfig), updatedAt: now };
  if (b.shell.autoDetect === undefined) delete next.autoDetect;
  if (setupChanged) next[ff] = { ...b.setup, updatedAt: now };
  return next;
}

/** A fresh stored config from a flat template, its setup in this device's half. */
export function newStoredConfig(template: SiteConfig, ff: FormFactor, now: number): StoredSiteConfig {
  const { shell, setup } = split(template);
  return { ...(shell as StoredSiteConfig), updatedAt: now, [ff]: { ...setup, updatedAt: now } };
}

function isStored(raw: object): boolean {
  return 'desktop' in raw || 'mobile' in raw;
}

/**
 * A config from before the split, moved into the half for *this* device — it
 * was recorded on this device, so this is the half it describes. Unstamped, so
 * any real edit on either device outranks the migration.
 */
export function migrateLegacy(raw: SiteConfig | StoredSiteConfig, ff: FormFactor): StoredSiteConfig {
  if (isStored(raw)) return raw as StoredSiteConfig;
  const { shell, setup } = split(raw as SiteConfig);
  const out = { ...(shell as StoredSiteConfig) };
  const stamp = (raw as { updatedAt?: number }).updatedAt;
  if (stamp !== undefined) out.updatedAt = stamp;
  if (!isEmptySetup(setup)) out[ff] = setup;
  return out;
}

/** True when a half holds nothing that changes how a site is worked. */
export function isEmptySetup(setup: SiteSetup | undefined): boolean {
  if (!setup) return true;
  return Object.entries(setup).every(([k, v]) => {
    if (k === 'updatedAt' || v === undefined) return true;
    if (Array.isArray(v)) return v.length === 0;
    if (v && typeof v === 'object') return Object.keys(v).length === 0;
    return false;
  });
}

/**
 * Stamp a whole-array edit (the Options JSON editor) the way the per-slot
 * writers stamp theirs: only what changed, judged on content with the stamps
 * ignored, so editing a stamp by hand cannot make a stale copy win a sync. A
 * removed id becomes a tombstone, or the next sync would bring it straight back.
 */
export function stampChanges(
  before: StoredSiteConfig[],
  after: StoredSiteConfig[],
  now: number,
): { configs: StoredSiteConfig[]; deleted: ConfigTombstones } {
  const old = new Map(before.map((c) => [c.id, c]));
  const configs = after.map((c) => {
    const prev = old.get(c.id);
    const next: StoredSiteConfig = { ...c };
    let touched = !prev || canonical(shellOf(prev)) !== canonical(shellOf(c));
    for (const ff of FORM_FACTORS) {
      const half = c[ff];
      if (!half) continue;
      const prevHalf = prev?.[ff];
      if (prevHalf && canonical(withoutStamp(prevHalf)) === canonical(withoutStamp(half))) {
        next[ff] = prevHalf;
      } else {
        next[ff] = { ...half, updatedAt: now };
        touched = true;
      }
    }
    if (prev && FORM_FACTORS.some((ff) => prev[ff] && !c[ff])) touched = true;
    if (touched) next.updatedAt = now;
    else if (prev?.updatedAt === undefined) delete next.updatedAt;
    else next.updatedAt = prev.updatedAt;
    return next;
  });
  const kept = new Set(after.map((c) => c.id));
  const deleted: ConfigTombstones = {};
  for (const c of before) if (!kept.has(c.id)) deleted[c.id] = now;
  return { configs, deleted };
}

/** Tombstones only have to outlive the other device's next sync. */
export function pruneConfigTombstones(
  deleted: ConfigTombstones,
  now: number,
  maxAgeMs: number = TOMBSTONE_TTL_MS,
): ConfigTombstones {
  const out: ConfigTombstones = {};
  for (const [id, at] of Object.entries(deleted)) if (now - at < maxAgeMs) out[id] = at;
  return out;
}
