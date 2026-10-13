/**
 * Render-logic tests for the review card. The card is the extension's entire
 * promise — "filling is automatic but never silent" — so what a row *claims*
 * about an input has to match what actually happened to it, and every question
 * the extension did not recognise has to be there with a way to teach it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { FillerModal, type ModalCallbacks, type ModalData } from './modal';
import type { FieldMatch } from '../../shared/types';
import type { ModalLayout } from '../../shared/modalLayout';
import { ACTION_LABELS } from '../../shared/labels';
import type { FieldChoice } from '../../shared/profileFields';

const noop = () => {};

function callbacks(over: Partial<ModalCallbacks> = {}): ModalCallbacks {
  return {
    onRerun: noop, onConfirm: noop, onTeach: noop, onPoint: noop,
    onSkip: noop, onClose: noop,
    ...over,
  };
}

let nextId = 1;
const match = (over: Partial<FieldMatch> = {}): FieldMatch => ({
  id: `r${nextId++}`,
  question: 'Email',
  kind: 'email',
  field: 'email',
  fieldLabel: 'Email',
  source: 'heuristic',
  confidence: 'high',
  valueToFill: 'ada@example.test',
  filled: true,
  required: false,
  ...over,
});

const unknown = (question: string, over: Partial<FieldMatch> = {}): FieldMatch => match({
  question, kind: 'text', field: undefined, fieldLabel: undefined, valueToFill: undefined,
  source: 'none', confidence: 'none', filled: false, ...over,
});

const CHOICES: FieldChoice[] = [
  { id: 'email', label: 'Email', group: 'builtIn' },
  { id: 'firstName', label: 'First name', group: 'builtIn' },
  { id: 'c_exp', label: 'Years of experience', group: 'custom' },
];

const data = (matches: FieldMatch[], over: Partial<ModalData> = {}): ModalData => ({
  siteName: 'jobs.example',
  matches,
  choices: CHOICES,
  ...over,
});

const QUEUE = {
  active: true, batchSize: 2,
  progress: { total: 12, queued: 7, inFlight: 2, done: 3, ratio: 0.25 },
};

let modal: FillerModal | undefined;

const ORIG_VW = window.innerWidth;
const ORIG_VH = window.innerHeight;

function setViewport(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
  window.dispatchEvent(new Event('resize'));
}

function footerBtn(shadow: ShadowRoot, label: string): HTMLButtonElement {
  return [...shadow.querySelectorAll('.cf-footer button.cf-btn')]
    .find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
}

/** Render on the report — most of these tests are about the rows. */
function render(d: ModalData, cb = callbacks()): ShadowRoot {
  modal = new FillerModal(cb);
  modal.render(d);
  return shadow();
}

function shadow(): ShadowRoot {
  return (document.getElementById('chromium-filler-modal-host') as HTMLElement).shadowRoot!;
}

function rows(shadow: ShadowRoot) {
  return Array.from(shadow.querySelectorAll('.cf-row')).map((row) => {
    const dot = row.querySelector('.cf-dot')!;
    return {
      question: row.querySelector('.cf-field b')!.textContent,
      detail: row.querySelector('.cf-field small')!.textContent,
      dot: dot.className,
      tag: row.querySelector('.cf-tag')!.textContent,
      buttons: Array.from(row.querySelectorAll('button')).map((b) => b.textContent),
    };
  });
}

function rowButton(root: ShadowRoot, index: number, label: string): HTMLButtonElement {
  return [...root.querySelectorAll('.cf-row')[index].querySelectorAll('button')]
    .find((b) => b.textContent === label) as HTMLButtonElement;
}

afterEach(() => {
  modal?.destroy();
  modal = undefined;
  document.getElementById('chromium-filler-modal-host')?.remove();
  setViewport(ORIG_VW, ORIG_VH);
});

