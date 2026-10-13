import { describe, it, expect } from 'vitest';
import { flowBanner, type FlowInput } from './flowState';
import { FLOW_TEXT } from './labels';

const base: FlowInput = { total: 4, filled: 3, toTeach: 1 };

describe('flowBanner', () => {
  it('rests on "submit on the site", with the counts', () => {
    const b = flowBanner(base);
    expect(b.key).toBe('ready');
    expect(b.tone).toBe('quiet');
    expect(b.title).toMatch(/submit on the site/i);
    expect(b.detail).toMatch(/^3 filled · 1 to teach/);
  });

  it('leaves "to teach" out of the line when there is none', () => {
    expect(flowBanner({ total: 2, filled: 2, toTeach: 0 }).detail).toMatch(/^2 filled — /);
  });

  it('a page whose questions are all new is an invitation, not a failure', () => {
    const b = flowBanner({ total: 3, filled: 0, toTeach: 3 });
    expect(b.key).toBe('nothing');
    expect(b.help).toBe('teaching');
  });

  it('blames the empty profile, not the page', () => {
    expect(flowBanner({ ...base, profileEmpty: true }).key).toBe('empty');
  });

  it('an applied record outranks everything, with its date when it has one', () => {
    const at = new Date(2026, 4, 12).getTime();
    const b = flowBanner({ ...base, profileEmpty: true, alreadyApplied: true, appliedAt: at, siteName: 'jobs.acme.test' });
    expect(b.key).toBe('alreadyApplied');
    expect(b.detail).toContain(new Date(at).toLocaleDateString());
    expect(b.detail.startsWith('jobs.acme.test')).toBe(true);
    expect(flowBanner({ ...base, alreadyApplied: true }).detail).not.toMatch(/undefined|\{when\}/);
  });

  it('never returns a key without words for it', () => {
    const inputs: FlowInput[] = [base, { total: 0, filled: 0, toTeach: 0 }, { ...base, alreadyApplied: true }, { ...base, profileEmpty: true }, { total: 1, filled: 0, toTeach: 1 }];
    for (const i of inputs) expect(FLOW_TEXT[flowBanner(i).key]).toBeDefined();
  });
});
