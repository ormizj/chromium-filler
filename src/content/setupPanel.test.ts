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
import { ACTION_LABELS, SELECTOR_STRENGTH_TEXT } from '../shared/labels';
import {
  RECORDING_WARNINGS, compileRecording, type CompiledSetup, type Recording,
} from '../shared/recording';

const noop = () => {};

function callbacks(over: Partial<SetupCallbacks> = {}): SetupCallbacks {
  return {
    onAddPrep: noop, onPickPrepTarget: noop, onMovePrep: noop, onRemovePrep: noop,
    onSetPrepMs: noop, onRunPrep: noop, onPickContainer: noop, onClearContainer: noop,
    onPickField: noop, onClearField: noop, onPickRedirect: noop, onClearRedirect: noop,
    onPickSubmit: noop, onClearSubmit: noop, onPickSuccess: noop, onClearSuccess: noop,
    onRename: noop, onOpenOptions: noop, onClose: noop, onDismissHelp: noop,
    onStartRecording: noop, onRebindStep: noop, onRepickStep: noop, onRemoveStep: noop,
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

let panel: SetupPanel | undefined;

function render(d: SetupData, cb = callbacks()): ShadowRoot {
  panel = new SetupPanel(cb);
  panel.render(d);
  return (document.getElementById('chromium-filler-setup-host') as HTMLElement).shadowRoot!;
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
  const taughtButUnfinished = () => data({
    fields: [
      { key: 'resume', label: 'CV / Résumé', status: 'high', note: 'saved · #cv', hasSave: true },
      { key: 'email', label: 'Email', status: 'high', note: 'auto · #email', hasSave: false },
    ],
    success: { key: 'successSelector', label: 'Confirmation element', status: 'none', note: 'not set', hasSave: false },
  });

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
  /**
   * The front door. It is on the first step because that is where the panel opens
   * for anyone who has not set this site up — and the five steps after it exist to
   * correct what recording produces, not to be walked through instead.
   */
  it('offers both flows on the first step, for re-recording a known site', () => {
    const started: string[] = [];
    const s = render(data(), callbacks({ onStartRecording: (f) => started.push(f) }));
    const buttons = [...s.querySelectorAll<HTMLButtonElement>('.cf-record-actions .cf-btn')];
    expect(buttons.map((b) => b.textContent)).toEqual([
      ACTION_LABELS.record, ACTION_LABELS.recordExternal,
    ]);

    buttons[0].click();
    buttons[1].click();
    expect(started).toEqual(['internal', 'external']);
  });

  /**
   * Still exactly one primary, and in the wizard it is Next. The offer screen is the
   * front door, so anyone who has reached step 1 has already chosen this path — and a
   * second coral button beside Next is the two-primaries bug the design-system
   * guardrail caught when Record first landed here.
   */
  it('is secondary in the wizard, where Next is the next action', () => {
    const s = render(data());
    expect(s.querySelectorAll('.cf-btn.primary')).toHaveLength(1);
    expect(nextBtn(s).classList).toContain('primary');
    expect(s.querySelector('.cf-record-actions .cf-btn')!.classList).not.toContain('primary');
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
    const group = select.querySelector('optgroup')!;
    expect(group.label).toBe('Form fields');
    const values = [...group.querySelectorAll('option')].map((o) => o.value);
    expect(values).toContain('field:email');
    expect(values).toContain('field:phone');
    // The CV leads them, the same order the profile itself is read in.
    expect(values[0]).toBe('field:resume');
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
    expect(notes).toContain(RECORDING_WARNINGS.noSuccess);
    expect(notes).toContain(RECORDING_WARNINGS.fragileTargets);
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

describe('where the panel opens', () => {
  /** A brand-new config: nothing saved, no page actions. */
  const fresh = () => data({
    prep: [],
    containers: [{ key: 'jobTitle', label: 'Job title', status: 'high', note: 'auto · h1', hasSave: false }],
    fields: [
      { key: 'resume', label: 'CV / Résumé', status: 'none', note: 'not found', hasSave: false },
      { key: 'email', label: 'Email', status: 'high', note: 'auto · #email', hasSave: false },
    ],
    submit: { key: 'submitSelector', label: 'Send button', status: 'none', note: 'not found', hasSave: false },
    success: { key: 'successSelector', label: 'Confirmation element', status: 'none', note: 'not set', hasSave: false },
  });

  /**
   * The bug this screen exists for. The record buttons started life as a block on
   * wizard step 1 — and the panel does not *open* on step 1: `firstStepWithWork`
   * sends a returning user to the earliest unfinished step, and a brand-new config
   * always has work on `fields` or `send`. So the one thing a new site wants was
   * four presses of Back away, and Site setup looked exactly as it always had.
   */
  it('opens on the offer to record when nothing has ever been saved', () => {
    const s = render(fresh());
    expect(s.querySelector('.cf-record-actions')).not.toBeNull();
    // Not the wizard: no rail, no step.
    expect(s.querySelector('.cf-rail')).toBeNull();
    expect(s.querySelector('.cf-step-title')!.textContent).toBe('Teach the extension this site');
  });

  it('opens on the wizard once the site has been taught anything', () => {
    const s = render(data());
    expect(s.querySelector('.cf-rail')).not.toBeNull();
  });

  it('gets out of the way when asked, and does not come back on a re-render', () => {
    const d = fresh();
    const s = render(d);
    s.querySelector<HTMLButtonElement>('.cf-footer .cf-btn')!.click();
    expect(s.querySelector('.cf-rail')).not.toBeNull();

    panel!.render(d);
    expect(s.querySelector('.cf-rail')).not.toBeNull();
  });

  it('offers both flows from the offer screen, with Record the only primary', () => {
    const started: string[] = [];
    const s = render(fresh(), callbacks({ onStartRecording: (f) => started.push(f) }));
    expect(s.querySelectorAll('.cf-btn.primary')).toHaveLength(1);

    const buttons = [...s.querySelectorAll<HTMLButtonElement>('.cf-record-actions .cf-btn')];
    buttons[0].click();
    buttons[1].click();
    expect(started).toEqual(['internal', 'external']);
  });
});
