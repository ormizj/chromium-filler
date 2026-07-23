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

import type { MatchConfidence } from './types';

export interface FieldOutcome {
  confidence: MatchConfidence;
  filled: boolean;
}

/** Green only when the value actually went in; a failed fill needs review. */
export function matchStatus(m: FieldOutcome): MatchConfidence {
  if (m.filled) return 'high';
  return m.confidence === 'high' ? 'low' : m.confidence;
}

export const STATUS_LABELS: Record<MatchConfidence, string> = {
  high: 'filled',
  low: 'needs review',
  none: 'not found',
};