describe('FillerModal — each row tells the truth about its input', () => {
  it('names the question, and what went in', () => {
    const r = rows(render(data([match({ question: 'Your email *' })])))[0];
    expect(r.question).toBe('Your email *');
    // The question already says "email", so the detail is just the answer.
    expect(r.detail).toBe('ada@example.test');
    expect(r.dot).toContain('high');
    expect(r.tag).toBe('filled');
  });

  it('does not claim "filled" for a confident match that did not take', () => {
    const r = rows(render(data([match({ filled: false })])))[0];
    expect(r.dot).toContain('low');
    expect(r.detail).toMatch(/would not take/i);
  });

  it('a kept answer is done, and says so', () => {
    const r = rows(render(data([match({ filled: false, kept: true })])))[0];
    expect(r.dot).toContain('high');
    expect(r.detail).toMatch(/kept the answer already there/i);
  });

  it('names the field when the question words it differently', () => {
    const r = rows(render(data([match({ question: 'Where are you based?', field: 'city', fieldLabel: 'City', valueToFill: 'London' })])))[0];
    expect(r.detail).toBe('City · London');
  });

  it('a recognised question with nothing in the profile says where the gap is', () => {
    const r = rows(render(data([match({ field: 'phone', fieldLabel: 'Phone', valueToFill: undefined, filled: false })])))[0];
    expect(r.detail).toBe('Phone · nothing in your profile for this');
  });

  it('an unrecognised question is a row to teach — plain, not a failure', () => {
    const r = rows(render(data([unknown('How did you hear about us?', { required: true })])))[0];
    expect(r.dot).toContain('none');
    expect(r.tag).toBe('to teach');
    expect(r.detail).toBe('Not recognised · required');
    expect(r.buttons).toEqual([ACTION_LABELS.teach]);
    const tag = shadow().querySelector('.cf-tag')!;
    expect(tag.className).not.toMatch(/\berr\b/);
  });

  it('a question the page did not word still gets a name', () => {
    expect(rows(render(data([unknown('', { kind: 'select' })])))[0].question).toBe('Unlabelled drop-down');
  });

  it('offers Confirm on a guess with something to fill, and Not this on every match', () => {
    const shadow = render(data([match({ confidence: 'low', filled: false }), match()]));
    expect(rows(shadow).map((r) => r.buttons)).toEqual([
      [ACTION_LABELS.confirm, ACTION_LABELS.notThis],
      [ACTION_LABELS.notThis],
    ]);
  });

  it('a confirmed row retires its button without touching its dot', () => {
    const m = match({ confidence: 'low', filled: false });
    const r = rows(render(data([m], { confirmed: [m.id] })))[0];
    expect(r.buttons).toContain(ACTION_LABELS.confirmed);
    expect(r.dot).toContain('low');
  });

  it('a taught row retires to "Taught ✓"', () => {
    expect(rows(render(data([match({ taught: true, source: 'lesson' })])))[0].buttons).toEqual([ACTION_LABELS.taught]);
  });

  it('an ignored row stays in place, needs nothing, and can be undone', () => {
    const r = rows(render(data([unknown('Middle name', { ignored: true })])))[0];
    expect(r.tag).toBe(ACTION_LABELS.ignored);
    expect(r.buttons).toEqual([ACTION_LABELS.notThis]);
  });

  it('never spends a primary fill — the one thing left is the site\'s own button', () => {
    const shadow = render(data([match(), unknown('Q')]));
    expect(shadow.querySelectorAll('.primary')).toHaveLength(0);
  });
});

describe('FillerModal — the report holds still', () => {
  it('renders rows in the order it was handed', () => {
    const shadow = render(data([match({ question: 'B' }), unknown('A'), match({ question: 'C', confidence: 'low', filled: false })]));
    expect(rows(shadow).map((r) => r.question)).toEqual(['B', 'A', 'C']);
  });

  it('puts the inputs that appeared later under their own head, at the end', () => {
    const shadow = render(data([match({ question: 'Email' }), unknown('Visa?', { later: true }), match({ question: 'City', later: true })]));
    const report = shadow.querySelector('.cf-report')!;
    expect([...report.children].map((c) => c.className.split(' ')[0])).toEqual(['cf-row', 'cf-later', 'cf-row', 'cf-row']);
  });
});

