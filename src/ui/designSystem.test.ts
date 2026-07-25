/**
 * The design-system guardrail. The reskin is only "a recolour with zero
 * inconsistencies, now and in the future" if the future is enforced — so this
 * test fails the build the moment a surface invents a colour, references a token
 * that does not exist, defines a second primary-button fill, or lets the
 * host-page palette copy drift from the tokens it mirrors.
 *
 * It reads the source files straight off disk, because that is the only way to
 * see the real CSS: Vite returns an *empty* string for a `.css?inline`/`?raw`
 * import under vitest, so a glob would check nothing. `fs` has no types in this
 * project (no `@types/node`), hence the one suppressed import; everything else is
 * DOM-typed (`URL`, `import.meta.url`). Each rule maps to a sentence in the
 * "UI layer" section of CLAUDE.md: colour lives in tokens.css, components in
 * primitives.css, and nowhere else.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - Node builtin; this project has no @types/node, and only the test needs fs.
import { readFileSync, readdirSync, statSync } from 'fs';
import { LIGHT_PALETTE, DARK_PALETTE, PALETTE_TOKENS, type Palette } from './palette';
import { STATUS_TEXT } from '../shared/labels';

// String path math on import.meta.url rather than the global URL: under jsdom
// `new URL('.', 'file://…')` mis-resolves the base to http://localhost, so fs
// would be handed the wrong scheme. A file:// URL is just a path once decoded.
const SELF = decodeURIComponent(import.meta.url.replace(/^file:\/\//, ''));
const UI_DIR = SELF.slice(0, SELF.lastIndexOf('/')); // …/src/ui
const SRC_DIR = UI_DIR.slice(0, UI_DIR.lastIndexOf('/')); // …/src

/** Every file under src/ with one of these extensions, as [displayPath, text]. */
function sources(exts: string[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir) as string[]) {
      const child = `${dir}/${name}`;
      if (statSync(child).isDirectory()) walk(child);
      else if (exts.some((e) => name.endsWith(e))) {
        out.push([child.slice(SRC_DIR.length + 1), readFileSync(child, 'utf8') as string]);
      }
    }
  };
  walk(SRC_DIR);
  return out;
}

const CSS = sources(['.css']);
const TS = sources(['.ts']);
const read = (suffix: string) => (CSS.find(([p]) => p.endsWith(suffix)) ?? TS.find(([p]) => p.endsWith(suffix)))![1];
const tokensCss = read('ui/tokens.css');
const primitivesCss = read('ui/primitives.css');

const isTokens = (path: string) => path.endsWith('ui/tokens.css');
const isPaletteTs = (path: string) => path.endsWith('ui/palette.ts');

