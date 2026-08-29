/**
 * Render tests for the setup wizard.
 *
 * The panel is where a new user is most lost. It used to stack five sections of
 * jargon in one scroll, auto-opening every one that had unresolved rows; these
 * assert the wizard that replaced it — that exactly one step is on screen, that
 * moving between them works, that the explanation is actually reachable, and
 * above all that a re-scan of the page does not throw the user back to step 1.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { SetupPanel, type SetupCallbacks, type SetupData } from './setupPanel';
import { REDIRECT_HELP, SETUP_STEP_HELP, SETUP_STEP_TITLES } from '../shared/help';
import { SETUP_STEP_ICONS, SETUP_STEP_ORDER } from '../shared/setupSteps';
import {
  ACTION_LABELS, MARK_GROUP_TEXT, RECORD_PASS_TEXT, SELECTOR_STRENGTH_TEXT,
  SETUP_STATUS_TEXT,
} from '../shared/labels';
import {
  RECORDING_NOTES, RECORDING_WARNINGS, compileRecording, type CompiledSetup,
  type Recording,
} from '../shared/recording';

const noop = () => {};

function callbacks(over: Partial<SetupCallbacks> = {}): SetupCallbacks {
  return {
    onAddPrep: noop, onPickPrepTarget: noop, onMovePrep: noop, onRemovePrep: noop,
    onSetPrepMs: noop, onRunPrep: noop, onPickContainer: noop, onClearContainer: noop,
    onPickField: noop, onClearField: noop, onPickRedirect: noop, onClearRedirect: noop,
    onPickSubmit: noop, onClearSubmit: noop, onPickSuccess: noop, onClearSuccess: noop,
    onRename: noop, onOpenOptions: noop, onClose: noop, onDismissHelp: noop,
    onStartRecording: noop, onMarkConfirmation: noop, onRebindStep: noop,
    onRepickStep: noop, onRemoveStep: noop,
    onSaveRecording: noop, onDiscardRecording: noop,
    ...over,
  };
}

/**
 * A fully configured site, so nothing is outstanding and the panel opens on
 * step 1. Tests that care about where it opens supply their own gaps.
 */
function data(over: Partial<SetupData> = {}): SetupData {
  return {
    name: 'Acme',
    urlPattern: '*://acme.com/*',
    prep: [],
    containers: [{ key: 'jobTitle', label: 'Job title', status: 'high', note: 'auto · h1', hasSave: false }],
    // The CV row is the only one the `fields` step counts, so a healthy fixture
    // has to carry a matched one — without it the panel opens on step 5.
    fields: [
      { key: 'resume', label: 'CV / Résumé', status: 'high', note: 'auto · #cv', hasSave: false },
      { key: 'email', label: 'Email', status: 'high', note: 'auto · #email', hasSave: false },
    ],
    verdict: { title: 'Quick apply', detail: 'a form was found here', kind: 'quickApply' as const },
    redirect: [],
    beforeFollow: [],
    submitCv: [],
    submit: { key: 'submitSelector', label: 'Send button', status: 'low', note: 'auto · Apply', hasSave: false },
    success: { key: 'successSelector', label: 'Confirmation element', status: 'high', note: 'saved · #done', hasSave: true },
    helpSeen: true,
    ...over,
  };
}

/**
 * A brand-new config: nothing saved, no page actions — which is what
 * `isUnconfigured` tests and so what routes the panel to the offer.
 */
function fresh(over: Partial<SetupData> = {}): SetupData {
  return data({
    prep: [],
    containers: [{ key: 'jobTitle', label: 'Job title', status: 'high', note: 'auto · h1', hasSave: false }],
    // One row of each status, because the offer screen now counts and names them and
    // a fixture that cannot produce a `low` cannot show the one chip that is worded.
    fields: [
      { key: 'resume', label: 'CV / Résumé', status: 'none', note: 'not found', hasSave: false },
      { key: 'email', label: 'Email', status: 'high', note: 'auto · #email', hasSave: false },
      { key: 'phone', label: 'Phone', status: 'low', note: 'auto (low) · .f input', hasSave: false },
    ],
    submit: { key: 'submitSelector', label: 'Send button', status: 'none', note: 'not found', hasSave: false },
    success: { key: 'successSelector', label: 'Confirmation element', status: 'none', note: 'not set', hasSave: false },
    ...over,
  });
}

/**
 * A site the **first pass** has taught and the second has not: it can fill and it
 * knows what sends it, and nothing here can yet tell that an application landed.
 * That is the ordinary ending of a recording, so it is the shape most of the home
 * screen's interesting states are.
 */
function beforeSendDone(over: Partial<SetupData> = {}): SetupData {
  return data({
    fields: [
      { key: 'resume', label: 'CV / Résumé', status: 'high', note: 'saved · #cv', hasSave: true },
      { key: 'email', label: 'Email', status: 'high', note: 'auto · #email', hasSave: false },
    ],
    success: { key: 'successSelector', label: 'Confirmation element', status: 'none', note: 'not set', hasSave: false },
    ...over,
  });
}

let panel: SetupPanel | undefined;

/**
 * Open the panel where a user opens it: on home, on every site.
 *
 * It used to route to the wizard for anything with a single saved selector, which is
 * exactly what this rework undid — so a test that wants the wizard has to press for
 * it, the same as anyone else. `render` below is that press.
 */
function mount(d: SetupData, cb = callbacks()): ShadowRoot {
  // Tear down anything already mounted. Both hosts carry the same element id, so a
  // second panel left the *first* one's shadow root as what `getElementById` returns
  // — every assertion after it silently read a stale card, and `afterEach` only ever
  // destroyed the last panel, so the leak outlived the test that caused it.
  panel?.destroy();
  panel = new SetupPanel(cb);
  panel.render(d);
  return (document.getElementById('chromium-filler-setup-host') as HTMLElement).shadowRoot!;
}

/** Home's footer leads with the way into the manual surface, on both its wordings. */
const manualBtn = (s: ShadowRoot) => s.querySelector<HTMLButtonElement>('.cf-footer .cf-btn')!;

/** Mount, then take the deliberate press into the wizard the rest of these assert. */
function render(d: SetupData, cb = callbacks()): ShadowRoot {
  const s = mount(d, cb);
  manualBtn(s).click();
  return s;
}

/** The step title currently on screen. */
const shown = (s: ShadowRoot) => s.querySelector('.cf-step-title')!.textContent;
const nextBtn = (s: ShadowRoot) =>
  [...s.querySelectorAll<HTMLButtonElement>('.cf-footer .cf-btn')].at(-1)!;
const backBtn = (s: ShadowRoot) => s.querySelector<HTMLButtonElement>('.cf-footer .cf-btn')!;

afterEach(() => {
  panel?.destroy();
  panel = undefined;
});

