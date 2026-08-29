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
  ACTION_LABELS, EXPORT_FIELD_LABELS, JOB_STATUS_LABELS, STATUS_TEXT, SETUP_STATUS_TEXT,
  resetRecordingPrompt, type ActionKey,
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

  it('words the same three outcomes again, for setting a site up', () => {
    for (const s of STATUSES) {
      const t = SETUP_STATUS_TEXT[s];
      expect(t.word.trim(), `${s}.word`).not.toBe('');
      expect(t.aria.trim(), `${s}.aria`).not.toBe('');
    }
  });

  /**
   * The whole reason the second catalog exists. `detectFields` returns a row per
   * *wanted* field, so a `none` on the setup surfaces means the page never asked
   * for it — the ordinary state of most of the sixteen on any real form. Wording
   * that "unmatched" would put "9 unmatched" on a healthy page, which is the
   * cry-wolf failure `setupSteps` is written against.
   */
  it('refuses to call a field the page never asked for "unmatched"', () => {
    expect(SETUP_STATUS_TEXT.none.word).not.toBe(STATUS_TEXT.none.word);
    expect(SETUP_STATUS_TEXT.none.word).not.toMatch(/unmatched|not found/i);
  });

  /** Only `low` needs a word on its on-page chip: the other two say it by being there. */
  it('marks only the uncertain outcome on an on-page chip', () => {
    expect(SETUP_STATUS_TEXT.low.chip.trim()).not.toBe('');
    expect(SETUP_STATUS_TEXT.high.chip).toBe('');
    expect(SETUP_STATUS_TEXT.none.chip).toBe('');
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

/**
 * The one line of prose in the catalog, and the only one that has to be built rather
 * than looked up: it counts what is about to be thrown away, and it says a different
 * thing on each leg because Reset does a different thing on each — a reload here, a
 * walk back to the board from the employer's site.
 */
describe('the prompt before a recording is thrown away', () => {
  it('says how many steps go, and agrees with itself about one', () => {
    expect(resetRecordingPrompt(6, 'posting')).toContain('6 steps');
    expect(resetRecordingPrompt(1, 'posting')).toContain('1 step');
    expect(resetRecordingPrompt(1, 'posting')).not.toContain('1 steps');
  });

  it('warns that the page goes back, and says where to on the employer\'s side', () => {
    // The destination leg is the one where "start again" means leaving the page you
    // are looking at, so it cannot be worded the same as a reload.
    expect(resetRecordingPrompt(3, 'posting')).toMatch(/reload/i);
    expect(resetRecordingPrompt(3, 'destination')).toMatch(/posting/i);
    expect(resetRecordingPrompt(3, 'destination')).not.toBe(resetRecordingPrompt(3, 'posting'));
  });
});