/** A raw colour: a hex literal or an rgb()/hsl() function. */
const HEX = /#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{6}\b/g;
const FUNC = /\b(?:rgba?|hsla?)\(/g;
/** Pure black / white — compositing primitives (shadows, scrims), not brand colour. */
const OVERLAY = /^(?:#000|#fff|#000000|#ffffff|rgba?\(\s*0\s*,\s*0\s*,\s*0|rgba?\(\s*255\s*,\s*255\s*,\s*255)/i;

function rawColours(text: string): string[] {
  const hits: string[] = [];
  for (const m of text.matchAll(HEX)) if (!OVERLAY.test(m[0])) hits.push(m[0]);
  for (const m of text.matchAll(FUNC)) {
    const tail = text.slice(m.index, (m.index ?? 0) + 28);
    if (!OVERLAY.test(tail)) hits.push(tail.split(')')[0] + ')');
  }
  return hits;
}

describe('design system — colour lives only in the token layer', () => {
  it('no CSS file outside tokens.css contains a raw colour', () => {
    const offenders: string[] = [];
    for (const [path, text] of CSS) {
      if (isTokens(path)) continue;
      const hits = rawColours(text);
      if (hits.length) offenders.push(`${path}: ${[...new Set(hits)].join(', ')}`);
    }
    expect(offenders, 'add the colour to tokens.css and reference it with var(--…)').toEqual([]);
  });

  it('no TS inline style outside palette.ts hardcodes a colour', () => {
    const offenders: string[] = [];
    for (const [path, text] of TS) {
      if (isPaletteTs(path) || path.endsWith('.test.ts')) continue;
      const hits = rawColours(text);
      if (hits.length) offenders.push(`${path}: ${[...new Set(hits)].join(', ')}`);
    }
    expect(offenders, 'host-page marks read from ui/palette.ts; everything else uses tokens').toEqual([]);
  });
});

/**
 * The two shadow surfaces inline `tokens.css + primitives.css` and then their own
 * file, at equal specificity — so an un-media-queried `.cf-card` rule in a surface
 * file silently beats every `@media` block in primitives.css on source order.
 *
 * That is not hypothetical. `setupPanel.css` carried `top: 16px; width: 400px`,
 * which outranked the `max-width: 640px` bottom-sheet rules: on a phone the setup
 * panel was a 400px column hanging off the top of the screen, overlapping the
 * review modal's sheet, and no DOM test could see it — jsdom does not evaluate the
 * cascade or media queries, so the bug is only visible in a real browser or here,
 * in the source. Both sheets share one slot now; the box belongs to primitives.css.
 */
describe('design system — the shared sheet owns its own box', () => {
  const BOX = [
    'position', 'top', 'right', 'bottom', 'left',
    'width', 'height', 'max-width', 'max-height', 'min-width', 'min-height',
  ];

  it('no surface stylesheet redefines the card box', () => {
    const offenders: string[] = [];
    for (const [path, text] of CSS) {
      if (path.endsWith('ui/primitives.css')) continue;
      // Comments first — this very file talks about `.cf-card` in prose, and a
      // greedy match ran from the sentence into the next real rule.
      const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
      // Rules whose subject IS the card: the `.cf-card` compound has to be the
      // last one before the brace, so `.cf-card > .cf-header { min-width: 0 }`
      // (styling a child, not the box) does not count.
      for (const m of css.matchAll(/\.cf-card[\w.:[\]='"-]*\s*\{([^}]*)\}/g)) {
        for (const prop of BOX) {
          if (new RegExp(`(^|[;{\\s])${prop}\\s*:`).test(m[1])) offenders.push(`${path}: ${prop}`);
        }
      }
    }
    expect(offenders, 'the sheet box lives in primitives.css — see content/sheet.ts').toEqual([]);
  });
});

describe('design system — every token referenced is defined', () => {
  it('no var(--…) points at a name nothing declares', () => {
    const declared = new Set<string>();
    const referenced = new Map<string, string>();
    for (const [path, text] of CSS) {
      for (const m of text.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
      for (const m of text.matchAll(/var\((--[a-z0-9-]+)/gi)) {
        if (!referenced.has(m[1])) referenced.set(m[1], path);
      }
    }
    const undefinedRefs = [...referenced].filter(([name]) => !declared.has(name));
    expect(undefinedRefs, 'a typo or a surface-local pseudo-token').toEqual([]);
  });
});

describe('design system — one primary button, defined once', () => {
  it('the coral gradient exists only in tokens.css', () => {
    for (const [path, text] of CSS) {
      if (isTokens(path)) continue;
      expect(text, `${path} redefines the primary gradient`).not.toMatch(/linear-gradient/);
    }
  });

  it('primitives.css fills the primary from the single --btn-primary token', () => {
    expect(primitivesCss).toMatch(/\.btn-primary[\s\S]{0,140}background:\s*var\(--btn-primary\)/);
  });
});

/**
 * The primary button's fill is a token, but nothing stopped a *later* rule from
 * painting over it: `.btn:hover` outranks `.btn-primary`, so its `background`
 * shorthand flattened the gradient to paper and the white label vanished. Rather
 * than re-assert the specificity by hand, ask the DOM the question the browser
 * asks — does this hover selector match a primary button? — with `:hover`
 * dropped, since jsdom cannot hover.
 */
describe('design system — no hover repaints the primary button', () => {
  /** Leaf declaration blocks: `[^{}]*` cannot cross a brace, so @media wrappers are skipped. */
  const rules = (css: string): Array<{ selector: string; body: string }> =>
    [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]*)\{([^{}]*)\}/g)]
      .map((m) => ({ selector: m[1].trim(), body: m[2] }));

  const button = (className: string, blocked = false): HTMLElement => {
    const el = document.createElement('button');
    el.className = className;
    if (blocked) el.setAttribute('aria-disabled', 'true');
    return el;
  };

  // The four primaries the extension renders: the light-DOM pages' `.btn`, the
  // modal's shadow-DOM `.cf-btn`, and each of them blocked (the modal's Apply
  // with no submit button, which is precisely the one users hover to ask why).
  const PRIMARIES: Array<[string, HTMLElement]> = [
    ['.btn.btn-primary', button('btn btn-primary')],
    ['button.cf-btn.primary', button('cf-btn primary')],
    ['.btn.btn-primary[aria-disabled]', button('btn btn-primary', true)],
    ['button.cf-btn.primary[aria-disabled]', button('cf-btn primary', true)],
  ];

  /** Split a selector list on its top-level commas — `:not(a, b)` is one selector. */
  const selectors = (list: string): string[] => {
    const out: string[] = [];
    let depth = 0;
    let buf = '';
    for (const ch of list) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        out.push(buf.trim());
        buf = '';
      } else buf += ch;
    }
    return [...out, buf.trim()].filter(Boolean);
  };

  it('every :hover rule that sets a background skips the primary', () => {
    const offenders: string[] = [];
    for (const { selector, body } of rules(primitivesCss)) {
      if (!/(^|[;\s])background(-color|-image)?\s*:/.test(body)) continue;
      // A hover may of course paint the primary — with the primary's own token.
      if (/background[^;]*var\(--btn-primary\)/.test(body)) continue;
      for (const one of selectors(selector)) {
        if (!one.includes(':hover')) continue;
        const resting = one.replace(/:hover/g, '');
        for (const [name, el] of PRIMARIES) {
          if (el.matches(resting)) offenders.push(`${one} repaints ${name}`);
        }
      }
    }
    expect(offenders, 'exclude the primary with :not(), as .btn:hover does').toEqual([]);
  });
});

describe('design system — every status is complete', () => {
  const ICONS: Record<'ok' | 'warn' | 'none', string> = {
    ok: '--icon-check',
    warn: '--icon-alert',
    none: '--icon-x',
  };

  for (const cls of ['ok', 'warn', 'none'] as const) {
    it(`.cf-dot.${cls} has a colour, an icon, and its icon token`, () => {
      const rule = new RegExp(`\\.cf-dot\\.${cls}\\s*\\{[\\s\\S]*?--i:\\s*var\\(${ICONS[cls]}\\)`);
      expect(primitivesCss, `.cf-dot.${cls} must set --i: var(${ICONS[cls]})`).toMatch(rule);
      expect(tokensCss, `tokens.css must define ${ICONS[cls]}`).toMatch(new RegExp(`${ICONS[cls]}\\s*:`));
    });
  }

  it('the three outcomes are worded in the catalog', () => {
    for (const status of ['high', 'low', 'none'] as const) {
      expect(STATUS_TEXT[status].word.trim()).not.toBe('');
    }
  });
});

describe('design system — the host-page palette mirrors the tokens', () => {
  const valueIn = (block: string, token: string): string | undefined =>
    block.match(new RegExp(`${token}\\s*:\\s*(#[0-9a-fA-F]{3,8})`))?.[1]?.toLowerCase();

  // Light is everything before the dark @media; dark is inside it (falling back
  // to light for tokens it does not override, exactly as the cascade does).
  const darkStart = tokensCss.indexOf('@media (prefers-color-scheme: dark)');
  const lightBlock = tokensCss.slice(0, darkStart);
  const darkBlock = tokensCss.slice(darkStart);

  const check = (palette: Palette, value: (t: string) => string | undefined, scheme: string) => {
    for (const key of Object.keys(PALETTE_TOKENS) as (keyof Palette)[]) {
      const token = PALETTE_TOKENS[key];
      expect(value(token), `${scheme} ${key} (${token})`).toBe(palette[key].toLowerCase());
    }
  };

  it('light palette equals the light token values', () => {
    check(LIGHT_PALETTE, (t) => valueIn(lightBlock, t), 'light');
  });

  it('dark palette equals the dark token values (or the light fallback)', () => {
    check(DARK_PALETTE, (t) => valueIn(darkBlock, t) ?? valueIn(lightBlock, t), 'dark');
  });
});