describe('setup wizard steps', () => {
  it('shows one step at a time, titled', () => {
    const shadow = render(data());
    expect(shadow.querySelectorAll('.cf-step-title').length).toBe(1);
    expect(shown(shadow)).toBe(SETUP_STEP_TITLES.site);
    // The site step's inputs are here; the field rows of step 5 are not.
    expect(shadow.querySelector('.cf-identity')).toBeTruthy();
    expect(shadow.textContent).not.toContain('Email');
  });

  it('says where you are in the run', () => {
    const shadow = render(data());
    expect(shadow.querySelector('.cf-step-count')?.textContent)
      .toBe(`Step 1 of ${SETUP_STEP_ORDER.length}`);
  });

  it('walks forward and back one step at a time', () => {
    const shadow = render(data());
    nextBtn(shadow).click();
    expect(shown(shadow)).toBe(SETUP_STEP_TITLES.prep);
    nextBtn(shadow).click();
    expect(shown(shadow)).toBe(SETUP_STEP_TITLES.kind);
    backBtn(shadow).click();
    expect(shown(shadow)).toBe(SETUP_STEP_TITLES.prep);
  });

  it('cannot go back off the front', () => {
    const shadow = render(data());
    expect(backBtn(shadow).hasAttribute('disabled')).toBe(true);
  });

  // Finishing the last step and finishing with the site are the same act, so
  // the wizard ends on the button the old footer carried permanently.
  it('ends on Done, which closes the panel', () => {
    let closed = 0;
    const shadow = render(data(), callbacks({ onClose: () => { closed += 1; } }));
    for (let i = 1; i < SETUP_STEP_ORDER.length; i += 1) nextBtn(shadow).click();
    expect(shown(shadow)).toBe(SETUP_STEP_TITLES.send);
    expect(nextBtn(shadow).textContent).toBe('Done');
    nextBtn(shadow).click();
    expect(closed).toBe(1);
  });

  /**
   * The regression that would make the wizard unusable. `refreshSetup` re-renders
   * on every Pick, prep edit and rename, so a step derived from the data would
   * send the user back to step 1 each time they picked a single field.
   */
  it('stays on the same step across a re-render', () => {
    const shadow = render(data());
    nextBtn(shadow).click();
    nextBtn(shadow).click();
    expect(shown(shadow)).toBe(SETUP_STEP_TITLES.kind);

    panel!.render(data({
      verdict: { title: 'External application', detail: 'configured apply link', kind: 'redirect' },
    }));
    expect(shown(shadow)).toBe(SETUP_STEP_TITLES.kind);
  });

  // The design-system rule the review modal's footer follows too: the coral is
  // the one thing the surface is for, and a wizard has exactly one next action.
  it('has exactly one primary button', () => {
    const shadow = render(data());
    expect(shadow.querySelectorAll('.cf-card .cf-btn.primary').length).toBe(1);
  });
});

/**
 * The other half of "an edit does not start fresh". The step surviving a
 * re-render is no use if the re-render still scrolls you to the top, drops your
 * focus and wipes what you were typing — `paint` replaces the whole `.cf-card`,
 * so all three went every time until `Sheet` learned to put them back.
 *
 * Scroll is the one piece that cannot be asserted here: jsdom does no layout, so
 * `scrollTop` never leaves 0. It is covered by an E2E in a real browser.
 */
describe('an edit keeps the user where they were', () => {
  const fieldRows = [
    { key: 'resume', label: 'CV / Résumé', status: 'high', note: 'auto · #cv', hasSave: false },
    { key: 'email', label: 'Email', status: 'high', note: 'auto · #email', hasSave: false },
    { key: 'city', label: 'City', status: 'none', note: 'not found', hasSave: false },
  ] as const;

  it('returns focus to the control that was focused', () => {
    const shadow = render(data({ fields: [...fieldRows] }));
    shadow.querySelectorAll<HTMLButtonElement>('.cf-rail-node')[4].click();

    const pickCity = shadow.querySelector<HTMLButtonElement>('[data-k="field:city"]')!;
    pickCity.focus();
    expect(shadow.activeElement).toBe(pickCity);

    panel!.render(data({ fields: [...fieldRows] }));
    // A different element — the card was rebuilt — but the same control.
    expect((shadow.activeElement as HTMLElement).dataset.k).toBe('field:city');
  });

  /**
   * The Name and URL-pattern inputs commit on `change`, i.e. on blur. A refresh
   * landing before that blur used to throw the typing away with no warning and
   * nothing to undo.
   */
  it('keeps text typed but not yet committed', () => {
    const shadow = render(data());
    const name = shadow.querySelector<HTMLInputElement>('[data-k="site:name"]')!;
    name.focus();
    name.value = 'Acme Careers';

    panel!.render(data());
    expect(shadow.querySelector<HTMLInputElement>('[data-k="site:name"]')!.value)
      .toBe('Acme Careers');
  });

  /**
   * The opposite mistake, and the worse one: a remembered value written back
   * into a field nobody is editing would beat the fresh config read that
   * `refreshSetup` exists to make, and the panel would show stale data forever.
   */
  it('lets fresh data win in a field the user is not editing', () => {
    const shadow = render(data());
    shadow.querySelector<HTMLInputElement>('[data-k="site:name"]')!.value = 'stale';

    panel!.render(data({ name: 'Renamed elsewhere' }));
    expect(shadow.querySelector<HTMLInputElement>('[data-k="site:name"]')!.value)
      .toBe('Renamed elsewhere');
  });

  // A prep row can be deleted by the very edit being rendered, so the control
  // that had focus legitimately no longer exists. That is not an error.
  it('survives the focused control disappearing', () => {
    const shadow = render(data({
      prep: [{ action: 'delay', ms: 500 }, { action: 'delay', ms: 900 }],
    }));
    shadow.querySelectorAll<HTMLButtonElement>('.cf-rail-node')[1].click();
    shadow.querySelector<HTMLInputElement>('[data-k="prep:prep:1:ms"]')!.focus();

    expect(() => panel!.render(data({ prep: [{ action: 'delay', ms: 500 }] }))).not.toThrow();
    expect(shadow.querySelector('[data-k="prep:prep:1:ms"]')).toBeNull();
  });
});

