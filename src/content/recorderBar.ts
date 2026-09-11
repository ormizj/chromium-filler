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
 * The armed state is loud on purpose, and it is the **whole bar** that wears it.
 * The page has just gone live under the user's finger and the bar is the only thing
 * that can say so, so the toolbar takes the accent skin, the readout becomes the
 * statement of the mode, and every control that is not the way out of it is blocked.
 * The one exception is the place toggle: it is furniture rather than one of the
 * bar's decisions, and moving the HUD off the control you are about to click is
 * exactly what it is for.
 *
 * The right-hand end is three sizes of changing your mind — **Reset** throws the
 * recording away and starts it again from the posting, **Undo** takes back the last
 * step, **Done** finishes. Only the first of those cannot be walked back, so it is
 * the only one that asks a question before it acts.
 *
 * It is a **toolbar, not a `Sheet`**. It never takes a pill slot, so the "one slot,
 * two sheets" arbitration between the review modal and the setup panel is untouched;
 * and it stays small because while it is up the page underneath is the thing the
 * user is working in.
 */

import {
  ACTION_LABELS, AFTER_SEND_ASK, BIND_LABELS, MARK_GROUP_TEXT, RECORD_PASS_TEXT,
  RECORDER_READOUT, resetRecordingPrompt,
} from '../shared/labels';
import { BIND_HELP } from '../shared/help';
import { clip } from '../shared/jobText';
import { FIELD_LABELS } from '../shared/fieldKeys';
import type { FieldKey } from '../shared/types';
import {
  isFieldBind, markGroups, marksFor, type BindKey, type ConfigBindKey,
  type MarkGroupId, type RecordFlow, type RecordLeg, type RecordPhase, type RecordedStep,
} from '../shared/recording';
import type { RecorderMode } from './recorder';
import { BASE_CSS } from '../ui/shadowCss';
import { RECORDER_ATTR, RECORDER_HOST_ID } from './extensionUi';
import barCss from './recorderBar.css?inline';

export interface RecorderBarCallbacks {
  /** Interact: arm one gesture, or cancel an arm that is already up. */
  onInteract(): void;
  /**
   * "That was not the Send button." Drops the mark the hold made and arms one
   * gesture that is allowed to be send-shaped — see `recorder.ts`'s hold.
   */
  onForceSend(): void;
  /** The after-sending pass's one action: go and point at the site's reply. */
  onMarkConfirmation(): void;
  /** Declare: name a thing, and let the picker find it. */
  onDeclare(bind: BindKey): void;
  /** Throw the whole recording away and start it again from the posting. */
  onReset(): void;
  onUndo(): void;
  onDone(): void;
}

export interface RecorderBarState {
  /**
   * Which half of the setup this is, and so which of the bar's two shapes it draws.
   * `beforeSend` is the full toolbar over an inert page; `afterSend` is one question
   * over a live one.
   */
  phase: RecordPhase;
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
  /**
   * Whether the application has already gone in — `afterSend` only.
   *
   * The pass has two doors: Apply presses the site's Send button and then opens this
   * bar, and `I’ll send it myself` (or the panel's own `Mark the confirmation`) opens
   * it over a page where nothing has been sent at all. The one sentence this bar
   * carries is a different sentence in each case, and through the second door the
   * first one is simply untrue.
   */
  sent?: boolean;
  /**
   * One thing to say about the press that just happened, when it was not simply
   * recorded — today, only that a send was held. Transient: it is cleared by the next
   * step, because it is about *that* press and nothing else.
   */
  notice?: string;
}

/**
 * The marks that decide **how an application is sent** — and the one set behind two
 * renderings, because it is one fact about them.
 *
 * They draw a caption under each mark: their names are terms of art, where a field's
 * name is its own explanation and `What the posting says` is explained by the head
 * the six sit under. Twenty-two more captions turn a 60vh list into a wall of prose.
 *
 * And they are boxed together in the menu. Flat, they were told from the posting
 * facts and the profile fields below them by a hairline every group already shares,
 * so the two marks that gate Apply read as the first four of twenty-six things to
 * point at. The box keeps the split between them — they are opposite answers to one
 * question, which is the whole reason they are two groups — while saying that the
 * question is not the one the rest of the list is answering.
 */
const DECIDES = new Set<MarkGroupId>(['sending', 'leaving']);

