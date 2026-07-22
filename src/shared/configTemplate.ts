/**
 * Builds a minimal, ready-to-tweak SiteConfig for a URL. Shared by the Options
 * page ("add template") and the content-script Setup panel so both produce the
 * same starting point. The user refines it visually (picker) or in JSON.
 */

import type { SiteConfig } from './types';

export function configTemplate(url?: string): SiteConfig {
  let host = 'example.com';
  try {
    if (url) host = new URL(url).host || host;
  } catch {
    /* keep fallback host */
  }
  const slug = host.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return {
    id: slug || `site-${Date.now()}`,
    name: host,
    urlPatterns: [`*://${host}/*`],
    waitFor: 'form',
    waitTimeoutMs: 15000,
    prep: [],
    extract: {},
    fieldOverrides: {},
    autoDetect: true,
  };
}