describe('setup wizard rail', () => {
  it('has a node per step, the current one marked', () => {
    const shadow = render(data());
    const nodes = shadow.querySelectorAll('.cf-rail-node');
    expect(nodes.length).toBe(SETUP_STEP_ORDER.length);
    expect(nodes[0].getAttribute('aria-current')).toBe('step');
    expect(nodes[1].hasAttribute('aria-current')).toBe(false);
  });

  // Status is never colour alone: each node reads out which step it is, what it
  // is called, and what it still needs.
  it('names each step and its outstanding work', () => {
    const shadow = render(data({
      fields: [{ key: 'resume', label: 'CV / Résumé', status: 'none', note: 'not found', hasSave: false }],
    }));
    const label = [...shadow.querySelectorAll('.cf-rail-node')]
      .map((n) => n.getAttribute('aria-label'))
      .find((l) => l?.includes(SETUP_STEP_TITLES.fields));
    expect(label).toMatch(/Step 5/);
    expect(label).toMatch(/no CV/i);
  });

  // The other half of the same rule, on a step that does count rows: the label
  // has to carry the number, not just the fact that something is outstanding.
  it('counts the work in the label where the step counts rows', () => {
    const shadow = render(data({
      containers: [{ key: 'jobTitle', label: 'Job title', status: 'none', note: 'not found', hasSave: false }],
    }));
    const label = [...shadow.querySelectorAll('.cf-rail-node')]
      .map((n) => n.getAttribute('aria-label'))
      .find((l) => l?.includes(SETUP_STEP_TITLES.info));
    expect(label).toMatch(/1 to do/);
  });

  // There is no separate index screen, so this is how someone who opened the
  // panel to re-pick one field gets to it without six taps of Next.
  it('jumps to the step whose node is pressed', () => {
    const shadow = render(data());
    shadow.querySelectorAll<HTMLButtonElement>('.cf-rail-node')[4].click();
    expect(shown(shadow)).toBe(SETUP_STEP_TITLES.fields);
  });

  /**
   * Which step a node is, drawn. Six identical dots said only that there were
   * six of something — the step's name was in the `aria-label` and nowhere a
   * sighted user could read it without clicking through.
   */
  it('draws each step its own mark, in wizard order', () => {
    const shadow = render(data());
    const marks = [...shadow.querySelectorAll<HTMLElement>('.cf-rail-node .cf-rail-icon')]
      .map((i) => i.style.getPropertyValue('--i'));
    expect(marks).toEqual(SETUP_STEP_ORDER.map((k) => `var(${SETUP_STEP_ICONS[k]})`));
  });

  /**
   * The mark and the dot are two signals, not one. Swapping a step glyph into
   * the `.cf-dot` would read fine and quietly cost the shape half of "status is
   * never colour alone" — so the dot has to still be there, still classed.
   */
  it('keeps the status dot beside the mark', () => {
    const shadow = render(data({
      fields: [{ key: 'resume', label: 'CV / Résumé', status: 'none', note: 'not found', hasSave: false }],
    }));
    const fields = shadow.querySelectorAll('.cf-rail-node')[4];
    expect(fields.querySelector('.cf-rail-icon')).not.toBeNull();
    expect(fields.querySelector('.cf-dot.warn')).not.toBeNull();
  });

  // Decorative: the node's own label already names the step and its work, and a
  // reader announcing the mark as well would say everything twice.
  it('hides the mark from screen readers', () => {
    const shadow = render(data());
    for (const icon of shadow.querySelectorAll('.cf-rail-icon')) {
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    }
  });
});

describe('where the wizard opens', () => {
  // What the old auto-opening sections were reaching for: the work that is left.
  // A site that *has* been taught something — a saved field — but whose
  // confirmation never got marked. The shape a recording leaves when one mark was
  // missed, and the reason this opens on the wizard rather than on the offer.
  const taughtButUnfinished = beforeSendDone;

  it('opens on the earliest step that still needs something', () => {
    expect(shown(render(taughtButUnfinished()))).toBe(SETUP_STEP_TITLES.send);
  });

  it('opens on step 1 when the site is fully configured', () => {
    expect(shown(render(data()))).toBe(SETUP_STEP_TITLES.site);
  });

  /**
   * A first-time user is walked from the beginning, legend and all — dropping
   * someone who has never seen the panel into step 6 explains nothing.
   */
  it('opens on step 1 for a user who has never used it', () => {
    const shadow = render({ ...taughtButUnfinished(), helpSeen: false });
    expect(shown(shadow)).toBe(SETUP_STEP_TITLES.site);
  });
});

describe('setup wizard help', () => {
  it('says what the panel is for, and that nothing is sent unasked', () => {
    const intro = render(data()).querySelector('.cf-intro');
    expect(intro?.textContent).toMatch(/set up|teach/i);
    expect(intro?.textContent).toMatch(/sends nothing until you press/i);
  });

  // The whole complaint about the old panel: the prose existed and lived behind
  // a `?` nobody pressed. With one step on screen it leads the step.
  it('leads every step with its own explanation', () => {
    const shadow = render(data());
    for (const key of SETUP_STEP_ORDER) {
      panel!.setStep(key);
      expect(shadow.querySelector('.cf-step-lead')?.textContent, key)
        .toContain(SETUP_STEP_HELP[key].body.slice(0, 40));
    }
  });

  it('keeps the row-by-row reference behind the ?', () => {
    const shadow = render(data());
    panel!.setStep('kind');
    expect(shadow.querySelector('.cf-help')).toBeNull();

    shadow.querySelector<HTMLButtonElement>('.cf-step-head .cf-help-btn')!.click();
    const help = shadow.querySelector('.cf-help');
    expect(help?.textContent).toContain(SETUP_STEP_HELP.kind.title);
    for (const row of SETUP_STEP_HELP.kind.rows ?? []) {
      expect(help?.textContent).toContain(row.label);
    }
  });

  /**
   * The reference has to reach the panel *with* its concrete selector. The step
   * is where you press Pick, and a rule with no example of what to pick sent the
   * user to the Options page to find one.
   */
  it('shows a row’s example beside it', () => {
    const shadow = render(data());
    panel!.setStep('kind');
    shadow.querySelector<HTMLButtonElement>('.cf-step-head .cf-help-btn')!.click();

    const example = REDIRECT_HELP.quickApplySelector.example!;
    const li = [...shadow.querySelectorAll('.cf-help-rows > li')]
      .find((el) => el.textContent?.includes('Quick-apply marker'));
    expect(li?.querySelector('.cf-help-example')?.textContent).toBe(example);
  });

  it('presses ? again to close', () => {
    const shadow = render(data());
    const button = () => shadow.querySelector<HTMLButtonElement>('.cf-step-head .cf-help-btn')!;
    button().click();
    expect(shadow.querySelector('.cf-help')).toBeTruthy();
    button().click();
    expect(shadow.querySelector('.cf-help')).toBeNull();
  });

  // The panel re-renders on every re-scan of the page; folding the explanation
  // away under the user mid-read would make it useless.
  it('keeps an opened explanation open across a re-render', () => {
    const shadow = render(data());
    shadow.querySelector<HTMLButtonElement>('.cf-step-head .cf-help-btn')!.click();
    expect(shadow.querySelectorAll('.cf-help').length).toBe(1);

    panel!.render(data({
      verdict: { title: 'External application', detail: 'configured apply link', kind: 'redirect' },
    }));
    expect(shadow.querySelectorAll('.cf-help').length).toBe(1);
  });
});

