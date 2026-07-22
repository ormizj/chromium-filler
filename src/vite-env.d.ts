/// <reference types="vite/client" />

declare module '*.css?inline' {
  const css: string;
  export default css;
}

// @types/node isn't installed and tsconfig restricts `types`; declare just the
// Node API vite.config.ts uses (typed to avoid needing the Buffer type).
declare module 'node:child_process' {
  export function execSync(command: string, options?: unknown): { toString(): string };
}
