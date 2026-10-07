/**
 * Merging two copies of the site configs — the config half of sync, pure, and
 * held to the same three properties as `mergeJobs`: **commutative, associative,
 * idempotent**. The tests assert all three directly.
 *
 * Every rule is a join:
 *
 * - A config is three parts — the shell and the two halves — and each part is
 *   **last-writer-wins on its own stamp**. That is what makes separate desktop
 *   and mobile setups sync well: the two are edited on different devices, and
 *   neither ever overwrites the other.
 * - Ties at the same instant are broken on `canonical()` content, never on which
 *   argument came first.
 * - Deletion is a tombstone (`id → at`), unioned by taking the latest. A part
 *   no newer than the tombstone is dropped, so a config re-created after a delete
 *   comes back *without* the halves from before it. A config is live exactly
 *   while its shell survives — and since every write bumps the shell
 *   (`siteConfigs.ts`), the shell is never older than either half, which is what
 *   keeps dropping a whole config associative.
 *
 * Output is sorted by id. List order matters locally (`findMatchingConfig` takes
 * the first match), so the storage edge puts it back; see syncSnapshot.ts.
 */

import type { FormFactor, SiteSetup, StoredSiteConfig } from './types';
import { canonical, shellOf, type ConfigTombstones } from './siteConfigs';
import { FORM_FACTORS } from './formFactor';

export interface ConfigSet {
  siteConfigs: StoredSiteConfig[];
  deletedSiteConfigs: ConfigTombstones;
}

const stamp = (x: { updatedAt?: number } | undefined): number => x?.updatedAt ?? 0;

/** [winner, loser] — newest, then the lower canonical form. Symmetric. */
function order<T extends { updatedAt?: number }>(x: T, y: T, content: (v: T) => unknown): [T, T] {
  if (stamp(x) !== stamp(y)) return stamp(x) > stamp(y) ? [x, y] : [y, x];
  return canonical(content(x)) <= canonical(content(y)) ? [x, y] : [y, x];
}

function mergeHalf(x: SiteSetup | undefined, y: SiteSetup | undefined): SiteSetup | undefined {
  if (!x || !y) return x ?? y;
  return order(x, y, (v) => v)[0];
}

function mergeConfig(x: StoredSiteConfig, y: StoredSiteConfig): StoredSiteConfig {
  const [win, lose] = order(x, y, shellOf);
  const out: StoredSiteConfig = { ...shellOf(lose), ...shellOf(win) } as unknown as StoredSiteConfig;
  if (win.updatedAt !== undefined) out.updatedAt = win.updatedAt;
  for (const ff of FORM_FACTORS) {
    const half = mergeHalf(x[ff], y[ff]);
    if (half) out[ff] = half;
  }
  return out;
}

/** Drop every part no newer than the tombstone; `undefined` once the shell goes. */
function survive(c: StoredSiteConfig, tomb: number | undefined): StoredSiteConfig | undefined {
  if (tomb === undefined) return c;
  if (stamp(c) <= tomb) return undefined;
  const out = { ...c };
  for (const ff of FORM_FACTORS as FormFactor[]) if (out[ff] && stamp(out[ff]) <= tomb) delete out[ff];
  return out;
}

export function mergeSiteConfigs(a: ConfigSet, b: ConfigSet): ConfigSet {
  const deleted: ConfigTombstones = { ...a.deletedSiteConfigs };
  for (const [id, at] of Object.entries(b.deletedSiteConfigs)) {
    deleted[id] = Math.max(deleted[id] ?? at, at);
  }

  const byId = new Map<string, StoredSiteConfig>();
  for (const c of [...a.siteConfigs, ...b.siteConfigs]) {
    const prev = byId.get(c.id);
    byId.set(c.id, prev ? mergeConfig(prev, c) : c);
  }

  const siteConfigs: StoredSiteConfig[] = [];
  for (const c of byId.values()) {
    const live = survive(c, deleted[c.id]);
    if (live) siteConfigs.push(live);
  }
  siteConfigs.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return { siteConfigs, deletedSiteConfigs: deleted };
}
