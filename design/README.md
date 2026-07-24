# chromium-filler — Soft / Warm redesign

Handoff package for reskinning the extension in the chosen **Soft / Warm** direction. Written so
a fresh agent can implement it without the exploration context. Read in this order.

## What was decided

After exploring three directions (mono, warm, glass) in `../design-explorations/`, the **Soft /
Warm** language was chosen: warm paper neutrals, a single clay accent, rounded corners, gentle
shadows, and muted status colour paired with tinted chips — picked because the review report is
easy to scan at a glance. Status markers move from text glyphs to real icons. Both light and dark
modes are specified.

## Files

| File | What it is |
|---|---|
| `design-system.md` | Source of truth for values — the full token mapping (light + dark), components, the status-icon spec |
| `surfaces-and-states.md` | Every surface and state, what's designed vs. still a judgement call, and the harness route to check each |
| `implementation-plan.md` | Ordered, checkpointed steps — retoken → canvas → icons → polish → new stat component → remaining states → verify |
| `reference/02-soft-warm.html` | The chosen baseline mockup (popup, both modal views, options settings). Light/dark toggle |
| `reference/states-gallery.html` | Everything the mockups missed — modal flows, pill, session strip, overflow, help, and the whole setup panel — in Soft/Warm, with icon dots |

## How to use it

The redesign is a **recolour, not a rebuild**. `src/ui/tokens.css` and `src/ui/primitives.css`
already centralise every colour and control, so most of the look changes by editing values in
those two files; the reference HTML is the visual target to match. Start at
`implementation-plan.md` step 0.

## Ground rules that outrank the visuals

Carried from the codebase's own constraints — the reskin changes colour and shadow only:

- Status is never colour alone — dots keep a distinct icon shape and their `.cf-dot.*` classes
  (E2E asserts on `.cf-dot.none`).
- 44px minimum tap target on coarse pointers; both shadow surfaces are bottom sheets under 640px.
- The modal footer never exceeds two buttons plus `⋯`.
- A blocked Apply explains itself, and each blocked reason shows a different note.
- Help is a disclosure, never a hover tooltip.
- Every colour comes from a token — never hardcode one in a surface's own CSS.

## Not yet built

These are called out in `surfaces-and-states.md` as "needs design" — mostly recolours of
components already specified (options Queue/Profile/Sites tabs, the remaining setup-panel states,
the mobile peek). The two that need care are the modal's flush-to-edge geometry and the options
modal-layout simulator: reskin only, touch no measurement or clamping logic.
