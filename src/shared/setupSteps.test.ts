/**
 * The setup wizard's step model.
 *
 * This is the logic that used to sit inline in `setupPanel.buildCard`, counting
 * "N to do" per section with no test under it. Every rule here is an
 * anti-cry-wolf decision: a panel that reports work on a perfectly healthy site
 * teaches the user to ignore the one step that really is unfinished.
 */
import { describe, it, expect } from 'vitest';
import {
  SETUP_STEP_ORDER, firstStepWithWork, stepStates,
  type SetupRow, type SetupSnapshot,
} from './setupSteps';

function row(over: Partial<SetupRow> = {}): SetupRow {
  return { key: 'k', label: 'L', status: 'high', note: 'auto · #k', hasSave: false, ...over };
}

/** A fully configured, healthy site: nothing outstanding anywhere. */
function snapshot(over: Partial<SetupSnapshot> = {}): SetupSnapshot {
  return {
    name: 'Acme',
    urlPattern: '*://acme.test/*',
    prep: [{ action: 'click', selector: '#apply', resolves: true }],
    containers: [row({ key: 'jobTitle' }), row({ key: 'jobDescription' })],
    // The CV row is always in this list — `main.ts` runs detection over every
    // text field *plus* `resume` — and it is the only one the step counts.
    fields: [row({ key: 'resume' }), row({ key: 'email' }), row({ key: 'fullName' })],
    verdict: { title: 'Quick apply', detail: 'a form was found here', kind: 'quickApply' as const },
    redirect: [
      { key: 'applySelector', label: 'External apply link', status: 'none', note: 'not set', hasSave: false },
      { key: 'quickApplySelector', label: 'Quick-apply marker', status: 'none', note: 'not set', hasSave: false },
    ],
    beforeFollow: [],
    submitCv: [],
    submit: row({ key: 'submitSelector', status: 'low', note: 'auto · Submit' }),
    success: row({ key: 'successSelector', status: 'high', note: 'saved · #done', hasSave: true }),
    ...over,
  };
}

const state = (s: SetupSnapshot, key: string) => stepStates(s).find((x) => x.key === key)!;

