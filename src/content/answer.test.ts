import { describe, it, expect, afterEach } from 'vitest';
import type { Profile } from '../shared/types';
import { isDisplayed } from '../shared/visible';
import { collectCandidates } from './fieldDetect';
import { fieldsAnswering, readAnswer } from './answer';

const PROFILE: Profile = {
  values: { email: 'ada@example.test', city: 'Haifa', state: 'Haifa', country: 'Israel', firstName: 'Ada' },
  customFields: [{ id: 'c_notice', label: 'Notice period', kind: 'text', value: '1 month', keywords: [] }],
};
const NO_DOCS = { cv: null, cover: null };

function cand(html: string) {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return collectCandidates(root, { visible: isDisplayed })[0];
}

afterEach(() => { document.body.innerHTML = ''; });

describe('readAnswer', () => {
  it('reads a text box, the chosen option, the checked radio and an uploaded file', () => {
    const text = cand('<label>Q <input value=" ada@example.test "></label>');
    expect(readAnswer(text)).toBe('ada@example.test');

    const select = cand('<label>Country <select><option value="">Select…</option><option value="il" selected>Israel</option></select></label>');
    expect(readAnswer(select)).toBe('Israel');

    const radio = cand('<fieldset><legend>Where?</legend><label><input type="radio" name="r" value="a">Tel Aviv</label><label><input type="radio" name="r" value="b" checked>Haifa</label></fieldset>');
    expect(readAnswer(radio)).toBe('Haifa');
  });

  it('a select still on its prompt holds no answer', () => {
    const select = cand('<label>Country <select><option value="">Select…</option><option>Israel</option></select></label>');
    expect(readAnswer(select)).toBe('');
  });
});

describe('fieldsAnswering', () => {
  it('names the field whose value was typed, ignoring case and spacing', () => {
    expect(fieldsAnswering(PROFILE, cand('<label>Contact <input value="ADA@example.test"></label>'), NO_DOCS)).toEqual(['email']);
  });

  it('reaches the user’s own fields', () => {
    expect(fieldsAnswering(PROFILE, cand('<label>When <input value="1 Month"></label>'), NO_DOCS)).toEqual(['c_notice']);
  });

  it('names every field holding the same value — the caller decides that is too many', () => {
    expect(fieldsAnswering(PROFILE, cand('<label>Q <input value="Haifa"></label>'), NO_DOCS).sort()).toEqual(['city', 'state']);
  });

  it('a select answers for the field that would have chosen the same option', () => {
    const c = cand('<label>Q <select><option value="">Select…</option><option value="il" selected>Israel</option><option value="us">United States</option></select></label>');
    expect(fieldsAnswering(PROFILE, c, NO_DOCS)).toEqual(['country']);
  });

  it('a radio group answers for the field that would have checked the same radio', () => {
    const c = cand('<fieldset><legend>Where?</legend><label><input type="radio" name="r">Tel Aviv</label><label><input type="radio" name="r" checked>Haifa</label></fieldset>');
    expect(fieldsAnswering(PROFILE, c, NO_DOCS).sort()).toEqual(['city', 'state']);
  });

  it('an empty box answers for nothing', () => {
    expect(fieldsAnswering(PROFILE, cand('<label>Q <input value=""></label>'), NO_DOCS)).toEqual([]);
  });

  it('a file answers for the stored document of the same name', () => {
    const c = cand('<label>Upload <input type="file"></label>');
    const cv = new File(['x'], 'ada-cv.pdf');
    // jsdom has no DataTransfer; a FileList is read here as `length` and `[0]`.
    Object.defineProperty(c.el, 'files', { value: [new File(['y'], 'ada-cv.pdf')] });
    expect(fieldsAnswering(PROFILE, c, { cv, cover: null })).toEqual(['resume']);
    expect(fieldsAnswering(PROFILE, c, NO_DOCS)).toEqual([]);
  });
});
