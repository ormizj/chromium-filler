/**
 * A human-readable identifier for the exact build currently running, so you can
 * confirm Chrome loaded your latest code (content scripts don't hot-reload — the
 * page must be reloaded). The literal below is replaced at build time by the
 * `stamp-build-id` plugin in vite.config.ts with "<label> · <git-hash>" (label
 * e.g. "swift-lynx-x7", a memorable random tag that changes every build so
 * successive builds are easy to tell apart at a glance).
 * Under Vitest (no build step) it stays the sentinel, which is fine.
 */
export const BUILD_ID = '__BUILD_ID__';

/** Just the memorable label (the part before the git hash) — the bit worth spotting. */
export const BUILD_LABEL = BUILD_ID.split(' · ')[0];
