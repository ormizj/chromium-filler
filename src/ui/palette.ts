/**
 * The design palette as plain literals, for the two places that draw on the
 * HOST page rather than inside a shadow root: the field highlight (`fill.ts`) and
 * the click-to-pick toolbar (`picker.ts`). Those marks live in the page's own
 * light DOM, which never sees `tokens.css`, so they cannot read a `var(--…)` —
 * this is the one legitimate copy of the token values.
 *
 * Because it is a copy, `designSystem.test.ts` parses `tokens.css` and asserts
 * every value here still equals the token it mirrors, in both schemes. That is
 * what keeps the duplicate honest; nothing else may hardcode a colour.
 *
 * The keys mirror token names: `ink`/`onInk` are `--fg`/`--bg` (the toolbar is a
 * deliberately inverted chip, exactly like the options toast), `neutral` is
 * `--border-strong`, `onStatus` is `--on-status`.
 */

export interface Palette {
  accent: string;
  ok: string;
  warn: string;
  err: string;
  ink: string;
  onInk: string;
  neutral: string;
  onStatus: string;
}

export const LIGHT_PALETTE: Palette = {
  accent: '#c46a3f',
  ok: '#3f9d6b',
  warn: '#c99a2e',
  err: '#c85a4e',
  ink: '#2c2a26',
  onInk: '#fffdfa',
  neutral: '#ded6c9',
  onStatus: '#ffffff',
};

export const DARK_PALETTE: Palette = {
  accent: '#e08a54',
  ok: '#5fc48c',
  warn: '#e0b356',
  err: '#e07a6c',
  ink: '#f3efe8',
  onInk: '#221e1a',
  neutral: '#453f37',
  onStatus: '#ffffff',
};

/** The token name each palette key mirrors — the parity test reads this. */
export const PALETTE_TOKENS: Record<keyof Palette, string> = {
  accent: '--accent',
  ok: '--ok',
  warn: '--warn',
  err: '--err',
  ink: '--fg',
  onInk: '--bg',
  neutral: '--border-strong',
  onStatus: '--on-status',
};

/** The scheme the host page is rendering in — the marks follow the OS like every surface. */
export function currentPalette(): Palette {
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  return dark ? DARK_PALETTE : LIGHT_PALETTE;
}

/** A #rrggbb with an alpha, for the translucent picker fill. */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
