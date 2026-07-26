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
import { SETUP_STEP_HELP, SETUP_STEP_TITLES } from '../shared/help';
import { SETUP_STEP_ICONS, SETUP_STEP_ORDER } from '../shared/setupSteps';

const noop = () => {};

function callbacks(over: Partial<SetupCallbacks> = {}): SetupCallbacks {
  return {
    onAddPrep: noop, onPickPrepTarget: noop, onMovePrep: noop, onRemovePrep: noop,
    onSetPrepMs: noop, onRunPrep: noop, onPickContainer: noop, onClearContainer: noop,
    onPickField: noop, onClearField: noop, onPickRedirect: noop, onClearRedirect: noop,
    onPickSubmit: noop, onClearSubmit: noop, onPickSuccess: noop, onClearSuccess: noop,
    onRename: noop, onOpenOptions: noop, onClose: noop, onDismissHelp: noop,
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
    verdict: 'Quick-apply — a form was found here',
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

    panel!.render(data({ verdict: 'External application' }));
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
  it('opens on the earliest step that still needs something', () => {
    const shadow = render(data({
      success: { key: 'successSelector', label: 'Confirmation element', status: 'none', note: 'not set', hasSave: false },
    }));
    expect(shown(shadow)).toBe(SETUP_STEP_TITLES.send);
  });

  it('opens on step 1 when the site is fully configured', () => {
    expect(shown(render(data()))).toBe(SETUP_STEP_TITLES.site);
  });

  /**
   * A first-time user is walked from the beginning, legend and all — dropping
   * someone who has never seen the panel into step 6 explains nothing.
   */
  it('opens on step 1 for a user who has never used it', () => {
    const shadow = render(data({
      helpSeen: false,
      success: { key: 'successSelector', label: 'Confirmation element', status: 'none', note: 'not set', hasSave: false },
    }));
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

    panel!.render(data({ verdict: 'External application' }));
    expect(shadow.querySelectorAll('.cf-help').length).toBe(1);
  });
});

describe('setup wizard step contents', () => {
  const beforeFollow = [{ action: 'click', selector: '#save-job', resolves: true }] as const;

  /**
   * Both prep lists are the same thing — clicks and waits this site needs before
   * the extension acts — and the "before leaving" one used to sit on the
   * application-type step, under three redirect selectors it has nothing to do
   * with. It was the last thing on a step about something else.
   */
  it('renders both prep lists on the page-actions step', () => {
    const shadow = render(data({
      prep: [{ action: 'waitFor', selector: '#form', ms: 5000, resolves: true }],
      beforeFollow: [...beforeFollow],
    }));
    panel!.setStep('prep');
    expect(shadow.textContent).toContain('before filling');
    expect(shadow.textContent).toContain('Before leaving');
    expect(shadow.querySelector('[data-k="prep:beforeFollow:0"]')).not.toBeNull();

    panel!.setStep('kind');
    expect(shadow.textContent).not.toContain('Before leaving');
    expect(shadow.querySelector('[data-k="prep:beforeFollow:0"]')).toBeNull();
  });

  /**
   * The external marker and the external apply link are one answer between them
   * — "this posting applies elsewhere, and here is what to press" — so they are
   * headed together, away from the marker that argues the opposite verdict.
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
      'External — the application is on the employer’s site',
      'External marker',
      'External apply link',
      'Quick apply — the form is on this page',
      'Quick-apply marker',
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
