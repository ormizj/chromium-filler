/**
 * The one rule for how a field's outcome is shown — the modal's status dot and
 * the on-page highlight both use it, so the report and the page can never
 * disagree about the same field.
 *
 * Confidence alone is not the outcome. A high-confidence match still fails to
 * fill when the control cannot take the value (a `<select>` with no matching
 * option) or when a saved override resolves to a wrapper instead of a control —
 * and reporting that as filled is the one thing this extension must never do,
 * since the user's only signal that a field needs attention is this dot.
 */

import type { FieldKey, MatchConfidence } from './types';
import { STATUS_TEXT } from './labels';
import { orderFieldsBy } from './fieldKeys';

export interface FieldOutcome {
  confidence: MatchConfidence;
  filled: boolean;
}

/** Green only when the value actually went in; a failed fill needs review. */
export function matchStatus(m: FieldOutcome): MatchConfidence {
  if (m.filled) return 'high';
  return m.confidence === 'high' ? 'low' : m.confidence;
}

/**
 * How far up the report an outcome sorts — lowest first, so the rows that still
 * need something from the user lead it.
 *
 * `Record<>` for the same reason `STATUS_TEXT` is: a fourth `MatchConfidence`
 * fails `npm run typecheck` until someone has decided where it belongs, rather
 * than silently sorting last.
 */
const REPORT_RANK: Record<MatchConfidence, number> = { none: 0, low: 1, high: 2 };

/**
 * The review report's reading order: unmatched, then to check, then filled, with
 * `FIELD_ORDER` deciding ties within each band.
 *
 * Deliberately keyed on `matchStatus` rather than on `confidence` — a
 * high-confidence match the control would not take reports as `low`, and a row
 * has to sort where its own dot says it belongs. It is also applied at *render*
 * time, not once at fill time: confirming or picking a row changes its status, and
 * the row moving into the filled band is the point.
 *
 * This is the modal's rule alone. The setup wizard lists every field the
 * extension knows and sorts by what the *profile* can supply (`orderFields`),
 * because there most `none` rows mean "this page never asked for it".
 */
export function orderReport<T extends FieldOutcome & { field: FieldKey }>(
  rows: readonly T[],
): T[] {
  return orderFieldsBy(rows, (r) => r.field, (r) => REPORT_RANK[matchStatus(r)]);
}

/**
 * The spoken descriptor for each outcome — a dot's `aria-label`. Kept as a thin
 * re-export of the wording catalog so the report and the status vocabulary can
 * never drift apart; `labels.ts` is the source of truth.
 */
export const STATUS_LABELS: Record<MatchConfidence, string> = {
  high: STATUS_TEXT.high.aria,
  low: STATUS_TEXT.low.aria,
  none: STATUS_TEXT.none.aria,
};
