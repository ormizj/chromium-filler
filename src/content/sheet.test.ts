/**
 * The one slot, tested through both surfaces at once.
 *
 * The review modal and the setup panel are one object with two renderings, and
 * before `Sheet` existed they were not: the panel hardcoded its own corner and its
 * own size, its drag had no ceiling, and nothing re-clamped it when the window
 * changed. Every assertion here is about the two behaving identically, because
 * "identically" is the whole feature — a rule proved on the modal alone is exactly
 * the rule the panel used to break.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { FillerModal, type ModalCallbacks, type ModalData } from './modal/modal';
import { SetupPanel, type SetupCallbacks, type SetupData } from './setupPanel';
import { DEFAULT_MODAL_LAYOUT, MIN_H, MIN_W, type ModalLayout } from '../shared/modalLayout';

const noop = () => {};

const ORIG_VW = window.innerWidth;
const ORIG_VH = window.innerHeight;

/** Resize the (jsdom) viewport and fire the resize both sheets listen for. */
function setViewport(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
  window.dispatchEvent(new Event('resize'));
}

function modalCallbacks(over: Partial<ModalCallbacks> = {}): ModalCallbacks {
  return {
    onRerun: noop, onApply: noop, onConfirm: noop, onPick: noop,
    onFollow: noop, onFillAnyway: noop, onSkip: noop, onClose: noop,
    onOpenSetup: noop, onOpenOptions: noop,
    ...over,
  };
}

function setupCallbacks(over: Partial<SetupCallbacks> = {}): SetupCallbacks {
  return {
    onAddPrep: noop, onPickPrepTarget: noop, onMovePrep: noop, onRemovePrep: noop,
    onSetPrepMs: noop, onRunPrep: noop, onPickContainer: noop, onClearContainer: noop,
    onPickField: noop, onClearField: noop, onPickRedirect: noop, onClearRedirect: noop,
    onPickSubmit: noop, onClearSubmit: noop, onPickSuccess: noop, onClearSuccess: noop,
    onRename: noop, onOpenOptions: noop, onClose: noop, onDismissHelp: noop,
    ...over,
  };
}

function modalData(over: Partial<ModalData> = {}): ModalData {
  return {
    siteName: 'Acme',
    jobTitle: 'Engineer',
    matches: [],
    applyState: 'ready',
    layout: DEFAULT_MODAL_LAYOUT,
    ...over,
  };
}

function setupData(over: Partial<SetupData> = {}): SetupData {
  return {
    name: 'Acme',
    urlPattern: '*://acme.com/*',
    prep: [],
    containers: [],
    fields: [],
    verdict: { title: 'Quick apply', detail: 'a form was found here', kind: 'quickApply' },
    redirect: [],
    beforeFollow: [],
    submitCv: [],
    submit: { key: 'submitSelector', label: 'Send button', status: 'low', note: 'auto · Apply', hasSave: false },
    success: { key: 'successSelector', label: 'Confirmation element', status: 'high', note: 'saved · #done', hasSave: true },
    helpSeen: true,
    layout: DEFAULT_MODAL_LAYOUT,
    ...over,
  };
}

/**
 * The two sheets behind one interface, so every geometry rule below runs against
 * both. `open` takes the layout so a case can hand each the *same* rectangle and
 * assert they land in the same place.
 */
interface Surface {
  name: string;
  open(layout?: ModalLayout, cb?: Partial<ModalCallbacks & SetupCallbacks>): Sheetish;
}

interface Sheetish {
  card(): HTMLElement | null;
  pill(): HTMLElement | null;
  minimize(): void;
  restore(): void;
  setSlot(slot: number | null): void;
  setFullscreen(on: boolean): void;
  isMinimized: boolean;
  destroy(): void;
}

let live: { destroy(): void }[] = [];

function shadowOf(hostId: string): ShadowRoot {
  return (document.getElementById(hostId) as HTMLElement).shadowRoot!;
}

