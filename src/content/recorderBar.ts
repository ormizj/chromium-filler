/**
 * The bar that stays up while the user applies for the job.
 *
 * Its whole reason to exist is the decision it carries, and that decision is now
 * asked **before** the user acts rather than after. The page underneath is inert,
 * and the middle of the bar is the two ways to make it do something:
 *
 * - **Interact** arms one gesture. The next click reaches the page and is kept as
 *   a step to replay. That is how a "Show more" or a "Next" gets into the config.
 * - **Declare…** names what an element *is* — the description, the Send button,
 *   the confirmation, a profile field — and then `picker.ts` goes and finds it.
 *
 * Neither is a default, and that is the feature: while neither is chosen a click
 * does nothing at all, so reading the posting cannot leave a stray press behind to
 * be replayed on every later visit.
 *
 * The armed state is loud on purpose. The page has just gone live under the
 * user's finger, and the bar is the only thing that can say so.
 *
 * It is a **toolbar, not a `Sheet`**. It never takes a pill slot, so the "one slot,
 * two sheets" arbitration between the review modal and the setup panel is untouched;
 * and it stays small because while it is up the page underneath is the thing the
 * user is working in.
 */

import { ACTION_LABELS, BIND_LABELS } from '../shared/labels';
import { FIELD_LABELS, orderFields } from '../shared/fieldKeys';
import { TEXT_FIELDS } from '../shared/fieldKeys';
import type { FieldKey } from '../shared/types';
import {
  isFieldBind, type BindKey, type ConfigBindKey, type RecordFlow, type RecordLeg,
  type RecordedStep,
} from '../shared/recording';
import type { RecorderMode } from './recorder';
import { BASE_CSS } from '../ui/shadowCss';
import { RECORDER_ATTR, RECORDER_HOST_ID } from './extensionUi';
import barCss from './recorderBar.css?inline';

export interface RecorderBarCallbacks {
  /** Interact: arm one gesture, or cancel an arm that is already up. */
  onInteract(): void;
  /** Declare: name a thing, and let the picker find it. */
  onDeclare(bind: BindKey): void;
  onUndo(): void;
  onDone(): void;
}

export interface RecorderBarState {
  flow: RecordFlow;
  /** Which page of a handoff this is. It decides what the menu leads with. */
  leg: RecordLeg;
  stepCount: number;
  /** Whether the page is inert, waiting for one click, or being typed into. */
  mode: RecorderMode;
  /** The step just recorded, reported back so the user can see it landed. */
  last?: RecordedStep;
  /** What has already been marked, so the menu can lead with what has not. */
  bound: BindKey[];
}

const INFO_MARKS: ConfigBindKey[] = [
  'jobTitle', 'jobDescription', 'jobRequirements', 'company', 'location', 'employmentType',
];

/**
 * How the application leaves this page, most likely first — **re-ordered, never
 * filtered**.
 *
 * Ordering by flow is worth doing: on the board half of a two-step posting the apply
 * link is what there is to mark, and on a quick-apply posting it is the one thing
 * there is not. Filtering by it was a bug, and a bad one. The board and the
 * employer's site are two legs of the *same* recording, so keying the list off the
 * flow alone left the destination leg — the page where the application is actually
 * sent — with no way to mark the Send button or the confirmation at all. An E2E
 * caught it; a user would have found a recording that could not be finished.
 *
 * So the leg decides the order and nothing decides the contents. A mark that is
 * unlikely here costs a line in a menu; a mark that is missing costs the recording.
 */
function flowMarks(flow: RecordFlow, leg: RecordLeg): ConfigBindKey[] {
  const sending: ConfigBindKey[] = ['submit', 'success'];
  const leaving: ConfigBindKey[] = ['applySelector', 'markerSelector', 'quickApplySelector'];
  // Only one page is ever about leaving: the posting of a recording that hands off.
  return flow === 'external' && leg === 'posting'
    ? [...leaving, ...sending]
    : [...sending, ...leaving];
}

export class RecorderBar {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private cb: RecorderBarCallbacks;
  private data?: RecorderBarState;
  /** Whether the Declare menu is open. On the instance: a repaint must not close it. */
  private menu = false;
  private startedAt = Date.now();
  private ticker?: ReturnType<typeof setInterval>;

  constructor(cb: RecorderBarCallbacks) {
    this.cb = cb;
    this.host = document.createElement('div');
    this.host.id = RECORDER_HOST_ID;
    this.host.setAttribute(RECORDER_ATTR, 'host');
    this.host.style.all = 'initial';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `${BASE_CSS}\n${barCss}`;
    this.shadow.append(style);
    document.documentElement.append(this.host);

    // The elapsed time is the only thing that changes on its own, and a recording
    // runs for minutes — a second is as often as it can possibly need repainting.
    this.ticker = setInterval(() => { if (this.data) this.paint(); }, 1000);
  }

  render(state: RecorderBarState): void {
    this.data = state;
    this.paint();
  }

  destroy(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.host.remove();
  }

  /* ---------------- Painting ---------------- */

  private paint(): void {
    const data = this.data;
    if (!data) return;
    this.shadow.querySelector('.cf-bar')?.remove();

    const bar = el('div', 'cf-bar');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Recording this site');
    // Source order is the wide layout: state, what just happened, the two options,
    // the way out. Narrow re-orders it with `order`, which is where the readout drops
    // to a row of its own.
    bar.append(this.state(data), this.lastStep(data), this.options(data), this.exits());
    this.shadow.append(bar);
  }

