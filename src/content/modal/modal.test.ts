/**
 * Render-logic tests for the review modal. The modal is the extension's entire
 * promise — "filling is automatic but never silent" — so what a row *claims*
 * about a field has to match what actually happened to it.
 *
 * The report now sits behind the Fields tab, which puts that promise under
 * pressure: hiding the report must not hide a problem. Hence the tab-dot tests.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { FillerModal, type ModalCallbacks, type ModalData } from './modal';
import type { FieldMatch } from '../../shared/types';
import type { ModalLayout } from '../../shared/modalLayout';

const noop = () => {};

function callbacks(over: Partial<ModalCallbacks> = {}): ModalCallbacks {
  return {
    onRerun: noop, onReset: noop, onApply: noop, onConfirm: noop, onPick: noop,
    onFollow: noop, onFillAnyway: noop, onSkip: noop, onClose: noop,
    onOpenSetup: noop, onOpenOptions: noop, onAddLinks: noop,
    ...over,
  };
}

const match = (over: Partial<FieldMatch> = {}): FieldMatch => ({
  field: 'email',
  source: 'heuristic',
  confidence: 'high',
  filled: true,
  required: false,
  ...over,
});

const data = (matches: FieldMatch[], over: Partial<ModalData> = {}): ModalData => ({
  siteName: 'Test site',
  matches,
  applyState: 'ready',
  ...over,
});

let modal: FillerModal | undefined;

const ORIG_VW = window.innerWidth;
const ORIG_VH = window.innerHeight;

/** Resize the (jsdom) viewport and fire the resize the modal listens for. */
function setViewport(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
  window.dispatchEvent(new Event('resize'));
}

/** One footer button by its visible label. */
function footerBtn(shadow: ShadowRoot, label: string): HTMLButtonElement {
  return [...shadow.querySelectorAll('.cf-footer button.cf-btn')]
    .find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
}

/** Render, then switch to the report — most of these tests are about the rows. */
function render(d: ModalData, cb = callbacks()): ShadowRoot {
  modal = new FillerModal(cb);
  modal.render(d);
  modal.setView('fields');
  return shadow();
}

function shadow(): ShadowRoot {
  return (document.getElementById('chromium-filler-modal-host') as HTMLElement).shadowRoot!;
}

/** The Job/Fields tab buttons, by their label. */
function tab(root: ShadowRoot, label: 'Job' | 'Fields'): HTMLButtonElement {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('.cf-view'))
    .find((b) => b.textContent?.includes(label))!;
}

/** The rows, in render order, as `[dot class, aria-label, button labels]`. */
function rows(shadow: ShadowRoot) {
  return Array.from(shadow.querySelectorAll('.cf-row')).map((row) => {
    const dot = row.querySelector('.cf-dot')!;
    return {
      dot: dot.className,
      label: dot.getAttribute('aria-label'),
      buttons: Array.from(row.querySelectorAll('button')).map((b) => b.textContent),
    };
  });
}

afterEach(() => {
  modal?.destroy();
  modal = undefined;
  document.getElementById('chromium-filler-modal-host')?.remove();
  setViewport(ORIG_VW, ORIG_VH);
});

describe('FillerModal — the report tells the truth about each field', () => {
  it('shows a filled field as filled', () => {
    const shadow = render(data([match({ field: 'email', filled: true })]));
    expect(rows(shadow)[0].dot).toContain('high');
    expect(rows(shadow)[0].label).toBe('filled');
  });

  it('does not claim "filled" for a high-confidence field that did not fill', () => {
    // Every failure path in Controller.applyFill lands here: a <select> with no
    // matching option, or a saved override (always high confidence) pointing at
    // a wrapper div rather than a control.
    const shadow = render(data([match({ field: 'country', confidence: 'high', filled: false })]));
    const row = rows(shadow)[0];
    expect(row.label).not.toBe('filled');
    expect(row.dot).not.toContain('high');
  });

  it('offers Confirm on a high-confidence field that did not fill', () => {
    const shadow = render(data([match({ field: 'country', confidence: 'high', filled: false })]));
    expect(rows(shadow)[0].buttons).toContain('Confirm');
  });

  it('agrees with its own summary line', () => {
    const shadow = render(data([
      match({ field: 'email', filled: true }),
      match({ field: 'country', confidence: 'high', filled: false }),
      match({ field: 'city', confidence: 'none', filled: false }),
    ]));
    const summary = shadow.querySelector('.cf-summary')!.textContent!;
    expect(summary).toContain('1 filled');
    const green = rows(shadow).filter((r) => r.label === 'filled');
    expect(green).toHaveLength(1);
  });

  it('keeps low-confidence and unmatched rows as they were', () => {
    const shadow = render(data([
      match({ field: 'phone', confidence: 'low', filled: false }),
      match({ field: 'city', confidence: 'none', filled: false }),
    ]));
    const [low, none] = rows(shadow);
    expect(low.label).toBe('needs review');
    expect(low.buttons).toContain('Confirm');
    expect(none.label).toBe('not found');
    expect(none.buttons).not.toContain('Confirm');
  });

  it('treats a low-confidence field the user confirmed as filled', () => {
    const shadow = render(data([match({ field: 'phone', confidence: 'low', filled: true })]));
    expect(rows(shadow)[0].label).toBe('filled');
    expect(rows(shadow)[0].buttons).not.toContain('Confirm');
  });

  it('Confirm and Pick call back with the field', () => {
    const onConfirm = vi.fn();
    const onPick = vi.fn();
    const shadow = render(
      data([match({ field: 'country', confidence: 'high', filled: false })]),
      callbacks({ onConfirm, onPick }),
    );
    const buttons = Array.from(shadow.querySelectorAll('.cf-row button')) as HTMLButtonElement[];
    buttons.find((b) => b.textContent === 'Confirm')!.click();
    buttons.find((b) => b.textContent === 'Pick')!.click();
    expect(onConfirm).toHaveBeenCalledWith('country');
    expect(onPick).toHaveBeenCalledWith('country');
  });

  /**
   * The design system has exactly one primary fill, and in this card it is Apply.
   * Confirm shipped as a primary once: a report of sixteen rows then drew sixteen
   * coral buttons around the one control that actually sends something, which is
   * the opposite of what the fill is for. Asserted on the whole card, so a future
   * row action cannot quietly claim it either.
   */
  it('spends the primary fill on the footer, not on a row', () => {
    const shadow = render(data([
      match({ field: 'email', filled: true }),
      match({ field: 'country', confidence: 'high', filled: false }),
      match({ field: 'phone', confidence: 'low', filled: false }),
    ]));
    expect(shadow.querySelectorAll('.cf-row button.primary')).toHaveLength(0);
    expect(shadow.querySelectorAll('button.cf-btn.primary')).toHaveLength(1);
    expect(footerBtn(shadow, 'Apply').classList.contains('primary')).toBe(true);
  });
});

