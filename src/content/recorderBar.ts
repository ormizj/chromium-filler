/**
 * The bar that stays up while the user applies for the job.
 *
 * Its whole reason to exist is the decision it carries: after each thing the user
 * does, is that a **step** to replay, or is it **something the extension should
 * know** — the description, the Send button, the confirmation? Answering that at the
 * end, from a list, means remembering which of nine clicks was which. Answering it
 * here costs one tap, while the thing is still on screen and still under the finger.
 *
 * So the bar is three parts: what is being recorded, what just happened and what to
 * do about it, and the way out. The middle part pre-fills with the extension's own
 * guess (`guessField` already named the field the user typed into), so the common
 * case is *not tapping anything at all* — which is what makes recording faster than
 * the wizard rather than the same twenty-five decisions in a different order.
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
import { BASE_CSS } from '../ui/shadowCss';
import { RECORDER_ATTR, RECORDER_HOST_ID } from './extensionUi';
import barCss from './recorderBar.css?inline';

export interface RecorderBarCallbacks {
  /** Re-decide the step that just happened: a binding, or `null` to keep it a step. */
  onBindLast(bind: BindKey | null): void;
  /** Mark something that is not what just happened — the picker finds it. */
  onBindPick(bind: BindKey): void;
  onUndo(): void;
  onDone(): void;
}

export interface RecorderBarState {
  flow: RecordFlow;
  /** Which page of a handoff this is. It decides what the menu leads with. */
  leg: RecordLeg;
  stepCount: number;
  /** The step the middle of the bar is about; absent before anything has happened. */
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
  /** Which menu is open, if any. On the instance: a re-render must not close it. */
  private menu: 'last' | 'pick' | null = null;
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
    bar.append(this.state(data), this.lastStep(data), this.exits());
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
   * The middle: what just happened, and the two answers to it. A guessed binding is
   * shown as already made — because it is — so the common case needs no tap.
   */
  private lastStep(data: RecorderBarState): HTMLElement {
    const wrap = el('div', 'cf-rec-last');
    const what = el('div', 'cf-rec-what');

    const { last } = data;
    if (last) {
      const name = last.label || last.target?.selector || 'that element';
      const verb = last.action === 'input' ? 'Filled in' : 'Clicked';
      what.append(text('span', `${verb} `), text('b', name));
      if (last.bind) what.append(text('span', ` — ${bindLabel(last.bind)}`));
    } else {
      what.textContent = 'Apply as you normally would.';
    }

    const actions = el('div', 'cf-rec-actions');
    if (last) actions.append(this.markButton(data, 'last'));
    // Always offered, and that is the point: the confirmation banner is never the
    // thing you just pressed — it *appears* once the application is in — so a bar
    // that could only re-label the last step could not mark the one selector that
    // exists for a few seconds and nowhere else.
    actions.append(this.markButton(data, 'pick'));
    wrap.append(what, actions);
    return wrap;
  }

  private markButton(data: RecorderBarState, kind: 'last' | 'pick'): HTMLElement {
    const wrap = el('div', 'cf-rec-wrap');
    const label = kind === 'last' ? ACTION_LABELS.bind : ACTION_LABELS.bindPick;
    const toggle = btn(label, () => {
      this.menu = this.menu === kind ? null : kind;
      this.paint();
    });
    toggle.setAttribute('aria-expanded', String(this.menu === kind));
    wrap.append(toggle);
    if (this.menu === kind) wrap.append(this.buildMenu(data, kind));
    return wrap;
  }

  private buildMenu(data: RecorderBarState, kind: 'last' | 'pick'): HTMLElement {
    const menu = el('div', 'cf-rec-menu');
    menu.setAttribute('role', 'menu');
    const choose = (bind: BindKey) => {
      this.menu = null;
      if (kind === 'last') this.cb.onBindLast(bind);
      else this.cb.onBindPick(bind);
    };

    // What the flow still needs leads, because those are the marks that cannot be
    // made later: the confirmation only exists for as long as it is on screen.
    const groups: Array<[string, BindKey[]]> = [
      ['This application', flowMarks(data.flow, data.leg)],
      ['What the posting says', INFO_MARKS],
      ['Form fields', fieldMarks()],
    ];

    // "Keep as a step" leads the menu for the last step, because it is one of the
    // answers to the same question and not a separate control — as a button on the
    // bar it was a third thing competing for a 390px row, and it only ever applied
    // to one of the two menus anyway.
    if (kind === 'last') {
      const keep = btn(ACTION_LABELS.keepAsClick, () => {
        this.menu = null;
        this.cb.onBindLast(null);
      }, 'btn-ghost');
      keep.setAttribute('role', 'menuitem');
      menu.append(keep);
    }

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

/** The CV first, then the rest in reading order — `FIELD_ORDER`'s job, reused. */
function fieldMarks(): BindKey[] {
  const fields: FieldKey[] = ['resume', ...TEXT_FIELDS];
  return orderFields(fields, (f) => f, () => false).map((f) => `field:${f}` as BindKey);
}

function clock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
