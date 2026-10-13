/**
 * The wording catalog is a single source of truth, so the one thing worth
 * testing is that it is *complete* — every outcome and every action verb has
 * non-empty words — and that it stays in step with the two things keyed off the
 * same statuses: `DOT_LEGEND` (the explanations) and `STATUS_LABELS` (the dot
 * aria-labels). A status worded here but missing there is exactly the drift this
 * file exists to stop.
 */
import { describe, it, expect } from 'vitest';
import {
  ACTION_LABELS, EXPORT_FIELD_LABELS, FLOW_TEXT, JOB_STATUS_LABELS, STATUS_TEXT,
  queueChipText, type ActionKey,
} from './labels';
import { STATUS_LABELS } from './fieldStatus';
import { DOT_LEGEND } from './help';
import { ALL_JOB_STATUSES } from './jobUrls';
import { EXPORT_FIELD_ORDER } from './jobExport';
import type { MatchConfidence } from './types';

const STATUSES: MatchConfidence[] = ['high', 'low', 'none'];

describe('labels — the wording catalog', () => {
  it('words every outcome, in all three forms', () => {
    for (const s of STATUSES) {
      const t = STATUS_TEXT[s];
      expect(t.tile.trim(), `${s}.tile`).not.toBe('');
      expect(t.word.trim(), `${s}.word`).not.toBe('');
      expect(t.aria.trim(), `${s}.aria`).not.toBe('');
    }
  });

  /**
   * An unrecognised input is the row the user teaches, not a failure — and on most
   * pages it is the commonest row. Worded as a fault it would be cry-wolf.
   */
  it('calls an unrecognised input something to teach, not a failure', () => {
    expect(STATUS_TEXT.none.word).toMatch(/teach/);
    expect(STATUS_TEXT.none.word).not.toMatch(/unmatched|failed|not found/i);
  });

  it('names every action verb', () => {
    for (const k of Object.keys(ACTION_LABELS) as ActionKey[]) {
      expect(ACTION_LABELS[k].trim(), k).not.toBe('');
    }
  });

  it('never words the resting state as though something was sent', () => {
    expect(`${FLOW_TEXT.ready.title} ${FLOW_TEXT.ready.detail}`).not.toMatch(/\bsent\b(?! for you)/i);
    expect(FLOW_TEXT.ready.title).toMatch(/submit on the site/i);
  });

  it('is the source of the dot aria-labels', () => {
    for (const s of STATUSES) expect(STATUS_LABELS[s]).toBe(STATUS_TEXT[s].aria);
  });

  it('shares its statuses with the dot legend', () => {
    for (const row of DOT_LEGEND) expect(STATUS_TEXT[row.status]).toBeDefined();
    expect(new Set(DOT_LEGEND.map((r) => r.status))).toEqual(new Set(STATUSES));
  });

  it('names every column the archive can export', () => {
    for (const f of EXPORT_FIELD_ORDER) expect(EXPORT_FIELD_LABELS[f].trim(), f).not.toBe('');
  });

  it('names every status a posting can be exported in', () => {
    for (const s of ALL_JOB_STATUSES) expect(JOB_STATUS_LABELS[s].trim(), s).not.toBe('');
  });
});

describe('queueChipText', () => {
  it('carries the position, and stays short', () => {
    expect(queueChipText(4, 12)).toBe('Queue · 4/12');
    expect(queueChipText(0, 0)).toBe('Queue');
  });
});
