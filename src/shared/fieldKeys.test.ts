import { describe, it, expect } from 'vitest';
import { FIELD_KEYWORDS, normalizeAttr } from './fieldKeys';
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
