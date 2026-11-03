import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from './defaults';
import {
  decideLearning, isDistinctive, learningPolicy, looksLikeEdit, normalizeAnswer,
  type LearnInput, type LearningPolicy,
} from './learning';

const ON: LearningPolicy = { lessons: true, records: true, corrections: true };
/** The profile is never corrected from the page — how it was before corrections. */
const NO_CORRECTIONS: LearningPolicy = { ...ON, corrections: false };

const input = (over: Partial<LearnInput> = {}): LearnInput => ({
  kind: 'text',
  value: 'ada@example.test',
  matches: [],
  before: { confidence: 'none', filled: false },
  ...over,
});

describe('normalizeAnswer', () => {
  it('trims, collapses whitespace and ignores case', () => {
    expect(normalizeAnswer('  Software   Developer ')).toBe('software developer');
  });
});

describe('isDistinctive', () => {
  it('refuses the answers that would match too many questions', () => {
    for (const v of ['Yes', 'no', 'N/A', 'none', 'Other', '3', '12', 'CA', '']) {
      expect(isDistinctive(v), v).toBe(false);
    }
  });

  it('accepts a real answer', () => {
    for (const v of ['Israel', 'ada@example.test', '123', 'Tel Aviv']) {
      expect(isDistinctive(v), v).toBe(true);
    }
  });
});

describe('looksLikeEdit', () => {
  it('a reformatted phone number is an edit of the same value', () => {
    expect(looksLikeEdit('+972 50-123-4567', '050 1234567')).toBe(true);
  });

  it('adding to or trimming our value is an edit', () => {
    expect(looksLikeEdit('Tel Aviv', 'Tel Aviv-Yafo')).toBe(true);
    expect(looksLikeEdit('Ada Lovelace', 'ada lovelace')).toBe(true);
  });

  it('an unrelated value is not', () => {
    expect(looksLikeEdit('Lovelace', 'Acme Corp')).toBe(false);
    expect(looksLikeEdit('Lovelace', 'Lo')).toBe(false);
  });
});