describe('setup wizard step contents', () => {
  const beforeFollow = [{ action: 'click', selector: '#save-job', resolves: true }] as const;
  const submitCv = [{ action: 'click', selector: '#cv-attach', resolves: true }] as const;

  /**
   * All three prep lists are the same thing — clicks and waits this site needs
   * around what the extension does — and each of the other two used to sit on a
   * step about something else: "before leaving" under three redirect selectors,
   * "after attaching the CV" above the two rows Apply depends on. Both were the
   * odd list out on a step whose own lead paragraph did not describe them.
   */
  it('renders all three prep lists on the page-actions step', () => {
    const shadow = render(data({
      prep: [{ action: 'waitFor', selector: '#form', ms: 5000, resolves: true }],
      submitCv: [...submitCv],
      beforeFollow: [...beforeFollow],
    }));
    panel!.setStep('prep');
    expect(shadow.textContent).toContain('before filling');
    expect(shadow.textContent).toContain('After attaching the CV');
    expect(shadow.textContent).toContain('Before leaving');
    expect(shadow.querySelector('[data-k="prep:submitCv:0"]')).not.toBeNull();
    expect(shadow.querySelector('[data-k="prep:beforeFollow:0"]')).not.toBeNull();

    panel!.setStep('kind');
    expect(shadow.textContent).not.toContain('Before leaving');
    expect(shadow.querySelector('[data-k="prep:beforeFollow:0"]')).toBeNull();
  });

  /**
   * The unconditional list first, then the two mutually exclusive endings: send
   * here (confirm the file, then Apply presses Send) or hand off to the
   * employer's own application. Reading the step top to bottom has to be reading
   * the site's page actions in the order they can happen.
   */
  it('orders the three lists before-filling → after-CV → before-leaving', () => {
    const shadow = render(data({
      prep: [{ action: 'waitFor', selector: '#form', ms: 5000, resolves: true }],
      submitCv: [...submitCv],
      beforeFollow: [...beforeFollow],
    }));
    panel!.setStep('prep');
    const heads = [...shadow.querySelectorAll('.cf-section')].map((h) => h.textContent ?? '');
    expect(heads.length).toBe(3);
    expect(heads[0]).toMatch(/before filling/i);
    expect(heads[1]).toMatch(/after attaching the cv/i);
    expect(heads[2]).toMatch(/before leaving/i);
  });

  /**
   * The `send` step exists because the two rows Apply depends on were buried at
   * the tail of a sixteen-row field list, which is why the confirmation element
   * went unset on nearly every site. A prep list above them re-buries them — and
   * `SETUP_STEP_HELP.send.body`, which renders directly above it, describes only
   * the Send button and the confirmation.
   */
  it('leaves the CV steps off the sending step', () => {
    const shadow = render(data({ submitCv: [...submitCv] }));
    panel!.setStep('send');
    expect(shadow.textContent).not.toContain('After attaching the CV');
    expect(shadow.querySelector('[data-k="prep:submitCv:0"]')).toBeNull();
  });

  /**
   * The external marker and the external apply link are one answer between them
   * — "this posting applies elsewhere, and here is what to press" — so they are
   * headed together, away from the marker that argues the opposite verdict.
   *
   * Quick apply leads: it is the ordinary case, and the only group a site that
   * never hands off has anything to fill in.
   */
  it('groups the redirect rows under the verdict each argues for', () => {
    const shadow = render(data({
      redirect: [
        { key: 'applySelector', label: 'External apply link', status: 'none', note: 'not set', hasSave: false },
        { key: 'quickApplySelector', label: 'Quick-apply marker', status: 'none', note: 'not set', hasSave: false },
        { key: 'markerSelector', label: 'External marker', status: 'none', note: 'not set', hasSave: false },
      ],
    }));
    panel!.setStep('kind');

    const order = [...shadow.querySelectorAll('.cf-section, .cf-row .cf-field b')]
      .map((n) => n.textContent);
    expect(order).toEqual([
      'Quick apply — the form is on this page',
      'Quick-apply marker',
      'External — the application is on the employer’s site',
      'External marker',
      'External apply link',
    ]);
  });

  // A group with no rows draws no heading, so a config that only ever sets the
  // quick-apply marker does not get an empty "External" section above it.
  it('drops a heading whose group is empty', () => {
    const shadow = render(data({
      redirect: [
        { key: 'quickApplySelector', label: 'Quick-apply marker', status: 'none', note: 'not set', hasSave: false },
      ],
    }));
    panel!.setStep('kind');
    expect(shadow.textContent).not.toContain('the application is on the employer');
    expect(shadow.textContent).toContain('the form is on this page');
  });

  /**
   * The verdict is the step's answer, so it leads the group that argues for it
   * rather than floating above both headings — where it read as a caption about
   * nothing in particular and went unread. `unknown` sits with quick apply
   * because that is how it is treated: the fill path runs either way.
   */
  const kinds = [
    { kind: 'quickApply', head: 'Quick apply — the form is on this page', tone: 'ok' },
    { kind: 'unknown', head: 'Quick apply — the form is on this page', tone: 'warn' },
    { kind: 'redirect', head: 'External — the application is on the employer’s site', tone: 'ok' },
  ] as const;

  for (const { kind, head, tone } of kinds) {
    it(`puts a ${kind} verdict directly under "${head.split(' —')[0]}"`, () => {
      const shadow = render(data({
        verdict: { title: 'Verdict title', detail: 'why', kind },
        redirect: [
          { key: 'applySelector', label: 'External apply link', status: 'none', note: 'not set', hasSave: false },
          { key: 'quickApplySelector', label: 'Quick-apply marker', status: 'none', note: 'not set', hasSave: false },
          { key: 'markerSelector', label: 'External marker', status: 'none', note: 'not set', hasSave: false },
        ],
      }));
      panel!.setStep('kind');

      const banner = shadow.querySelector('.cf-verdict')!;
      expect(banner.previousElementSibling!.textContent).toBe(head);
      expect(banner.querySelector('.cf-flow-title')!.textContent).toBe('Verdict title');
      expect(banner.querySelector('.cf-flow-detail')!.textContent).toBe('why');
      // Status is never colour alone: `unknown` is the state to act on, so it
      // carries the `!` shape and the other two carry the check.
      expect(banner.querySelector(`.cf-dot.${tone}`)).not.toBeNull();
      expect(banner.classList.contains(tone)).toBe(true);
    });
  }

  // A group with no rows draws no heading — and must not take the verdict down
  // with it, or the step states no answer at all.
  it('still states the verdict when its group has no rows', () => {
    const shadow = render(data({
      verdict: { title: 'External application', detail: 'why', kind: 'redirect' },
      redirect: [
        { key: 'quickApplySelector', label: 'Quick-apply marker', status: 'none', note: 'not set', hasSave: false },
      ],
    }));
    panel!.setStep('kind');
    expect(shadow.querySelector('.cf-verdict .cf-flow-title')!.textContent)
      .toBe('External application');
  });
});

