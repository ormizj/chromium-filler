/**
 * The count line both shadow surfaces draw: `● 5 filled · ◐ 2 to check · ○ 9 …`.
 *
 * It is a **key as well as a tally**, which is the one rule a caller must not
 * break: every status stays on the line at zero, because a reader who has never
 * seen a yellow dot learns nothing from a line that omits the yellow one. That is
 * also why each count wears its own dot rather than the three sharing a legend
 * somewhere else — as a separate legend under sixteen rows it was read, if at all,
 * after the colours it explains.
 *
 * Here rather than in either surface because two of them want it now: the review
 * modal over its report, and the setup panel's offer screen over the fields it can
 * already see on the page. `.cf-summary` moved to `primitives.css` with it.
 */

export interface SummaryPart {
  /**
   * The `.cf-dot` modifier, not the status — the two callers legitimately spell
   * the same three outcomes differently. The modal renders a `MatchConfidence`
   * (`high`/`low`/`none`) and the setup panel maps `RowStatus` through its own
   * `DOT` table to `ok`/`warn`/`none`; primitives.css declares both spellings.
   */
  dot: string;
  count: number;
  /** The word after the number, from a wording catalog — never a literal here. */
  word: string;
  /** The dot's spoken descriptor. It is the only name the dot has. */
  aria: string;
}

export function summaryLine(parts: SummaryPart[]): HTMLParagraphElement {
  const line = document.createElement('p');
  line.className = 'cf-summary';
  for (const part of parts) {
    const dot = document.createElement('span');
    dot.className = `cf-dot ${part.dot}`;
    // `role="img"` because the dot is the status: without a name it is an unlabelled
    // decoration, and the count beside it says how many without saying of what.
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', part.aria);
    const label = document.createElement('span');
    label.textContent = `${part.count} ${part.word}`;
    line.append(dot, label);
  }
  return line;
}
