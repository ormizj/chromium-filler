/**
 * Render-logic tests for the review modal. The modal is the extension's entire
 * promise — "filling is automatic but never silent" — so what a row *claims*
 * about a field has to match what actually happened to it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { FillerModal, type ModalCallbacks, type ModalData } from './modal';
import type { FieldMatch } from '../../shared/types';

const noop = () => {};

function callbacks(over: Partial<ModalCallbacks> = {}): ModalCallbacks {
  return {
    onRerun: noop, onReset: noop, onSubmitCv: noop, onConfirm: noop, onPick: noop,
    onFollow: noop, onFillAnyway: noop, onSkip: noop, onClose: noop,
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
  canSubmitCv: false,
  ...over,
});

let modal: FillerModal | undefined;

function render(d: ModalData, cb = callbacks()): ShadowRoot {
  modal = new FillerModal(cb);
  modal.render(d);
  return (document.getElementById('chromium-filler-modal-host') as HTMLElement).shadowRoot!;
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
