import { describe, it, expect, beforeEach } from 'vitest';
import type { InputSignature } from './types';
import {
  isFragile, lessonFor, signatureMatches, signatureParts, uniqueSignature, type SignatureParts,
} from './inputSignature';

const P = (over: Partial<SignatureParts> = {}): SignatureParts => ({
  question: 'name', kind: 'text', ...over,
});

describe('uniqueSignature', () => {
  it('stops at the question and kind when they already name one input', () => {
    const all = [P({ question: 'first name' }), P({ question: 'email', kind: 'email' })];
    expect(uniqueSignature(all, 0, 'a.test')).toEqual({ question: 'first name', kind: 'text' });
  });

  it('adds the name attribute when the question is shared', () => {
    const all = [P({ name: 'applicant name' }), P({ name: 'ref name' })];
    expect(uniqueSignature(all, 1, 'a.test')).toEqual({ question: 'name', kind: 'text', name: 'ref name' });
  });

  it('adds the section when the names do not tell them apart', () => {
    const all = [P({ section: 'reference 1' }), P({ section: 'reference 2' })];
    expect(uniqueSignature(all, 1, 'a.test')).toEqual({ question: 'name', kind: 'text', section: 'reference 2' });
  });

  it('adds the options of a choice', () => {
    const all = [
      P({ question: 'level', kind: 'select', options: 'junior|senior' }),
      P({ question: 'level', kind: 'select', options: 'a1|b2|c1' }),
    ];
    expect(uniqueSignature(all, 0, 'a.test').options).toBe('junior|senior');
  });

  it('falls back to the position among identical inputs', () => {
    const all = [P(), P(), P()];
    expect(uniqueSignature(all, 2, 'a.test')).toEqual({ question: 'name', kind: 'text', index: 2 });
  });

  it('pins an input the page says nothing about to its site', () => {
    const all = [P({ question: '' }), P({ question: 'email', kind: 'email' })];
    expect(uniqueSignature(all, 0, 'a.test')).toEqual({ question: '', kind: 'text', host: 'a.test' });
  });
});

describe('signatureMatches', () => {
  it('needs every stored part to be equal', () => {
    const sig: InputSignature = { question: 'name', kind: 'text', section: 'reference 1' };
    expect(signatureMatches(sig, P({ section: 'reference 1' }), 'b.test')).toBe(true);
    expect(signatureMatches(sig, P({ section: 'reference 2' }), 'b.test')).toBe(false);
    expect(signatureMatches(sig, P(), 'b.test')).toBe(false);
  });

  it('ignores parts the signature did not store', () => {
    expect(signatureMatches({ question: 'name', kind: 'text' }, P({ name: 'x', section: 'y' }), 'b.test')).toBe(true);
  });

  it('a different kind is a different input', () => {
    expect(signatureMatches({ question: 'name', kind: 'text' }, P({ kind: 'textarea' }), 'b.test')).toBe(false);
  });

  it('a host-pinned signature only matches on its host', () => {
    const sig: InputSignature = { question: '', kind: 'text', host: 'a.test' };
    expect(signatureMatches(sig, P({ question: '' }), 'a.test')).toBe(true);
    expect(signatureMatches(sig, P({ question: '' }), 'b.test')).toBe(false);
  });
});

describe('lessonFor', () => {
  const lesson = (id: string, signature: InputSignature) => ({ id, signature });
  const idOf = (r: ReturnType<typeof lessonFor<{ id: string; signature: InputSignature }>>) => (r === 'ambiguous' ? r : r?.id);

  it('finds the lesson for an input', () => {
    const all = [P({ question: 'given name' }), P({ question: 'email', kind: 'email' })];
    expect(idOf(lessonFor([lesson('a', { question: 'given name', kind: 'text' })], all, 0, 'x'))).toBe('a');
    expect(lessonFor([lesson('a', { question: 'given name', kind: 'text' })], all, 1, 'x')).toBeUndefined();
  });

  it('fails closed when a lesson matches two inputs on the page', () => {
    const all = [P(), P()];
    expect(lessonFor([lesson('a', { question: 'name', kind: 'text' })], all, 0, 'x')).toBe('ambiguous');
  });

  it('a positional lesson picks its own input among the identical ones', () => {
    const all = [P(), P()];
    const l = [lesson('a', { question: 'name', kind: 'text', index: 1 })];
    expect(lessonFor(l, all, 0, 'x')).toBeUndefined();
    expect(idOf(lessonFor(l, all, 1, 'x'))).toBe('a');
  });

  it('the more specific lesson wins over a general one', () => {
    const all = [P({ section: 'reference 1' })];
    const l = [
      lesson('general', { question: 'name', kind: 'text' }),
      lesson('specific', { question: 'name', kind: 'text', section: 'reference 1' }),
    ];
    expect(idOf(lessonFor(l, all, 0, 'x'))).toBe('specific');
  });
});

describe('isFragile', () => {
  it('flags signatures that lean on position or on one site', () => {
    expect(isFragile({ question: 'name', kind: 'text' })).toBe(false);
    expect(isFragile({ question: 'name', kind: 'text', index: 1 })).toBe(true);
    expect(isFragile({ question: '', kind: 'text', host: 'a.test' })).toBe(true);
  });
});

describe('signatureParts', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('reads the question, kind, a stable name, the section and the options', () => {
    document.body.innerHTML = `
      <fieldset><legend>Reference 1</legend>
        <label for="a">Seniority *</label>
        <select id="a" name="ref_seniority"><option value="">Choose…</option><option>Junior</option><option>Senior</option></select>
      </fieldset>`;
    expect(signatureParts(document.getElementById('a')!)).toEqual({
      question: 'seniority', kind: 'select', name: 'ref seniority', section: 'reference 1', options: 'junior|senior',
    });
  });

  it('drops a generated name', () => {
    document.body.innerHTML = '<label for="a">City</label><input id="a" name="question_88231947">';
    expect(signatureParts(document.getElementById('a')!).name).toBeUndefined();
  });

  it('reads a radio group as one input with its options', () => {
    document.body.innerHTML = `
      <fieldset><legend>Need sponsorship?</legend>
        <label><input type="radio" name="sp" id="y"> Yes</label>
        <label><input type="radio" name="sp"> No</label>
      </fieldset>`;
    expect(signatureParts(document.getElementById('y')!)).toEqual({
      question: 'need sponsorship', kind: 'radio', name: 'sp', options: 'yes|no',
    });
  });
});