/**
 * How much of a step's label the readout shows. `labelFor` stores up to 80
 * characters, which is right for the review's rows and half again too much for a
 * toolbar: `Clicked ` + 60 + ` — Send button` is two lines at 390px and one on a
 * 720px bar, which is exactly the space `.cf-rec-what` reserves. Mirrors the
 * picker's `PREVIEW_CHARS` — same decision about the same kind of text.
 */
const READOUT_CHARS = 60;

/**
 * Whether the page has been handed to the user — one armed gesture, or a field that
 * gesture landed in and is now being typed into.
 *
 * One answer, because the bar, the Interact button, the readout and the four blocked
 * controls are five renderings of one mode, and any disagreement between them is a
 * toolbar saying two things at once.
 *
 * `afterSend` is excluded rather than incidentally false: that bar is built with no
 * recorder at all (`main.ts`'s `attachAfterSendBar`), over a page the user is really
 * applying on, so it has no mode to be in.
 */
const isArmed = (d: RecorderBarState): boolean => d.phase !== 'afterSend' && d.mode !== 'idle';

/** Which edge the bar — and the picker it opens — is docked to. */
export type BarPlace = 'top' | 'bottom';

/** Fixed, because the Declare toggle has to name it through `aria-controls`. */
const MENU_ID = 'cf-rec-menu';

export class RecorderBar {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private cb: RecorderBarCallbacks;
  private data?: RecorderBarState;
  /** Whether the Declare menu is open. On the instance: a repaint must not close it. */
  private menu = false;
  /**
   * Whether the Reset confirm is open. On the instance for the same reason as `menu`,
   * and it matters more here: the question is about to be answered with a press, and a
   * popover that vanished on the next clock tick would take the press with it.
   */
  private confirming = false;
  private startedAt = Date.now();
  private ticker?: ReturnType<typeof setInterval>;
  /** The elapsed-time span, kept so the tick can write it without a repaint. */
  private clockEl?: HTMLElement;
  /**
   * Which edge the bar is docked to. Seeded with the rule this used to keep in a
   * `@media (pointer: coarse)` block — a top bar sits under the mobile URL bar and
   * out of the thumb's reach — and moved here because the user can now change it,
   * and because a media query is invisible to vitest.
   *
   * Page-lifetime, deliberately: it is `Controller.draggedLayout`'s kind of thing
   * rather than `modalFullscreen`'s. Moving the HUD off the page's own header is a
   * nudge made while looking at one posting, and a stored answer would quietly
   * redefine where the bar opens on every site afterwards.
   */
  private dock: BarPlace = window.matchMedia?.('(pointer: coarse)').matches ? 'bottom' : 'top';

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

    // The elapsed time is the only thing that changes on its own, so it is the only
    // thing a tick may touch. Repainting for it — which is what this used to do —
    // rebuilt the open Declare menu once a second, and a menu is a scroll position
    // and a focused item as much as it is a list: scrolling down to a profile field
    // meant racing the timer back to the top of it.
    this.ticker = setInterval(() => this.tick(), 1000);

