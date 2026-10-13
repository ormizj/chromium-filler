import { describe, it, expect } from 'vitest';
import type { Lesson } from './types';
import { dropField, forget, lessonsFor, recordHits, sameSignature, teach } from './lessons';

const base = (over: Partial<Lesson> = {}): Lesson => ({
  id: 'l1',
  signature: { question: 'given name', kind: 'text' },
  target: { field: 'firstName' },
  label: 'Given name',
  createdAt: 1,
  hits: 0,
  ...over,
});

describe('teach', () => {
  it('adds a lesson', () => {
    const out = teach([], { signature: { question: 'x', kind: 'text' }, target: { ignore: true }, label: 'X' }, 5, 'n1');
    expect(out).toEqual([{ id: 'n1', signature: { question: 'x', kind: 'text' }, target: { ignore: true }, label: 'X', createdAt: 5, hits: 0 }]);
  });

  it('teaching the same input again replaces the lesson, keeping one per signature', () => {
    const out = teach([base()], { signature: { kind: 'text', question: 'given name' }, target: { field: 'fullName' }, label: 'Given name' }, 9, 'n2');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'n2', target: { field: 'fullName' }, createdAt: 9 });
  });

  it('a more specific signature is a different lesson', () => {
    const out = teach([base()], { signature: { question: 'given name', kind: 'text', section: 'reference 1' }, target: { ignore: true }, label: 'Given name' }, 9, 'n2');
    expect(out).toHaveLength(2);
  });

  it('keeps where it was taught, for Options', () => {
    const out = teach([], { signature: { question: 'x', kind: 'text' }, target: { ignore: true }, label: 'X', taughtOn: 'jobs.acme.test' }, 5, 'n1');
    expect(out[0].taughtOn).toBe('jobs.acme.test');
  });
});

describe('sameSignature', () => {
  it('compares every part, whatever order the keys were written in', () => {
    expect(sameSignature({ question: 'a', kind: 'text', name: 'n' }, { name: 'n', kind: 'text', question: 'a' })).toBe(true);
    expect(sameSignature({ question: 'a', kind: 'text' }, { question: 'a', kind: 'text', index: 0 })).toBe(false);
  });
});

describe('forget / recordHits / lessonsFor / dropField', () => {
  it('forgets by id', () => {
    expect(forget([base(), base({ id: 'l2' })], 'l1').map((l) => l.id)).toEqual(['l2']);
  });

  it('counts hits, and returns the same list when there are none to count', () => {
    const list = [base()];
    expect(recordHits(list, [])).toBe(list);
    expect(recordHits(list, ['l1'])[0].hits).toBe(1);
  });

  it('lists the lessons that point at a field', () => {
    const list = [base(), base({ id: 'l2', target: { ignore: true } }), base({ id: 'l3', target: { field: 'c_x' } })];
    expect(lessonsFor(list, 'c_x').map((l) => l.id)).toEqual(['l3']);
  });

  it('drops the lessons of a deleted field', () => {
    const list = [base(), base({ id: 'l3', target: { field: 'c_x' } })];
    expect(dropField(list, 'c_x').map((l) => l.id)).toEqual(['l1']);
  });
});