describe('setup step order', () => {
  // The order is the order the extension does things in: identify the site,
  // prepare the page, work out where the application lives, read the posting,
  // fill it, send it. A wizard whose steps do not follow the flow is a list.
  it('runs site → prep → kind → info → fields → send', () => {
    expect([...SETUP_STEP_ORDER]).toEqual(['site', 'prep', 'kind', 'info', 'fields', 'send']);
  });

  it('gives every step its position, in order', () => {
    const states = stepStates(snapshot());
    expect(states.map((s) => s.key)).toEqual([...SETUP_STEP_ORDER]);
    expect(states.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('site step', () => {
  it('is settled once it has a URL pattern', () => {
    const s = state(snapshot(), 'site');
    expect(s.todo).toBe(0);
    expect(s.tone).toBe('ok');
    expect(s.summary).toBe('Acme');
  });

  // A config with no pattern matches no page at all, so nothing else in the
  // wizard can ever run. That is work, and it is the only work on this step.
  it('counts a missing URL pattern as work', () => {
    const s = state(snapshot({ urlPattern: '  ' }), 'site');
    expect(s.todo).toBe(1);
    expect(s.tone).toBe('warn');
    expect(s.summary).toMatch(/URL pattern/i);
  });
});

describe('prep step', () => {
  /**
   * Never counted, ever. A `waitFor` whose target has not appeared yet is the
   * *normal* state of a page whose form is behind a click — that is the whole
   * reason the step exists. Counting an unresolved prep target would put a "1 to
   * do" chip on every correctly configured site.
   */
  it('never reports work, even when a step does not resolve yet', () => {
    const s = state(snapshot({
      prep: [{ action: 'waitFor', selector: '#form', ms: 10_000, resolves: false }],
    }), 'prep');
    expect(s.todo).toBe(0);
    expect(s.tone).toBe('ok');
  });

  // An empty list is the ordinary case — most forms are simply there on load —
  // so it reads as "not set", not as "done" and not as a fault.
  it('is untouched when there is nothing to run', () => {
    const s = state(snapshot({ prep: [], submitCv: [], beforeFollow: [] }), 'prep');
    expect(s.tone).toBe('none');
    expect(s.summary).toMatch(/nothing/i);
  });

  it('says how many steps will run', () => {
    const s = state(snapshot({
      prep: [
        { action: 'click', selector: '#a', resolves: true },
        { action: 'delay', ms: 500 },
      ],
    }), 'prep');
    expect(s.summary).toMatch(/2/);
  });

  /**
   * The step renders three lists, so the rail has to summarise three. Counting
   * only the before-filling list told a site whose page actions are entirely
   * "before leaving" or "after attaching the CV" that there was *nothing to
   * run* — on the very step holding them.
   */
  it('counts every list the step renders', () => {
    const s = state(snapshot({
      prep: [{ action: 'click', selector: '#a', resolves: true }],
      submitCv: [{ action: 'click', selector: '#cv-attach', resolves: true }],
      beforeFollow: [{ action: 'click', selector: '#save-job', resolves: true }],
    }), 'prep');
    expect(s.summary).toMatch(/3/);
    expect(s.tone).toBe('ok');
    // Still never work: these lists are optional by nature, and an unresolved
    // target in any of them is the normal state of a page that needs them.
    expect(s.todo).toBe(0);
  });

  it.each(['submitCv', 'beforeFollow'] as const)(
    'is not "nothing to run" when its only steps are %s',
    (list) => {
      const s = state(snapshot({
        prep: [],
        [list]: [{ action: 'click', selector: '#x', resolves: true }],
      }), 'prep');
      expect(s.tone).toBe('ok');
      expect(s.summary).toMatch(/1/);
    },
  );
});

describe('application-type step', () => {
  /**
   * "Not set" everywhere is the healthy, ordinary state of a quick-apply site:
   * these selectors exist only to correct a wrong guess. Counting them the way
   * the field rows are counted labelled every site in the world "2 to do".
   */
  it('does not treat an unset override as work', () => {
    const s = state(snapshot(), 'kind');
    expect(s.todo).toBe(0);
    expect(s.tone).toBe('none');
    expect(s.summary).toMatch(/guessed/i);
  });

  // A selector the user saved that no longer matches is the one real fault
  // here: the correction they made has silently stopped applying.
  it('counts a saved selector that no longer resolves', () => {
    const s = state(snapshot({
      redirect: [
        { key: 'applySelector', label: 'External apply link', status: 'low', note: 'saved selector · no match', hasSave: true },
        { key: 'markerSelector', label: 'External marker', status: 'none', note: 'not set', hasSave: false },
      ],
    }), 'kind');
    expect(s.todo).toBe(1);
    expect(s.tone).toBe('warn');
  });

  it('reads as settled when a saved override still matches', () => {
    const s = state(snapshot({
      redirect: [
        { key: 'applySelector', label: 'External apply link', status: 'high', note: 'saved · → ats.acme.test', hasSave: true },
      ],
    }), 'kind');
    expect(s.todo).toBe(0);
    expect(s.tone).toBe('ok');
  });
});

describe('job-info step', () => {
  it('counts every row that is not a confident match', () => {
    const s = state(snapshot({
      containers: [row(), row({ status: 'low' }), row({ status: 'none' })],
    }), 'info');
    expect(s.todo).toBe(2);
    expect(s.tone).toBe('warn');
    expect(s.summary).toMatch(/2 to do/);
  });

  it('is settled when every row matched', () => {
    const s = state(snapshot(), 'info');
    expect(s.todo).toBe(0);
    expect(s.tone).toBe('ok');
  });
});

describe('form-fields step', () => {
  /**
   * The one row list where an unmatched row is *not* work. A posting asks for
   * four of the sixteen fields the extension knows how to fill; counting the
   * twelve it does not ask for reported "12 to do" on a site with nothing wrong,
   * which is exactly the cry-wolf failure every other rule here avoids.
   */
  it('ignores form fields the page does not ask for', () => {
    const s = state(snapshot({
      fields: [row({ key: 'resume' }), row({ key: 'city', status: 'none' }), row({ key: 'github', status: 'low' })],
    }), 'fields');
    expect(s.todo).toBe(0);
    expect(s.tone).toBe('ok');
  });

  /**
   * The CV is the exception, and the reason this step exists: an application
   * sent without the document attached is the failure the whole surface is
   * there to prevent, so an unmatched `resume` row is always work.
   */
  it('counts an unmatched CV upload', () => {
    const s = state(snapshot({
      fields: [row({ key: 'resume', status: 'none' }), row({ key: 'email' })],
    }), 'fields');
    expect(s.todo).toBe(1);
    expect(s.tone).toBe('warn');
    expect(s.summary).toMatch(/cv/i);
  });

  // Found but not fillable is not found: a `low` CV row cannot be relied on.
  //
  // It still must not be *described* as nothing found. `low` is the ordinary
  // outcome of the unlabelled-file-input fallback (`fieldDetect.ts`) and of a
  // saved `cvUpload` pointing at a wrapper, so a page that plainly has an upload
  // was telling a screen-reader user — this string is the rail node's whole
  // accessible name — that there was none.
  it('counts a CV upload that only weakly matched', () => {
    const s = state(snapshot({
      fields: [row({ key: 'resume', status: 'low' }), row({ key: 'email' })],
    }), 'fields');
    expect(s.todo).toBe(1);
    expect(s.tone).toBe('warn');
    expect(s.summary).toMatch(/cv/i);
    expect(s.summary).not.toMatch(/no cv|not found/i);
  });

  // A page with no file input at all has no `resume` row to look at, and that is
  // the same answer: nothing here can attach the CV.
  it('counts a page with no CV row at all', () => {
    const s = state(snapshot({ fields: [row({ key: 'email' })] }), 'fields');
    expect(s.todo).toBe(1);
    expect(s.tone).toBe('warn');
  });

  it('is untouched when no fields were detected', () => {
    const s = state(snapshot({ fields: [] }), 'fields');
    expect(s.todo).toBe(0);
    expect(s.tone).toBe('none');
    expect(s.summary).toMatch(/nothing/i);
  });
});

describe('sending step', () => {
  /**
   * A Send button found by its label is the ordinary healthy state — most sites
   * need no override at all. Counting it made every site look unfinished, which
   * is the same mistake the redirect rows avoid.
   */
  it('does not count a Send button found by its label', () => {
    const s = state(snapshot(), 'send');
    expect(s.todo).toBe(0);
    expect(s.tone).toBe('ok');
    expect(s.summary).toMatch(/ready/i);
  });

  it('counts a page where no Send button was found at all', () => {
    const s = state(snapshot({ submit: row({ status: 'none', hasSave: false }) }), 'send');
    expect(s.todo).toBe(1);
    expect(s.summary).toMatch(/send button/i);
  });

  /**
   * Unlike every other row in the wizard there is no healthy "not set" here.
   * Without a confirmation element nothing on this site can ever be recorded as
   * applied, and Apply refuses to send — so this is always outstanding work.
   */
  it('always counts a missing confirmation element', () => {
    const s = state(snapshot({ success: row({ status: 'none', hasSave: false }) }), 'send');
    expect(s.todo).toBe(1);
    expect(s.tone).toBe('warn');
    expect(s.summary).toMatch(/confirmation/i);
  });

  it('names both when neither is set', () => {
    const s = state(snapshot({
      submit: row({ status: 'none' }),
      success: row({ status: 'none' }),
    }), 'send');
    expect(s.todo).toBe(2);
    expect(s.summary).toMatch(/send button/i);
    expect(s.summary).toMatch(/confirmation/i);
  });
});

describe('firstStepWithWork', () => {
  // What the panel opens on for a returning user: the work that is left, not a
  // walk through five steps that are already done.
  it('is the earliest step with something outstanding', () => {
    const s = snapshot({
      fields: [row({ key: 'resume', status: 'none' })],
      success: row({ status: 'none' }),
    });
    expect(firstStepWithWork(stepStates(s))).toBe(SETUP_STEP_ORDER.indexOf('fields'));
  });

  it('finds the sending step when only the confirmation is missing', () => {
    const s = snapshot({ success: row({ status: 'none' }) });
    expect(firstStepWithWork(stepStates(s))).toBe(SETUP_STEP_ORDER.indexOf('send'));
  });

  it('is -1 for a site with nothing left to do', () => {
    expect(firstStepWithWork(stepStates(snapshot()))).toBe(-1);
  });
});