describe('setup panel legend', () => {
  it('is open for a user who has not seen it', () => {
    const shadow = render(data({ helpSeen: false }));
    const legend = shadow.querySelector<HTMLDetailsElement>('.cf-legend')!;
    expect(legend.open).toBe(true);
    // The colours are shown, not named — one real dot per meaning.
    expect(legend.querySelectorAll('.cf-legend-dot .cf-dot').length).toBe(3);
    expect(legend.textContent).toMatch(/auto/);
    expect(legend.textContent).toMatch(/saved/);
    expect(legend.textContent).toMatch(/pick/i);
  });

  // The legend is read above the work, so it must not become the work: the
  // first version pushed every section off a 390px screen.
  it('stays short enough to sit above the step', () => {
    const legend = render(data({ helpSeen: false })).querySelector('.cf-legend')!;
    expect(legend.textContent!.length).toBeLessThan(400);
  });

  /**
   * The rail leads the body on every step. The legend and the intro render on
   * step 1 only, so ahead of the rail they moved it ~200px between step 1 and
   * step 2 — and moved it again whenever the `<details>` was opened, under the
   * finger that had just opened it.
   */
  it('sits below the rail, which never moves', () => {
    const shadow = render(data({ helpSeen: false }));
    const kids = [...shadow.querySelector('.cf-body')!.children];
    expect(kids[0].classList.contains('cf-rail')).toBe(true);
    expect(kids.findIndex((k) => k.classList.contains('cf-legend')))
      .toBeGreaterThan(0);

    panel!.setStep('fields');
    expect([...shadow.querySelector('.cf-body')!.children][0].classList.contains('cf-rail'))
      .toBe(true);
  });

  it('is folded away once dismissed', () => {
    const shadow = render(data({ helpSeen: true }));
    expect(shadow.querySelector<HTMLDetailsElement>('.cf-legend')!.open).toBe(false);
  });

  it('reports the dismissal so it stays dismissed on the next posting', () => {
    let dismissed = 0;
    const shadow = render(data({ helpSeen: false }), callbacks({ onDismissHelp: () => { dismissed += 1; } }));
    shadow.querySelector<HTMLButtonElement>('.cf-legend-dismiss')!.click();
    expect(dismissed).toBe(1);
  });

  // It belongs to the step that introduces the site, not to every step — as a
  // permanent header it was a block of prose above every row in the wizard.
  it('is on the first step only', () => {
    const shadow = render(data({ helpSeen: false }));
    panel!.setStep('fields');
    expect(shadow.querySelector('.cf-legend')).toBeNull();
    expect(shadow.querySelector('.cf-intro')).toBeNull();
  });
});

/* ---------------- Recording ---------------- */

/** A finished recording and what it compiled to, as the Controller hands them over. */
function recorded(over: Partial<Recording> = {}): { recording: Recording; compiled: CompiledSetup } {
  const recording: Recording = {
    flow: 'internal',
    startedAt: 0,
    postingUrl: 'https://acme.com/job/1',
    steps: [
      {
        id: 's1', at: 100, leg: 'posting', url: 'https://acme.com/job/1', action: 'click',
        label: 'Show more', target: { selector: '#more', strength: 'strong', strategy: 'id' },
      },
      {
        id: 's2', at: 900, leg: 'posting', url: 'https://acme.com/job/1', action: 'input',
        label: 'Email', bind: 'field:email', bindSource: 'auto',
        target: { selector: '#email', strength: 'strong', strategy: 'id' },
      },
      {
        id: 's3', at: 1800, leg: 'posting', url: 'https://acme.com/job/1', action: 'click',
        label: 'Next', target: { selector: 'body > div > div:nth-of-type(3)', strength: 'fragile', strategy: 'path' },
      },
    ],
    ...over,
  };
  return { recording, compiled: compileRecording(recording) };
}

describe('the record lead', () => {
  const recordBtn = (s: ShadowRoot) =>
    s.querySelector<HTMLButtonElement>('.cf-record-lead .cf-record-actions .cf-btn')!;

  /**
   * One button, not two.
   *
   * It used to ask "does this posting apply here, or on the employer's own site?" —
   * a question someone looking at an unfamiliar posting usually cannot answer, and
   * one `compileRecording` overrules from the legs the steps really arrived on. Its
   * only remaining effect was the order of the recorder bar's Declare menu, which
   * the classifier already running on this page decides better than a guess.
   */
  it('offers one way to record, on the first step, for a known site', () => {
    let started = 0;
    const s = render(data(), callbacks({ onStartRecording: () => { started += 1; } }));
    const buttons = [...s.querySelectorAll('.cf-record-lead .cf-record-actions .cf-btn')];
    expect(buttons).toHaveLength(1);
    // Worded as a redo: this step is only reachable on a site already recorded, and
    // the paragraph above the button says so in the same breath.
    expect(buttons[0].textContent).toBe(RECORD_PASS_TEXT.beforeSend.again);

    recordBtn(s).click();
    expect(started).toBe(1);
  });

  /**
   * A bare label, with the explanation in the prose above it. The button carried a
   * caption of its own for as long as it was one of two asking where the application
   * happens — a distinction the user could not make. There is one button now and the
   * paragraph over it already says what pressing it does, so a caption said the same
   * thing a second time inside the control.
   */
  it('says only what pressing it does', () => {
    const b = recordBtn(render(data()));
    expect(b.querySelector('small')).toBeNull();
    expect(b.textContent).toBe(RECORD_PASS_TEXT.beforeSend.again);
  });

  /**
   * Still exactly one primary, and in the wizard it is Next. Home is the front door
   * now, so anyone who has reached step 1 has already chosen this path — and a second
   * coral button beside Next is the two-primaries bug the design-system guardrail
   * caught when Record first landed here.
   */
  it('is secondary in the wizard, where Next is the next action', () => {
    const s = render(data());
    expect(s.querySelectorAll('.cf-btn.primary')).toHaveLength(1);
    expect(nextBtn(s).classList).toContain('primary');
    expect(recordBtn(s).classList).not.toContain('primary');
  });

  it('is not on the other steps, which are about correcting what it produced', () => {
    const s = render(data());
    nextBtn(s).click();
    expect(s.querySelector('.cf-record-lead')).toBeNull();
    expect(s.querySelectorAll('.cf-btn.primary')).toHaveLength(1);
  });
});

