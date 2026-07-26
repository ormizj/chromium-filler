import { describe, it, expect, afterEach } from 'vitest';
import { detectFields } from './fieldDetect';
import type { FieldKey } from '../shared/types';

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = '';
});

const ALL: FieldKey[] = [
  'firstName', 'lastName', 'fullName', 'email', 'phone', 'linkedin',
  'github', 'website', 'portfolio', 'address', 'city', 'state', 'zip',
  'country', 'coverLetter', 'resume',
];

function get(root: HTMLElement, fields: FieldKey[] = ALL) {
  const detected = detectFields({ root, fields });
  const by = new Map(detected.map((d) => [d.field, d]));
  return by;
}

describe('detectFields — attribute sources', () => {
  it('detects email and phone by id with high confidence', () => {
    const root = mount(`
      <input id="email" />
      <input id="phone" />
    `);
    const by = get(root);
    expect(by.get('email')?.element?.id).toBe('email');
    expect(by.get('email')?.confidence).toBe('high');
    expect(by.get('phone')?.element?.id).toBe('phone');
    expect(by.get('phone')?.confidence).toBe('high');
  });

  it('detects a field by its associated <label> text', () => {
    const root = mount(`
      <label for="x1">Phone number</label>
      <input id="x1" />
    `);
    const by = get(root);
    expect(by.get('phone')?.element?.id).toBe('x1');
    expect(by.get('phone')?.confidence).toBe('high');
  });

  it('detects by autocomplete tokens', () => {
    const root = mount(`<input id="q" autocomplete="email" />`);
    const by = get(root);
    expect(by.get('email')?.element?.id).toBe('q');
    expect(by.get('email')?.confidence).toBe('high');
  });

  it('treats a placeholder-only match as low confidence', () => {
    const root = mount(`<input placeholder="Email address" />`);
    const by = get(root);
    expect(by.get('email')?.confidence).toBe('low');
  });

  it('reports no element for a field with no candidate', () => {
    const root = mount(`<input id="email" />`);
    const by = get(root, ['email', 'phone']);
    expect(by.get('phone')?.element).toBeNull();
    expect(by.get('phone')?.confidence).toBe('none');
  });
});

describe('detectFields — name disambiguation', () => {
  it('assigns first/last to their own inputs and leaves fullName unmatched', () => {
    const root = mount(`
      <input id="first_name" />
      <input id="last_name" />
    `);
    const by = get(root);
    expect(by.get('firstName')?.element?.id).toBe('first_name');
    expect(by.get('lastName')?.element?.id).toBe('last_name');
    expect(by.get('fullName')?.element).toBeNull();
  });

  it('detects separator-free attribute names ("firstname", not "first_name")', () => {
    // Nothing in the markup separates the two words, so `normalizeAttr` has
    // nothing to split on and the keyword table has to match the compound.
    const root = mount(`
      <input name="firstname" />
      <input name="lastname" />
      <input name="emailaddress" />
      <input name="phonenumber" />
    `);
    const by = get(root);
    expect(by.get('firstName')?.element?.getAttribute('name')).toBe('firstname');
    expect(by.get('firstName')?.confidence).toBe('high');
    expect(by.get('lastName')?.element?.getAttribute('name')).toBe('lastname');
    expect(by.get('lastName')?.confidence).toBe('high');
    expect(by.get('email')?.element?.getAttribute('name')).toBe('emailaddress');
    expect(by.get('phone')?.element?.getAttribute('name')).toBe('phonenumber');
  });

  it('detects a single full-name field', () => {
    const root = mount(`<input id="name" />`);
    const by = get(root);
    expect(by.get('fullName')?.element?.id).toBe('name');
    expect(by.get('fullName')?.confidence).toBe('high');
  });

  it('never assigns the same element to two fields', () => {
    const root = mount(`
      <input id="first_name" />
      <input id="last_name" />
    `);
    const by = get(root);
    const first = by.get('firstName')?.element;
    const last = by.get('lastName')?.element;
    expect(first).not.toBe(last);
  });
});

