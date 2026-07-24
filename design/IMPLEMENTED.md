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

## Verification

`npm run typecheck`, `npx vitest run` (incl. the labels + guardrail tests), and
`npm run build && npm run test:e2e` all green; every surface screenshotted at
desktop and 390px in both colour schemes against the reference.
