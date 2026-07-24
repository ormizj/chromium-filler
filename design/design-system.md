# Soft / Warm — design system

The chosen visual direction for the chromium-filler redesign. This document is the source of
truth for values; the reference HTML in `reference/` is the source of truth for how they
compose. Everything here maps onto the token names that already exist in
`src/ui/tokens.css`, so implementing it is mostly a matter of changing values, not structure.

## Design intent

Warm paper neutrals, a single clay accent, rounded corners, and gentle shadows. Status is
carried by muted colour **plus a glyph**, surfaced in soft tinted chips and a three-stat
summary so the important information is legible at a glance. The direction was chosen because
it makes the review report easy to scan — filled vs. needs-review vs. unmatched reads
instantly — while still feeling calm rather than clinical.

Two weights only (400 / 600), sentence case everywhere, no ALL-CAPS except the existing
`.cf-section` / `.cf-site` micro-labels which stay uppercased at 11–12px.

## Token mapping

These replace the values in the two `:root, :host` blocks of `src/ui/tokens.css`. Names are
unchanged, so every surface that already reads them inherits the new look. Light is the
default block; dark goes in the `@media (prefers-color-scheme: dark)` block.

### Neutrals & surfaces

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | `#fffdfa` | `#221e1a` | Card / popup / options / modal fill (the "paper") |
| `--surface` | `#f4efe7` | `#2c2823` | Raised inset: segmented-control track, stat tiles, section fills |
| `--surface-2` | `#faf6ee` | `#322d27` | A row inside a card (report rows, setup rows) |
| `--fg` | `#2c2a26` | `#f3efe8` | Primary text |
| `--muted` | `#6f6a61` | `#b3aca0` | Secondary text, captions, notes |
| `--border` | `#eae4da` | `#37322b` | Default hairline |
| `--border-strong` | `#ded6c9` | `#453f37` | Hover / grip / emphasized divider |

New token to add — `--canvas` (`#f4efe7` light / `#1a1815` dark): the page background *behind*
cards on the popup and options pages. Today those bodies use `--bg`; on white that reads fine,
but the warm look wants the page a shade deeper than the cards floating on it. Add `--canvas`
to tokens.css and point `body` in `popup.css` / `options.css` at it. The modal and setup panel
do **not** use it — they float over someone else's site.

### Brand & status

| Token | Light | Dark | Role |
|---|---|---|---|
| `--accent` | `#c46a3f` | `#e08a54` | Clay — primary buttons, session strip, notice, links |
| `--accent-fg` | `#ffffff` | `#2a1a10` | Text on `--accent` |
| `--accent-weak` | `#f6e7dd` | `#3a2a1f` | Accent tint — notice banner, session strip bg, `?`-open |
| `--btn-primary` (fill) | `linear-gradient(135deg,#e0632f,#f0913f)` | `#e08a54` (solid `--accent`) | Fill for **all** primary buttons — see note below |
| `--ok` | `#3f9d6b` | `#5fc48c` | Filled / high confidence |
| `--ok-weak` | `#e4f2e8` | `#22332a` | ok chip / applied banner bg |
| `--warn` | `#c99a2e` | `#e0b356` | Low confidence / needs review |
| `--warn-weak` | `#f7edd6` | `#352d1c` | warn chip bg |
| `--err` | `#c85a4e` | `#e07a6c` | Unmatched |
| `--err-weak` | `#f7e2df` | `#3a2622` | err chip bg |

Keep the `--cf-*` legacy aliases block exactly as-is — it already re-points at the names above.

### Geometry, type, elevation

Unchanged from the current tokens.css except the two shadows, which warm up and soften:

| Token | Light | Dark |
|---|---|---|
| `--shadow-1` | `0 1px 2px rgba(80,60,40,.10)` | `0 1px 2px rgba(0,0,0,.5)` |
| `--shadow-2` | `0 18px 40px -22px rgba(80,60,40,.35)` | `0 24px 50px -26px rgba(0,0,0,.7)` |

Radii, spacing, `--tap: 44px`, font stack and the type scale (`--text-xs`…`--text-xl`) stay as
they are. The direction reads warm through colour and shadow, not through new geometry, so the
existing responsive rules in primitives.css keep working untouched.

## Components

