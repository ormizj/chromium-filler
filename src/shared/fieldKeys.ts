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

/** Positive keyword patterns per field (normalized strings). */
export const FIELD_KEYWORDS: Record<FieldKey, RegExp[]> = {
  firstName: [/\bfirst name\b/, /\bgiven name\b/, /\bforename\b/, /\bfname\b/, /\bfirst\b/],
  lastName: [/\blast name\b/, /\bfamily name\b/, /\bsurname\b/, /\blname\b/, /\blast\b/],
  fullName: [/\bfull name\b/, /\byour name\b/, /^name$/, /\bcandidate name\b/, /\bapplicant name\b/],
  email: [/\be ?mail\b/],
  phone: [/\bphone\b/, /\btelephone\b/, /\bmobile\b/, /\btel\b/, /\bcell\b/],
  linkedin: [/\blinked ?in\b/],
  github: [/\bgit ?hub\b/],
  website: [/\bwebsite\b/, /\bweb site\b/, /\bpersonal site\b/, /\bhomepage\b/],
  portfolio: [/\bportfolio\b/],
  address: [/\baddress\b/, /\bstreet\b/],
  city: [/\bcity\b/, /\btown\b/],
  state: [/\bstate\b/, /\bprovince\b/, /\bregion\b/],
  zip: [/\bzip\b/, /\bpostal\b/, /\bpost ?code\b/],
  country: [/\bcountry\b/],
  coverLetter: [/\bcover letter\b/, /\bcoverletter\b/, /\bwhy do you\b/, /\bmotivation\b/],
  resume: [/\bresume\b/, /\bcv\b/, /\bcurriculum vitae\b/, /\bre ?sume\b/],
};

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
