import { describe, it, expect } from 'vitest';
import {
  RECORDING_WARNINGS, compileRecording,
  type BindKey, type RecordFlow, type RecordLeg, type RecordedStep, type Recording,
} from './recording';

/* ---------------- Builders ---------------- */

let clock = 0;

interface StepOver {
  at?: number;
  leg?: RecordLeg;
  url?: string;
  selector?: string;
  label?: string;
  bind?: BindKey;
  to?: string;
  strength?: 'strong' | 'ok' | 'fragile';
}

function step(action: RecordedStep['action'], over: StepOver = {}): RecordedStep {
  clock += 100;
  const { selector, strength = 'strong', ...rest } = over;
  return {
    id: `s${clock}`,
    at: over.at ?? clock,
    leg: 'posting',
    url: 'https://board.test/job/1',
    action,
    label: over.label ?? '',
    ...(selector ? { target: { selector, strength, strategy: 'id' as const } } : {}),
    ...rest,
  };
}

const click = (selector: string, over: StepOver = {}) => step('click', { selector, ...over });
const input = (selector: string, bind: BindKey, over: StepOver = {}) =>
  step('input', { selector, bind, bindSource: 'auto', ...over } as StepOver);
const bindOnly = (selector: string, bind: BindKey, over: StepOver = {}) =>
  step('click', { selector, bind, bindSource: 'user', ...over } as StepOver);

function recording(steps: RecordedStep[], flow: RecordFlow = 'internal'): Recording {
  return {
    flow,
    startedAt: 0,
    postingUrl: 'https://board.test/job/1',
    destinationUrl: steps.some((s) => s.leg === 'destination') ? 'https://ats.test/apply' : undefined,
    steps,
  };
}

beforeEach(() => { clock = 0; });

/* ---------------- 1. Legs ---------------- */

describe('rule 1 — the legs decide which config a step lands in', () => {
  it('keeps an all-posting recording internal', () => {
    const out = compileRecording(recording([click('#expand')]));
    expect(out.flow).toBe('internal');
    expect(out.destination).toBeUndefined();
    expect(out.flowCorrected).toBeFalsy();
  });

  it('splits a two-leg recording into two patches', () => {
    const out = compileRecording(recording([
      click('#apply-external', { label: 'Apply on company site' }),
      step('navigate', { to: 'https://ats.test/apply' }),
      click('#start', { leg: 'destination', url: 'https://ats.test/apply' }),
    ], 'external'));
    expect(out.flow).toBe('external');
    expect(out.posting.url).toBe('https://board.test/job/1');
    expect(out.destination?.url).toBe('https://ats.test/apply');
  });

  /**
   * The chosen flow only ever shaped what the bar prompted for. What actually
   * happened outranks it, in both directions — otherwise a posting the user
   * mislabelled compiles into a config describing a page it never visited.
   */
  it('corrects a recording that contradicts the chosen flow', () => {
    const wentExternal = compileRecording(recording([
      click('#apply'),
      step('navigate', { to: 'https://ats.test/apply' }),
      click('#x', { leg: 'destination' }),
    ], 'internal'));
    expect(wentExternal.flow).toBe('external');
    expect(wentExternal.flowCorrected).toBe(true);

    const stayedHere = compileRecording(recording([click('#expand')], 'external'));
    expect(stayedHere.flow).toBe('internal');
    expect(stayedHere.flowCorrected).toBe(true);
  });
});

/* ---------------- 2. Binds are not clicks ---------------- */

describe('rule 2 — a bound step is never also a prep click', () => {
  it('turns a bound click into its config slot and nothing else', () => {
    const out = compileRecording(recording([
      bindOnly('#desc', 'jobDescription'),
    ]));
    expect(out.posting.extract.jobDescription).toBe('#desc');
    expect(out.posting.prep).toEqual([]);
  });

  it('sends a bound field to fieldOverrides, and the CV to cvUpload', () => {
    const out = compileRecording(recording([
      input('#email', 'field:email'),
      input('#cv', 'field:resume'),
      input('#cover', 'field:coverLetter'),
    ]));
    expect(out.posting.fieldOverrides).toEqual({ email: '#email', coverLetter: '#cover' });
    expect(out.posting.cvUpload).toBe('#cv');
  });

  /**
   * Clicking the file input opens the OS file dialog. The extension attaches the CV
   * with a DataTransfer instead, so replaying that click would pop a dialog over a
   * page the user is not looking at.
   */
  it('drops the click that opened the file dialog once the upload is bound', () => {
    const out = compileRecording(recording([
      click('#cv'),
      input('#cv', 'field:resume'),
    ]));
    expect(out.posting.cvUpload).toBe('#cv');
    expect(out.posting.prep).toEqual([]);
  });

  it('drops an unbound input rather than inventing a step for it', () => {
    const out = compileRecording(recording([step('input', { selector: '#mystery' })]));
    expect(out.posting.prep).toEqual([]);
    expect(out.posting.fieldOverrides).toEqual({});
  });

  it('lets a later bind correct an earlier one for the same slot', () => {
    const out = compileRecording(recording([
      bindOnly('#wrong', 'jobDescription'),
      bindOnly('#right', 'jobDescription'),
    ]));
    expect(out.posting.extract.jobDescription).toBe('#right');
  });
});