describe('reviewing a recording', () => {
  it('shows nothing of the review until it is asked for', () => {
    const { recording, compiled } = recorded();
    const s = render(data({ recording, compiled }));
    expect(s.querySelector('.cf-rail')).not.toBeNull();
    expect(s.querySelector('[data-k="rec:s1:bind"]')).toBeNull();
  });

  it('lists what the user did, in order', () => {
    const { recording, compiled } = recorded();
    const s = render(data({ recording, compiled }));
    panel!.showReview(true);
    const rows = [...s.querySelectorAll('.cf-row b')].map((b) => b.textContent);
    expect(rows).toEqual(['Clicked Show more', 'Filled in Email', 'Clicked Next']);
  });

  /**
   * The panel re-renders on every edit — `refreshSetup` runs after each one — so a
   * mode derived from `SetupData` would throw the user out of the review the first
   * time they changed a row. Same rule, and same failure, as `step`.
   */
  it('stays in the review across a re-render', () => {
    const { recording, compiled } = recorded();
    const s = render(data({ recording, compiled }));
    panel!.showReview(true);
    panel!.render(data({ recording, compiled }));
    expect(s.querySelector('[data-k="rec:s1:bind"]')).not.toBeNull();
  });

  /**
   * The one bind the extension still guesses for itself is a profile field, and the
   * bar has no control for refusing a guess any more — so the review is the only
   * place a wrong one can be corrected, and it has to offer the sixteen fields to
   * correct it to. Grouped, because flat they run straight past the marks above them.
   */
  it('offers the profile fields, under a heading of their own', () => {
    const { recording, compiled } = recorded();
    const s = render(data({ recording, compiled }));
    panel!.showReview(true);

    const select = s.querySelector<HTMLSelectElement>('[data-k="rec:s2:bind"]')!;
    const group = [...select.querySelectorAll('optgroup')]
      .find((g) => g.label === MARK_GROUP_TEXT.fields)!;
    const values = [...group.querySelectorAll('option')].map((o) => o.value);
    expect(values).toContain('field:email');
    expect(values).toContain('field:phone');
    // The CV leads them, the same order the profile itself is read in.
    expect(values[0]).toBe('field:resume');
  });

  /**
   * And it groups them the way the bar's menu did. A recording is corrected here
   * having been made there, so a mark that read as "applying on this page" while it
   * was being chosen must not read as something else while it is being checked.
   */
  it('groups every mark the way the menu it was chosen from did', () => {
    const { recording, compiled } = recorded();
    const s = render(data({ recording, compiled }));
    panel!.showReview(true);

    const select = s.querySelector<HTMLSelectElement>('[data-k="rec:s2:bind"]')!;
    const heads = [...select.querySelectorAll('optgroup')].map((g) => g.label);
    expect(heads).toEqual([
      MARK_GROUP_TEXT.sending, MARK_GROUP_TEXT.leaving,
      MARK_GROUP_TEXT.info, MARK_GROUP_TEXT.fields,
    ]);
  });

  it('re-marks a step through the callback rather than deciding itself', () => {
    const seen: Array<[string, string | null]> = [];
    const { recording, compiled } = recorded();
    const s = render(
      data({ recording, compiled }),
      callbacks({ onRebindStep: (id, bind) => seen.push([id, bind]) }),
    );
    panel!.showReview(true);

    const select = s.querySelector<HTMLSelectElement>('[data-k="rec:s1:bind"]')!;
    select.value = 'submit';
    select.dispatchEvent(new Event('change'));
    expect(seen).toEqual([['s1', 'submit']]);
  });

  it('shows a guessed mark as already made, so the common case needs no tap', () => {
    const { recording, compiled } = recorded();
    const s = render(data({ recording, compiled }));
    panel!.showReview(true);
    expect(s.querySelector<HTMLSelectElement>('[data-k="rec:s2:bind"]')!.value).toBe('field:email');
  });

  /**
   * A step identified only by where it sits on the page is the thing most likely to
   * stop working silently, so it is the one row that offers a re-pick — and it says
   * so in a word, not only in the dot's colour.
   */
  it('offers a re-pick only on a step it could not identify properly', () => {
    const { recording, compiled } = recorded();
    const s = render(data({ recording, compiled }));
    panel!.showReview(true);
    expect(s.querySelector('[data-k="rec:s3:pick"]')).not.toBeNull();
    expect(s.querySelector('[data-k="rec:s1:pick"]')).toBeNull();
    const note = [...s.querySelectorAll('.cf-row small')].map((n) => n.textContent);
    expect(note[2]).toContain(SELECTOR_STRENGTH_TEXT.fragile.word);
  });

  it('says what the compiler could not settle', () => {
    const { recording, compiled } = recorded();
    const s = render(data({ recording, compiled }));
    panel!.showReview(true);
    const notes = [...s.querySelectorAll('.cf-flow-detail')].map((n) => n.textContent);
    expect(notes).toContain(RECORDING_WARNINGS.fragileTargets);
  });

  /**
   * The first pass ending without a confirmation is its *expected* outcome, not a
   * failure — the element does not exist until an application has really gone in, and
   * this pass stops short of sending one. So it is drawn as an `ok` note rather than a
   * `warn`: for as long as there was one recording, the half that worked reported
   * itself as broken on every site.
   */
  it('hands on to the second pass in the affirmative, below the warnings', () => {
    // With the Send button marked, which is where a first pass ends. Without one
    // there is nothing to hand on to — the second pass has no button to press.
    const base = recorded().recording;
    const { recording, compiled } = recorded({
      steps: [...base.steps, {
        id: 's4', at: 2600, leg: 'posting', url: 'https://acme.com/job/1', action: 'click',
        label: 'Submit application', bind: 'submit', bindSource: 'auto',
        target: { selector: '#send', strength: 'strong', strategy: 'id' },
      }],
    });
    const s = render(data({ recording, compiled }));
    panel!.showReview(true);
    const note = [...s.querySelectorAll('.cf-flow.ok .cf-flow-detail')]
      .map((n) => n.textContent);
    expect(note).toContain(RECORDING_NOTES.afterSendPending);

    // Warnings first: reading what happens next before what needs looking at now
    // makes the outstanding half sound optional.
    const all = [...s.querySelectorAll('.cf-flow')];
    const warn = all.findIndex((n) => n.classList.contains('warn'));
    const ok = all.findIndex((n) => n.classList.contains('ok'));
    expect(warn).toBeLessThan(ok);
  });

  it('offers Save and Discard, with Save the only primary', () => {
    let saved = 0;
    const { recording, compiled } = recorded();
    const s = render(data({ recording, compiled }), callbacks({ onSaveRecording: () => { saved += 1; } }));
    panel!.showReview(true);

    expect(s.querySelectorAll('.cf-btn.primary')).toHaveLength(1);
    const save = s.querySelector<HTMLButtonElement>('.cf-footer .cf-btn.primary')!;
    expect(save.textContent).toBe(ACTION_LABELS.saveRecording);
    save.click();
    expect(saved).toBe(1);
  });

  it('warns when the recording contradicted the flow the user chose', () => {
    const { recording } = recorded({
      flow: 'internal',
      destinationUrl: 'https://ats.test/apply',
    });
    recording.steps.push({
      id: 's4', at: 2500, leg: 'destination', url: 'https://ats.test/apply', action: 'click',
      label: 'Start', target: { selector: '#start', strength: 'strong', strategy: 'id' },
    });
    const s = render(data({ recording, compiled: compileRecording(recording) }));
    panel!.showReview(true);
    expect(s.textContent).toContain('handed off');
  });
});

/**
 * Home, which is where the panel opens on every site and where every task here ends.
 *
 * It is the merge of two screens — the offer to record and the report a save landed
 * on — and they were the same screen asked at two moments: here is what this site
 * knows, here is what it still needs, here is how to teach it. Its structure is the
 * two passes, because that is the division that is real: everything up to the Send
 * button, and the confirmation that does not exist until one has gone in.
 */
