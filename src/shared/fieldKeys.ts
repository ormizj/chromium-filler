/**
 * Heuristic keyword tables for mapping a form control to a FieldKey.
 *
 * Regexes are tested against a *normalized* string: lower-cased, with
 * camelCase and separators (`_`, `-`, `.`) turned into spaces (see
 * `normalizeAttr`). Keep patterns space-based accordingly.
 */

import type { FieldKey } from './types';

export const TEXT_FIELDS: FieldKey[] = [
  'firstName', 'lastName', 'fullName', 'email', 'phone', 'linkedin',
  'github', 'website', 'portfolio', 'address', 'city', 'state', 'zip',
  'country', 'coverLetter',
];

/**
 * Positive keyword patterns per field (normalized strings).
 *
 * Compound words take an optional separator (`first ?name`) because
 * `normalizeAttr` can only split what the markup separated: `firstName` and
 * `first_name` both become "first name", but `name="firstname"` — an ordinary
 * spelling on hand-written application forms — stays one word, and `\bfirst\b`
 * does not match inside it.
 */
export const FIELD_KEYWORDS: Record<FieldKey, RegExp[]> = {
  firstName: [/\bfirst ?name\b/, /\bgiven ?name\b/, /\bforename\b/, /\bfname\b/, /\bfirst\b/],
  lastName: [/\blast ?name\b/, /\bfamily ?name\b/, /\bsurname\b/, /\blname\b/, /\blast\b/],
  fullName: [
    /\bfull ?name\b/, /\byour ?name\b/, /^name$/,
    /\bcandidate ?name\b/, /\bapplicant ?name\b/,
  ],
  email: [/\be ?mail\b/, /\be ?mail ?address\b/],
  phone: [
    /\bphone\b/, /\bphone ?number\b/, /\btelephone\b/, /\bmobile\b/, /\btel\b/, /\bcell\b/,
  ],
  linkedin: [/\blinked ?in\b/],
  github: [/\bgit ?hub\b/],
  website: [/\bwebsite\b/, /\bweb site\b/, /\bpersonal site\b/, /\bhomepage\b/],
  portfolio: [/\bportfolio\b/],
  address: [/\baddress\b/, /\bstreet\b/],
  city: [/\bcity\b/, /\btown\b/],
  state: [/\bstate\b/, /\bprovince\b/, /\bregion\b/],
  zip: [/\bzip\b/, /\bzip ?code\b/, /\bpostal\b/, /\bpostal ?code\b/, /\bpost ?code\b/],
  country: [/\bcountry\b/],
  coverLetter: [/\bcover ?letter\b/, /\bwhy do you\b/, /\bmotivation\b/],
  resume: [/\bresume\b/, /\bcv\b/, /\bcurriculum vitae\b/, /\bre ?sume\b/],
};

/**
 * The order fields are *shown* in, most consequential first.
 *
 * Deliberately not `TEXT_FIELDS`. That list is what detection is asked to find,
 * and `detectFields` uses its order twice — for the rows it returns *and* as the
 * tie-break between two fields that score equally on the same control — so
 * reordering it would quietly change which control a field claims. This one is
 * for display, and is applied to the *output* of detection.
 *
 * The CV leads because it is the field an application is actually judged on; a
 * report that opened on "Country ✓" and buried an unattached CV at the bottom
 * was ordered by nothing more than the order the profile happened to be typed in.
 */
export const FIELD_ORDER: FieldKey[] = [
  'resume', 'coverLetter',
  'email', 'phone',
  'fullName', 'firstName', 'lastName',
  'linkedin', 'github', 'website', 'portfolio',
  'address', 'city', 'state', 'zip', 'country',
];

const ORDER_INDEX = new Map(FIELD_ORDER.map((f, i) => [f, i]));

/**
 * Sort rows into reading order: everything the user has actually provided in
 * their profile first, then everything they have not, `FIELD_ORDER` within each.
 *
 * The two groups matter because the setup wizard lists every field the extension
 * knows, filled or not. Without the split, a site's one unmatched control could
 * sit below eleven rows for fields that will never be filled because there is
 * nothing to fill them with — which is the opposite of "a healthy site reports no
 * work". `filled` is about the *profile*, never about the page.
 */
export function orderFields<T>(
  rows: readonly T[],
  key: (row: T) => FieldKey,
  filled: (row: T) => boolean,
): T[] {
  const rank = (row: T) => ORDER_INDEX.get(key(row)) ?? FIELD_ORDER.length;
  return [...rows].sort((a, b) =>
    Number(filled(b)) - Number(filled(a)) || rank(a) - rank(b));
}

/** autocomplete attribute token(s) that strongly indicate a field. */
export const AUTOCOMPLETE_MAP: Partial<Record<FieldKey, string[]>> = {
  firstName: ['given-name'],
  lastName: ['family-name'],
  fullName: ['name'],
  email: ['email'],
  phone: ['tel', 'tel-national'],
  address: ['street-address', 'address-line1'],
  city: ['address-level2'],
  state: ['address-level1'],
  zip: ['postal-code'],
  country: ['country', 'country-name'],
};

/** Field labels shown in the UI. */
export const FIELD_LABELS: Record<FieldKey, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  fullName: 'Full name',
  email: 'Email',
  phone: 'Phone',
  linkedin: 'LinkedIn',
  github: 'GitHub',
  website: 'Website',
  portfolio: 'Portfolio',
  address: 'Address',
  city: 'City',
  state: 'State',
  zip: 'ZIP / Postal',
  country: 'Country',
  coverLetter: 'Cover letter',
  resume: 'Résumé / CV',
};

/** Turn an attribute value into a normalized, space-separated lower-case string. */
export function normalizeAttr(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip diacritics: résumé -> resume
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase -> camel Case
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