describe('FillerModal — the minimized pill', () => {
  it('does not read as all-green when nothing filled', () => {
    const shadow = render(data([
      match({ field: 'email', confidence: 'high', filled: false }),
      match({ field: 'city', confidence: 'none', filled: false }),
    ]));
    modal!.minimize();
    const pill = shadow.querySelector('.cf-pill')!;
    expect(pill.textContent).toContain('0/2 filled');
    expect(pill.querySelector('.cf-dot')!.className).not.toContain('high');
  });

  it('is green once every field is filled', () => {
    const shadow = render(data([match({ field: 'email', filled: true })]));
    modal!.minimize();
    expect(shadow.querySelector('.cf-pill .cf-dot')!.className).toContain('high');
  });

  it('minimizing keeps the report, so restoring shows it again', () => {
    const shadow = render(data([match({ field: 'email', filled: true })]));
    modal!.minimize();
    expect(shadow.querySelector('.cf-card')).toBeNull();
    modal!.restore();
    expect(rows(shadow)).toHaveLength(1);
  });
});

describe('FillerModal — the posting comes first', () => {
  const posting = (over: Partial<ModalData> = {}) =>
    data([match({ field: 'email', filled: true })], {
      jobTitle: 'Staff Platform Engineer',
      jobDescription: [
        { kind: 'para', text: 'Acme is hiring.' },
        { kind: 'heading', text: 'What you will do' },
        { kind: 'list', items: ['Own the pipeline', 'Mentor'] },
      ],
      ...over,
    });

  it('opens on the job, not on the field report', () => {
    modal = new FillerModal(callbacks());
    modal.render(posting());
    const root = shadow();
    expect(root.querySelector('.cf-title')!.textContent).toBe('Staff Platform Engineer');
    expect(root.querySelectorAll('.cf-row')).toHaveLength(0);
  });

  it('renders the description as prose, not as one welded string', () => {
    modal = new FillerModal(callbacks());
    modal.render(posting());
    const prose = shadow().querySelector('.cf-prose')!;
    expect(prose.querySelectorAll('p')).toHaveLength(1);
    expect(prose.querySelector('h4')!.textContent).toBe('What you will do');
    expect(Array.from(prose.querySelectorAll('li'), (li) => li.textContent))
      .toEqual(['Own the pipeline', 'Mentor']);
  });

  it('keeps requirements as their own section', () => {
    modal = new FillerModal(callbacks());
    modal.render(posting({ jobRequirements: [{ kind: 'list', items: ['8+ years'] }] }));
    const root = shadow();
    expect(root.querySelector('.cf-section')!.textContent).toBe('Requirements');
    expect(root.querySelectorAll('.cf-prose')).toHaveLength(2);
  });

  it('says so when the page had no description, rather than showing a blank body', () => {
    modal = new FillerModal(callbacks());
    modal.render(posting({ jobDescription: [], jobRequirements: [] }));
    expect(shadow().querySelector('.cf-empty')).not.toBeNull();
  });

  it('shows the report once Fields is tapped, and goes back on Job', () => {
    modal = new FillerModal(callbacks());
    modal.render(posting());
    const root = shadow();
    tab(root, 'Fields').click();
    expect(root.querySelectorAll('.cf-row')).toHaveLength(1);
    tab(root, 'Job').click();
    expect(root.querySelectorAll('.cf-row')).toHaveLength(0);
    expect(root.querySelector('.cf-title')).not.toBeNull();
  });

  it('stays on Fields across a re-render, so confirming a field does not eject you', () => {
    modal = new FillerModal(callbacks());
    const d = posting();
    modal.render(d);
    tab(shadow(), 'Fields').click();
    modal.render(d); // what Controller.confirmField does
    expect(shadow().querySelectorAll('.cf-row')).toHaveLength(1);
  });
});