describe('the home screen', () => {
  const footer = (s: ShadowRoot) =>
    [...s.querySelectorAll<HTMLButtonElement>('.cf-footer .cf-btn')];
  const passName = (s: ShadowRoot, i: number) =>
    [...s.querySelectorAll('.cf-pass .cf-pass-name')][i]?.textContent;
  const passDot = (s: ShadowRoot, i: number) =>
    [...s.querySelectorAll('.cf-pass .cf-dot')][i]?.className;

  /**
   * The change this screen exists for. It used to route here only while
   * `isUnconfigured` — so one saved selector, which a single Pick from the review
   * modal's report is enough to produce, sent every later visit straight into the
   * six-step wizard. Site setup then opened the manual surface automatically: the
   * surface that put `submitSelector` and `successSelector` last in a queue of
   * twenty-five, which is why they went unset and why recording exists at all.
   */
  it('is where the panel opens, configured or not', () => {
    for (const d of [fresh(), data()]) {
      const s = mount(d);
      expect(s.querySelector('.cf-passes')).not.toBeNull();
      expect(s.querySelector('.cf-rail')).toBeNull();
    }
  });

  it('draws the two passes, in the order they can happen', () => {
    const s = mount(data());
    expect(passName(s, 0)).toContain(RECORD_PASS_TEXT.beforeSend.name);
    expect(passName(s, 1)).toContain(RECORD_PASS_TEXT.afterSend.name);
  });

  /** Status is never colour alone here either: each pass carries a dot and a line. */
  it('says how far each pass has got', () => {
    const s = mount(fresh());
    expect(passDot(s, 0)).toContain('none');
    expect(passDot(s, 1)).toContain('none');

    const done = mount(data());
    expect(passDot(done, 0)).toContain('ok');
    expect(passDot(done, 1)).toContain('ok');
  });

  /**
   * **Which block is coral is the whole screen.** The passes are sequential, so the
   * one control that is loud is the one that advances the earliest pass still
   * wanting something — and exactly one is, which is what the panel's
   * one-primary rule has always asserted.
   */
  it('puts the one coral button on the earliest pass still wanting something', () => {
    const s = mount(fresh());
    expect(s.querySelectorAll('.cf-btn.primary')).toHaveLength(1);
    expect(s.querySelector('.cf-pass .cf-btn.primary')!.textContent)
      .toContain(RECORD_PASS_TEXT.beforeSend.action);
  });

  it('moves it to the second pass once the first is done', () => {
    const s = mount(beforeSendDone());
    expect(s.querySelectorAll('.cf-btn.primary')).toHaveLength(1);
    expect(s.querySelector('.cf-btn.primary')!.textContent)
      .toBe(RECORD_PASS_TEXT.afterSend.action);
  });

  it('moves it to Done once neither pass wants anything', () => {
    const s = mount(data());
    expect(s.querySelectorAll('.cf-btn.primary')).toHaveLength(1);
    expect(footer(s).at(-1)!.classList).toContain('primary');
    expect(footer(s).at(-1)!.textContent).toBe(ACTION_LABELS.done);
  });

  /**
   * The second pass cannot be started before the first has produced a site that can
   * fill and send — so it is drawn with no control at all rather than a dead one.
   * The panel's standing rule is that an unavailable control keeps its outline and
   * its meaning; a control with neither is just noise.
   */
  it('gives the second pass no control until there is something to confirm', () => {
    const s = mount(fresh());
    const blocks = [...s.querySelectorAll('.cf-pass')];
    expect(blocks[1].querySelector('.cf-btn')).toBeNull();
    expect(blocks[0].querySelector('.cf-btn')).not.toBeNull();
  });

  it('reaches the second pass from the block that describes it', () => {
    let marked = 0;
    const s = mount(beforeSendDone(), callbacks({ onMarkConfirmation: () => { marked += 1; } }));
    s.querySelector<HTMLButtonElement>('.cf-btn.primary')!.click();
    expect(marked).toBe(1);
  });

  /**
   * A settled pass keeps its control, worded as a redo.
   *
   * A pass can be wrong as well as missing — a confirmation captured off a cookie
   * banner, a Send button that turned out to be "Save job" — and with the wizard no
   * longer a way *into* a site, these two blocks are where that is corrected. Never
   * coral: `outstandingPass` decides where the one primary goes, and a finished pass
   * is not outstanding.
   */
  it('keeps a way to redo a pass that is already done', () => {
    const s = mount(data());
    const blocks = [...s.querySelectorAll('.cf-pass')];
    const label = (i: number) => blocks[i].querySelector('.cf-btn')!.textContent;
    expect(label(0)).toBe(RECORD_PASS_TEXT.beforeSend.again);
    expect(label(1)).toBe(RECORD_PASS_TEXT.afterSend.again);
    for (const block of blocks) {
      expect(block.querySelector('.cf-btn')!.classList).not.toContain('primary');
    }
  });

  it('redoes the second pass through the same callback as marking it', () => {
    let marked = 0;
    const s = mount(data(), callbacks({ onMarkConfirmation: () => { marked += 1; } }));
    [...s.querySelectorAll('.cf-pass')][1].querySelector<HTMLButtonElement>('.cf-btn')!.click();
    expect(marked).toBe(1);
  });

  /**
   * …and a pass that has produced nothing still says what it is *for*. "Record it
   * again" on a site nobody has recorded reads as though something was already saved
   * and lost.
   */
  it('says the pass’s own verb while it has produced nothing', () => {
    const s = mount(fresh());
    expect([...s.querySelectorAll('.cf-pass')][0].querySelector('.cf-btn')!.textContent)
      .toBe(RECORD_PASS_TEXT.beforeSend.action);
    const s2 = mount(beforeSendDone());
    expect([...s2.querySelectorAll('.cf-pass')][1].querySelector('.cf-btn')!.textContent)
      .toBe(RECORD_PASS_TEXT.afterSend.action);
  });

  /**
   * The manual surface is reachable, and reaching it is a decision — but only once
   * the site has been taught something. It is where a recording is *corrected*, and
   * as a way in it was the six-step wizard competing with recording on the one screen
   * built to replace it.
   */
  it('offers the wizard from the footer, and only from there', () => {
    const s = mount(data());
    expect(footer(s)[0].textContent).toBe('Review configuration');
    footer(s)[0].click();
    expect(s.querySelector('.cf-rail')).not.toBeNull();
  });

  /**
   * And offers it nowhere at all while nothing is saved. Recording is the only way to
   * set a site up: the wizard puts `submitSelector` and `successSelector` last in a
   * queue of twenty-five, which is why they went unset on nearly every site.
   *
   * There is no footer at all here rather than one holding nothing — Done is withheld
   * on the same site for its own reason, so with the by-hand link gone the band would
   * be empty furniture.
   */
  it('offers no way into the wizard while nothing is saved', () => {
    const s = mount(fresh());
    expect(s.querySelector('.cf-footer')).toBeNull();
    const labels = [...s.querySelectorAll('.cf-btn')].map((b) => b.textContent);
    expect(labels.some((l) => l?.includes('by hand'))).toBe(false);
    expect(labels.some((l) => l === 'Review configuration')).toBe(false);
  });

  /**
   * Done is withheld while the site is unconfigured, which is the one thing the
   * footerless offer got right: closing the panel having taught the extension
   * nothing is not an outcome, and the next posting on the site opens here again.
   * The header `×` is still the way to get the card out of the way.
   */
  it('withholds Done until the site has been taught something', () => {
    expect(footer(mount(fresh()))).toEqual([]);
    expect(footer(mount(data())).map((b) => b.textContent))
      .toEqual(['Review configuration', ACTION_LABELS.done]);
  });

  it('closes the panel from Done', () => {
    let closed = 0;
    const s = mount(data(), callbacks({ onClose: () => { closed += 1; } }));
    footer(s).find((b) => b.textContent === ACTION_LABELS.done)!.click();
    expect(closed).toBe(1);
  });

  /**
   * Save used to hand the user straight to the wizard — four steps into the manual
   * surface with nothing saying the recording had worked. It reports instead, and
   * the report is the one thing on this screen about the press that got here rather
   * than about the site.
   */
  it('leads with the save when a recording just landed', () => {
    const s = mount(data());
    panel!.showHome({ saved: true });
    expect(shown(s)).toBe('Site setup saved');

    panel!.showHome();
    expect(shown(s)).not.toBe('Site setup saved');
  });

  /**
   * The steps that still have work are the entire reason to go into the wizard
   * rather than close the panel, so they are named — from `stepStates`, the same
   * model the rail counts from, so this cannot disagree with the chips a press later.
   */
  it('names what the wizard would still ask for', () => {
    const s = mount(data({
      containers: [
        { key: 'jobTitle', label: 'Job title', status: 'none', note: 'not found', hasSave: false },
      ],
    }));
    const notes = [...s.querySelectorAll('.cf-flow.warn .cf-flow-detail')]
      .map((n) => n.textContent);
    expect(notes.some((n) => n?.startsWith(SETUP_STEP_TITLES.info))).toBe(true);
  });

  /**
   * …and never the two steps the pass blocks already speak for. `send`'s two rows
   * *are* the two passes, and `fields`' only work is the CV, which the first pass
   * reports in its own summary. Repeating "Sending — 1 thing still to do" under a
   * block that has just said the confirmation is missing is the cry-wolf failure
   * every counting rule in `setupSteps.ts` is written against.
   */
  it('leaves out the steps the passes have already reported', () => {
    const s = mount(beforeSendDone());
    const notes = [...s.querySelectorAll('.cf-flow.warn .cf-flow-detail')]
      .map((n) => n.textContent);
    expect(notes.some((n) => n?.startsWith(SETUP_STEP_TITLES.send))).toBe(false);
    // …and says nothing at all instead: "Nothing else needs you" under a pass block
    // still asking to be finished contradicts the coral button beside it.
    expect(s.querySelector('.cf-record-or')).toBeNull();
  });

  it('says so when nothing is outstanding', () => {
    const s = mount(data());
    expect(s.querySelector('.cf-flow.warn')).toBeNull();
    expect(s.querySelector('.cf-record-or')!.textContent).toBe('Nothing else needs you.');
  });

  /**
   * A place in a task, not a fact about the data — the same rule `step` and the
   * review follow, and the same failure if broken: `refreshSetup` re-renders on
   * every edit, so this would throw the user out of the wizard they had opened.
   */
  it('stays where the user left it across a re-render', () => {
    const d = data();
    const s = mount(d);
    footer(s)[0].click();
    panel!.render(d);
    expect(s.querySelector('.cf-rail')).not.toBeNull();
  });
});