describe('FillerModal — teaching a row', () => {
  it('opens a chooser inside the list, under the row', () => {
    const shadow = render(data([unknown('Given name'), match()]));
    rowButton(shadow, 0, ACTION_LABELS.teach).click();
    const report = shadow.querySelector('.cf-report')!;
    expect(report.children[1].className).toBe('cf-teach');
    const select = shadow.querySelector('.cf-teach select') as HTMLSelectElement;
    expect([...select.querySelectorAll('optgroup')].map((g) => g.label)).toEqual(['Your details', 'Your own fields', 'Something else']);
  });

  it('teaches a row as a field', () => {
    const onTeach = vi.fn();
    const m = unknown('Given name');
    const shadow = render(data([m]), callbacks({ onTeach }));
    modal!.openTeach(m.id);
    const select = shadow.querySelector('.cf-teach select') as HTMLSelectElement;
    select.value = 'firstName';
    select.dispatchEvent(new Event('change'));
    const save = [...shadow.querySelectorAll('.cf-teach button')].find((b) => b.textContent === ACTION_LABELS.save) as HTMLButtonElement;
    save.click();
    expect(onTeach).toHaveBeenCalledWith(m.id, { field: 'firstName' });
    expect(shadow.querySelector('.cf-teach')).toBeNull();
  });

  it('makes a new field on the spot, named after the question', () => {
    const onTeach = vi.fn();
    const m = unknown('Notice period');
    const shadow = render(data([m]), callbacks({ onTeach }));
    modal!.openTeach(m.id, { newField: true });
    const [name, value] = [...shadow.querySelectorAll('.cf-teach input')] as HTMLInputElement[];
    expect(name.value).toBe('Notice period');
    value.value = '1 month';
    value.dispatchEvent(new Event('input'));
    ([...shadow.querySelectorAll('.cf-teach button')].find((b) => b.textContent === ACTION_LABELS.save) as HTMLButtonElement).click();
    expect(onTeach).toHaveBeenCalledWith(m.id, { newField: { label: 'Notice period', value: '1 month' } });
  });

  it('can set a question aside', () => {
    const onTeach = vi.fn();
    const m = unknown('Middle name');
    const shadow = render(data([m]), callbacks({ onTeach }));
    modal!.openTeach(m.id);
    const select = shadow.querySelector('.cf-teach select') as HTMLSelectElement;
    select.value = '__ignore';
    select.dispatchEvent(new Event('change'));
    ([...shadow.querySelectorAll('.cf-teach button')].find((b) => b.textContent === ACTION_LABELS.save) as HTMLButtonElement).click();
    expect(onTeach).toHaveBeenCalledWith(m.id, { ignore: true });
  });

  it('will not save without an answer, and says so by being unavailable', () => {
    const onTeach = vi.fn();
    const m = unknown('Given name');
    const shadow = render(data([m]), callbacks({ onTeach }));
    modal!.openTeach(m.id);
    const save = [...shadow.querySelectorAll('.cf-teach button')].find((b) => b.textContent === ACTION_LABELS.save) as HTMLButtonElement;
    expect(save.getAttribute('aria-disabled')).toBe('true');
    save.click();
    expect(onTeach).not.toHaveBeenCalled();
  });

  it('survives a re-render — the engine repaints as fields appear', () => {
    const m = unknown('Given name');
    const shadow = render(data([m]));
    modal!.openTeach(m.id);
    modal!.render(data([m, unknown('Later', { later: true })]));
    expect(shadow.querySelector('.cf-teach')).not.toBeNull();
  });

  it('"Not this" on a match opens the same chooser, on the field it was taken for', () => {
    const m = match();
    const shadow = render(data([m]));
    rowButton(shadow, 0, ACTION_LABELS.notThis).click();
    expect((shadow.querySelector('.cf-teach select') as HTMLSelectElement).value).toBe('email');
  });

  it('opening a chooser from the picker unfolds the card', () => {
    const m = unknown('Given name');
    modal = new FillerModal(callbacks());
    modal.render(data([m]));
    modal.minimize();
    modal.openTeach(m.id);
    expect(modal.isMinimized).toBe(false);
    expect(shadow().querySelector('.cf-teach')).not.toBeNull();
  });
});

