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
    expect(flowBanner({ ...base, applied: true, appLink: true }).key).toBe('applied');
  });

  /**
   * The state the modal had no way of reaching: a posting whose record already
   * says `applied`, revisited. Nothing happened on this page-load, so it cannot
   * borrow `applied`'s wording ("Acme Careers confirmed it") — but it retires the
   * same two controls, so it carries the same explanation behind its `?`.
   */
  it('recognises a posting that was applied to on an earlier visit', () => {
    const b = flowBanner({ ...base, alreadyApplied: true });
    expect(b.key).toBe('alreadyApplied');
    expect(b.tone).toBe('ok');
    expect(b.help).toBe('alreadyApplied');
    expect(b.title).toMatch(/already applied/i);
    expect(b.detail).toContain('Acme Careers');
  });

  it('names the date when the record carries one', () => {
    const at = Date.UTC(2026, 2, 14);
    const b = flowBanner({ ...base, alreadyApplied: true, appliedAt: at });
    // Locale-formatted, so the year is what can be asserted without pinning the
    // test to one machine's date order.
    expect(b.detail).toContain(String(new Date(at).getFullYear()));
    // Mid-sentence, before the clause about the buttons — appended it read as
    // "…are retired here on 5/12/2026".
    expect(b.detail).toMatch(/recorded as applied on .*, so/);
    // And it must not invent one, or leave the slot showing, when the entry
    // predates `appliedAt`.
    const undated = flowBanner({ ...base, alreadyApplied: true }).detail;
    expect(undated).not.toMatch(/undefined|NaN|\{when\}/);
    expect(undated).toMatch(/recorded as applied, so/);
  });

  it('outranks everything except a confirmation that just arrived', () => {
    // Same reasoning as `applied`: once a posting is recorded as done, a blocked
    // Apply or a pending handoff cannot still be the useful answer.
    for (const applyState of ['ready', 'noButton', 'noConfirmation'] as const) {
      expect(flowBanner({ ...base, alreadyApplied: true, applyState }).key).toBe('alreadyApplied');
    }
    expect(flowBanner({ ...base, alreadyApplied: true, appLink: true }).key).toBe('alreadyApplied');
    expect(flowBanner({ ...base, alreadyApplied: true, redirect: { followed: false } }).key)
      .toBe('alreadyApplied');
    expect(flowBanner({ ...base, alreadyApplied: true, filled: 0, total: 0 }).key)
      .toBe('alreadyApplied');
    // A send that just landed is the more specific truth, and keeps its receipt.
    expect(flowBanner({ ...base, alreadyApplied: true, applied: true }).key).toBe('applied');
  });

  /**
   * Skip is retired on a fresh send too now, so that state needs the same
   * explanation it never had — otherwise a control goes grey with nothing to press
   * for a reason.
   */
  it('explains the retired controls on a fresh confirmation as well', () => {
    expect(flowBanner({ ...base, applied: true }).help).toBe('alreadyApplied');
  });

  it('explains an apply control that opens an app', () => {
    const b = flowBanner({ ...base, appLink: true });
    expect(b.key).toBe('appLink');
    expect(b.tone).toBe('warn');
    expect(b.help).toBe('appLink');
    expect(b.title).toMatch(/app/i);
  });

  it('an app link outranks the redirect states — nothing was opened', () => {
    // A configured two-step site whose apply link turns out to be an app link is
    // both at once, and "Opening the employer's application" would be a lie.
    for (const followed of [false, true]) {
      const b = flowBanner({ ...base, appLink: true, redirect: { host: 'ats.acme.test', followed } });
      expect(b.key).toBe('appLink');
    }
  });

  it('an app link outranks a blocked Apply and an empty page', () => {
    // Same reason `noButton` beats `empty`: the narrower explanation is the useful
    // one. An app-link posting has no Send button *because* the form is elsewhere.
    expect(flowBanner({ ...base, appLink: true, applyState: 'noButton' }).key).toBe('appLink');
    expect(flowBanner({ ...base, appLink: true, applyState: 'noButton', total: 0 }).key).toBe('appLink');
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

  /**
   * `total` is the number of *rows in the report*, and `main.ts` builds one row
   * per field it has something to fill with (`wantedFields`) — so zero rows means
   * an empty profile, never a page with no form. A page whose fields all went
   * unrecognised still reports one row each and lands on `ready`.
   *
   * The banner used to say "No application form was found here", which blamed
   * the site for a state only the profile can cause — and it is reachable on the
   * first run the getting-started checklist walks a new user through.
   */
  it('blames the empty profile, not the page, when there is nothing to fill with', () => {
    const b = flowBanner({ ...base, filled: 0, total: 0, applyState: 'ready' });
    expect(b.key).toBe('empty');
    expect(b.tone).toBe('quiet');
    expect(b.title).not.toMatch(/this page|found here/i);
    expect(`${b.title} ${b.detail}`).toMatch(/profile/i);
  });

  // The other side of the same rule: rows that matched nothing are still rows.
  it('is ready, not empty, when the page was read but nothing matched', () => {
    const b = flowBanner({ ...base, filled: 0, total: 12, applyState: 'ready' });
    expect(b.key).toBe('ready');
  });

  it('never returns a key without words for it', () => {
    const inputs: FlowInput[] = [
      base,
      { ...base, applied: true },
      { ...base, alreadyApplied: true },
      { ...base, alreadyApplied: true, appliedAt: Date.UTC(2026, 2, 14) },
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