/**
 * Discard is the back door, and it goes where the panel opens: home. Landing in the
 * wizard would hand the user the manual surface they have just declined to use.
 */
describe('discarding a recording', () => {
  it('returns home, on a site with nothing saved and on one being re-recorded', () => {
    for (const d of [fresh(), data()]) {
      const s = mount(d);
      panel!.showReview(true);
      panel!.showReview(false);
      expect(s.querySelector('.cf-passes')).not.toBeNull();
      expect(s.querySelector('.cf-rail')).toBeNull();
    }
  });

  /** …and never as the report, which is about a save that did not happen. */
  it('does not claim anything was saved', () => {
    const s = mount(data());
    panel!.showHome({ saved: true });
    panel!.showReview(true);
    panel!.showReview(false);
    expect(shown(s)).not.toBe('Site setup saved');
  });
});

/**
 * Home used to say what recording *is* and nothing about the page behind it —
 * even though `refreshSetup` computes a complete `data.fields` on every render, in
 * every mode, and hands it over. So "teach the extension this site" gave no sense of
 * how much teaching was left, and the rows that would have said were two taps down a
 * rail this screen does not draw.
 */
describe('what home says is already recognised', () => {
  const summary = (s: ShadowRoot) => s.querySelector('.cf-detected .cf-summary')!;
  const chips = (s: ShadowRoot) =>
    [...s.querySelectorAll('.cf-detected-chips .chip')].map((c) => c.textContent);

  it('counts every field row by outcome', () => {
    // The fixture is one of each.
    expect(summary(mount(fresh())).textContent)
      .toBe(`1 ${SETUP_STATUS_TEXT.high.word}1 ${SETUP_STATUS_TEXT.low.word}1 ${SETUP_STATUS_TEXT.none.word}`);
  });

  /**
   * The line is a key as much as a tally: a reader who has never seen a yellow dot
   * learns nothing from a line that leaves the yellow one out because it happens to
   * be zero. Same rule as the review modal's `.cf-summary`, which it now shares.
   */
  it('keeps all three statuses on the line at zero', () => {
    const s = mount(fresh({
      fields: [{ key: 'email', label: 'Email', status: 'high', note: 'auto · #email', hasSave: false }],
    }));
    expect(summary(s).querySelectorAll('.cf-dot')).toHaveLength(3);
    expect(summary(s).textContent).toContain(`0 ${SETUP_STATUS_TEXT.none.word}`);
  });

  /**
   * The wording trap this screen exists to avoid. `detectFields` returns a row per
   * *wanted* field, so nine `none`s is the ordinary state of any real form — calling
   * that "unmatched" blames the site for the commonest case, which is the same
   * cry-wolf failure `setupSteps.fields` counts only the CV to sidestep.
   */
  it('says a field the page never asked for is not on the page, not unmatched', () => {
    const text = summary(mount(fresh())).textContent!;
    expect(text).toContain(SETUP_STATUS_TEXT.none.word);
    expect(text).not.toMatch(/unmatched/i);
  });

  /**
   * "5 found" answers how many and not which, and which is the thing someone about to
   * teach the site needs. In `data.fields` order, which `orderFields` has already put
   * in reading order.
   */
  it('names what it found, and nothing it did not', () => {
    expect(chips(mount(fresh())))
      .toEqual(['Email', `Phone · ${SETUP_STATUS_TEXT.low.chip}`]);
  });

  /**
   * A page that offers nothing keeps the count line — it is a key, and a reader has
   * to be able to learn the three dots from it — but the answer to "what did you
   * find" has to be a sentence when the answer is "nothing". A heading promising what
   * it can read, over three zeros and an empty chip row, reads as a bug.
   */
  it('says so in words when it found nothing, rather than showing three zeros', () => {
    const s = mount(fresh({
      fields: [{ key: 'email', label: 'Email', status: 'none', note: 'not found', hasSave: false }],
    }));
    expect(s.querySelector('.cf-detected .cf-summary')).not.toBeNull();
    expect(s.querySelector('.cf-detected-chips')).toBeNull();
    expect(s.querySelector('.cf-detected .cf-record-or')!.textContent).toMatch(/nothing here/i);
  });

  /**
   * Only while the site is unconfigured. Once it has been taught something the same
   * space carries what the wizard would still ask for, which is the useful reading
   * then — and step 5 lists every field row with its selector anyway, so a second
   * rendering of the same counts under the record button is clutter.
   */
  it('is for a site nobody has taught anything', () => {
    expect(mount(data()).querySelector('.cf-detected .cf-summary')).toBeNull();
    expect(mount(fresh()).querySelector('.cf-detected .cf-summary')).not.toBeNull();
  });
});