const SURFACES: Surface[] = [
  {
    name: 'review modal',
    open(layout = DEFAULT_MODAL_LAYOUT, cb = {}) {
      const modal = new FillerModal(modalCallbacks(cb));
      live.push(modal);
      modal.render(modalData({ layout }));
      const root = shadowOf('chromium-filler-modal-host');
      return {
        card: () => root.querySelector('.cf-card'),
        pill: () => root.querySelector('.cf-pill'),
        minimize: () => modal.minimize(),
        restore: () => modal.restore(),
        setSlot: (s) => modal.setSlot(s),
        setFullscreen: (on) => modal.setFullscreen(on),
        get isMinimized() { return modal.isMinimized; },
        destroy: () => modal.destroy(),
      };
    },
  },
  {
    name: 'setup panel',
    open(layout = DEFAULT_MODAL_LAYOUT, cb = {}) {
      const panel = new SetupPanel(setupCallbacks(cb));
      live.push(panel);
      panel.render(setupData({ layout }));
      const root = shadowOf('chromium-filler-setup-host');
      return {
        card: () => root.querySelector('.cf-card'),
        pill: () => root.querySelector('.cf-pill'),
        minimize: () => panel.minimize(),
        restore: () => panel.restore(),
        setSlot: (s) => panel.setSlot(s),
        setFullscreen: (on) => panel.setFullscreen(on),
        get isMinimized() { return panel.isMinimized; },
        destroy: () => panel.destroy(),
      };
    },
  },
];

afterEach(() => {
  for (const s of live) s.destroy();
  live = [];
  setViewport(ORIG_VW, ORIG_VH);
});

describe.each(SURFACES)('$name — geometry', (surface) => {
  it('renders at the stored rectangle', () => {
    setViewport(1440, 900);
    const card = surface.open({ right: 24, bottom: 32, width: 500, height: 640 }).card()!;
    expect(card.style.width).toBe('500px');
    expect(card.style.height).toBe('640px');
    expect(card.style.right).toBe('24px');
    expect(card.style.bottom).toBe('32px');
    // The anchor is bottom-right, so the other two have to be handed back or the
    // stylesheet's own `top`/`left` would fight the inline rectangle.
    expect(card.style.top).toBe('auto');
    expect(card.style.left).toBe('auto');
  });

  it('overrides the stylesheet caps, which would otherwise beat an inline width', () => {
    setViewport(1440, 900);
    const card = surface.open().card()!;
    expect(card.style.maxWidth).toBe('none');
    expect(card.style.maxHeight).toBe('none');
  });

  it('clamps a rectangle chosen on a bigger screen back onto this one', () => {
    setViewport(1024, 700);
    const card = surface.open({ right: 900, bottom: 800, width: 1600, height: 1400 }).card()!;
    expect(parseInt(card.style.width, 10)).toBeLessThanOrEqual(1024);
    expect(parseInt(card.style.height, 10)).toBeLessThanOrEqual(700);
    expect(parseInt(card.style.right, 10) + parseInt(card.style.width, 10)).toBeLessThanOrEqual(1024);
    expect(parseInt(card.style.bottom, 10) + parseInt(card.style.height, 10)).toBeLessThanOrEqual(700);
  });

  it('never shrinks below the minimum a header, a line and a footer need', () => {
    setViewport(1440, 900);
    const card = surface.open({ right: 16, bottom: 16, width: 40, height: 40 }).card()!;
    expect(parseInt(card.style.width, 10)).toBe(MIN_W);
    expect(parseInt(card.style.height, 10)).toBe(MIN_H);
  });

  it('springs back after a temporary shrink instead of keeping it', () => {
    // The intended size is fixed; only a gesture changes it. Writing the clamped
    // value back would turn "I narrowed the tab for a second" into a card that
    // stays small forever.
    setViewport(1440, 900);
    const sheet = surface.open({ right: 16, bottom: 16, width: 900, height: 800 });
    setViewport(600, 500);
    setViewport(1440, 900);
    expect(sheet.card()!.style.width).toBe('900px');
    expect(sheet.card()!.style.height).toBe('800px');
  });

  it('publishes the edges it ended up flush against', () => {
    setViewport(1440, 900);
    const card = surface.open({ right: 0, bottom: 0, width: 460, height: 720 }).card()!;
    expect(card.getAttribute('data-limit-right')).toBe('screen');
    expect(card.getAttribute('data-limit-bottom')).toBe('screen');
    expect(card.getAttribute('data-limit-left')).not.toBe('screen');
  });

  it('is a bottom sheet under 640px — no inline geometry to beat the media query', () => {
    // The exact regression the setup panel used to be: its own stylesheet block
    // outranked the narrow rules, so on a phone it was a 400px column off the top.
    setViewport(390, 780);
    const card = surface.open().card()!;
    for (const prop of ['width', 'height', 'right', 'bottom', 'left', 'top', 'max-width', 'max-height']) {
      expect(card.style.getPropertyValue(prop), `${prop} must be left to the stylesheet`).toBe('');
    }
    expect(card.hasAttribute('data-limit-right')).toBe(false);
  });

  it('fills the viewport in fullscreen, and gives the configured card back on exit', () => {
    setViewport(1440, 900);
    const sheet = surface.open({ right: 24, bottom: 32, width: 500, height: 640 });
    sheet.setFullscreen(true);
    expect(sheet.card()!.style.width).toBe('1440px');
    expect(sheet.card()!.style.height).toBe('900px');
    expect(sheet.card()!.classList.contains('cf-full')).toBe(true);

    sheet.setFullscreen(false);
    expect(sheet.card()!.style.width).toBe('500px');
    expect(sheet.card()!.style.right).toBe('24px');
  });

  it('carries resize handles on the far edges, and none on a bottom sheet', () => {
    setViewport(1440, 900);
    expect(surface.open().card()!.querySelectorAll('.cf-grab')).toHaveLength(3);
  });
});

