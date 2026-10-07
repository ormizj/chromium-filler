// Types for the pure half of scripts/version.mjs, so its test typechecks.
export function parseVersion(s: string): number[];
export function compareVersions(a: string, b: string): number;
export function readManifestVersion(src: string): string;
export function replaceManifestVersion(src: string, version: string): string;
export function replaceListingVersion(md: string, from: string, to: string): string;
