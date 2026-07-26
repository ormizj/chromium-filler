import { describe, it, expect } from 'vitest';
import { FIELD_KEYWORDS, FIELD_LABELS, FIELD_ORDER, normalizeAttr, orderFields } from './fieldKeys';
import type { FieldKey } from './types';

/** Every field whose keyword table matches this attribute value. */
function fieldsFor(attr: string): FieldKey[] {
  const normalized = normalizeAttr(attr);
  return (Object.keys(FIELD_KEYWORDS) as FieldKey[])
    .filter((f) => FIELD_KEYWORDS[f].some((re) => re.test(normalized)));
}

describe('normalizeAttr', () => {
  it('splits camelCase and separators into spaces, lower-cased', () => {
    expect(normalizeAttr('firstName')).toBe('first name');
    expect(normalizeAttr('first_name')).toBe('first name');
    expect(normalizeAttr('first-name')).toBe('first name');
    expect(normalizeAttr('  First   Name  ')).toBe('first name');
  });

  it('strips diacritics so "Résumé" reads as "resume"', () => {
    expect(normalizeAttr('Résumé')).toBe('resume');
  });

  it('returns an empty string for nullish input', () => {
    expect(normalizeAttr(null)).toBe('');
    expect(normalizeAttr(undefined)).toBe('');
    expect(normalizeAttr('')).toBe('');
  });

  it('leaves an all-lower-case compound word joined — the keywords must cope', () => {
    // No camelCase hump and no separator to split on, so the table is what has
    // to match "firstname"; this is why the patterns allow an optional space.
    expect(normalizeAttr('firstname')).toBe('firstname');
    expect(normalizeAttr('FIRSTNAME')).toBe('firstname');
  });
});

describe('FIELD_KEYWORDS — separator-free attribute names', () => {
  // `name="firstname"` is an ordinary spelling on hand-written application
  // forms; before this the whole field came back unmatched.
  const cases: Array<[string, FieldKey]> = [
    ['firstname', 'firstName'],
    ['FIRSTNAME', 'firstName'],
    ['givenname', 'firstName'],
    ['lastname', 'lastName'],
    ['familyname', 'lastName'],
    ['fullname', 'fullName'],
    ['yourname', 'fullName'],
    ['phonenumber', 'phone'],
    ['emailaddress', 'email'],
    ['zipcode', 'zip'],
    ['postalcode', 'zip'],
    ['coverletter', 'coverLetter'],
  ];

  for (const [attr, field] of cases) {
    it(`maps "${attr}" to ${field}`, () => {
      expect(fieldsFor(attr)).toContain(field);
    });
  }
});

describe('FIELD_KEYWORDS — the separated spellings still work', () => {
  const cases: Array<[string, FieldKey]> = [
    ['first_name', 'firstName'],
    ['firstName', 'firstName'],
    ['First Name', 'firstName'],
    ['last-name', 'lastName'],
    ['Full name', 'fullName'],
    ['e-mail', 'email'],
    ['Phone number', 'phone'],
    ['ZIP / Postal', 'zip'],
    ['Cover letter', 'coverLetter'],
    ['Résumé (PDF)', 'resume'],
  ];

  for (const [attr, field] of cases) {
    it(`maps "${attr}" to ${field}`, () => {
      expect(fieldsFor(attr)).toContain(field);
    });
  }
});

describe('FIELD_ORDER', () => {
  it('leads with the CV, then the cover letter — the two that decide an application', () => {
    expect(FIELD_ORDER.slice(0, 2)).toEqual(['resume', 'coverLetter']);
  });

  it('names every field exactly once, so nothing can fall off a list sorted by it', () => {
    const keys = Object.keys(FIELD_LABELS) as FieldKey[];
    expect([...FIELD_ORDER].sort()).toEqual([...keys].sort());
  });
});

describe('orderFields', () => {
  const key = (f: FieldKey) => f;

  it('sorts by importance, not by the order the rows arrived in', () => {
    expect(orderFields(['country', 'email', 'resume'], key, () => true))
      .toEqual(['resume', 'email', 'country']);
  });

  it('puts every field the user filled in ahead of every one they did not', () => {
    // The CV outranks the city everywhere — but a city that was actually
    // entered is still worth more than a CV that was never uploaded.
    const filled = new Set<FieldKey>(['city']);
    expect(orderFields(['resume', 'city'], key, (f) => filled.has(f)))
      .toEqual(['city', 'resume']);
  });

  it('keeps FIELD_ORDER within each group', () => {
    const filled = new Set<FieldKey>(['email', 'city']);
    expect(orderFields(['country', 'city', 'resume', 'email'], key, (f) => filled.has(f)))
      .toEqual(['email', 'city', 'resume', 'country']);
  });

  it('does not mutate the array it was given', () => {
    const rows: FieldKey[] = ['country', 'resume'];
    orderFields(rows, key, () => true);
    expect(rows).toEqual(['country', 'resume']);
  });

  it('sorts rows of any shape, not just bare keys', () => {
    const rows = [{ field: 'zip' as FieldKey }, { field: 'resume' as FieldKey }];
    expect(orderFields(rows, (r) => r.field, () => true).map((r) => r.field))
      .toEqual(['resume', 'zip']);
  });
});

describe('FIELD_KEYWORDS — no cross-talk between first and last name', () => {
  it('does not read a last-name attribute as a first name, or the reverse', () => {
    expect(fieldsFor('lastname')).not.toContain('firstName');
    expect(fieldsFor('firstname')).not.toContain('lastName');
    expect(fieldsFor('family_name')).not.toContain('firstName');
    expect(fieldsFor('given_name')).not.toContain('lastName');
  });

  it('does not claim an unrelated attribute', () => {
    expect(fieldsFor('company')).toEqual([]);
    expect(fieldsFor('salary_expectation')).toEqual([]);
  });
});