/**
 * Three colours and a row of buttons explain nothing on their own, and the one
 * fact a user most needs at that moment — that nothing has gone anywhere yet,
 * whatever the report says — appeared nowhere they would actually read it.
 */
describe('FillerModal — the report says what it means', () => {
  it('keys the three dot colours under the rows', () => {
    const legend = render(data([match()])).querySelector('.cf-legend-line')!;
    expect(legend.textContent).toContain('filled');
    expect(legend.textContent).toContain('to check');
    expect(legend.textContent).toContain('unmatched');
    // A colour alone is not a key; each word gets the dot it describes.
    expect(legend.querySelectorAll('.cf-dot').length).toBe(3);
  });

  // Said once, in the footer, beside the button that would change it — rather
  // than under the report, which is where the user is not looking when they ask.
  it('says that nothing has been sent yet, next to the button that sends', () => {
    const footer = render(data([match()])).querySelector('.cf-footer')!;
    expect(footer.querySelector('.cf-flow')!.textContent).toMatch(/nothing has been sent/i);
  });

  // The two-step body has no report at all, so a report key there would be a lie.
  it('leaves the key off a posting that hands off elsewhere', () => {
    const shadow = render(data([], {
      redirect: { host: 'jobs.acme.com', reason: 'apply link is cross-origin', followed: false },
    }));
    expect(shadow.querySelector('.cf-legend-line')).toBeNull();
  });
});

/**
 * The footer is where the user decides. Everything that acts on the *posting* —
 * send it, or move on — has to be reachable without opening anything, and
 * everything that acts on the *extension* has to be out of the way: at 390px a
 * row of five buttons makes the two that matter no easier to hit.
 */