describe('FillerModal — the count line and the banner', () => {
  it('keys filled, to check and to teach above the rows', () => {
    const shadow = render(data([match(), match({ confidence: 'low', filled: false }), unknown('Q')]));
    const summary = shadow.querySelector('.cf-summary')!.textContent!;
    expect(summary).toMatch(/1\s*filled/);
    expect(summary).toMatch(/1\s*to check/);
    expect(summary).toMatch(/1\s*to teach/);
  });

  it('ignored rows count nowhere', () => {
    const shadow = render(data([match(), unknown('Q', { ignored: true })]));
    expect(shadow.querySelector('.cf-summary')!.textContent).toMatch(/0\s*to teach/);
  });

  it('rests on "submit on the site", beside the footer', () => {
    const shadow = render(data([match()]));
    expect(shadow.querySelector('.cf-footer .cf-flow')!.textContent).toMatch(/submit on the site/i);
  });

  it('a page of new questions is an invitation to teach', () => {
    const shadow = render(data([unknown('A'), unknown('B')]));
    expect(shadow.querySelector('.cf-flow-title')!.textContent).toBe('Nothing recognised yet');
  });

  it('blames an empty profile, not the page', () => {
    const shadow = render(data([unknown('A')], { profileEmpty: true }));
    expect(shadow.querySelector('.cf-flow-title')!.textContent).toBe('Nothing to fill with yet');
  });
});

