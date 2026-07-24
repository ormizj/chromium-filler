# Surfaces & states — coverage and gaps

Every surface the redesign touches, every state each can be in, and whether we have a visual
for it yet. "Harness" is the `?page=…&state=…` route in `dev/frame.html` that renders the real
surface — use it to check the implementation against the reference. A fresh agent should treat
the **Gap** column as the to-do list: anything "designed in gallery" has a target to match;
anything "needs design" is a judgement call to make during implementation, guided by the
system doc.

## Surface 1 — Popup (`src/popup`, light DOM)

The toolbar popup: run/reset triggers and session progress.

| State | Harness | Visual | Gap |
|---|---|---|---|
| Idle / ready | `page=popup` | 02 mockup | covered |
| Mid-session progress | `page=popup` | 02 mockup (counts) | covered |
| No profile / first run | — | needs design | empty-state copy + CTA to options |
| Reset confirm | — | needs design | minor — inline confirm vs. destructive button |

## Surface 2 — Review modal (`src/content/modal`, shadow DOM)

The flagship. Two views (Job default, Fields), a footer with two decisions + overflow, and a
lot of flow-specific bodies. This is where most of the missing states live.

| State | Harness | Visual | Gap |
|---|---|---|---|
| Job view (filled) | `state=default` | 02 mockup | covered |
| Fields view (report) | `view=fields` | 02 mockup | covered |
| Long posting (reading typography) | `state=long` | 02 mockup proves prose | check scroll + rhythm |
| Two-step redirect (notice + escape) | `state=redirect` | gallery | designed in gallery |
| Redirect followed | `state=redirect-followed` | gallery (landed) | designed in gallery |
| Handoff destination landed | `state=landed` | gallery | designed in gallery |
| Empty listing (nothing to fill) | `state=empty` | gallery | designed in gallery |
| Failed fill (confident, not accepted) | `state=failed-fill` | gallery | designed in gallery |
| Apply blocked — no Send button | `state=apply-unset&note=apply` | gallery | designed in gallery |
| Apply blocked — no confirmation | `state=apply-unverified` | gallery | designed in gallery |
| Applied ✓ (sent & confirmed) | `state=applied` | gallery | designed in gallery |
| Session strip + "Skip → next" | `session=1` | gallery | designed in gallery |
| Overflow menu open | click ⋯ | gallery | designed in gallery |
| Minimized pill | `onClose` | gallery | designed in gallery |
| Flush to screen edge (desktop) | `state=flush` | needs design | squared corners / dropped border — geometry rule only, colours from tokens |
| Peek (mobile collapsed) | narrow + `.peek` | needs design | 40vh bottom sheet; recolour only |

Footer rule that must survive the reskin: never more than two visible buttons plus `⋯`. A
third clips the primary action off the right edge at 390px.

## Surface 3 — Setup panel (`src/content/setupPanel`, shadow DOM)

The second shadow surface — maps a site's selectors. **Entirely absent from the exploration
mockups.** One representative state is in the gallery; the rest recolour from the same rows.

| State | Harness | Visual | Gap |
|---|---|---|---|
| Default (quick-apply site) | `page=setup` | gallery | designed in gallery |
| First-run help / legend open | `state=help` | needs design | legend uses `HelpEntry.short`; help component designed in gallery |
| External (two-step) site | `state=external` | needs design | all form-field rows grey, redirect section active — recolour of gallery |
| CV needs confirm steps | `state=cv-steps` | needs design | steps in Form-fields section — recolour |
| Send button not found | `state=submit-unset` | needs design | one row `none` + note — recolour |
| No confirmation element | `state=success-unset` | needs design | one row `none` + note — recolour |

## Surface 4 — Options page (`src/options`, light DOM)

Four tabs. Only Settings was mocked.

| Tab / element | Harness | Visual | Gap |
|---|---|---|---|
| Settings tab | `page=options` | 02 mockup | covered |
| Queue tab | `page=options` | needs design | list of job URLs by status + import — recolour of rows/chips |
| Profile tab | `page=options` | needs design | field inputs + CV upload — standard form controls |
| Sites tab | `page=options` | needs design | site-config list, `describeConfig()` sentences, key reference |
| Modal-layout simulator | Settings tab | needs design | drag/resize frame + live preview; **geometry is delicate — recolour only, do not restyle behaviour** |
| Getting-started checklist | Settings, `helpSeen=false` | needs design | retires once `helpSeen` |

## Cross-cutting — do not regress in the reskin

These are correctness rules the visual layer must respect. They come from the codebase's
"Non-obvious constraints"; the reskin changes colour and shadow only.

- **Status dots keep a distinct shape** — now real icons (check / alert / cross) rather than
  text glyphs, but the rule is unchanged: colour is only half the signal. Keep the
  `.cf-dot.ok/.warn/.none` class names (E2E asserts on `.none`).
- **44px minimum tap target** under `@media (pointer: coarse)` on every control.
- **Bottom sheet under 640px** for both shadow surfaces; the modal clears its inline
  desktop layout below `NARROW_WIDTH`.
- **Focus-visible ring** on every control (`--ring`) — keyboard use must stay visible.
- **Reduced-motion** block stays.
- **Help is disclosure, never `title=` tooltip** — a phone has no hover.
- The **greyed Apply explains itself** — each blocked reason shows a *different* note.
