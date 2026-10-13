import { describe, it, expect } from 'vitest';
import { matchStatus } from './fieldStatus';

describe('matchStatus', () => {
  it('is green only when the value actually went in', () => {
    expect(matchStatus({ confidence: 'high', filled: true })).toBe('high');
    expect(matchStatus({ confidence: 'high', filled: false })).toBe('low');
    expect(matchStatus({ confidence: 'low', filled: false })).toBe('low');
    expect(matchStatus({ confidence: 'none', filled: false })).toBe('none');
  });

  it('an answer that was already there, or an ignored question, needs nothing', () => {
    expect(matchStatus({ confidence: 'high', filled: false, kept: true })).toBe('high');
    expect(matchStatus({ confidence: 'none', filled: false, ignored: true })).toBe('high');
  });
});