describe('FillerModal — the footer offers Apply and Skip', () => {
  const labels = (shadow: ShadowRoot) =>
    [...shadow.querySelectorAll('.cf-footer-actions > button.cf-btn')]
      .map((b) => b.textContent?.trim());
  const menu = (shadow: ShadowRoot) =>
    [...shadow.querySelectorAll('.cf-more-menu button')].map((b) => b.textContent?.trim());

  // The three that are on every branch: the card must not be a dead end. Before
  // them, a posting whose fields came out wrong could only be fixed by closing
  // the modal and finding Site setup in the toolbar popup.
  const WAYS_OUT = ['Site setup', 'Add links', 'Open options'];

  it('shows exactly Apply and Skip, with the rest behind the overflow', () => {
    const shadow = render(data([match()]));
    expect(labels(shadow)).toEqual(['Apply', 'Skip']);
    expect(menu(shadow)).toEqual(['Re-run', 'Reset', ...WAYS_OUT]);
  });

  it('reaches the setup wizard, the importer and the options page from the menu', () => {
    const onOpenSetup = vi.fn();
    const onAddLinks = vi.fn();
    const onOpenOptions = vi.fn();
    const shadow = render(data([match()]), callbacks({ onOpenSetup, onAddLinks, onOpenOptions }));
    const item = (label: string) => [...shadow.querySelectorAll<HTMLButtonElement>('.cf-more-menu button')]
      .find((b) => b.textContent?.trim() === label)!;
    item('Site setup').click();
    item('Add links').click();
    item('Open options').click();
    expect(onOpenSetup).toHaveBeenCalledOnce();
    expect(onAddLinks).toHaveBeenCalledOnce();
    expect(onOpenOptions).toHaveBeenCalledOnce();
  });

  // Re-run and Reset rebuild the whole card, so the menu went with them and this
  // never showed. Two of the three ways out open another tab and leave this one
  // untouched — and a popover still hanging over the report when the user comes
  // back has outlived the choice it was opened to make.
  it('closes the menu when an item is chosen', () => {
    const shadow = render(data([match()]));
    const toggle = shadow.querySelector<HTMLButtonElement>('.cf-more > .cf-btn')!;
    const menu = shadow.querySelector<HTMLElement>('.cf-more-menu')!;
    toggle.click();
    expect(menu.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    [...menu.querySelectorAll('button')].find((b) => b.textContent === 'Open options')!.click();
    expect(menu.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  // A posting already sent still needs them — that is when "the CV went to the
  // wrong field, let me fix this site" is most likely to be the next thought.
  it('keeps them on an applied posting, where Apply itself has retired', () => {
    const shadow = render(data([match()], { applied: true }));
    expect(menu(shadow)).toEqual(['Re-run', 'Reset', ...WAYS_OUT]);
  });

  it('presses the site’s Send button through onApply', () => {
    const onApply = vi.fn();
    const shadow = render(data([match()]), callbacks({ onApply }));
    footerBtn(shadow, 'Apply').click();
    expect(onApply).toHaveBeenCalledOnce();
  });

  it('reports the skip through onSkip', () => {
    const onSkip = vi.fn();
    const shadow = render(data([match()]), callbacks({ onSkip }));
    footerBtn(shadow, 'Skip').click();
    expect(onSkip).toHaveBeenCalledOnce();
  });

  // Skip used to render only during a session, so a posting opened by hand
  // could be closed but never recorded as one the user had decided against.
  it('offers Skip outside a session too', () => {
    expect(labels(render(data([match()])))).toContain('Skip');
  });

  it('names the consequence during a session, where skipping also opens the next', () => {
    const shadow = render(data([match()], {
      session: {
        active: true,
        batchSize: 5,
        progress: { total: 4, queued: 2, inFlight: 1, applied: 1, skipped: 0, done: 1, ratio: 0.25 },
      },
    }));
    expect(labels(shadow)).toEqual(['Apply', 'Skip → next']);
  });

  /**
   * A two-step posting has no form to apply to, but wanting nothing to do with
   * it is exactly as likely — more so, since following it costs a page load. It
   * keeps the same shape as the quick-apply footer: the primary action, Skip,
   * and the overflow. Three visible buttons clipped the primary one off the
   * right edge at 390px, which is how this was found.
   */
  it('offers Skip on a posting that hands off elsewhere, without a third button', () => {
    const shadow = render(data([], {
      redirect: { host: 'jobs.acme.com', reason: 'apply link is cross-origin', followed: false },
    }));
    expect(labels(shadow)).toEqual(['Open application', 'Skip']);
    expect(menu(shadow)).toEqual(['Fill this page instead', ...WAYS_OUT]);
  });
});

/**
 * Apply greys out when no Send button could be found. A greyed control that
 * cannot say why it is grey is how a user concludes the extension is broken —
 * which is exactly what happened to the button this one replaced.
 *
 * The reason now sits in the flow banner at the top of the body, stated at rest
 * rather than only after a press: a card whose sole clue was a dead-looking
 * button is what "the flow is hard to find" meant in practice.
 */
describe('FillerModal — the greyed Apply button explains itself', () => {
  it('stays pressable when there is nothing to press, so the press can answer', () => {
    const button = footerBtn(render(data([match()], { applyState: 'noButton' })), 'Apply');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    // `disabled` would swallow the click and leave the question unanswered.
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  it('states the reason without being asked', () => {
    const banner = render(data([match()], { applyState: 'noButton' }))
      .querySelector('.cf-flow.warn')!;
    expect(banner).not.toBeNull();
    expect(banner.textContent).toMatch(/send button/i);
    // Only the long form is behind the disclosure.
    expect(banner.querySelector('.cf-help')).toBeNull();
    expect(banner.querySelector('.cf-help-btn')).not.toBeNull();
  });

  it('opens a note saying what Apply does and how to point it at the button', () => {
    const shadow = render(data([match()], { applyState: 'noButton' }));
    expect(shadow.querySelector('.cf-flow .cf-help')).toBeNull();

    footerBtn(shadow, 'Apply').click();
    const note = shadow.querySelector('.cf-flow .cf-help')!;
    expect(note).not.toBeNull();
    expect(note.textContent).toMatch(/set up this site|send button/i);
    // Pressing again puts it away.
    footerBtn(shadow, 'Apply').click();
    expect(shadow.querySelector('.cf-flow .cf-help')).toBeNull();
  });

  // The banner's own `?` and the blocked Apply drive the same disclosure — two
  // controls for one panel, which must not get out of step with each other.
  it('opens the same note from the banner’s own help button', () => {
    const shadow = render(data([match()], { applyState: 'noButton' }));
    const ask = shadow.querySelector<HTMLButtonElement>('.cf-flow .cf-help-btn')!;
    ask.click();
    expect(shadow.querySelector('.cf-flow .cf-help')).not.toBeNull();
    expect(shadow.querySelector('.cf-flow .cf-help-btn')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('does not fire onApply while it is grey', () => {
    const onApply = vi.fn();
    const shadow = render(data([match()], { applyState: 'noButton' }), callbacks({ onApply }));
    footerBtn(shadow, 'Apply').click();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('never opens the note on a page with a Send button', () => {
    const onApply = vi.fn();
    const shadow = render(data([match()], { applyState: 'ready' }), callbacks({ onApply }));
    const button = footerBtn(shadow, 'Apply');
    expect(button.getAttribute('aria-disabled')).toBeNull();

    button.click();
    expect(onApply).toHaveBeenCalledOnce();
    expect(shadow.querySelector('.cf-flow .cf-help')).toBeNull();
  });

  /**
   * The other reason Apply is grey, and the one nobody would guess: no
   * confirmation element is configured, so a submission's outcome could not be
   * read back. The user's next action is completely different from "find the
   * button", so the note must be too.
   */
  it('says the confirmation is missing, not that the button is', () => {
    const shadow = render(data([match()], { applyState: 'noConfirmation' }));
    const apply = footerBtn(shadow, 'Apply');
    expect(apply.getAttribute('aria-disabled')).toBe('true');
    expect(apply.getAttribute('aria-label')).toMatch(/confirmation/i);
    // Stated up front, in the banner, as well as in the note behind it.
    expect(shadow.querySelector('.cf-flow.warn')!.textContent).toMatch(/confirmation element/i);

    apply.click();
    const note = shadow.querySelector('.cf-flow .cf-help')!;
    expect(note.textContent).toMatch(/confirmation element/i);
    // It must not send the user hunting for a button that was already found.
    expect(note.textContent).not.toMatch(/no such button could be found/i);
  });

  // Picking the Send button mid-session flips Apply live; a note about a button
  // that now works is just wrong text left on screen.
  it('drops an open note once the page gains a Send button', () => {
    modal = new FillerModal(callbacks());
    modal.render(data([match()], { applyState: 'noButton' }));
    modal.setApplyHelp(true);
    expect(shadow().querySelector('.cf-flow .cf-help')).not.toBeNull();

    modal.render(data([match()], { applyState: 'ready' }));
    expect(shadow().querySelector('.cf-flow .cf-help')).toBeNull();
    expect(shadow().querySelector('.cf-flow.warn')).toBeNull();
  });
});

/**
 * The resting state — the one the modal used to say nothing about. A filled
 * posting waiting on the user is by far the commonest thing on screen, and the
 * card showed a job advert and a coral button with no statement connecting them.
 */
describe('FillerModal — it says where the posting is in the flow', () => {
  it('reports the fill and that nothing has gone anywhere yet', () => {
    const banner = render(data([
      match({ field: 'email', filled: true }),
      match({ field: 'phone', confidence: 'low', filled: false }),
    ])).querySelector('.cf-flow.quiet')!;
    expect(banner.textContent).toMatch(/nothing has been sent/i);
    expect(banner.textContent).toContain('1 of 2');
  });

  it('says the same thing in both views', () => {
    modal = new FillerModal(callbacks());
    modal.render(data([match()], { jobTitle: 'A job' }));
    expect(shadow().querySelector('.cf-flow')).not.toBeNull();
    modal.setView('fields');
    expect(shadow().querySelector('.cf-flow')).not.toBeNull();
  });

  // A page with a Send button but no fields the extension recognised. It is not
  // "ready to review" — there is nothing to review — and it is not blocked either.
  it('reports an unrecognised form as empty rather than as ready', () => {
    const banner = render(data([], { applyState: 'ready' })).querySelector('.cf-flow')!;
    expect(banner.className).toContain('quiet');
    expect(banner.textContent).toMatch(/nothing to fill/i);
  });

  // A listing page has neither fields nor a Send button, and the question its
  // greyed Apply provokes is still "why can't I apply?".
  it('still explains a blocked Apply on a page with no fields', () => {
    const banner = render(data([], { applyState: 'noButton' })).querySelector('.cf-flow')!;
    expect(banner.className).toContain('warn');
    expect(banner.textContent).toMatch(/send button/i);
  });
});

/**
 * The one unambiguous good-news state. The site's own confirmation is routinely
 * below the fold or hidden behind this very card, so "did that actually go
 * through?" was a question the user answered by scrolling around the page they
 * had just submitted.
 */
describe('FillerModal — it says when the application went through', () => {
  const sent = (over: Partial<ModalData> = {}) =>
    data([match()], { jobTitle: 'A job', applied: true, ...over });

  it('shows a confirmation banner on the posting', () => {
    modal = new FillerModal(callbacks());
    modal.render(sent());
    const banner = shadow().querySelector('.cf-applied')!;
    expect(banner).not.toBeNull();
    expect(banner.textContent).toMatch(/sent/i);
    // Live region, because it appears without the user having moved focus.
    expect(banner.getAttribute('role')).toBe('status');
    // Named as what the site said, not as what the extension did: the claim is
    // only as good as the confirmation element that produced it.
    expect(banner.textContent).toContain('Test site');
  });

  /**
   * The confirmation lost to the posting on every axis that decides what gets
   * read first — 13px against 24px, a strip against a headline. It was "really
   * hard to find" for exactly that reason, so the hierarchy is now asserted.
   */
  it('outranks the job title rather than sitting under it', () => {
    modal = new FillerModal(callbacks());
    modal.render(sent());
    const root = shadow();
    const banner = root.querySelector('.cf-applied')!;
    const title = root.querySelector('.cf-title')!;
    // The banner comes first in the body…
    expect(banner.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // …and the title steps down to make room for it.
    expect(title.className).toContain('cf-title-sub');
    // Nothing left to do here, said in words.
    expect(root.textContent).toMatch(/safe to close this tab/i);
  });

  // The body scrolls; on a long posting the banner scrolls away with it, and the
  // header is the one strip of the card that is always on screen.
  it('marks the header too, which never scrolls away', () => {
    modal = new FillerModal(callbacks());
    modal.render(sent());
    const chip = shadow().querySelector('.cf-header .cf-sent-chip')!;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toMatch(/sent/i);
  });

  it('shows it on the report too, where the legend would otherwise deny it', () => {
    const shadow = render(sent());
    expect(shadow.querySelector('.cf-applied')).not.toBeNull();
    // The report is a record now, not a plan — and the footer's "nothing sent
    // yet" line is gone, rather than contradicting the banner above it.
    expect(shadow.querySelector('.cf-legend-send')!.textContent).toMatch(/already sent/i);
    expect(shadow.textContent).not.toMatch(/nothing has been sent/i);
  });

  // Pressing Apply twice would send a second application to the same posting.
  it('retires Apply rather than leaving it live', () => {
    const onApply = vi.fn();
    const shadow = render(sent(), callbacks({ onApply }));
    expect(footerBtn(shadow, 'Apply')).toBeUndefined();
    const done = footerBtn(shadow, 'Applied ✓');
    expect(done.getAttribute('aria-disabled')).toBe('true');
    done.click();
    expect(onApply).not.toHaveBeenCalled();
  });

  // Collapsed, the pill is the only thing left on screen; a fill count there
  // reads as unfinished work on a posting that is already done.
  it('says so on the minimized pill', () => {
    const shadow = render(sent());
    modal!.minimize();
    expect(shadow.querySelector('.cf-pill')!.textContent).toMatch(/sent/i);
    expect(shadow.querySelector('.cf-pill .cf-dot')!.className).toContain('ok');
  });

  it('stays quiet until the confirmation actually appeared', () => {
    const shadow = render(data([match()], { jobTitle: 'A job' }));
    expect(shadow.querySelector('.cf-applied')).toBeNull();
    expect(footerBtn(shadow, 'Apply')).toBeDefined();
  });
});

describe('FillerModal — the Fields tab advertises what it is hiding', () => {
  const withMatches = (matches: FieldMatch[]) => {
    modal = new FillerModal(callbacks());
    modal.render(data(matches, { jobTitle: 'A job' }));
    return tab(shadow(), 'Fields').querySelector('.cf-dot')!.className;
  };

  it('is red while any field was never found', () => {
    expect(withMatches([
      match({ field: 'email', filled: true }),
      match({ field: 'city', confidence: 'none', filled: false }),
    ])).toContain('none');
  });

  it('is amber while a field needs review', () => {
    expect(withMatches([
      match({ field: 'email', filled: true }),
      match({ field: 'phone', confidence: 'low', filled: false }),
    ])).toContain('low');
  });

  it('is amber for a high-confidence field that did not actually fill', () => {
    // Same rule as the row dot: "high confidence" is not "it worked".
    expect(withMatches([match({ field: 'country', confidence: 'high', filled: false })]))
      .toContain('low');
  });

  it('is green only when every field took its value', () => {
    expect(withMatches([
      match({ field: 'email', filled: true }),
      match({ field: 'phone', confidence: 'low', filled: true }),
    ])).toContain('high');
  });

  it('is not offered at all for a two-step posting, which has no form here', () => {
    modal = new FillerModal(callbacks());
    modal.render(data([], {
      jobTitle: 'A job',
      redirect: { host: 'ats.acme.test', reason: 'configured external apply link', followed: false },
    }));
    const root = shadow();
    expect(root.querySelector('.cf-views')).toBeNull();
    expect(root.querySelector('.cf-flow.accent')!.textContent).toContain('ats.acme.test');
  });
});

describe('FillerModal — stored geometry', () => {
  it('applies the saved size and position on a desktop viewport', () => {
    modal = new FillerModal(callbacks());
    modal.render(data([match()], {
      jobTitle: 'A job',
      layout: { right: 40, bottom: 24, width: 500, height: 600 },
    }));
    const card = shadow().querySelector('.cf-card') as HTMLElement;
    expect(card.style.width).toBe('500px');
    expect(card.style.right).toBe('40px');
  });

  it('clamps a layout stored on a bigger screen back onto this one', () => {
    modal = new FillerModal(callbacks());
    modal.render(data([match()], {
      jobTitle: 'A job',
      layout: { right: 16, bottom: 16, width: 4000, height: 4000 },
    }));
    const card = shadow().querySelector('.cf-card') as HTMLElement;
    expect(parseInt(card.style.width, 10)).toBeLessThanOrEqual(window.innerWidth);
    expect(parseInt(card.style.height, 10)).toBeLessThanOrEqual(window.innerHeight);
  });

  it('turns off the CSS size caps so the card can reach the size that was set', () => {
    // The stylesheet caps the card at min(88vh, 820px) tall as a fallback for the
    // no-layout case; left in place it silently overrode a stored size, so a card
    // meant to fill the screen came out 820px and the simulator was lying.
    modal = new FillerModal(callbacks());
    modal.render(data([match()], {
      jobTitle: 'A job',
      layout: { right: 0, bottom: 0, width: window.innerWidth, height: window.innerHeight },
    }));
    const card = shadow().querySelector('.cf-card') as HTMLElement;
    expect(card.style.maxHeight).toBe('none');
    expect(card.style.maxWidth).toBe('none');
    expect(parseInt(card.style.height, 10)).toBe(window.innerHeight);
  });

  it('keeps the chosen size fixed: a temporary shrink fits, then springs back', () => {
    // The bug this guards: applyLayout used to write the clamped size back over
    // the stored one, so narrowing the tab shrank the modal permanently — widen
    // it again and it stayed small. A fixed card fits a too-small viewport and
    // returns to its size when there is room.
    setViewport(1440, 900);
    modal = new FillerModal(callbacks());
    modal.render(data([match()], {
      jobTitle: 'A job',
      layout: { right: 16, bottom: 16, width: 460, height: 720 },
    }));
    const card = shadow().querySelector('.cf-card') as HTMLElement;
    expect(card.style.height).toBe('720px');

    setViewport(1000, 500); // shorter than the card
    expect(parseInt(card.style.height, 10)).toBeLessThanOrEqual(500);

    setViewport(1440, 900); // room again
    expect(card.style.height).toBe('720px');
    expect(card.style.width).toBe('460px');
  });
});

/**
 * A corner where two straight screen edges meet must not be rounded, and a card
 * edge lying along the viewport edge must not draw its own border there. Both are
 * CSS, keyed off these attributes — which is all jsdom can see, and all the modal
 * is responsible for.
 */
describe('FillerModal — flush edges', () => {
  const at = (over: Partial<ModalLayout>) => data([match()], {
    jobTitle: 'A job',
    layout: { right: 16, bottom: 16, width: 460, height: 720, ...over },
  });

  const limits = () => {
    const card = shadow().querySelector('.cf-card') as HTMLElement;
    const { limitTop, limitRight, limitBottom, limitLeft } = card.dataset;
    return { top: limitTop, right: limitRight, bottom: limitBottom, left: limitLeft };
  };

  it('marks nothing flush when the card sits in the gutter', () => {
    setViewport(1440, 900);
    modal = new FillerModal(callbacks());
    modal.render(at({}));
    expect(limits()).toEqual({ top: 'free', right: 'free', bottom: 'free', left: 'free' });
  });

  it('marks the two edges of a bottom-right corner it is jammed into', () => {
    setViewport(1440, 900);
    modal = new FillerModal(callbacks());
    modal.render(at({ right: 0, bottom: 0 }));
    expect(limits()).toEqual({ top: 'free', right: 'screen', bottom: 'screen', left: 'free' });
  });

  it('follows the card as it is dragged off the edge', () => {
    setViewport(1440, 900);
    modal = new FillerModal(callbacks());
    modal.render(at({ right: 0, bottom: 0 }));
    modal.place({ right: 16, bottom: 16, width: 460, height: 720 });
    expect(limits().right).toBe('free');
  });

  it('drops the attributes on a phone, so the bottom sheet keeps its own corners', () => {
    // Load-bearing: `.cf-card[data-limit-…]` outranks the plain `.cf-card` rule in
    // the narrow media query, so a leftover attribute would square the sheet's top
    // corners — the one place a rounded corner survives a flush edge on purpose.
    setViewport(390, 800);
    modal = new FillerModal(callbacks());
    modal.render(at({ right: 0, bottom: 0 }));
    const card = shadow().querySelector('.cf-card') as HTMLElement;
    expect(card.hasAttribute('data-limit-right')).toBe(false);
    expect(limits()).toEqual({ top: undefined, right: undefined, bottom: undefined, left: undefined });
  });
});

/**
 * Fullscreen is an *override* of the stored layout, not a replacement for it: the
 * user's configured card has to be waiting when they turn it off again. It is also
 * the one modal state that outlives the page, so it arrives through `ModalData`
 * from the controller rather than living on the instance the way `view` does.
 */
describe('FillerModal — fullscreen', () => {
  const laid = (over: Partial<ModalData> = {}) => data([match()], {
    jobTitle: 'A job',
    layout: { right: 16, bottom: 16, width: 460, height: 720 },
    ...over,
  });

  const card = () => shadow().querySelector('.cf-card') as HTMLElement;
  const toggle = () => shadow().querySelector('.cf-fullscreen') as HTMLButtonElement;
  const limits = () => {
    const { limitTop, limitRight, limitBottom, limitLeft } = card().dataset;
    return { top: limitTop, right: limitRight, bottom: limitBottom, left: limitLeft };
  };

  it('offers the toggle without spending the primary fill on it', () => {
    // The coral belongs to Apply. A header control that took it would make a
    // window decoration look like the decision the modal exists for.
    setViewport(1440, 900);
    modal = new FillerModal(callbacks());
    modal.render(laid());
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
    expect(toggle().getAttribute('aria-label')).toBe('Fullscreen');
    expect(toggle().classList.contains('primary')).toBe(false);
    expect(shadow().querySelectorAll('button.cf-btn.primary')).toHaveLength(1);
  });

  it('fills the viewport when pressed, and says so', () => {
    setViewport(1440, 900);
    const onFullscreen = vi.fn();
    modal = new FillerModal(callbacks({ onFullscreen }));
    modal.render(laid());

    toggle().click();

    expect(onFullscreen).toHaveBeenCalledWith(true);
    expect(card().style.width).toBe('1440px');
    expect(card().style.height).toBe('900px');
    expect(card().style.right).toBe('0px');
    expect(card().style.bottom).toBe('0px');
    // All four edges flush is what squares the corners and drops the borders.
    expect(limits()).toEqual({ top: 'screen', right: 'screen', bottom: 'screen', left: 'screen' });
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    expect(toggle().getAttribute('aria-label')).toBe('Exit fullscreen');
  });

  it('opens fullscreen when the stored setting says so', () => {
    // The whole point of persisting it: the next posting must not need the click.
    setViewport(1440, 900);
    modal = new FillerModal(callbacks());
    modal.render(laid({ fullscreen: true }));
    expect(card().style.width).toBe('1440px');
    expect(card().classList.contains('cf-full')).toBe(true);
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
  });

  it('gives back the configured card on the way out, untouched', () => {
    // The regression this design exists to prevent: fullscreen must not be
    // implemented by writing a full-viewport rectangle over `settings.modalLayout`,
    // or turning it off would leave the user with no card to come back to.
    setViewport(1440, 900);
    const onFullscreen = vi.fn();
    const d = laid({ fullscreen: true });
    modal = new FillerModal(callbacks({ onFullscreen }));
    modal.render(d);

    toggle().click();

    expect(onFullscreen).toHaveBeenCalledWith(false);
    expect(card().style.width).toBe('460px');
    expect(card().style.right).toBe('16px');
    expect(d.layout).toEqual({ right: 16, bottom: 16, width: 460, height: 720 });
  });

  it('tracks the viewport as it changes', () => {
    setViewport(1440, 900);
    modal = new FillerModal(callbacks());
    modal.render(laid({ fullscreen: true }));
    expect(card().style.width).toBe('1440px');

    setViewport(1000, 700);
    expect(card().style.width).toBe('1000px');
    expect(card().style.height).toBe('700px');
  });

  it('stops the header being a drag handle while it is on', () => {
    // A drag would move the card out from under the flag: it would look
    // un-fullscreened while the setting still said it was.
    setViewport(1440, 900);
    const onLayoutPreview = vi.fn();
    const onLayoutChange = vi.fn();
    modal = new FillerModal(callbacks({ onLayoutPreview, onLayoutChange }));
    modal.render(laid({ fullscreen: true }));

    const header = shadow().querySelector('.cf-header') as HTMLElement;
    header.setPointerCapture = noop;
    header.releasePointerCapture = noop;
    const at = (type: string, x: number, y: number) =>
      header.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));

    at('pointerdown', 500, 300);
    at('pointermove', 400, 200);
    at('pointerup', 400, 200);

    expect(onLayoutPreview).not.toHaveBeenCalled();
    expect(onLayoutChange).not.toHaveBeenCalled();
    expect(card().style.width).toBe('1440px');
  });

  it('is a class and no inline geometry on a phone', () => {
    // Under 640px the sheet is sized by the media query, and an inline width
    // would beat it — so fullscreen there has to be CSS off this class.
    setViewport(390, 800);
    modal = new FillerModal(callbacks());
    modal.render(laid({ fullscreen: true }));
    expect(card().classList.contains('cf-full')).toBe(true);
    expect(card().style.width).toBe('');
    expect(card().style.maxHeight).toBe('');
  });

  it('is offered on a two-step posting too, which has no view toggle', () => {
    // That page is nothing but a notice to read, so the room is worth more there
    // than anywhere — and the header builds a different set of controls.
    setViewport(1440, 900);
    modal = new FillerModal(callbacks());
    modal.render(laid({ redirect: { host: 'ats.example', reason: 'external', followed: false } }));
    expect(shadow().querySelector('.cf-views')).toBeNull();
    expect(toggle()).not.toBeNull();
  });
});

/**
 * The Options simulator draws the same card at 1/3 scale, and the two are bound
 * both ways: the frame drives the preview, and dragging or closing the preview
 * drives the frame. These are the modal's half of that contract.
 */
describe('FillerModal — two views of one layout', () => {
  const laid = (over = {}) => data([match()], {
    jobTitle: 'A job',
    layout: { right: 16, bottom: 16, width: 460, height: 720 },
    ...over,
  });

  it('re-places the card without rebuilding it', () => {
    // A rebuild mid-drag would throw away the very element holding the pointer
    // capture, so the driving view needs a way to move this one in place.
    setViewport(1440, 900);
    modal = new FillerModal(callbacks());
    modal.render(laid());
    const before = shadow().querySelector('.cf-card') as HTMLElement;

    modal.place({ right: 200, bottom: 100, width: 500, height: 600 });

    const after = shadow().querySelector('.cf-card') as HTMLElement;
    expect(after).toBe(before);
    expect(after.style.right).toBe('200px');
    expect(after.style.width).toBe('500px');
  });

  it('clamps what it is handed, like any other layout', () => {
    setViewport(1000, 800);
    modal = new FillerModal(callbacks());
    modal.render(laid());
    modal.place({ right: 0, bottom: 0, width: 4000, height: 4000 });
    const card = shadow().querySelector('.cf-card') as HTMLElement;
    expect(parseInt(card.style.width, 10)).toBeLessThanOrEqual(1000);
  });

  it('reports every step of a drag, but only persists on release', () => {
    // The split exists because the content script writes storage in
    // `onLayoutChange`: one write per drag, not one per pointermove.
    setViewport(1440, 900);
    const onLayoutPreview = vi.fn();
    const onLayoutChange = vi.fn();
    modal = new FillerModal(callbacks({ onLayoutPreview, onLayoutChange }));
    modal.render(laid());

    const header = shadow().querySelector('.cf-header') as HTMLElement;
    header.setPointerCapture = noop;
    header.releasePointerCapture = noop;
    // jsdom has no PointerEvent; a MouseEvent carries everything the handler reads.
    const at = (type: string, x: number, y: number) =>
      header.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));

    at('pointerdown', 500, 300);
    at('pointermove', 480, 290);
    at('pointermove', 460, 280);
    expect(onLayoutPreview).toHaveBeenCalledTimes(2);
    expect(onLayoutChange).not.toHaveBeenCalled();

    at('pointerup', 460, 280);
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
  });
});
