/**
 * The wording catalog is a single source of truth, so the one thing worth
 * testing is that it is *complete* — every field outcome and every action verb
 * has non-empty words — and that it stays in step with the two things keyed off
 * the same statuses: `DOT_LEGEND` (the explanations) and `STATUS_LABELS` (the
 * dot aria-labels). A status worded here but missing there is exactly the drift
 * this file exists to stop.
 */
import { describe, it, expect } from 'vitest';
import {
  ACTION_LABELS, EXPORT_FIELD_LABELS, JOB_STATUS_LABELS, STATUS_TEXT, type ActionKey,
} from './labels';
import { STATUS_LABELS } from './fieldStatus';
import { DOT_LEGEND } from './help';
import { ALL_JOB_STATUSES } from './jobUrls';
import { EXPORT_FIELD_ORDER } from './jobExport';
import type { MatchConfidence } from './types';

const STATUSES: MatchConfidence[] = ['high', 'low', 'none'];

describe('labels — the wording catalog', () => {
  it('words every field outcome, in all three forms', () => {
    for (const s of STATUSES) {
      const t = STATUS_TEXT[s];
      expect(t.tile.trim(), `${s}.tile`).not.toBe('');
      expect(t.word.trim(), `${s}.word`).not.toBe('');
      expect(t.aria.trim(), `${s}.aria`).not.toBe('');
    }
  });

  it('names every action verb', () => {
    const keys: ActionKey[] = [
      'apply', 'applied', 'skip', 'skipNext', 'rerun', 'confirm', 'pick',
      'done', 'openOptions', 'more', 'openApplication', 'openApplicationAgain', 'fillAnyway',
      'cancel', 'wider', 'deeper',
    ];
    for (const k of keys) expect(ACTION_LABELS[k].trim(), k).not.toBe('');
  });

  it('is the source of the dot aria-labels', () => {
    for (const s of STATUSES) expect(STATUS_LABELS[s]).toBe(STATUS_TEXT[s].aria);
  });

  it('shares its statuses with the dot legend, so the setup key and the modal key agree', () => {
    for (const row of DOT_LEGEND) expect(STATUS_TEXT[row.status]).toBeDefined();
    // Every outcome the catalog words has a legend entry, and vice versa.
    expect(new Set(DOT_LEGEND.map((r) => r.status))).toEqual(new Set(STATUSES));
  });

  /**
   * The archive's checkboxes are rendered by walking these two records, so a
   * column or a posting status with no words here is a control that cannot be
   * drawn. The `Record<>` types already fail the build for a missing key; these
   * catch the other half — a key present but left blank.
   */
  it('names every column the archive can export', () => {
    for (const f of EXPORT_FIELD_ORDER) expect(EXPORT_FIELD_LABELS[f].trim(), f).not.toBe('');
  });

  it('names every status a posting can be exported in', () => {
    for (const s of ALL_JOB_STATUSES) expect(JOB_STATUS_LABELS[s].trim(), s).not.toBe('');
  });
});