describe('decideLearning', () => {
  it('an answer equal to exactly one profile value is learned as that field', () => {
    expect(decideLearning(input({ matches: ['email'] }), ON)).toEqual({ lesson: { field: 'email' } });
  });

  it('a low guess the user answered with the same field is promoted to a lesson', () => {
    const d = decideLearning(input({ matches: ['email'], before: { field: 'email', confidence: 'low', filled: false } }), ON);
    expect(d).toEqual({ lesson: { field: 'email' } });
  });

  it('a confident match the user agrees with teaches nothing new', () => {
    const d = decideLearning(input({ matches: ['email'], before: { field: 'email', confidence: 'high', filled: false } }), ON);
    expect(d).toEqual({});
  });

  it('a fill overwritten with another profile value moves the question to that field', () => {
    const d = decideLearning(input({
      value: 'Ada', matches: ['firstName'],
      before: { field: 'lastName', confidence: 'high', filled: true, filledValue: 'Lovelace' },
    }), ON);
    expect(d).toEqual({ lesson: { field: 'firstName' } });
  });

  it('two fields with the same value decide nothing — it fails closed', () => {
    expect(decideLearning(input({ value: 'New York', matches: ['city', 'state'] }), ON)).toEqual({});
  });

  it('an answer no field holds is recorded, never learned', () => {
    expect(decideLearning(input({ value: 'Software developer' }), ON)).toEqual({ record: {} });
  });

  it('a value typed over our fill corrects that field in the profile', () => {
    const d = decideLearning(input({
      value: 'John',
      before: { field: 'firstName', confidence: 'high', filled: true, filledValue: 'Joe' },
    }), ON);
    expect(d).toEqual({ update: { field: 'firstName' } });
  });

  it('a reformatted fill corrects the field too', () => {
    const d = decideLearning(input({
      kind: 'tel', value: '+972 50 123 4567',
      before: { field: 'phone', confidence: 'high', filled: true, filledValue: '+972501234567' },
    }), ON);
    expect(d).toEqual({ update: { field: 'phone' } });
  });

  it('a yes/no choice changed over our fill corrects the field, even when another field says the same', () => {
    const d = decideLearning(input({
      kind: 'radio', value: 'No', matches: ['c_sponsor'],
      before: { field: 'c_relocate', confidence: 'high', filled: true, filledValue: 'Yes' },
    }), ON);
    expect(d).toEqual({ update: { field: 'c_relocate' } });
  });

  it('typing over our fill with what two other fields hold decides nothing', () => {
    const d = decideLearning(input({
      value: 'Haifa', matches: ['city', 'state'],
      before: { field: 'address', confidence: 'high', filled: true, filledValue: 'Herzl 1' },
    }), ON);
    expect(d).toEqual({});
  });

  it('a file or a checkbox never corrects the profile', () => {
    expect(decideLearning(input({
      kind: 'file', value: 'other.pdf', before: { field: 'resume', confidence: 'high', filled: true, filledValue: 'cv.pdf' },
    }), ON)).toEqual({});
    expect(decideLearning(input({
      kind: 'checkbox', value: 'No', before: { field: 'c_x', confidence: 'high', filled: true, filledValue: 'Yes' },
    }), ON)).toEqual({});
  });

  it('without corrections, an unrelated value typed over our fill stops that fill', () => {
    const d = decideLearning(input({
      value: 'Acme Corp',
      before: { field: 'lastName', confidence: 'high', filled: true, filledValue: 'Lovelace' },
    }), NO_CORRECTIONS);
    expect(d).toEqual({ lesson: { ignore: true }, record: { field: 'lastName' } });
  });

  it('without corrections, a tweak of our fill keeps the fill, and is recorded against the field it edits', () => {
    const d = decideLearning(input({
      kind: 'tel', value: '050 1234567',
      before: { field: 'phone', confidence: 'high', filled: true, filledValue: '+972 50-123-4567' },
    }), NO_CORRECTIONS);
    expect(d).toEqual({ record: { field: 'phone' } });
  });

  it('an answer typed into a recognised box we had nothing to fill with is only recorded', () => {
    const d = decideLearning(input({
      value: 'linkedin.com/in/ada', before: { field: 'linkedin', confidence: 'high', filled: false },
    }), ON);
    expect(d).toEqual({ record: {} });
  });

  it('clearing our fill stops it; clearing anything else means nothing', () => {
    expect(decideLearning(input({
      value: '', before: { field: 'city', confidence: 'high', filled: true, filledValue: 'Haifa' },
    }), ON)).toEqual({ lesson: { ignore: true } });
    expect(decideLearning(input({ value: '' }), ON)).toEqual({});
  });

  it('a yes or no never becomes a lesson, even when one field holds it', () => {
    expect(decideLearning(input({ kind: 'radio', value: 'Yes', matches: ['c_relocate'] }), ON)).toEqual({});
    expect(decideLearning(input({ kind: 'radio', value: 'Yes' }), ON)).toEqual({ record: {} });
  });

  it('a checkbox teaches nothing — one "Yes" field would tick every consent box', () => {
    expect(decideLearning(input({ kind: 'checkbox', value: 'Yes', matches: ['c_x'] }), ON)).toEqual({});
  });

  it('long text and rich text are never recorded', () => {
    expect(decideLearning(input({ kind: 'textarea', value: 'Dear team, I am writing…' }), ON)).toEqual({});
    expect(decideLearning(input({ kind: 'editable', value: 'hello there' }), ON)).toEqual({});
    expect(decideLearning(input({ value: 'x'.repeat(121) }), ON)).toEqual({});
  });

  it('long text that equals a profile value is still learned', () => {
    expect(decideLearning(input({ kind: 'textarea', value: 'My cover note', matches: ['additionalInfo'] }), ON))
      .toEqual({ lesson: { field: 'additionalInfo' } });
  });

  it('an uploaded file named like a stored document is learned as it', () => {
    expect(decideLearning(input({ kind: 'file', value: 'cv.pdf', matches: ['resume'] }), ON)).toEqual({ lesson: { field: 'resume' } });
    expect(decideLearning(input({ kind: 'file', value: 'other.pdf' }), ON)).toEqual({});
  });

  it('follows the policy: no lessons, no records', () => {
    expect(decideLearning(input({ matches: ['email'] }), { ...ON, lessons: false })).toEqual({});
    expect(decideLearning(input({ value: 'Software developer' }), { ...ON, records: false })).toEqual({});
  });
});

describe('learningPolicy', () => {
  it('reads the three settings', () => {
    expect(learningPolicy(DEFAULT_SETTINGS)).toEqual({ lessons: true, records: true, corrections: true });
    expect(learningPolicy({ ...DEFAULT_SETTINGS, rememberTypedAnswers: false })).toMatchObject({ records: false });
    expect(learningPolicy({ ...DEFAULT_SETTINGS, learnFromTyping: false })).toMatchObject({ lessons: false });
    expect(learningPolicy({ ...DEFAULT_SETTINGS, updateProfileFromEdits: false })).toMatchObject({ corrections: false });
  });
});
