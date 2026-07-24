# Soft / Warm — implemented

The redesign in this folder has been applied to the extension. This note records
what was built and how the "needs design" rows in `surfaces-and-states.md` were
resolved, so the handoff package no longer reads as an open to-do list.

## What shipped beyond a recolour

The ask was a design *system* with zero inconsistencies, so three enforcement
points were added on top of the retoken (see CLAUDE.md → "UI layer"):

- **`src/shared/labels.ts`** — the single source of the status wording
  (`STATUS_TEXT`: Filled / To check / Unmatched) and the action verbs
  (`ACTION_LABELS`: Apply, Skip, Confirm, Pick, …). Every surface renders from it;
  `fieldStatus.STATUS_LABELS` re-exports the aria forms. Previously the same three
  statuses were worded four different ways.
- **`src/ui/palette.ts`** — the one sanctioned copy of the token colours, for the
  host-page marks (`fill.ts` highlight, `picker.ts` toolbar) that live outside the
  shadow roots and cannot read `var(--…)`.
- **`src/ui/designSystem.test.ts`** — the guardrail: no raw colour outside
  tokens.css, no undefined `var(--…)`, one primary fill, every status complete,
  and palette-vs-token parity. This is what keeps the future consistent.

New shared component: the three-stat summary (`.cf-stats` / `.cf-stat` in
primitives.css), used by both the modal's Job view and the options Queue stats.

## Surfaces & states — resolution of the gaps

| Row (from surfaces-and-states.md) | Resolution |
|---|---|
| Modal Job/Fields, long, redirect(-followed), landed, empty, failed-fill, apply-unset/-unverified, applied, session, pill, overflow | Recoloured via the retoken; verified against the reference at desktop + 390px, both schemes |
| Modal three-stat summary (new) | Built in `modal.ts` (`statSummary`), counts from `matchStatus`; `.cf-summary` line kept as the greyscale fallback |
| Modal flush-to-edge | Geometry untouched; recolour only — squared corners / dropped border verified in `state=flush` |
| Modal peek (mobile) | Inherits the bottom-sheet + `.peek` rules; recolour only |
| Setup panel — all states (default, help, external, cv-steps, submit/success-unset) | Recoloured; the neutral "not set" dot is a grey dash (`--icon-dash`), not the report's red cross |
| Popup — badge → tinted `.chip`, primary → shared `.btn-primary`, canvas background | Duplicated `.badge`/`button.primary` deleted; `popup.test.ts` class assertions updated |
| Options — Queue / Profile / Sites / Settings tabs | Warm surface layering (canvas → paper panels → surface insets); `.stat` → shared `.cf-stat`; `.explain` → shared `.cf-help`; `button.primary` reads `--btn-primary` |
| Options modal-layout simulator | Measurement/clamping untouched; frame + card recolour only |
| Getting-started checklist | Recoloured (accent-weak card) |

## Follow-up: matched to `reference-updated/`

The first cut was "close but not quite" against the updated mockup
(`reference-updated/design.html`), so a second pass re-tuned it to that file — the
current source of truth. No new architecture, all through the same token layer:

- **Rounder geometry** — new `--radius-btn`/`--radius-card`/`--radius-xl` (13/14/20);
  cards/panels, buttons, and inset rows all pick these up.
- **Buttons** — 44px on every pointer (no denser desktop button), weight 500, 13px
  radius. This is most of the "buttons feel different" the reskin was reported for.
- **Two-layer `--shadow-2`**, a third text level **`--muted-2`**, and the dark palette
  retuned so insets are *darker* than the paper (`--bg` `#26231f`, `--surface` `#211e1a`).
- **Segmented toggle** (Job/Fields) → rounded rectangle, not a pill.
- **Popup** → brand mark, a progress card with a big done/total number and
  filled/skipped/waiting chips, secondary actions as a button row.
- **Options** → folder tabs and `.switch` toggle rows in Settings.

Deferred (need data, not styling): the Job-view company/location/type meta chips and
the Settings throughput/match-rate stat cards.

## Third pass: how the surfaces *use* the tokens

The palette matched the reference after the second pass; the surfaces still did
not. Every remaining difference was in application rather than colour — which tone
a surface sits on, how much air a card has, and three treatments that had never
been ported. All fixed in the token/primitive layer plus two render changes:

- **Surface layering.** The popup was a `--canvas` page, so its progress card sat
  three values off its background in light and read *raised* in dark; it is a paper
  panel now. Dark `--surface-2` was lighter than `--bg` (the light value is darker),
  so hovers and shallow insets flipped side between schemes. The options settings
  rows were `--bg` on a `--bg` panel — visible only by their border — and are now
  inset like every other row on that page.
- **Secondary buttons** are paper with a border, filling in on hover, as in the
  reference. They were `--surface`-filled, which read as a well rather than a
  button, and the options page had a second hover model (`brightness(0.97)`) that
  did almost nothing in dark mode.
- **Sentence-case labels.** Six in-UI labels were micro-caps; the reference uses
  uppercase only for page furniture.
- **Modal density** — header/body/footer at the reference's 12/16 rather than
  10/12, which is most of what made the same palette read as a tighter design.
- **The fields view is a divided list** (the reference's `.field`), not a stack of
  bordered inset cards, and each row carries its status as a **word** in a tinted
  tag as well as a dot. **The job description** is second-level ink with
  full-strength headings, as the reference's `.desc` is.
- **The queue strip** is a quiet muted line directly above the footer, not an
  accent-filled band under the header — it reports, it is not an action. Its
  progress dots are deliberately not ported: the text carries richer per-status
  counts already.
- **Two bugs the comparison exposed.** The footer's `min-width: 96px` was a
  descendant selector, so the `⋯` overflow was as wide as Skip — a quarter of a
  390px footer, taken off the two decisions. And `.cf-stat` only ever spelled
  `.ok/.warn/.none`, while the modal renders tiles as `.high/.low/.none`, so the
  filled and to-check numbers were falling back to plain ink; only the red one had
  ever been coloured.
- **The options folder tabs** sat 16px left of their panel with a rule cutting
  across the active tab and 32px of air below it. Tab and panel are one sheet now.

## Verification

`npm run typecheck`, `npx vitest run` (incl. the labels + guardrail tests), and
`npm run build && npm run test:e2e` all green; every surface screenshotted at
desktop and 390px in both colour schemes against the reference.