Every component below already exists in `src/ui/primitives.css` or the two surface CSS files.
The redesign recolours them through the tokens above; only the items marked **NEW** need markup.

- **Buttons** (`.btn`, `.btn-primary`, `.btn-danger`, `.btn-ghost`) — the primary fill is a warm
  coral gradient (`--btn-primary`: `#e0632f → #f0913f`) with a soft coloured shadow, in **light
  mode only**. This applies to every primary button — the modal's Apply, the popup's "Run this
  page", options CTAs — so the primary action reads the same everywhere. It's a deliberate,
  single exception to the otherwise-flat direction: the primary is the one thing worth drawing the
  eye to. Dark mode keeps the **solid `--accent`** fill, because a gradient glows badly against
  the dark card. Hover uses the existing `filter: brightness(1.08)`.

  Implement it on the primary rule itself (`.btn-primary`, `button.cf-btn.primary`) with a
  `prefers-color-scheme` split — not as a per-button class — so no surface has to opt in. Two
  states that are primary buttons but must **not** read as the live gradient CTA: a
  disabled/blocked Apply (`aria-disabled`) fades via the existing `opacity`, which is enough to
  distinguish it; and the green "Applied ✓" button keeps its own `--ok` fill (it reports success,
  not a pending action), so it overrides the primary background.
- **Status dots** (`.cf-dot.ok/.warn/.none`) — 16px, coloured fill **and an icon**: a check,
  an alert/exclamation, and a cross. These replace the old text glyphs (`✓ ! ×`) — real icons
  read as more finished at this size and stay crisp. Implement as a white icon masked inside
  the coloured circle (see below); the icon is load-bearing, because status is never colour
  alone (colour-blindness, greyscale). The class names do **not** change — the E2E suite asserts
  on `.cf-dot.none`, so only the `::before` presentation moves from `content: '×'` to a masked
  SVG. The three view-tab dots (12px) and legend dots use the same classes, so they inherit the
  icons automatically.

  Reference implementation (from the gallery — recolour-safe, single CSS change in
  primitives.css):

  ```css
  .cf-dot { position: relative; }
  .cf-dot::before {
    content: ''; position: absolute; inset: 22%;
    background: #fff;
    -webkit-mask: var(--i) center/contain no-repeat; mask: var(--i) center/contain no-repeat;
  }
  .cf-dot.ok  { --i: url("…check.svg");  }   /* was ::before { content: '✓' } */
  .cf-dot.warn{ --i: url("…alert.svg"); }
  .cf-dot.none{ --i: url("…x.svg");     }
  ```

  The mask approach keeps the coloured circle and drops in any icon set. If the project would
  rather use its icon system than inline data-URIs, that's fine — the requirement is a distinct
  *shape* per status, not a specific asset. Prefer stroked, rounded icons to match the warmth.
- **Chips** (`.chip.ok/.warn/.err/.accent`) — tint background + matching text, no border. These
  are the "at a glance" element the direction was picked for; keep them prominent.
- **Segmented control** (`.cf-views` / `.cf-view.active`) — track on `--surface`, active pill on
  `--bg` with `--shadow-1`. The Job/Fields toggle.
- **Rows** (`.cf-row`, `.cf-field`, `.cf-actions`) — report and setup rows, on `--surface-2`.
- **Floating sheet** (`.cf-card`, `.cf-header`, `.cf-body`, `.cf-footer`, `.cf-pill`) — the shared
  modal/setup shell. Bottom sheet under 640px, pill when minimized. Unchanged structurally.
- **Session strip** (`.cf-session`) — accent-weak bg, accent text; only while a queue runs.
- **Notice / applied / empty** (`.cf-notice`, `.cf-applied`, `.cf-empty`) — the Job-view banners.
- **Inline help** (`.cf-help*`, `.cf-help-btn`) — disclosure with an accent left-border. Never a
  hover tooltip. Rendered from `src/shared/help.ts`.
- **Three-stat summary** — **NEW**. `filled / to-check / unmatched` as three tiles on `--surface`
  with coloured numbers. The exploration mockup introduced it in the Job view; the current code
  only has the `.cf-summary` text line in the Fields view. Recommended addition — see
  `surfaces-and-states.md` for placement. Optional but it is much of why 02 scanned so well.