/* ---------------- 3. Send is never replayed ---------------- */

describe('rule 3 — nothing that sends an application reaches a prep list', () => {
  it('puts a bound Send button in submitSelector and in no list', () => {
    const out = compileRecording(recording([
      click('#expand'),
      bindOnly('#send', 'submit'),
      bindOnly('.thanks', 'success'),
    ]));
    expect(out.posting.submitSelector).toBe('#send');
    expect(out.posting.prep).toEqual([{ action: 'click', selector: '#expand' }]);
    expect(out.posting.submitCv).toEqual([]);
  });

  /**
   * The dangerous case, and the reason this is a compiler rule rather than a
   * recorder one. The user pressed Send and never told us that is what it was, so
   * the step arrives as an ordinary unbound click — and an ordinary unbound click
   * becomes prep, which runs automatically on every later visit. That would make
   * the extension submit applications on page load, which is the one thing it must
   * never do. A send-shaped label is therefore adopted as the Send button, not
   * replayed.
   */
  it('adopts an unbound send-shaped click as the Send button instead of replaying it', () => {
    const out = compileRecording(recording([
      click('#expand', { label: 'Show more' }),
      click('#go', { label: 'Submit application' }),
    ]));
    expect(out.posting.submitSelector).toBe('#go');
    expect(out.posting.prep).toEqual([{ action: 'click', selector: '#expand' }]);
    expect(out.warnings).toContain(RECORDING_WARNINGS.adoptedSubmit);
  });

  it('drops a second send-shaped click rather than letting it through to prep', () => {
    const out = compileRecording(recording([
      bindOnly('#send', 'submit'),
      click('#send-again', { label: 'Send application' }),
    ]));
    expect(out.posting.submitSelector).toBe('#send');
    expect(JSON.stringify(out.posting)).not.toContain('#send-again');
  });

  it('is not fooled by a Save button, which must stay an ordinary step', () => {
    const out = compileRecording(recording([click('#save', { label: 'Save job' })]));
    expect(out.posting.submitSelector).toBeUndefined();
    expect(out.posting.prep).toEqual([{ action: 'click', selector: '#save' }]);
  });
});

/* ---------------- 4. The internal split ---------------- */

describe('rule 4 — clicks split around the CV and the Send button', () => {
  it('puts clicks before the CV in prep and clicks after it in submitCv', () => {
    const out = compileRecording(recording([
      click('#expand'),
      click('#start-application'),
      input('#cv', 'field:resume'),
      click('#confirm-attachment'),
      bindOnly('#send', 'submit'),
      bindOnly('.thanks', 'success'),
    ]));
    expect(out.posting.prep.map((s) => s.selector)).toEqual(['#expand', '#start-application']);
    expect(out.posting.submitCv.map((s) => s.selector)).toEqual(['#confirm-attachment']);
  });

  it('puts everything in prep when no CV was attached', () => {
    const out = compileRecording(recording([
      click('#a'), click('#b'), bindOnly('#send', 'submit'),
    ]));
    expect(out.posting.prep.map((s) => s.selector)).toEqual(['#a', '#b']);
    expect(out.posting.submitCv).toEqual([]);
  });

  it('drops clicks made after the application was sent', () => {
    const out = compileRecording(recording([
      bindOnly('#send', 'submit'),
      click('#after'),
      bindOnly('.thanks', 'success'),
    ]));
    expect(JSON.stringify(out.posting)).not.toContain('#after');
  });
});

/* ---------------- 5. The external split ---------------- */