describe('FillerModal — the footer', () => {
  const footerLabels = (shadow: ShadowRoot) =>
    [...shadow.querySelectorAll('.cf-footer-actions > button.cf-btn')].map((b) => b.textContent);

  it('is Fill again and Teach, off the queue — no overflow menu', () => {
    const shadow = render(data([match()]));
    expect(footerLabels(shadow)).toEqual([ACTION_LABELS.fillAgain, ACTION_LABELS.teach]);
    expect(footerBtn(shadow, ACTION_LABELS.skipNext)).toBeUndefined();
    expect(shadow.querySelector('.cf-more')).toBeNull();
  });

  it('adds Skip → next on a queue tab', () => {
    const onSkip = vi.fn();
    const shadow = render(data([match()], { queue: QUEUE }), callbacks({ onSkip }));
    expect(footerLabels(shadow)).toEqual([ACTION_LABELS.fillAgain, ACTION_LABELS.teach, ACTION_LABELS.skipNext]);
    footerBtn(shadow, ACTION_LABELS.skipNext).click();
    expect(onSkip).toHaveBeenCalled();
  });

  it('retires Skip on a posting already done, without removing it', () => {
    const onSkip = vi.fn();
    const shadow = render(data([match()], { queue: QUEUE, alreadyDone: true }), callbacks({ onSkip }));
    const skip = footerBtn(shadow, ACTION_LABELS.skipNext);
    expect(skip.getAttribute('aria-disabled')).toBe('true');
    skip.click();
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('Fill again sweeps again, and Teach points at a field — the popup\'s Teach', () => {
    const onRerun = vi.fn();
    const onPoint = vi.fn();
    const shadow = render(data([match()]), callbacks({ onRerun, onPoint }));
    footerBtn(shadow, ACTION_LABELS.fillAgain).click();
    expect(onRerun).toHaveBeenCalled();
    footerBtn(shadow, ACTION_LABELS.teach).click();
    expect(onPoint).toHaveBeenCalled();
  });

  it('does not offer Reset', () => {
    const shadow = render(data([match()]));
    expect(shadow.textContent).not.toMatch(/Reset/);
  });
});

describe('FillerModal — the queue', () => {
  it('shows the queue strip only on a queue tab', () => {
    expect(render(data([match()])).querySelector('.cf-session')).toBeNull();
    modal?.destroy();
    document.getElementById('chromium-filler-modal-host')?.remove();
    const shadow = render(data([match()], { queue: QUEUE }));
    expect(shadow.querySelector('.cf-session')!.textContent).toContain('3/12 done');
  });
});

describe('FillerModal — a posting already done', () => {
  it('leads with the record and marks the header', () => {
    modal = new FillerModal(callbacks());
    modal.render(data([match()], { alreadyDone: true }));
    const root = shadow();
    expect(root.querySelector('.cf-flow.ok .cf-flow-title')!.textContent).toBe('Already done');
    expect(root.querySelector('.cf-header .cf-sent-chip')!.textContent).toBe('Done');
  });

  it('says so on the pill', () => {
    modal = new FillerModal(callbacks());
    modal.render(data([match()], { alreadyDone: true }));
    modal.minimize();
    expect(shadow().querySelector('.cf-pill')!.textContent).toBe('Already done');
  });
});

describe('FillerModal — the pill', () => {
  it('counts what was filled and what is left to teach', () => {
    modal = new FillerModal(callbacks());
    modal.render(data([match(), unknown('Q')]));
    modal.minimize();
    const pill = shadow().querySelector('.cf-pill')!;
    expect(pill.textContent).toBe('1 filled · 1 to teach');
    expect(pill.querySelector('.cf-dot')!.className).toContain('none');
  });

  it('is green once everything is answered', () => {
    modal = new FillerModal(callbacks());
    modal.render(data([match()]));
    modal.minimize();
    expect(shadow().querySelector('.cf-pill .cf-dot')!.className).toContain('high');
  });

  it('minimizing keeps the report, so restoring shows it again', () => {
    modal = new FillerModal(callbacks());
    modal.render(data([match(), unknown('Q')]));
    modal.minimize();
    modal.restore();
    expect(rows(shadow())).toHaveLength(2);
  });
});

describe('FillerModal — the header', () => {
  const dotOn = (matches: FieldMatch[]) => {
    modal = new FillerModal(callbacks());
    modal.render(data(matches));
    return shadow().querySelector('.cf-header .cf-dot')!.className;
  };
  it('grey while a question is left to teach', () => expect(dotOn([match(), unknown('Q')])).toContain('none'));
  it('amber while a row needs a look', () => expect(dotOn([match({ filled: false })])).toContain('low'));
  it('green when every row is answered', () => expect(dotOn([match(), unknown('Q', { ignored: true })])).toContain('high'));

  it('is the report alone: no view toggle and no fullscreen', () => {
    const root = render(data([match()]));
    expect(root.querySelector('.cf-views, .cf-view')).toBeNull();
    expect(root.querySelector('.cf-fullscreen')).toBeNull();
    expect(root.querySelector('.cf-report')).not.toBeNull();
  });
});

describe('FillerModal — stored geometry', () => {
  it('applies the saved size and position on a desktop viewport', () => {
    modal = new FillerModal(callbacks());
    modal.render(data([match()], {
        layout: { right: 40, bottom: 24, width: 500, height: 600 },
    }));
    const card = shadow().querySelector('.cf-card') as HTMLElement;
    expect(card.style.width).toBe('500px');
    expect(card.style.right).toBe('40px');
  });

  it('clamps a layout stored on a bigger screen back onto this one', () => {
    modal = new FillerModal(callbacks());
    modal.render(data([match()], {
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

describe('FillerModal — two views of one layout', () => {
  const laid = (over = {}) => data([match()], {
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

/**
 * The one non-`ready` Apply that is not retired.
 *
 * It is not a failure state: the site fills and the Send button is known, and the
 * only thing missing is the reply — which cannot exist until an application has gone
 * in. So the press has to work, and it has to say what else it is about to start.
 */