    /*
     * The two ways out of a popover that are not pressing the toggle again.
     *
     * Both are needed and neither exists by accident. The page underneath is inert
     * while a recording runs, so a press anywhere else does nothing at all — a 60vh
     * list of ~26 marks opened by mistake could only be dismissed by finding the one
     * button that opened it, which the list is very likely covering. Bound on the
     * shadow root rather than the document: the page's own inertness is `inertPage`'s
     * business, and a listener out there would be one more thing racing it.
     */
    this.shadow.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key !== 'Escape' || !this.isOpen()) return;
      e.preventDefault();
      e.stopPropagation();
      this.closePopovers();
      this.paint();
    });
    this.shadow.addEventListener('pointerdown', (e) => {
      if (!this.isOpen()) return;
      const target = e.target as Element | null;
      // Inside the popover is using it; on the toggle is its own business, and
      // closing here would land a second close under the press that reopens it.
      if (target?.closest('.cf-rec-menu, .cf-rec-confirm, [aria-expanded="true"]')) return;
      this.closePopovers();
      this.paint();
    });
  }

  /** Whether either popover is up. Both are mutually exclusive — see `closePopovers`. */
  private isOpen(): boolean {
    return this.menu || this.confirming;
  }

  render(state: RecorderBarState): void {
    this.data = state;
    this.paint();
  }

  /**
   * Which edge the bar is really on, which is not always the one that was chosen.
   *
   * Once the mark has landed the review card comes back expanded on the same
   * gesture, carrying the receipt for the application — and under 640px that card is
   * a full-width bottom sheet, which is exactly where this bar would sit. Two reports
   * over one another, and the one underneath is the one that matters. So the report
   * bar moves to the top whatever the dock says: that is collision avoidance rather
   * than taste, and it outranked the media query this replaced for the same reason.
   */
  place(): BarPlace {
    const report = this.data?.phase === 'afterSend' && !!this.data.notice;
    return report && this.dock === 'bottom' ? 'top' : this.dock;
  }

  destroy(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.host.remove();
  }

  /* ---------------- Painting ---------------- */

  /** One second later, and nothing else has happened. Write the clock and stop. */
  private tick(): void {
    if (!this.data || !this.clockEl) return;
    this.clockEl.textContent = clock(Math.floor((Date.now() - this.startedAt) / 1000));
  }

  private paint(): void {
    const data = this.data;
    if (!data) return;
    // The menu deliberately survives a repaint (`this.menu` is on the instance), and
    // half of surviving is coming back to the same place — same rule as the sheets'
    // `captureUserPlace`. Restored *after* the bar is in the document, or an element
    // with no height yet clamps it to 0.
    const scroll = this.menu ? this.shadow.querySelector('.cf-rec-menu')?.scrollTop : undefined;
    this.shadow.querySelector('.cf-bar')?.remove();

    const bar = el('div', 'cf-bar');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', RECORD_PASS_TEXT[data.phase].aria);
    // One computed answer drives the bar, the Declare menu and the Reset confirm, so
    // the three cannot disagree about which way is "away from the edge we are on".
    bar.dataset.place = this.place();
    if (data.phase === 'afterSend') bar.classList.add('cf-bar-after');
    // Reporting rather than asking. `place()` is what actually moves it; this is the
    // class the E2E reads, and what the CSS uses to quieten the bar down to a line.
    if (data.phase === 'afterSend' && data.notice) bar.classList.add('cf-bar-report');
    // The held send's explanation is a paragraph, and a paragraph cannot share a row
    // with four controls — see the wrap rule in `recorderBar.css`. Only on the first
    // pass: the after-sending bar is three children wide and its sentence *is* the
    // content, so wrapping there put Done above the line it dismisses.
    if (data.notice && data.phase !== 'afterSend') bar.classList.add('cf-bar-notice');
    // The mode is the whole bar's, not one button's. The page has just gone live
    // under the user's finger, and a recoloured 100px button among four others is
    // not a thing a page can be in — see the armed block in `recorderBar.css`, and
    // the four controls that go `aria-disabled` below it. The place toggle is the
    // one exception, and deliberately: it is furniture rather than one of the bar's
    // decisions, and moving the HUD off the control you are about to click is
    // exactly what it is for.
    if (isArmed(data)) bar.classList.add('cf-bar-armed');
    // Source order is the wide layout: state, what just happened, the two options,
    // the way out. Narrow re-orders it with `order`, which is where the readout drops
    // to a row of its own.
    bar.append(...(data.phase === 'afterSend'
      ? [this.state(data), this.lastStep(data), this.afterSendActions(data)]
      : [this.placeButton(), this.state(data), this.lastStep(data), this.options(data), this.exits()]));
    this.shadow.append(bar);
    if (scroll) {
      const list = this.shadow.querySelector('.cf-rec-menu');
      if (list) list.scrollTop = scroll;
    }
  }

  /**
   * The way out from under the page's own header.
   *
   * On a fine pointer this bar docks to the top, which is where a job board keeps its
   * nav — and routinely where "Apply now" is. There was no way to move it, so the one
   * control the recording is about could be sitting underneath the toolbar asking the
   * user to press it.
   *
   * Drawn only on the first pass: that is the full toolbar, and the thing in the way.
   * The after-sending bar is one sentence and a `Done`, and its own placement is
   * already decided for it by the card coming back underneath — see `place()`.
   *
   * No `aria-pressed`. This is not a state being toggled, it is a move, so the name
   * is where the bar will go and the icon points the same way. Both are written here,
   * from one call to `place()`, so they cannot drift apart.
   */
  private placeButton(): HTMLElement {
    const to = this.place() === 'top' ? 'bottom' : 'top';
    const b = document.createElement('button');
    b.className = 'cf-rec-place';
    b.setAttribute('aria-label', to === 'bottom' ? ACTION_LABELS.moveBarToBottom : ACTION_LABELS.moveBarToTop);
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dock = to;
      // The popovers open away from the edge the bar is docked to, so one that is
      // already up would be pointing the wrong way the instant the bar lands.
      this.closePopovers();
      this.paint();
    });
    return b;
  }

  private state(data: RecorderBarState): HTMLElement {
    const wrap = el('div', 'cf-rec-state');
    const live = el('span', 'cf-rec-live');
    live.setAttribute('aria-hidden', 'true');
    const secs = Math.floor((Date.now() - this.startedAt) / 1000);
    const count = el('span', 'cf-rec-count');
    if (data.phase === 'afterSend') {
      // No clock and no step count: this pass records nothing and lasts as long as
      // the site's reply takes to appear. A ticking timer over "waiting for the
      // confirmation" reads as a deadline, and there is none.
      //
      // And once the mark is written the pass is *over*, so the live dot goes with
      // it. A pulsing red dot beside a report that the site is finished says the
      // opposite of the sentence next to it.
      wrap.setAttribute('role', 'status');
      if (data.notice) wrap.append(text('span', 'Setup finished'));
      else wrap.append(live, text('span', 'Finishing setup'));
      this.clockEl = undefined;
      return wrap;
    }
    // Two spans, one string: the clock is written on its own every second, and the
    // separator stays inside the wrapper so the readout reads exactly as it always
    // did (the E2E's step-count helper reads `.cf-rec-count` whole).
    const elapsed = text('span', clock(secs), 'cf-rec-clock');
    // The one part of the live region that must not be announced. It changes every
    // second, and a status region that changes every second reads the whole bar out
    // every second — which is the opposite of what it is here for.
    elapsed.setAttribute('aria-hidden', 'true');
    this.clockEl = elapsed;
    count.append(elapsed, text('span', ` · ${data.stepCount} step${data.stepCount === 1 ? '' : 's'}`));
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
   *
   * Once it is armed it is also the only live control on the bar, Declare having
   * gone `aria-disabled` beside it: the question "is this a step, or is it a thing"
   * is asked *before* the page goes live, and there is nothing to answer it with
   * while a gesture is still outstanding.
   */
  private options(data: RecorderBarState): HTMLElement {
    const wrap = el('div', 'cf-rec-options');

    const armed = isArmed(data);
    // Not `.primary` when armed: Done is the one thing this bar is for, and a second
    // coral beside it makes neither of them mean anything. `.cf-rec-armed` is a mode,
    // drawn as one.
    const interact = btn(
      armed ? ACTION_LABELS.interactArmed : ACTION_LABELS.interact,
      () => { this.closePopovers(); this.cb.onInteract(); },
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
      const open = !this.menu;
      this.closePopovers();
      this.menu = open;
      this.paint();
    });
    // Not while a gesture is armed. The bar is in a mode with exactly one live
    // control — the one that armed it, and so the one that stands it down — and
    // naming a thing is the other half of the question this bar asks *before* the
    // page goes live, not something to reach for while it already is. Same
    // `aria-disabled` convention as Reset and Undo at zero steps: never the
    // `disabled` property, which swallows the press that asks why it is grey.
    if (isArmed(data)) toggle.setAttribute('aria-disabled', 'true');
    toggle.setAttribute('aria-expanded', String(this.menu));
    // It opens a `role="menu"`, and said so nowhere: without these a screen reader
    // announces a plain button and gives no way to reach what it opened.
    toggle.setAttribute('aria-haspopup', 'menu');
    toggle.setAttribute('aria-controls', MENU_ID);
    wrap.append(toggle);
    if (this.menu) wrap.append(this.buildMenu(data));
    return wrap;
  }

  private buildMenu(data: RecorderBarState): HTMLElement {
    const menu = el('div', 'cf-rec-menu');
    menu.id = MENU_ID;
    menu.setAttribute('role', 'menu');
    // Closed *and* painted, in that order, before the picker is asked for.
    // Setting the flag alone left the flag and the DOM disagreeing: nothing on the
    // way to `startPicker` repaints — `pickForBind` disarms, and a disarm from idle
    // is a no-op that raises no mode change — so a 60vh list stayed hanging over the
    // very page the picker was asking the user to point at, and on the cancel path
    // nothing ever came along to take it down.
    const choose = (bind: BindKey) => {
      this.closePopovers();
      this.paint();
      this.cb.onDeclare(bind);
    };

    /*
     * Every mark this pass is allowed to make, in one list, grouped for reading.
     *
     * `marksFor` is the whole of the decision and it lives in `shared/recording.ts`,
     * because the compiler enforces the same rule from the other end and two copies
     * of "what belongs to which pass" is how the menu and the config drift apart. It
     * is what takes the Confirmation out of the first pass: that element does not
     * exist until an application has really gone in, so offering it here asked the
     * user to point at something that is not on the page.
     *
     * What the application still needs leads, because those are the marks that are
     * hardest to come back for.
     */
    const groups = markGroups(marksFor(data.phase, data.flow, data.leg));

    /*
     * The two groups that decide how an application is sent go in one box — see
     * `DECIDES`. `marksFor` always emits them adjacent and first (lead then trail,
     * whichever way round the leg puts them), so this is a contiguous run and the
     * box is built lazily on the first of them.
     *
     * `role="none"`: it is a drawing, not a grouping. `role="menu"` owns its
     * `menuitem`s and only a `group` may come between, and the two real groups
     * inside it — each with its own head and name — are already that. A second
     * semantic layer would put the items one level further from the menu and buy
     * nothing a border does not already say.
     */
    let boxed: HTMLElement | undefined;
    const into = (id: MarkGroupId): HTMLElement => {
      if (!DECIDES.has(id)) return menu;
      if (!boxed) {
        boxed = el('div', 'cf-rec-menu-decides');
        boxed.setAttribute('role', 'none');
        menu.append(boxed);
      }
      return boxed;
    };

    for (const { id, keys } of groups) {
      const pending = keys.filter((k) => !data.bound.includes(k));
      const shown = pending.length ? pending : keys;
      /*
       * One element per group, and the head is its first child. Flat, the head was a
       * `--muted-2` line of `--text-xs` directly under a caption of exactly that
       * colour and size, so it read as a third line of the caption above it rather
       * than as the start of anything. The wrapper is what the hairline between
       * groups is drawn from, and what lets the head hold its place while a 60vh
       * list scrolls — a group is the unit both of those rules are about.
       *
       * `role="group"` because a wrapper alone would take the items out of the
       * menu's ownership: `role="menu"` owns its `menuitem`s, and only a `group` may
       * come between them. It is named by the head it already draws.
       */
      const group = el('div', 'cf-rec-menu-group');
      group.setAttribute('role', 'group');
      const head = text('div', MARK_GROUP_TEXT[id], 'cf-rec-menu-head');
      head.id = `cf-mark-group-${id}`;
      group.setAttribute('aria-labelledby', head.id);
      group.append(head);
      for (const key of shown) {
        const b = btn('', () => choose(key), 'btn-ghost');
        b.setAttribute('role', 'menuitem');
        const marked = data.bound.includes(key);
        /*
         * The name and the tick share a line, and that needs a line to share: the
         * item is a `flex-direction: column` box so it can carry a caption under the
         * name, so a `✓` appended beside the label landed on a *row of its own* —
         * a stray mark floating between a name and its explanation.
         */
        const line = el('div', 'cf-rec-menu-line');
        line.append(text('span', bindLabel(key), 'cf-rec-menu-label'));
        if (marked) {
          // The glyph is for the eye only. What a screen reader gets is the word, in
          // the name below — a bare "check mark" announced after a mark's name says
          // less than the tick does, and says it in the wrong grammar.
          const tick = text('span', '✓', 'cf-rec-menu-mark');
          tick.setAttribute('aria-hidden', 'true');
          line.append(tick);
        }
        b.append(line);
        // Named here whenever the name is not simply the label: with a caption to
        // keep out of it, with a tick to fold in, or both. Spelling it out and
        // stopping at the label is what used to drop the ✓ from the accessible name
        // entirely, so the four marks that matter most announced nothing about
        // already being done.
        const name = marked ? `${bindLabel(key)}, marked` : bindLabel(key);
        // Only the marks that decide how an application is sent. Their names are
        // terms of art — "Quick-apply marker" says nothing on its own, and this is
        // the last surface where the choice is still open. Drawn rather than hidden
        // behind hover, because the priority target is a phone and has none.
        //
        // What it says is an example rather than a definition, and `BIND_HELP` is
        // where that rule is written down: the label above it and the head above
        // that have both already given the definition, so a third go at it is the
        // one thing a caption here must not be.
        const hint = !isFieldBind(key) && DECIDES.has(id) ? BIND_HELP[key].short : undefined;
        if (hint) {
          // Described by, not labelled by. The item's name is the mark's name — that
          // is what the compiler stores and what every other surface calls it — and a
          // caption folded into the name would have a screen reader announce the whole
          // sentence where the list says "Send button".
          const note = text('span', hint, 'cf-rec-menu-hint');
          note.id = `cf-hint-${key}`;
          b.setAttribute('aria-label', name);
          b.setAttribute('aria-describedby', note.id);
          b.append(note);
        } else if (marked) {
          b.setAttribute('aria-label', name);
        }
        group.append(b);
      }
      into(id).append(group);
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
    if (data.phase === 'afterSend') {
      // The whole of what this pass has to say, and it has to be a sentence: the user
      // pressed Apply on a job page and is now looking at a bar they did not ask for,
      // over a page that has just changed under them. Once the mark is written the
      // same line carries the report instead — one place to look, either way.
      what.classList.add('cf-rec-ask');
      what.append(text('span', data.notice ?? AFTER_SEND_ASK[data.sent ? 'sent' : 'unsent']));
      wrap.append(what);
      return wrap;
    }
    if (data.notice) {
      // Louder than the ordinary readout, and it has to be: it is the answer to "why
      // did that button do nothing", and it is competing with the page underneath.
      //
      // And announced. The bar's one live region is `.cf-rec-state`, which this is not
      // in, so the one sentence explaining a press that was refused reached a screen
      // reader nowhere at all. `alert` rather than `status` for the same reason it is
      // drawn louder: it is about a press that has just been taken away.
      what.classList.add('cf-rec-notice');
      what.setAttribute('role', 'alert');
      what.append(text('span', data.notice));
      wrap.append(what, inWrap(btn(
        ACTION_LABELS.notTheSendButton, () => { this.closePopovers(); this.cb.onForceSend(); },
      )));
      return wrap;
    }
    if (isArmed(data)) {
      what.append(text('span', RECORDER_READOUT.armed));
    } else if (last) {
      // Clipped for the bar, not at the source: `labelFor` stores a label the review
      // shows in full, and this is a toolbar. Marked with an ellipsis rather than cut,
      // so a name that ran on says it ran on.
      const name = clip(last.label || last.target?.selector || RECORDER_READOUT.element, READOUT_CHARS);
      const verb = last.action === 'input' ? 'Filled in' : 'Clicked';
      what.append(text('span', `${verb} `), text('b', name));
      if (last.bind) what.append(text('span', ` — ${bindLabel(last.bind)}`));
    } else {
      what.append(text('span', RECORDER_READOUT.start));
    }

    wrap.append(what);
    return wrap;
  }

  /**
   * The after-sending pass's whole middle: one thing to do, and one way to leave.
   *
   * No Interact, no Declare, no Undo, no Reset. The page is live — the user is really
   * applying — so there is nothing to hand back to them, and this pass records
   * nothing, so there is nothing to take back. A menu here would be a list of one.
   *
   * "Not yet" rather than "Cancel": nothing is being abandoned. The site keeps
   * everything the first pass taught it, and the offer comes round again the next
   * time Apply is pressed.
   */
  private afterSendActions(data: RecorderBarState): HTMLElement {
    const wrap = el('div', 'cf-rec-exits');
    // Once the mark is written there is nothing left to ask, and the bar is only
    // still up to say so — a live "Mark the confirmation" beside that report would
    // invite the user to do the finished thing again.
    if (data.notice) {
      wrap.append(inWrap(btn(ACTION_LABELS.done, () => this.cb.onDone(), 'primary')));
      return wrap;
    }
    wrap.append(
      inWrap(btn(ACTION_LABELS.notYet, () => this.cb.onDone())),
      inWrap(btn(RECORD_PASS_TEXT.afterSend.action, () => this.cb.onMarkConfirmation(), 'primary')),
    );
    return wrap;
  }

  /**
   * The three ways out, and they are three different sizes of changing your mind:
   * Reset throws the recording away, Undo takes back the last step, Done finishes.
   *
   * Reset leads and Done stays last. Done is where the thumb already goes, and the
   * destructive control must not sit against the primary — a misplaced press there
   * would trade "I have finished applying" for "throw the last ten minutes away".
   *
   * Every child is a `.cf-rec-wrap`, not just the one that needs the positioning
   * context: at 390px this row is three equal thirds, and equal only because the
   * three boxes are the same shape. A bare `<button>` beside a `<div>` under
   * `flex-basis: 0` adds its own padding on top of its share — the same 191/169 the
   * options row above already documents.
   */
  private exits(): HTMLElement {
    const wrap = el('div', 'cf-rec-exits');
    // While a gesture is armed there is one thing to do and one way out of it, so
    // the three ways of changing your mind stand down with everything else. Done
    // included: the press the user has already paid for is one click away, and
    // finishing the recording in the middle of it would leave a step half-taken.
    // Pressing the armed button hands the page back, and it is the loudest control
    // on the bar while it does.
    const armed = !!this.data && isArmed(this.data);

    const undo = btn(ACTION_LABELS.undo, () => this.cb.onUndo());
    if (armed || !this.data?.stepCount) undo.setAttribute('aria-disabled', 'true');

    const done = btn(ACTION_LABELS.stopRecording, () => this.cb.onDone(), 'primary');
    // It keeps `.primary` and de-fills through primitives' blocked-primary rule,
    // which is the one treatment that reads as "unavailable" rather than "broken".
    if (armed) done.setAttribute('aria-disabled', 'true');

    wrap.append(this.resetButton(), inWrap(undo), inWrap(done));
    return wrap;
  }

  /**
   * Reset, and the question it asks first.
   *
   * It is the one control on the bar with no way back — Undo is a step at a time and
   * Done ends the recording with the report intact, but this drops every step *and*
   * navigates. So it follows Options → Queue's Clear all: a press opens the warning,
   * and the warning carries the verb.
   */
  private resetButton(): HTMLElement {
    const wrap = el('div', 'cf-rec-wrap');
    const toggle = btn(ACTION_LABELS.resetRecording, () => {
      const open = !this.confirming;
      this.closePopovers();
      this.confirming = open;
      this.paint();
    }, 'btn-danger');
    // Same convention as Undo beside it, and as the modal's blocked Apply: never the
    // `disabled` property, which swallows the press that asks why the control is grey.
    if ((this.data && isArmed(this.data)) || !this.data?.stepCount) {
      toggle.setAttribute('aria-disabled', 'true');
    }
    toggle.setAttribute('aria-expanded', String(this.confirming));
    wrap.append(toggle);
    if (this.confirming) wrap.append(this.buildConfirm());
    return wrap;
  }

  private buildConfirm(): HTMLElement {
    const box = el('div', 'cf-rec-confirm');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', ACTION_LABELS.resetRecording);

    const data = this.data;
    box.append(text(
      'div',
      resetRecordingPrompt(data?.stepCount ?? 0, data?.leg ?? 'posting'),
      'cf-rec-confirm-text',
    ));

    const row = el('div', 'cf-rec-confirm-row');
    row.append(
      btn(ACTION_LABELS.cancel, () => { this.confirming = false; this.paint(); }),
      btn(ACTION_LABELS.resetRecordingConfirm, () => {
        this.confirming = false;
        this.cb.onReset();
      }, 'btn-danger'),
    );
    box.append(row);
    return box;
  }

  /**
   * Two popovers hang off this bar and only one may ever be up: they overlap, and the
   * second to open would sit on the first with nothing saying which press it belongs
   * to. Every control that opens one closes the other through here.
   */
  private closePopovers(): void {
    this.menu = false;
    this.confirming = false;
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

/** One control in the box the narrow layout's equal-thirds rule measures. */
function inWrap(control: HTMLElement): HTMLElement {
  const wrap = el('div', 'cf-rec-wrap');
  wrap.append(control);
  return wrap;
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

function clock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
