import { describe, it, expect } from 'vitest';
import type { FieldKey } from './types';
import { matchStatus, orderReport } from './fieldStatus';

const row = (field: FieldKey, confidence: 'high' | 'low' | 'none', filled = false) =>
  ({ field, confidence, filled });

describe('matchStatus', () => {
  it('is green only when the value actually went in', () => {
    expect(matchStatus({ confidence: 'high', filled: true })).toBe('high');
    expect(matchStatus({ confidence: 'high', filled: false })).toBe('low');
    expect(matchStatus({ confidence: 'low', filled: false })).toBe('low');
    expect(matchStatus({ confidence: 'none', filled: false })).toBe('none');
  });
});

describe('orderReport', () => {
  it('leads with the rows that need the user: unmatched, then to-check, then filled', () => {
    const rows = [
      row('email', 'high', true),
      row('phone', 'low'),
      row('city', 'none'),
    ];
    expect(orderReport(rows).map((r) => r.field)).toEqual(['city', 'phone', 'email']);
  });

  it('keeps FIELD_ORDER within each group', () => {
    // Country and the CV are both unmatched, so the CV still leads them — the
    // reading order only ever decides ties now, it no longer decides the report.
    const rows = [
      row('country', 'none'),
      row('email', 'high', true),
      row('resume', 'none'),
      row('phone', 'high', true),
    ];
    expect(orderReport(rows).map((r) => r.field))
      .toEqual(['resume', 'country', 'email', 'phone']);
  });

  it('sorts a high-confidence match that did not fill with the rows to check', () => {
    // The row reports as `low` — a green dot is reserved for a value that went
    // in — so it has to sort where its dot says it belongs.
    const rows = [row('email', 'high', true), row('country', 'high', false)];
    expect(orderReport(rows).map((r) => r.field)).toEqual(['country', 'email']);
  });

  it('does not mutate the array it was given', () => {
    const rows = [row('email', 'high', true), row('city', 'none')];
    orderReport(rows);
    expect(rows.map((r) => r.field)).toEqual(['email', 'city']);
  });
});