describe('detectFields — overrides', () => {
  it('override selector wins over heuristics and is marked as override', () => {
    const root = mount(`
      <input id="email" />
      <input id="weird_field" />
    `);
    const detected = detectFields({
      root,
      fields: ['email'],
      overrides: { email: '#weird_field' },
    });
    const email = detected.find((d) => d.field === 'email');
    expect(email?.element?.id).toBe('weird_field');
    expect(email?.source).toBe('override');
    expect(email?.confidence).toBe('high');
  });

  it('with autoDetect=false only overrides are used', () => {
    const root = mount(`<input id="email" />`);
    const detected = detectFields({ root, fields: ['email'], autoDetect: false });
    expect(detected.find((d) => d.field === 'email')?.element).toBeNull();
  });
});

describe('detectFields — resume file input', () => {
  it('detects a file input labelled as resume/CV with high confidence', () => {
    const root = mount(`
      <label for="cv">Upload your CV / Resume</label>
      <input id="cv" type="file" />
    `);
    const by = get(root);
    expect(by.get('resume')?.element?.id).toBe('cv');
    expect(by.get('resume')?.confidence).toBe('high');
  });

  it('detects a lone unlabelled file input as low confidence', () => {
    const root = mount(`<input type="file" />`);
    const by = get(root);
    expect(by.get('resume')?.element?.tagName).toBe('INPUT');
    expect(by.get('resume')?.confidence).toBe('low');
  });

  it('matches an accented "Résumé" label (diacritics normalized)', () => {
    const root = mount(`
      <label for="cv">Résumé (PDF)</label>
      <input id="cv" type="file" />
    `);
    const by = get(root);
    expect(by.get('resume')?.element?.id).toBe('cv');
    expect(by.get('resume')?.confidence).toBe('high');
  });
});

/**
 * Some sites take the cover letter as an upload rather than a textarea, so it is
 * the second field allowed to claim a file input — but only on a *named* one.
 */
describe('detectFields — cover-letter file input', () => {
  it('detects a file input labelled as a cover letter', () => {
    const root = mount(`
      <label for="cl">Cover letter (PDF)</label>
      <input id="cl" type="file" />
    `);
    const by = get(root);
    expect(by.get('coverLetter')?.element?.id).toBe('cl');
    expect(by.get('coverLetter')?.confidence).toBe('high');
  });

  it('takes each of two labelled uploads, without either stealing the other', () => {
    const root = mount(`
      <label for="cv">Résumé</label>
      <input id="cv" type="file" />
      <label for="cl">Cover letter</label>
      <input id="cl" type="file" />
    `);
    const by = get(root);
    expect(by.get('resume')?.element?.id).toBe('cv');
    expect(by.get('coverLetter')?.element?.id).toBe('cl');
  });

  // The whole point of the narrower rule: the CV may fall back to a lone
  // unlabelled upload, the cover letter never may. Attaching the wrong document
  // to an application is not a mistake a "best guess" is worth making.
  it('never falls back to an unlabelled file input, the way the CV does', () => {
    const root = mount(`<input type="file" />`);
    const by = get(root);
    expect(by.get('resume')?.element).not.toBeNull();
    expect(by.get('coverLetter')?.element).toBeNull();
    expect(by.get('coverLetter')?.confidence).toBe('none');
  });

  it('leaves the file input to the CV when only the CV is being filled', () => {
    const root = mount(`
      <label for="cl">Cover letter</label>
      <input id="cl" type="file" />
    `);
    const by = get(root, ['resume']);
    expect(by.get('resume')?.element?.id).toBe('cl');
  });

  it('still prefers a textarea when the page offers one', () => {
    const root = mount(`
      <label for="cl-text">Cover letter</label>
      <textarea id="cl-text"></textarea>
      <label for="cv">Résumé</label>
      <input id="cv" type="file" />
    `);
    const by = get(root);
    expect(by.get('coverLetter')?.element?.id).toBe('cl-text');
    expect(by.get('resume')?.element?.id).toBe('cv');
  });
});
