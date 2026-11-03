import { describe, it, expect } from 'vitest';
import type { TypedAnswer } from './types';
import { MAX_QUESTIONS, dismissAnswer, recordAnswer, sortedAnswers } from './typedAnswers';

const typed = (value: string, question = 'Current title') => ({ value, question, kind: 'text' as const });

describe('recordAnswer', () => {
  it('starts a record at one', () => {
    const out = recordAnswer([], typed('Software developer'), 10);
    expect(out).toEqual([{
      key: 'software developer', value: 'Software developer', kind: 'text', count: 1,
      questions: ['Current title'], firstAt: 10, lastAt: 10,
    }]);
  });

  it('counts the same answer again, whatever its spacing or case', () => {
    let list = recordAnswer([], typed('Software developer'), 10);
    list = recordAnswer(list, typed('  software   Developer ', 'Job title'), 20);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      count: 2, value: 'software   Developer'.replace(/\s+/g, ' '), firstAt: 10, lastAt: 20,
      questions: ['Job title', 'Current title'],
    });
  });

  it('keeps a few questions, most recent first, without repeats', () => {
    let list: TypedAnswer[] = [];
    for (const [i, q] of ['A', 'B', 'A', 'C', 'D', 'E', 'F', 'G'].entries()) list = recordAnswer(list, typed('x y z', q), i);
    expect(list[0].questions).toEqual(['G', 'F', 'E', 'D', 'C'].slice(0, MAX_QUESTIONS));
  });

  it('remembers the field it was typed over', () => {
    const out = recordAnswer([], { ...typed('050 1234567', 'Phone'), field: 'phone' }, 1);
    expect(out[0].field).toBe('phone');
  });

  it('ignores an empty answer', () => {
    const list: TypedAnswer[] = [];
    expect(recordAnswer(list, typed('   '), 1)).toBe(list);
  });

  it('holds at most `cap` records, dropping the least used, oldest first', () => {
    let list = recordAnswer([], typed('keep me'), 1);
    list = recordAnswer(list, typed('keep me'), 2);
    list = recordAnswer(list, typed('old'), 3);
    list = recordAnswer(list, typed('new'), 4, 2);
    expect(list.map((a) => a.key).sort()).toEqual(['keep me', 'new']);
  });
});

describe('dismissAnswer / sortedAnswers', () => {
  it('dismisses by key', () => {
    const list = recordAnswer(recordAnswer([], typed('a b c'), 1), typed('d e f'), 2);
    expect(dismissAnswer(list, 'a b c').map((a) => a.key)).toEqual(['d e f']);
  });

  it('lists the most used first, then the most recent', () => {
    let list = recordAnswer([], typed('once'), 1);
    list = recordAnswer(list, typed('twice'), 2);
    list = recordAnswer(list, typed('twice'), 3);
    list = recordAnswer(list, typed('later'), 5);
    expect(sortedAnswers(list).map((a) => a.key)).toEqual(['twice', 'later', 'once']);
  });
});