  private state(data: RecorderBarState): HTMLElement {
    const wrap = el('div', 'cf-rec-state');
    const live = el('span', 'cf-rec-live');
    live.setAttribute('aria-hidden', 'true');
    const secs = Math.floor((Date.now() - this.startedAt) / 1000);
    const count = el('span', 'cf-rec-count');
    count.textContent = `${clock(secs)} · ${data.stepCount} step${data.stepCount === 1 ? '' : 's'}`;
    // One live region for the whole bar, and it is this: a screen-reader user needs
    // to know the recording is running and how much of it there is, not to hear
    // every button relabel itself.
    wrap.setAttribute('role', 'status');
    wrap.append(live, text('span', 'Recording'), count);
    return wrap;
  }

  /**
   * The middle: the two ways to act on the page. Interact is the one that changes
   * what the page is doing, so it takes the emphasis while it is armed — and only
   * while it is armed, because a permanently loud button says nothing.
   */
  private options(data: RecorderBarState): HTMLElement {
    const wrap = el('div', 'cf-rec-options');

    const armed = data.mode !== 'idle';
    // Not `.primary` when armed: Done is the one thing this bar is for, and a second
    // coral beside it makes neither of them mean anything. `.cf-rec-armed` is a mode,
    // drawn as one.
    const interact = btn(
      armed ? ACTION_LABELS.interactArmed : ACTION_LABELS.interact,
      () => { this.menu = false; this.cb.onInteract(); },
      armed ? 'cf-rec-armed' : '',
    );
    interact.setAttribute('aria-pressed', String(armed));

    // Both options are the same shape of box — a `.cf-rec-wrap` holding one button —
    // so that "equal halves" at 390px is a fact about two identical siblings rather
    // than a coincidence of a `<button>`'s padding and a `<div>`'s lack of it. It
    // was 191/169 while they differed.
    const one = el('div', 'cf-rec-wrap');
    one.append(interact);
    wrap.append(one, this.declareButton(data));
    return wrap;
  }

  private declareButton(data: RecorderBarState): HTMLElement {
    const wrap = el('div', 'cf-rec-wrap');
    const toggle = btn(ACTION_LABELS.declare, () => {
      this.menu = !this.menu;
      this.paint();
    });
    toggle.setAttribute('aria-expanded', String(this.menu));
    wrap.append(toggle);
    if (this.menu) wrap.append(this.buildMenu(data));
    return wrap;
  }

  private buildMenu(data: RecorderBarState): HTMLElement {
    const menu = el('div', 'cf-rec-menu');
    menu.setAttribute('role', 'menu');
    const choose = (bind: BindKey) => {
      this.menu = false;
      this.cb.onDeclare(bind);
    };

    // What the flow still needs leads, because those are the marks that cannot be
    // made later: the confirmation only exists for as long as it is on screen.
    const groups: Array<[string, BindKey[]]> = [
      ['This application', flowMarks(data.flow, data.leg)],
      ['What the posting says', INFO_MARKS],
      ['Form fields', fieldMarks()],
    ];

    for (const [head, keys] of groups) {
      const pending = keys.filter((k) => !data.bound.includes(k));
      const shown = pending.length ? pending : keys;
      menu.append(text('div', head, 'cf-rec-menu-head'));
      for (const key of shown) {
        const b = btn(bindLabel(key), () => choose(key), 'btn-ghost');
        b.setAttribute('role', 'menuitem');
        if (data.bound.includes(key)) b.append(text('span', ' ✓'));
        menu.append(b);
      }
    }
    return menu;
  }

  /**
   * What the last action turned into — a readout and never a control. It is
   * feedback that the press landed, and the place to change one's mind about it is
   * the review, which opens the moment recording stops.
   */
  private lastStep(data: RecorderBarState): HTMLElement {
    const wrap = el('div', 'cf-rec-last');
    const what = el('div', 'cf-rec-what');

    const { last } = data;
    if (data.mode !== 'idle') {
      what.append(text('span', 'The page is live — use it as you normally would.'));
    } else if (last) {
      const name = last.label || last.target?.selector || 'that element';
      const verb = last.action === 'input' ? 'Filled in' : 'Clicked';
      what.append(text('span', `${verb} `), text('b', name));
      if (last.bind) what.append(text('span', ` — ${bindLabel(last.bind)}`));
    } else {
      what.append(text('span', 'Interact to use the page, Declare to name something on it.'));
    }

    wrap.append(what);
    return wrap;
  }

  private exits(): HTMLElement {
    const wrap = el('div', 'cf-rec-exits');
    const undo = btn(ACTION_LABELS.undo, () => this.cb.onUndo());
    if (!this.data?.stepCount) undo.setAttribute('aria-disabled', 'true');
    wrap.append(undo, btn(ACTION_LABELS.stopRecording, () => this.cb.onDone(), 'primary'));
    return wrap;
  }
}

/* ---------------- Small builders ---------------- */

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function text(tag: string, content: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
}

function btn(label: string, onClick: () => void, extra = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `cf-btn${extra ? ` ${extra}` : ''}`;
  b.textContent = label;
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (b.getAttribute('aria-disabled') === 'true') return;
    onClick();
  });
  return b;
}

/** `field:email` → "Email", everything else → its name from the catalog. */
export function bindLabel(key: BindKey): string {
  if (isFieldBind(key)) {
    const field = key.slice('field:'.length) as FieldKey;
    return FIELD_LABELS[field] ?? field;
  }
  return BIND_LABELS[key as ConfigBindKey] ?? key;
}

/**
 * The CV first, then the rest in reading order — `FIELD_ORDER`'s job, reused.
 *
 * Exported because the review's per-step dropdown offers the same sixteen fields,
 * and two lists of them in two files is the drift the label catalog exists to stop.
 */
export function fieldMarks(): BindKey[] {
  const fields: FieldKey[] = ['resume', ...TEXT_FIELDS];
  return orderFields(fields, (f) => f, () => false).map((f) => `field:${f}` as BindKey);
}

function clock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
