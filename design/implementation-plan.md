# Implementation plan

For the agent applying Soft/Warm to the real extension. The direction is deliberately a
**recolour**, not a re-architecture: the token/primitive system already centralises every
colour, radius and control, so most of the work is changing values in two files and verifying
nothing regressed. Do the steps in order — each is checkable on its own.

## 0. Orient

Read `design-system.md` (values) and `surfaces-and-states.md` (what to cover). Skim the CLAUDE.md
sections "UI layer", "In-app help", "Data model & storage". Open the reference HTML in a browser
with the light/dark toggle: `reference/02-soft-warm.html` (baseline) and
`reference/states-gallery.html` (everything else, including the setup panel and blocked-Apply
notes). These are static targets — match them, don't import them.

## 1. Retoken (the core change)

Edit `src/ui/tokens.css`: replace the values in the light `:root, :host` block and the dark
`@media (prefers-color-scheme: dark)` block with the tables in `design-system.md`. Add the new
`--canvas` token to both. Update `--shadow-1` / `--shadow-2`. Leave geometry, type scale and the
`--cf-*` alias block untouched.

Checkpoint: `npm run dev`, open `http://localhost:5173/dev/` — all four surfaces should already
look warm, because they all read these tokens. Anything still cold is hardcoding a colour
instead of reading a token; fix it at the source, not with an override.

## 2. Page canvas

Point `body` in `src/popup/popup.css` and `src/options/options.css` at `var(--canvas)` so cards
sit a shade above the page. The modal and setup panel keep floating on the host site — don't
touch their backgrounds.

## 3. Status icons

In `src/ui/primitives.css`, replace the three `.cf-dot.*::before { content: '…' }` rules with the
masked-SVG approach in `design-system.md`. Keep the class names. Verify the 12px view-tab dots and
the legend dots (`src/shared/help.ts` `DOT_LEGEND`) still render — they use the same classes, so
they should inherit automatically.

Checkpoint: `npx vitest run` — the `.cf-dot.none` assertions must stay green.

## 4. Component polish pass

Walk each component in `design-system.md` against the reference. Most need nothing beyond the
retoken. Watch for: the segmented control's active-pill shadow, chip contrast in dark mode, the
session strip's accent-weak background, and the `?`-open state of help buttons. Keep primitives
in `primitives.css`/`tokens.css` — if two surfaces could want a rule, it goes there, not in one
surface's file (this is the rule that stopped popup/options dark mode contradicting each other).

## 5. New: three-stat summary (optional but recommended)

The `filled / to-check / unmatched` tiles are why 02 scanned well. They don't exist in the code
yet. Add them to the modal — the gallery places them in the Job view under the description, and in
the Fields view they can replace or sit above `.cf-summary`. This is a real change to
`src/content/modal/modal.ts` + `modal.css`, so treat it as a small feature: derive the counts from
`matches` (`fieldStatus.ts` already classifies), and keep the existing `.cf-summary` text as the
screen-reader/greyscale fallback. Ship the retoken without it if time is short.

## 6. Cover the remaining states

Using `surfaces-and-states.md`, walk every "needs design" row through its harness route and make
it look right. These are almost all recolours of components already styled in steps 1–4 (external
setup, cv-steps, submit/success-unset, options Queue/Profile/Sites tabs). The two that need
real attention:

- **Modal flush-to-edge** (`state=flush`) — the squared-corner / dropped-border geometry in
  primitives.css is behavioural, not cosmetic. Recolour only; do not touch the `data-limit-*` rules.
- **Options modal-layout simulator** — the measured-viewport logic is delicate (see CLAUDE.md
  "Data model & storage"). Reskin the frame and chips; change no measurement or clamping code.

## 7. Verify

- `npm run typecheck` and `npx vitest run` green (adding a config key or the stat component must
  not break the `Record<keyof …>` help types or the modal tests).
- `npm run build` then `npm run test:e2e` — the E2E suite loads `dist/` and asserts on dot
  classes and footer structure; a reskin should leave it green.
- Screenshot each surface at desktop **and** 390px (the dev harness renders a phone frame). The
  footer must never exceed two buttons + `⋯` at 390px, and both shadow surfaces must be
  full-width bottom sheets.
- Check both colour schemes — the reference toggles; the extension follows the OS via
  `prefers-color-scheme`.

## Files you'll touch

Primary: `src/ui/tokens.css`, `src/ui/primitives.css`. Page canvas: `src/popup/popup.css`,
`src/options/options.css`. Surface-specific only if a rule is genuinely unique to it:
`src/content/modal/modal.css`, `src/content/setupPanel.css`, `src/options/options.css`. New
component: `src/content/modal/modal.ts` (+ its css). Do **not** invent colours in any surface
file — every colour comes from a token.
