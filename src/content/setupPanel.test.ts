/**
 * Render tests for the setup panel's help layer.
 *
 * The panel is where a new user is most lost: five sections of jargon, rows
 * reading `auto · #first_name`, and dots whose colours nothing explains. These
 * assert that the explanation is actually reachable — from the panel, without
 * leaving the page — and that opening one does not disturb the work in progress.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { SetupPanel, type SetupCallbacks, type SetupData } from './setupPanel';
import { SETUP_GROUP_HELP } from '../shared/help';

const noop = () => {};

function callbacks(over: Partial<SetupCallbacks> = {}): SetupCallbacks {
  return {
    onAddPrep: noop, onPickPrepTarget: noop, onMovePrep: noop, onRemovePrep: noop,
    onSetPrepMs: noop, onRunPrep: noop, onPickContainer: noop, onClearContainer: noop,
    onPickField: noop, onClearField: noop, onPickRedirect: noop, onClearRedirect: noop,
    onRename: noop, onOpenOptions: noop, onClose: noop, onDismissHelp: noop,
    ...over,
  };
}

function data(over: Partial<SetupData> = {}): SetupData {
  return {
    name: 'Acme',
    urlPattern: '*://acme.com/*',
    prep: [],
    containers: [{ key: 'jobTitle', label: 'Job title', status: 'high', note: 'auto · h1', hasSave: false }],
    fields: [{ key: 'email', label: 'Email', status: 'none', note: 'not found', hasSave: false }],
    verdict: 'Quick-apply — a form was found here',
    redirect: [],
    beforeFollow: [],
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

afterEach(() => {
  panel?.destroy();
  panel = undefined;
});

describe('setup panel help', () => {
  it('says what the panel is for, and that nothing is submitted', () => {
    const intro = render(data()).querySelector('.cf-intro');
    expect(intro?.textContent).toMatch(/set up|teach/i);
    expect(intro?.textContent).toMatch(/never (presses |submits)/i);
  });

  it('gives every section a help toggle', () => {
    const shadow = render(data());
    const groups = shadow.querySelectorAll('.cf-group');
    expect(groups.length).toBe(Object.keys(SETUP_GROUP_HELP).length);
    for (const group of groups) {
      expect(group.querySelector('summary .cf-help-btn'), group.textContent ?? '').toBeTruthy();
    }
  });

  it('shows no explanation until its ? is pressed', () => {
    const shadow = render(data());
    expect(shadow.querySelector('.cf-help')).toBeNull();

    const button = shadow.querySelector<HTMLButtonElement>('.cf-group summary .cf-help-btn')!;
    button.click();
    expect(shadow.querySelector('.cf-help')).toBeTruthy();
  });

  it('explains the section it was opened from, inside that section', () => {
    const shadow = render(data());
    // "Application type" — the section whose jargon is worst.
    const find = () => [...shadow.querySelectorAll('.cf-group')]
      .find((g) => g.querySelector('summary')?.textContent?.includes('Application type'))!;
    find().querySelector<HTMLButtonElement>('.cf-help-btn')!.click();

    // Opening the help re-renders the card, so the section has to be re-found.
    const help = find().querySelector('.cf-help');
    expect(help).toBeTruthy();
    expect(help?.textContent).toContain(SETUP_GROUP_HELP.kind.title);
    // Every row of that section is documented, so no row needs its own ?.
    for (const row of SETUP_GROUP_HELP.kind.rows ?? []) {
      expect(help?.textContent).toContain(row.label);
    }
  });

  // Pressing ? on a collapsed section has to reveal the explanation, not file it
  // away inside something still shut — and it must never close a section the
  // user had open, which would hide the rows they were working through.
  it('reveals the explanation whatever state the section was in', () => {
    for (const startOpen of [false, true]) {
      const shadow = render(data({ fields: [], containers: [] }));
      const group = () => shadow.querySelector<HTMLDetailsElement>('.cf-group')!;
      group().open = startOpen;
      group().querySelector<HTMLButtonElement>('.cf-help-btn')!.click();

      expect(group().open).toBe(true);
      expect(group().querySelector('.cf-help')).toBeTruthy();
      panel!.destroy();
      panel = undefined;
    }
  });

  // The panel re-renders on every re-scan of the page; folding the explanation
  // away under the user mid-read would make it useless.
  it('keeps an opened explanation open across a re-render', () => {
    const shadow = render(data());
    shadow.querySelector<HTMLButtonElement>('.cf-group summary .cf-help-btn')!.click();
    expect(shadow.querySelectorAll('.cf-help').length).toBe(1);

    panel!.render(data({ verdict: 'External application' }));
    expect(shadow.querySelectorAll('.cf-help').length).toBe(1);
  });

  it('presses ? again to close', () => {
    const shadow = render(data());
    const button = () => shadow.querySelector<HTMLButtonElement>('.cf-group summary .cf-help-btn')!;
    button().click();
    expect(shadow.querySelector('.cf-help')).toBeTruthy();
    button().click();
    expect(shadow.querySelector('.cf-help')).toBeNull();
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
  it('stays short enough to sit above the sections', () => {
    const legend = render(data({ helpSeen: false })).querySelector('.cf-legend')!;
    expect(legend.textContent!.length).toBeLessThan(400);
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
});
