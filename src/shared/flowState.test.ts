import { describe, it, expect } from 'vitest';
import { flowBanner, type FlowInput } from './flowState';
import { FLOW_TEXT } from './labels';

const base: FlowInput = {
  applyState: 'ready',
  filled: 4,
  total: 6,
  siteName: 'Acme Careers',
};

describe('flowBanner', () => {
  it('leads with the confirmation once the site has confirmed it', () => {
    const b = flowBanner({ ...base, applied: true });
    expect(b.key).toBe('applied');
    expect(b.tone).toBe('ok');
    expect(b.title).toMatch(/sent/i);
    // The claim is only as good as the confirmation element that produced it, so
    // the detail names who confirmed rather than claiming it as our own doing.
    expect(b.detail).toContain('Acme Careers');
  });

  it('beats every other state — a sent application is the whole answer', () => {
    for (const applyState of ['ready', 'noButton', 'noConfirmation'] as const) {
      expect(flowBanner({ ...base, applied: true, applyState }).key).toBe('applied');
    }
    expect(flowBanner({ ...base, applied: true, redirect: { followed: true } }).key).toBe('applied');
  });

  it('names the destination of a two-step posting', () => {
    const b = flowBanner({ ...base, redirect: { host: 'ats.acme.test', followed: false } });
    expect(b.key).toBe('external');
    expect(b.tone).toBe('accent');
    expect(b.title).toContain('ats.acme.test');
  });

  it('says so once the handoff has been followed', () => {
    const b = flowBanner({ ...base, redirect: { host: 'ats.acme.test', followed: true } });
    expect(b.key).toBe('externalOpened');
    expect(b.tone).toBe('accent');
  });

  it('falls back to a hostless wording rather than printing "undefined"', () => {
    const b = flowBanner({ ...base, redirect: { followed: false } });
    expect(b.key).toBe('external');
    expect(b.title).not.toMatch(/undefined/);
  });

  /**
   * The two blocked states are the reason this function exists: each needs a
   * different action from the user, and the old UI showed the same grey button
   * for both with the difference buried behind a press.
   */
  it('distinguishes the two reasons Apply cannot run', () => {
    const noButton = flowBanner({ ...base, applyState: 'noButton' });
    expect(noButton.key).toBe('noButton');
    expect(noButton.tone).toBe('warn');
    expect(noButton.help).toBe('apply');

    const noConfirmation = flowBanner({ ...base, applyState: 'noConfirmation' });
    expect(noConfirmation.key).toBe('noConfirmation');
    expect(noConfirmation.tone).toBe('warn');
    expect(noConfirmation.help).toBe('applyUnverified');
  });

  it('keeps the phrases the E2E suite reads back', () => {
    // These two strings are what tells the user which half is missing, and
    // e2e/extension.spec.ts asserts on them; they must survive a reword.
    expect(flowBanner({ ...base, applyState: 'noButton' }).detail).toMatch(/Send button/i);
    expect(flowBanner({ ...base, applyState: 'noConfirmation' }).detail).toMatch(/confirmation element/i);
  });

  it('states that nothing has been sent while the posting is fillable', () => {
    const b = flowBanner(base);
    expect(b.key).toBe('ready');
    expect(b.tone).toBe('quiet');
    expect(b.title).toMatch(/nothing.*sent/i);
    // The counts belong here rather than only in the Fields tab's summary — the
    // Job view is the default, and it said nothing about the fill at all.
    expect(b.detail).toContain('4');
  });

  /**
   * A listing page has no fields *and* no Send button. Its greyed Apply still
   * provokes "why can't I apply?", so the blocked state has to win — answering
   * "nothing to fill here" would leave a dead-looking control unexplained, which
   * is the exact failure the banner exists to prevent.
   */
  it('explains a blocked Apply even on a page with no fields at all', () => {
    const b = flowBanner({ ...base, filled: 0, total: 0, applyState: 'noButton' });
    expect(b.key).toBe('noButton');
    expect(b.help).toBe('apply');
  });

  it('reports an unrecognised form as empty rather than as ready to apply', () => {
    const b = flowBanner({ ...base, filled: 0, total: 0, applyState: 'ready' });
    expect(b.key).toBe('empty');
    expect(b.tone).toBe('quiet');
    expect(b.title).toMatch(/nothing to fill/i);
  });

  it('never returns a key without words for it', () => {
    const inputs: FlowInput[] = [
      base,
      { ...base, applied: true },
      { ...base, redirect: { followed: false } },
      { ...base, redirect: { followed: true } },
      { ...base, applyState: 'noButton' },
      { ...base, applyState: 'noConfirmation' },
      { ...base, filled: 0, total: 0, applyState: 'noButton' },
      { ...base, filled: 0, total: 0, applyState: 'ready' },
    ];
    for (const input of inputs) {
      const b = flowBanner(input);
      expect(FLOW_TEXT[b.key], `${b.key} is unworded`).toBeTruthy();
      expect(b.title.trim()).not.toBe('');
    }
  });
});