describe('rule 5 — the handoff splits the posting from the employer', () => {
  const twoStep = () => recording([
    click('#save-job', { label: 'Save job' }),
    bindOnly('#apply-external', 'applySelector', { label: 'Apply on company site' }),
    step('navigate', { to: 'https://ats.test/apply' }),
    click('#start', { leg: 'destination', url: 'https://ats.test/apply' }),
    input('#cv', 'field:resume', { leg: 'destination', url: 'https://ats.test/apply' }),
    bindOnly('#send', 'submit', { leg: 'destination', url: 'https://ats.test/apply' }),
    bindOnly('.thanks', 'success', { leg: 'destination', url: 'https://ats.test/apply' }),
  ], 'external');

  it('puts the apply link and the steps before it on the posting', () => {
    const out = compileRecording(twoStep());
    expect(out.posting.redirect?.applySelector).toBe('#apply-external');
    expect(out.posting.redirect?.beforeFollow?.map((s) => s.selector)).toEqual(['#save-job']);
  });

  /**
   * `RedirectConfig.beforeFollow` is documented as always optional: these are the
   * board's own courtesies, and a "Save job" that has moved must never be the reason
   * an application does not get made.
   */
  it('marks every before-leaving step optional', () => {
    const out = compileRecording(twoStep());
    expect(out.posting.redirect?.beforeFollow?.every((s) => s.optional)).toBe(true);
  });

  it('puts the form, the Send button and the confirmation on the employer', () => {
    const out = compileRecording(twoStep());
    expect(out.destination?.cvUpload).toBe('#cv');
    expect(out.destination?.prep.map((s) => s.selector)).toEqual(['#start']);
    expect(out.destination?.submitSelector).toBe('#send');
    expect(out.destination?.successSelector).toBe('.thanks');
  });

  it('adopts the click that caused the handoff when nothing was bound as the apply link', () => {
    const out = compileRecording(recording([
      click('#apply-external', { label: 'Apply on company site' }),
      step('navigate', { to: 'https://ats.test/apply' }),
      click('#start', { leg: 'destination' }),
    ], 'external'));
    expect(out.posting.redirect?.applySelector).toBe('#apply-external');
    expect(out.posting.prep).toEqual([]);
  });

  /**
   * The apply link is already `redirect.applySelector`, and `beforeFollow` runs
   * immediately before the handoff — so leaving it in both would press it once as a
   * courtesy step and once as the handoff, opening the employer's form twice.
   */
  it('does not also replay the handoff click before leaving', () => {
    const out = compileRecording(recording([
      click('#save-job', { label: 'Save job' }),
      click('#apply-external', { label: 'Apply on company site' }),
      step('navigate', { to: 'https://ats.test/apply' }),
      click('#start', { leg: 'destination' }),
    ], 'external'));
    expect(out.posting.redirect?.applySelector).toBe('#apply-external');
    expect(out.posting.redirect?.beforeFollow?.map((s) => s.selector)).toEqual(['#save-job']);
  });

  /**
   * A handoff the user marked and then left without touching anything on the far
   * side is still a two-step posting — the navigation is evidence in its own right.
   */
  it('treats the navigation alone as enough to call it a handoff', () => {
    const out = compileRecording(recording([
      click('#apply-external', { label: 'Apply on company site' }),
      step('navigate', { to: 'https://ats.test/apply' }),
    ], 'external'));
    expect(out.flow).toBe('external');
    expect(out.posting.redirect?.applySelector).toBe('#apply-external');
  });
});

/* ---------------- 6. Waits ---------------- */

describe('rule 6 — a pause becomes the click’s own timeout', () => {
  it('leaves a prompt click alone', () => {
    const out = compileRecording(recording([
      click('#a', { at: 100 }), click('#b', { at: 400 }),
    ]));
    expect(out.posting.prep).toEqual([
      { action: 'click', selector: '#a' }, { action: 'click', selector: '#b' },
    ]);
  });

  /**
   * `PrepStep.ms` on a click *is* the `waitForSelector` timeout `prep.ts` gives it,
   * so a slow step needs no second step in front of it. A separate `waitFor` would
   * double the list and wait twice for the same element.
   */
  it('widens the timeout of a click the user waited for', () => {
    const out = compileRecording(recording([
      click('#a', { at: 100 }), click('#slow', { at: 5100 }),
    ]));
    expect(out.posting.prep[1]).toEqual({ action: 'click', selector: '#slow', ms: 10000 });
  });

  it('never waits less than the built-in timeout, or longer than half a minute', () => {
    const out = compileRecording(recording([
      click('#a', { at: 0 }), click('#b', { at: 1500 }), click('#c', { at: 61500 }),
    ]));
    expect(out.posting.prep[1].ms).toBe(5000);
    expect(out.posting.prep[2].ms).toBe(30000);
  });
});

/* ---------------- 7. Duplicates ---------------- */