describe.each(SURFACES)('$name — folding', (surface) => {
  it('folds to a pill and comes back, without destroying the host', () => {
    setViewport(1440, 900);
    const sheet = surface.open();
    sheet.minimize();
    expect(sheet.isMinimized).toBe(true);
    expect(sheet.card()).toBeNull();
    expect(sheet.pill()).not.toBeNull();

    sheet.restore();
    expect(sheet.card()).not.toBeNull();
    expect(sheet.pill()).toBeNull();
  });

  it('shows no pill at all while another sheet holds the slot', () => {
    // Two pills would otherwise land on the same bottom-right spot — and on
    // mobile, underneath the expanded sheet itself.
    setViewport(1440, 900);
    const sheet = surface.open();
    sheet.setSlot(null);
    sheet.minimize();
    expect(sheet.pill()).toBeNull();
    expect(sheet.isMinimized).toBe(true);

    // Still alive: the slot freeing up brings it straight back.
    sheet.setSlot(1);
    expect(sheet.pill()).not.toBeNull();
  });

  it('stacks its pill at the rail position it was given', () => {
    setViewport(1440, 900);
    const sheet = surface.open();
    sheet.setSlot(1);
    sheet.minimize();
    expect(sheet.pill()!.style.getPropertyValue('--pill-slot')).toBe('1');
  });

  it('reports a fold, so the controller can hand the slot on', () => {
    setViewport(1440, 900);
    const onFold = vi.fn();
    const sheet = surface.open(DEFAULT_MODAL_LAYOUT, { onFold });
    sheet.minimize();
    expect(onFold).toHaveBeenCalledWith(true);
    sheet.restore();
    expect(onFold).toHaveBeenLastCalledWith(false);
  });
});

describe('one slot, two sheets', () => {
  it('puts both sheets at the same rectangle when given the same layout', () => {
    // The point of the whole exercise: the panel used to dock top-right at a
    // hardcoded 400px while the modal sat bottom-right at the user's size.
    setViewport(1440, 900);
    const layout = { right: 24, bottom: 32, width: 500, height: 640 };
    const boxes = SURFACES.map((s) => {
      const card = s.open(layout).card()!;
      return [card.style.right, card.style.bottom, card.style.width, card.style.height];
    });
    expect(boxes[0]).toEqual(boxes[1]);
  });

  it('marks which sheet a card belongs to, so the two are tellable apart', () => {
    setViewport(1440, 900);
    expect(SURFACES.map((s) => s.open().card()!.dataset.sheet)).toEqual(['review', 'setup']);
  });
});
