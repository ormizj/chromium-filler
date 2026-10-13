import { describe, it, expect } from 'vitest';
import type { Profile } from './types';
import {
  fieldChoices, fieldLabel, fieldValue, isCustomId, keywordMatch, newCustomField,
} from './profileFields';

const profile = (over: Partial<Profile> = {}): Profile => ({
  values: { firstName: 'Ada', email: 'ada@example.test' },
  keywords: {},
  customFields: [
    { id: 'c_exp', label: 'Years of experience', kind: 'text', value: '7', keywords: ['experience (years)'] },
    { id: 'c_visa', label: 'Need sponsorship', kind: 'yesNo', value: 'No', keywords: ['visa sponsorship'] },
  ],
  ...over,
});

describe('newCustomField', () => {
  it('makes a custom id and trims the label', () => {
    const f = newCustomField('  Salary  ', 'text', '90k');
    expect(isCustomId(f.id)).toBe(true);
    expect(f).toMatchObject({ label: 'Salary', kind: 'text', value: '90k', keywords: [] });
  });
});

describe('fieldLabel / fieldValue', () => {
  it('reads built-ins and custom fields alike', () => {
    const p = profile();
    expect(fieldLabel(p, 'firstName')).toBe('First name');
    expect(fieldLabel(p, 'c_exp')).toBe('Years of experience');
    expect(fieldValue(p, 'email')).toBe('ada@example.test');
    expect(fieldValue(p, 'c_visa')).toBe('No');
    expect(fieldValue(p, 'c_missing')).toBeUndefined();
    expect(fieldLabel(p, 'c_missing')).toBe('Deleted field');
  });
});

describe('keywordMatch', () => {
  it('matches a custom field by its label as a whole phrase', () => {
    expect(keywordMatch(profile(), 'how many years of experience do you have')).toBe('c_exp');
  });

  it('matches by an extra keyword', () => {
    expect(keywordMatch(profile(), 'do you require visa sponsorship')).toBe('c_visa');
    expect(keywordMatch(profile(), 'experience years')).toBe('c_exp');
  });

  it('matches a wording the user added to a built-in field', () => {
    expect(keywordMatch(profile({ keywords: { firstName: ['christian name'] } }), 'christian name')).toBe('firstName');
  });

  it('prefers the longest phrase, and refuses a tie between two fields', () => {
    const p = profile({
      customFields: [
        { id: 'c_a', label: 'Notice', kind: 'text', value: '1', keywords: [] },
        { id: 'c_b', label: 'Notice period', kind: 'text', value: '2', keywords: [] },
        { id: 'c_c', label: 'Start date', kind: 'text', value: '3', keywords: [] },
        { id: 'c_d', label: 'Start date', kind: 'text', value: '4', keywords: [] },
      ],
    });
    expect(keywordMatch(p, 'what is your notice period')).toBe('c_b');
    expect(keywordMatch(p, 'start date')).toBeUndefined();
  });

  it('never matches inside a word', () => {
    expect(keywordMatch(profile(), 'yearsofexperience')).toBeUndefined();
  });
});

describe('fieldChoices', () => {
  it('lists built-ins in reading order, then the custom fields', () => {
    const ids = fieldChoices(profile()).map((c) => c.id);
    expect(ids.slice(0, 3)).toEqual(['resume', 'coverLetter', 'email']);
    expect(ids.slice(-2)).toEqual(['c_exp', 'c_visa']);
  });

  it('says which group each choice belongs to', () => {
    const choices = fieldChoices(profile());
    expect(choices.find((c) => c.id === 'email')?.group).toBe('builtIn');
    expect(choices.find((c) => c.id === 'c_exp')?.group).toBe('custom');
  });
});