describe('rule 7 — a double press is one step', () => {
  it('collapses consecutive clicks on the same target', () => {
    const out = compileRecording(recording([
      click('#more'), click('#more'), click('#more'), click('#other'),
    ]));
    expect(out.posting.prep.map((s) => s.selector)).toEqual(['#more', '#other']);
  });

  it('keeps a repeat that is genuinely a repeat, with something between', () => {
    const out = compileRecording(recording([click('#more'), click('#other'), click('#more')]));
    expect(out.posting.prep.map((s) => s.selector)).toEqual(['#more', '#other', '#more']);
  });
});

/* ---------------- 8-9. What the review must say ---------------- */

describe('rules 8 and 9 — what the compiler refuses to be quiet about', () => {
  it('keeps a fragile target but says so', () => {
    const out = compileRecording(recording([
      click('#a', { selector: 'body > div > div:nth-of-type(3) > button', strength: 'fragile', label: 'Next' }),
      bindOnly('#send', 'submit'),
      bindOnly('.thanks', 'success'),
    ]));
    expect(out.posting.prep).toHaveLength(1);
    expect(out.warnings).toContain(RECORDING_WARNINGS.fragileTargets);
  });

  /**
   * Without a confirmation element nothing here can ever be recorded as applied and
   * Apply refuses to send at all — and a recording is the one moment the element is
   * on screen to be pointed at.
   */
  it('warns when no confirmation was marked', () => {
    const out = compileRecording(recording([bindOnly('#send', 'submit')]));
    expect(out.warnings).toContain(RECORDING_WARNINGS.noSuccess);
  });

  it('warns when no Send button was found', () => {
    const out = compileRecording(recording([click('#expand')]));
    expect(out.warnings).toContain(RECORDING_WARNINGS.noSubmit);
  });

  it('says nothing when the recording is complete', () => {
    const out = compileRecording(recording([
      click('#expand'),
      bindOnly('#desc', 'jobDescription'),
      input('#cv', 'field:resume'),
      bindOnly('#send', 'submit'),
      bindOnly('.thanks', 'success'),
    ]));
    expect(out.warnings).toEqual([]);
  });
});

/* ---------------- 10. Which leg owns what ---------------- */

describe('rule 10 — the leg that sends the application owns the sending', () => {
  it('never puts a redirect block on the employer’s config', () => {
    const out = compileRecording(recording([
      bindOnly('#apply-external', 'applySelector'),
      step('navigate', { to: 'https://ats.test/apply' }),
      bindOnly('#send', 'submit', { leg: 'destination' }),
      bindOnly('.thanks', 'success', { leg: 'destination' }),
    ], 'external'));
    expect(out.destination?.redirect).toBeUndefined();
  });

  it('never leaves a Send button on a posting that hands off', () => {
    const out = compileRecording(recording([
      bindOnly('#board-send', 'submit'),
      bindOnly('#apply-external', 'applySelector'),
      step('navigate', { to: 'https://ats.test/apply' }),
      bindOnly('#send', 'submit', { leg: 'destination' }),
      bindOnly('.thanks', 'success', { leg: 'destination' }),
    ], 'external'));
    expect(out.posting.submitSelector).toBeUndefined();
    expect(out.posting.successSelector).toBeUndefined();
    expect(out.destination?.submitSelector).toBe('#send');
    expect(out.warnings).toContain(RECORDING_WARNINGS.sendOnWrongLeg);
  });

  it('keeps the posting’s own job info even when the application is elsewhere', () => {
    const out = compileRecording(recording([
      bindOnly('#desc', 'jobDescription'),
      bindOnly('#apply-external', 'applySelector'),
      step('navigate', { to: 'https://ats.test/apply' }),
      bindOnly('#send', 'submit', { leg: 'destination' }),
      bindOnly('.thanks', 'success', { leg: 'destination' }),
    ], 'external'));
    expect(out.posting.extract.jobDescription).toBe('#desc');
  });
});

/* ---------------- Nothing personal is carried ---------------- */

describe('what a recording is allowed to hold', () => {
  /**
   * The recorder watches someone fill in an application: their name, their address,
   * their salary expectation. It records where those went, never what they were —
   * and the compiler is the second place that has to stay true, because its output
   * is what gets written to storage and shown in the JSON editor.
   */
  it('carries no typed value into the compiled config', () => {
    const typed = step('input', { selector: '#email', bind: 'field:email' }) as RecordedStep & {
      value?: string;
    };
    typed.value = 'someone@example.com';
    const out = compileRecording(recording([typed]));
    expect(JSON.stringify(out)).not.toContain('someone@example.com');
  });
});
