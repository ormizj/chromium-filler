/**
 * Shadow-DOM Setup panel: the on-page, visual way to build or reconfigure a
 * site config. Lets the user Pick the job title / description / requirements
 * containers and every profile form field (+ CV upload) directly on the page,
 * showing a live preview of what each saved selector currently resolves to.
 *
 * It is a **linear wizard**: one step on screen at a time, in the order the
 * extension itself does things (`SETUP_STEP_ORDER`), with a progress rail and
 * Back / Next. It used to render all five sections stacked in one scroll, and
 * auto-opened every section that had unresolved rows — so a fresh site opened
 * onto ~25 rows of `auto · #first_name` with no ordering and nothing saying
 * which of them mattered. On a 390px phone that was unusable.
 *
 * The panel is a dumb renderer: the Controller computes previews/`found` from
 * the DOM and supplies callbacks, mirroring the review modal's design.
 */

import type { FieldKey, PrepAction } from '../shared/types';
import {
  RECORD_PASS_ORDER, markGroups, marksFor,
  type BindKey, type CompiledSetup, type RecordPhase, type Recording, type RecordedStep,
} from '../shared/recording';
import { MARK_GROUP_TEXT, SELECTOR_STRENGTH_TEXT } from '../shared/labels';
import { bindLabel } from './recorderBar';
import {
  CONCEPT_HELP, DOT_LEGEND, SETUP_STEP_HELP, SETUP_STEP_TITLES,
} from '../shared/help';
import {
  SETUP_STEP_ICONS, SETUP_STEP_ORDER, firstStepWithWork, isUnconfigured, outstandingPass,
  passStates, setupStage, stepStates,
  type ContainerKey, type PassState, type PrepListKey, type PrepRow, type RowStatus,
  type SetupRow, type SetupSnapshot, type SetupStage, type SetupStepKey,
  type SetupVerdict, type StepState,
} from '../shared/setupSteps';
import type { PostingKind } from '../shared/redirect';
import {
  ACTION_LABELS, RECORD_PASS_TEXT, SETUP_STATUS_TEXT,
} from '../shared/labels';
import { helpButton, helpPanel, richText } from '../ui/help';
import { summaryLine } from '../ui/summaryLine';
import { Sheet, type SheetCallbacks, type SheetData } from './sheet';
import setupCss from './setupPanel.css?inline';

// Re-exported so the Controller, the dev harness and the E2E keep one import
// path for the row shapes, while the pure step model owns their definitions.
export type {
  ContainerKey, PrepListKey, PrepRow, RowStatus, SetupRow, SetupStepKey, SetupVerdict,
} from '../shared/setupSteps';

const DOT: Record<RowStatus, string> = { high: 'ok', low: 'warn', none: 'none' };

/**
 * The wizard steps the two passes already speak for, so home's outstanding list can
 * leave them out.
 *
 * `send`'s two rows *are* the two passes — the Send button and the confirmation — and
 * `fields`' only work is the CV, which the first pass reports in its own summary. A
 * list under the blocks repeating "Sending — 1 thing still to do" beside a block that
 * has just said the confirmation is missing is the cry-wolf failure every counting
 * rule in `setupSteps.ts` is written against.
 */
const PASS_STEPS = new Set<SetupStepKey>(['fields', 'send']);

export interface SetupData extends SheetData, SetupSnapshot {
  /**
   * A finished recording waiting to be reviewed. Its presence is what the
   * Controller uses to ask for review mode; which mode is actually *shown* stays on
   * the panel instance, for the same reason `step` does.
   */
  recording?: Recording;
  /** What that recording compiled to — the half of the review that is the outcome. */
  compiled?: CompiledSetup;
  /**
   * Whether the user has already dismissed the legend. False opens it, so a
   * first-time user is told what the dots and the `auto ·` prefixes mean before
   * being asked to act on them — and lands on step 1 rather than being dropped
   * into the middle of a wizard they have never seen.
   */
  helpSeen: boolean;
}

export interface SetupCallbacks extends SheetCallbacks {
  onAddPrep(action: PrepAction, list: PrepListKey): void;
  onPickPrepTarget(index: number, list: PrepListKey): void;
  onMovePrep(index: number, dir: -1 | 1, list: PrepListKey): void;
  onRemovePrep(index: number, list: PrepListKey): void;
  onSetPrepMs(index: number, ms: number, list: PrepListKey): void;
  onRunPrep(): void;
  onPickContainer(key: ContainerKey): void;
  onClearContainer(key: ContainerKey): void;
  onPickField(field: FieldKey): void;
  onClearField(field: FieldKey): void;
  onPickRedirect(key: string): void;
  onClearRedirect(key: string): void;
  /** Save the control Apply should press on this site. */
  onPickSubmit(): void;
  onClearSubmit(): void;
  /** Save the element that only appears once the application really went in. */
  onPickSuccess(): void;
  onClearSuccess(): void;
  onRename(name: string, urlPattern: string): void;
  /**
   * Set this site up by doing it once — the first pass, and the only one that can
   * be started from a page nothing has happened on yet.
   *
   * No argument. It used to carry the user's guess at whether the application
   * happens here or on the employer's site, which `compileRecording` overrules from
   * what actually arrived (rule 1) — so the Controller takes its hint from the
   * classifier it has already run on this very page instead of asking.
   */
  onStartRecording(): void;
  /**
   * Start the second pass by hand: the user is going to apply on this page however
   * they like, and will point at the site's reply when it appears. The other way in
   * is the review modal's Apply, which presses Send first.
   */
  onMarkConfirmation(): void;
  /** Re-decide one recorded step from the review — `null` keeps it a step. */
  onRebindStep(id: string, bind: BindKey | null): void;
  /** Point a recorded step at a different element, for a fragile one. */
  onRepickStep(id: string): void;
  onRemoveStep(id: string): void;
  /** Write the compiled config(s) and hand over to the wizard. */
  onSaveRecording(): void;
  onDiscardRecording(): void;
  onOpenOptions(): void;
  /** The legend was dismissed — persist it so the next posting stays quiet. */
  onDismissHelp(): void;
  /**
   * Done: finished configuring, tear the panel down. The header's `×` does NOT
   * come here — it minimizes to the pill, like the review modal's does. The two
   * exits mean different things and only one of them is destructive: "I have
   * finished with this site" versus "get out of my way for a second".
   */
  onClose(): void;
}

const PREP_LABEL: Record<PrepAction, string> = {
  click: 'Click',
  waitFor: 'Wait for',
  scrollIntoView: 'Scroll to',
  delay: 'Delay',
};

/**
 * The two verdicts the `kind` step decides between, and the rows that argue for
 * each. See `appendRedirectRows` for why this is a grouping and not a list.
 *
 * Quick apply leads because it is the ordinary case — the form is on the page in
 * front of you — and because it is the group every site has something to say
 * about. Not every board hands off to an employer ATS, and an empty group draws
 * no heading, so leading with External made the commonest site open onto a
 * section about the thing it does not do.
 *
 * `kinds` is which verdicts each group is the answer to, and it is what puts the
 * live verdict banner inside a group rather than above both of them. An
 * `unknown` posting sits with quick apply because that is what it is treated as:
 * the fill path runs, and "(assumed)" is the whole of the difference.
 */
const REDIRECT_GROUPS: ReadonlyArray<{
  head: string;
  keys: readonly string[];
  kinds: readonly PostingKind[];
}> = [
  {
    head: 'Quick apply — the form is on this page',
    keys: ['quickApplySelector'],
    kinds: ['quickApply', 'unknown'],
  },
  {
    head: 'External — the application is on the employer’s site',
    keys: ['markerSelector', 'applySelector'],
    kinds: ['redirect'],
  },
];

export class SetupPanel extends Sheet<SetupData> {
  private cb: SetupCallbacks;
  /**
   * Which step is on screen. **On the instance, never in `SetupData`.** The
   * Controller re-renders on every Pick, prep edit and rename (`refreshSetup`),
   * so a step derived from the data would throw the user back to the start every
   * time they picked a field — the one regression that would make this unusable.
   */
  private step = 0;
  /** Whether the opening step has been chosen; it is picked once, not per render. */
  private placed = false;
  /**
   * Which of the panel's three screens is up. **On the instance, never in
   * `SetupData`** — same rule as `step`, and the same failure if it is broken:
   * `refreshSetup` re-renders on every edit, so a mode derived from the data would
   * throw the user out of the review each time they re-marked a row.
   *
   * `home` is where the panel **always** opens, and that is the change this screen
   * exists for. It used to route here only while `isUnconfigured` — so one saved
   * selector, which a single Pick from the review modal's report is enough to
   * produce, sent every later visit straight into the six-step wizard. Site setup
   * then opened the manual surface automatically: the surface that put
   * `submitSelector` and `successSelector` last in a queue of twenty-five, which is
   * why they went unset on nearly every site and why recording exists at all.
   *
   * It is also the merge of what used to be two screens, `offer` and `saved`. They
   * were the same screen asked at two moments — here is what this site knows, here
   * is what it still needs, here is how to teach it — and keeping them apart meant
   * the two passes were named on exactly one of them.
   *
   * `wizard` is now only ever reached by pressing for it, **and only from a site that
   * has already been taught something** — it is where a recording is corrected, never
   * a way to make one unnecessary. `homeFooter` is the whole of that rule.
   */
  private mode: 'home' | 'wizard' | 'review' = 'home';
  /**
   * Whether a recording was just saved, so home can lead with the fact once. It is
   * about the press that got here rather than about the config, which is why it is
   * not read back out of the data: the same site renders the same home screen a
   * minute later, and by then nothing has just happened.
   */
  private justSaved = false;
  /** The `?` explanations the user opened — a re-scan mid-read must not close one. */
  private openHelp = new Set<SetupStepKey>();
  /**
   * Whether the offer's own `?` is open. Not in `openHelp`, which is keyed by wizard
   * step and the offer is not one — same reason `mode` is on the instance rather than
   * in `SetupData`.
   */
  private offerHelp = false;
  /** The legend, once dismissed, stays folded for the rest of this page too. */
  private legendDismissed = false;

  constructor(cb: SetupCallbacks) {
    super('setup', 'chromium-filler-setup-host', setupCss, cb);
    this.cb = cb;
  }

  render(data: SetupData): void {
    this.data = data;
    // Where to open, decided once. A first-time user walks from step 1, legend
    // and all; anyone else lands on the earliest step that still needs them,
    // which is what the old auto-opening sections were reaching for.
    if (!this.placed) {
      this.placed = true;
      // Only *which step the wizard opens on* is decided here now. Which screen is
      // up is not a question any more: it is home, on every site, every time.
      const work = firstStepWithWork(stepStates(data));
      this.step = data.helpSeen && work >= 0 ? work : 0;
    }
    this.paint();
  }

  /**
   * Show the review of a finished recording, or go back to the wizard.
   *
   * Called by the Controller when a recording stops, and by Save/Discard on the way
   * out. It is a command rather than a property of the data for the reason `mode`
   * itself is on the instance: the panel re-renders constantly, and the review must
   * not reappear every time it does.
   */
  showReview(on: boolean): void {
    if (on) {
      this.mode = 'review';
      this.repaint();
      return;
    }
    // Refusing a recording is not the same as finishing one, so this is the *back*
    // door, and it goes where the panel opens: home. Landing in the wizard would
    // hand the user the manual surface they have just declined to use.
    this.mode = 'home';
    this.justSaved = false;
    if (this.data) this.step = Math.max(0, firstStepWithWork(stepStates(this.data)));
    this.repaint();
  }

  /**
   * Go home — the screen the panel opens on, and the one every task here ends at.
   *
   * A command like `showReview` and for the identical reason: this is a place in a
   * task, not a fact about the data, so a re-render must not put the user back here
   * once they have moved on.
   *
   * `saved` leads the card with the fact that a recording just landed. The
   * Controller sets it *before* it refreshes, so the outstanding-work list is
   * counted from the config that was just written — reading it from the pre-save
   * render is what made the old landing step point at work the patch had done.
   */
  showHome(opts: { saved?: boolean } = {}): void {
    this.mode = 'home';
    this.justSaved = !!opts.saved;
    this.repaint();
  }

  /** Jump to a step by key. Used by the dev harness, so each step is screenshottable. */
  setStep(key: SetupStepKey): void {
    const i = SETUP_STEP_ORDER.indexOf(key);
    if (i < 0) return;
    this.placed = true;
    this.mode = 'wizard';
    this.step = i;
    this.repaint();
  }

  /** Move by one, clamped. The rail and the footer both come through here. */
  private goTo(index: number): void {
    const next = Math.max(0, Math.min(SETUP_STEP_ORDER.length - 1, index));
    if (next === this.step) return;
    this.step = next;
    this.repaint();
  }

  /** Re-render from the last data — what `Sheet` calls after a fold or a resize. */
  protected repaint(): void {
    if (this.data) this.render(this.data);
  }

  /**
   * The collapsed panel. Neutral dot: a folded setup panel is not reporting an
   * outcome the way the review modal's pill is — there is nothing here that
   * succeeded or failed, only work still open.
   */
  protected buildPill(): HTMLElement {
    const pill = el('button', 'cf-pill');
    pill.setAttribute('aria-label', 'Reopen site setup');
    const dot = el('span', 'cf-dot none');
    const label = el('span');
    label.textContent = ACTION_LABELS.siteSetup;
    pill.append(dot, label);
    pill.onclick = () => this.restore();
    return pill;
  }

  /**
   * The way out of the wizard, and the only one it had.
   *
   * `Review configuration` is a one-way door without it: the footer's `‹ Back` walks
   * *steps* and is disabled on the first of them, and `Done` — which destroys the
   * panel rather than going anywhere — only replaces `Next ›` on the last. So the
   * press that opened the six-step form had no matching press that closed it, and
   * leaving meant five taps of Next, or minimizing to a pill and hunting for the
   * review modal's.
   *
   * It goes **home**, not to the modal: home is where it was entered from, the panel
   * stays alive with every mark and pick intact, and home's own `Done` is what hands
   * the slot back to the card underneath. Two presses, both of them named.
   *
   * In the header rather than the footer, for two reasons. The footer is two buttons
   * with one primary on every step — the 390px rule the review modal follows too —
   * and a third would break it. And this is a different kind of movement from the one
   * the footer makes: Back walks one step of a task, this leaves the task.
   *
   * **Only in the wizard.** The review screen's whole content is Discard-or-Save, and
   * a third exit there would be a way to walk away from a recording without saying
   * what became of it. Home has nothing behind it.
   *
   * It leads the header, before the title, and `this.step` is deliberately untouched:
   * `placed` decides the landing step once, so pressing `Review configuration` again
   * comes back to the step the user left rather than to the top of a form they have
   * already walked half of.
   */
  private backButton(): HTMLElement[] {
    if (this.mode !== 'wizard') return [];
    const back = el('button', 'cf-back');
    // No text: the mark is a masked icon, so the accessible name is the whole of
    // what this control is called — the same rule `.cf-fullscreen` follows.
    back.setAttribute('aria-label', ACTION_LABELS.backToHome);
    back.onclick = () => this.showHome();
    return [back];
  }

  protected buildCard(): HTMLElement {
    const data = this.data!;
    const card = el('div', 'cf-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', `Set up ${data.name}`);

    // Header (drag handle)
    const header = el('div', 'cf-header');
    header.append(el('div', 'cf-grip'));
    const title = el('span', 'cf-heading');
    title.textContent = 'Set up this site';

    // Icon-only toggle, same control the review modal's header carries — the two
    // sheets share one slot, so they had better offer the same ways to resize it.
    const full = document.createElement('button');
    full.className = 'cf-fullscreen';
    full.setAttribute('aria-pressed', String(!!data.fullscreen));
    full.setAttribute('aria-label', data.fullscreen
      ? ACTION_LABELS.exitFullscreen
      : ACTION_LABELS.fullscreen);
    full.onclick = () => this.setFullscreen(!data.fullscreen);

    const close = el('button', 'cf-close');
    close.textContent = '×';
    // Minimize, not close: Done in the footer is the destructive exit. Losing a
    // half-configured panel to the button that looks like "get out of the way"
    // is the same mistake the review modal's close button used to make.
    close.setAttribute('aria-label', 'Minimize');
    close.onclick = () => this.minimize();
    header.append(...this.backButton(), title, full, close);
    this.makeDraggable(card, header);

    if (this.mode === 'review' && data.recording && data.compiled) {
      card.append(header, this.reviewBody(data.recording, data.compiled), this.reviewFooter());
      return card;
    }

    if (this.mode === 'home') {
      // The footer is optional here, and on the site that matters most it is absent
      // — see `homeFooter`. Nothing else in the panel has a card without one, so it
      // is appended rather than assumed.
      const footer = this.homeFooter(data);
      card.append(header, this.homeBody(data), ...(footer ? [footer] : []));
      return card;
    }

    const states = stepStates(data);
    const current = states[this.step];

    const body = el('div', 'cf-body');
    // The rail leads on every step, so it sits at the same y on all six. It used
    // to come *after* the intro and the legend — which only render on step 1 —
    // so walking off step 1 jumped the rail ~200px up the card, and opening the
    // legend's `<details>` moved it again under the user's finger. The intro and
    // the legend are still about the panel rather than about step 1, so they
    // stay ahead of the step's own prose; they just no longer displace the one
    // element whose whole job is to be in a fixed place.
    body.append(this.rail(states));
    if (current.key === 'site') {
      const intro = el('p', 'cf-intro');
      intro.textContent = 'Teach the extension how to read and fill this site. '
        + 'It sends nothing until you press Apply.';
      body.append(intro, this.legend(data));
    }
    body.append(this.stepHead(current), this.stepBody(current.key, data));

    // Two buttons, on every step, with exactly one primary — the same rule the
    // review modal's footer follows, and for the same 390px reason.
    const footer = el('div', 'cf-footer');
    const back = btn('‹ Back', () => this.goTo(this.step - 1));
    if (this.step === 0) back.setAttribute('disabled', 'true');
    const last = this.step === SETUP_STEP_ORDER.length - 1;
    // The wizard ends where the old footer's Done did: finishing the last step
    // and finishing with the site are the same act, so they are one button.
    //
    // Next keeps the primary on every step, including the first. The offer screen is
    // the front door now, so by the time anyone is *in* the wizard they have either
    // recorded the site or chosen to do it by hand — and on that path the next action
    // really is Next. The re-record buttons on this step are a correction, and a
    // second coral button beside Next would be the two-primaries bug the guardrail
    // caught the first time round.
    footer.append(back, last
      ? btn(ACTION_LABELS.done, () => this.cb.onClose(), true)
      : btn('Next ›', () => this.goTo(this.step + 1), true));

    card.append(header, body, footer);
    return card;
  }

  /**
   * The progress rail: per step, the step's own mark above a `.cf-dot`, the
   * current node ringed. Each node is a button — there is no separate index
   * screen, so this is also how someone who opened the panel to re-pick one
   * field gets there without six taps of Next.
   *
   * Two marks, because there are two questions. The **icon** says which step
   * this is; six identical dots said only that there were six of something. The
   * **dot** keeps saying how that step is doing, and it has to stay a `.cf-dot`
   * — its check/alert/dash is the shape half of "status is never colour alone",
   * so the step mark cannot be swapped into it. Hence icon *above*, dot below.
   *
   * The icon is `aria-hidden`: the node's `aria-label` already names the step
   * and its outstanding work, and a screen reader announcing a decorative mark
   * beside that is noise.
   */
  private rail(states: StepState[]): HTMLElement {
    const rail = el('div', 'cf-rail');
    rail.setAttribute('role', 'tablist');
    rail.setAttribute('aria-label', 'Setup steps');
    for (const s of states) {
      const node = document.createElement('button');
      node.className = `cf-rail-node${s.index === this.step ? ' current' : ''}`;
      node.dataset.k = `rail:${s.key}`;
      node.setAttribute('role', 'tab');
      node.setAttribute('aria-selected', String(s.index === this.step));
      if (s.index === this.step) node.setAttribute('aria-current', 'step');
      // The whole state of the step, read aloud: which one, what it is, and what
      // it still needs. The marks alone say none of that.
      node.setAttribute('aria-label',
        `Step ${s.index + 1}, ${SETUP_STEP_TITLES[s.key]} — ${s.summary}`);

      const icon = el('span', 'cf-rail-icon');
      icon.setAttribute('aria-hidden', 'true');
      icon.style.setProperty('--i', `var(${SETUP_STEP_ICONS[s.key]})`);

      node.append(icon, el('span', `cf-dot ${s.tone}`));
      node.onclick = () => this.goTo(s.index);
      rail.append(node);
    }
    return rail;
  }

  /**
   * Where you are, what this step is, and — shown, not hidden behind the `?` —
   * what it is for. With one step on screen there is finally room for the prose,
   * and a panel that opens onto five jargon headings was the whole complaint.
   */
  private stepHead(s: StepState): HTMLElement {
    const head = el('div', 'cf-step-head');

    // `Step n of 6` · `?` … `N to do`. The `?` trails the text it belongs to
    // rather than being pushed to the far edge; the chip keeps the right edge,
    // because it is a status and reads as one only where nothing else is.
    const meta = el('div', 'cf-step-meta');
    const count = el('span', 'cf-step-count');
    count.textContent = `Step ${s.index + 1} of ${SETUP_STEP_ORDER.length}`;
    meta.append(count);

    const help = SETUP_STEP_HELP[s.key];
    const open = this.openHelp.has(s.key);
    meta.append(helpButton(SETUP_STEP_TITLES[s.key], open, (next) => {
      if (next) this.openHelp.add(s.key);
      else this.openHelp.delete(s.key);
      this.repaint();
    }));

    if (s.todo > 0) {
      const chip = el('span', 'chip warn cf-step-todo');
      chip.textContent = `${s.todo} to do`;
      meta.append(chip);
    }
    head.append(meta);

    const title = el('h2', 'cf-step-title');
    title.textContent = SETUP_STEP_TITLES[s.key];
    const lead = el('p', 'cf-step-lead');
    lead.append(...richText(help.body));
    head.append(title, lead);

    // The row-by-row reference stays behind the `?`: it is something to look up,
    // not something to read on the way past.
    if (open) head.append(helpPanel(help));
    return head;
  }

  /**
   * Record this site, offered as one button.
   *
   * It used to be two — "Apply on this site" / "Apply on the employer's site" — and
   * that was a third question competing with the two the screen is actually about.
   * It asked something a user looking at an unfamiliar posting usually cannot
   * answer; `compileRecording` overrules the answer from the legs the steps really
   * arrived on (rule 1); and its only remaining effect was the order of the recorder
   * bar's Declare menu, which the page's own classifier can decide better than a
   * guess. So the Controller derives it and the screen asks nothing.
   *
   * `primary` is not a property of the button but of the screen: exactly one control
   * on this panel is coral, and which one it is says what to do next.
   *
   * `label` is the pass's `action` or its `again`, because "Record the first pass" on
   * a site that has already been recorded reads as though nothing was saved.
   */
  private recordButton(primary: boolean, label: string): HTMLElement {
    const actions = el('div', 'cf-record-actions');
    actions.append(btn(label, () => this.cb.onStartRecording(), primary, 'record'));
    return actions;
  }

  /**
   * The same button on wizard step 1, worded for doing it *again* — the label
   * included, since this step is only reachable on a site that has been recorded.
   * It read `Record the first pass` under a paragraph beginning "Record this site
   * again", which is the same sentence twice with the tense flipped.
   *
   * Never the primary: on every wizard step that belongs to Next.
   */
  private recordLead(): HTMLElement {
    const wrap = el('div', 'cf-record-lead');
    const lead = el('p', 'cf-record-lead-text');
    lead.textContent = 'Record this site again to correct or add to what is saved. '
      + 'Nothing already set is lost unless the new recording covers it.';
    wrap.append(lead, this.recordButton(false, RECORD_PASS_TEXT.beforeSend.again));

    const or = el('p', 'cf-record-or');
    or.textContent = 'Or correct it by hand below.';
    wrap.append(or);
    return wrap;
  }

  /* ---------------- Home ---------------- */

  /**
   * The panel's home, and its structure is the two passes.
   *
   * Setting a site up follows the application, and an application has two halves:
   * everything up to the Send button, which is rehearsable and sends nothing, and
   * the confirmation, which does not exist until one has really gone in. Every
   * other division this screen used to draw — an offer against a wizard, a
   * just-recorded state against a returning one, an "apply here" against an "apply
   * there" — cut across that one. So this screen draws only that one: where each
   * pass has got to, and the single next thing to do about it.
   *
   * What follows the two blocks depends on which end of the job the site is at. A
   * site that has been taught nothing gets `detected()` — the head start the page
   * gives for free, so "teach me this site" is a concrete ask rather than a blank
   * one. A site that has been taught something gets the wizard's own accounting of
   * what is still outstanding, since that is the only reason to go into it.
   */
  private homeBody(data: SetupData): HTMLElement {
    const body = el('div', 'cf-body');
    const stage = setupStage(data);
    const passes = passStates(data);

    const head = el('div', 'cf-step-head');
    const title = el('h2', 'cf-step-title');
    // Never "Set up this site": the card's own header already says that, and a
    // heading repeating the one directly above it is a heading saying nothing. This
    // names what the screen is *for*, which changes with how far the site has got —
    // and, once, with the press that got here rather than with the site at all.
    title.textContent = this.justSaved
      ? 'Site setup saved'
      : stage === 'unconfigured' ? 'Teach the extension this site' : 'What this site knows';
    head.append(title);

    /*
     * A sentence and a `?`, not the whole catalog entry.
     *
     * `CONCEPT_HELP.recording.body` is the full account of how a recording works —
     * the two passes, the two buttons, Undo, Reset — and rendered here it was
     * twenty-one lines of prose at 390px before the user could reach a single
     * control. The pass blocks below say the part that has to be read before
     * pressing anything; the rest is something to look up.
     */
    const lead = el('p', 'cf-step-lead');
    lead.textContent = CONCEPT_HELP.recording.short ?? '';
    // Immediately after the line it explains, never pushed to an edge and never
    // inside the heading — the placement rule the whole panel follows.
    lead.append(' ', helpButton('Setting a site up', this.offerHelp, (next) => {
      this.offerHelp = next;
      this.repaint();
    }));
    head.append(lead);
    if (this.offerHelp) head.append(helpPanel(CONCEPT_HELP.recording));
    body.append(head);

    const wanting = outstandingPass(passes);
    const wrap = el('div', 'cf-passes');
    for (const phase of RECORD_PASS_ORDER) {
      wrap.append(this.passBlock(phase, passes[phase], stage, wanting === phase));
    }
    body.append(wrap);

    body.append(stage === 'unconfigured' ? this.detected(data) : this.outstanding(data));
    return body;
  }

  /**
   * One pass: what it is, how far it has got, and the one control that advances it.
   *
   * The dot carries the status because status is never colour alone anywhere else
   * here, and the summary line beside it is the words half of the same claim.
   *
   * **The second pass has no button until the first has produced something**, and it
   * is drawn with none rather than with a dead one — the panel's standing rule that
   * an unavailable control keeps its outline and its meaning, and a control with
   * neither is just noise. The passes really are sequential: there is nothing to
   * confirm the landing of until the site can fill and send.
   *
   * **A settled pass keeps its control, worded as a redo.** A pass can be wrong as
   * well as missing — a confirmation captured off a cookie banner, a Send button that
   * turned out to be "Save job" — and with the wizard no longer a way *in* to a site,
   * this block is where those are corrected. It is never the primary: `outstandingPass`
   * decides where the one coral button goes, and a finished pass is not outstanding.
   */
  private passBlock(
    phase: RecordPhase, state: PassState, stage: SetupStage, primary: boolean,
  ): HTMLElement {
    const item = el('div', 'cf-pass');
    const words = RECORD_PASS_TEXT[phase];

    const name = el('div', 'cf-pass-name');
    const dot = el('span', `cf-dot ${DOT[state.status]}`);
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', SETUP_STATUS_TEXT[state.status].aria);
    const label = el('span');
    label.textContent = words.name;
    name.append(dot, label);

    const detail = el('div', 'cf-pass-detail');
    /*
     * What this pass is while it is outstanding; what it bought once it is done. A
     * block that still explained itself after it was finished read as unfinished.
     *
     * It is also the only description in the block: the button under it carries a
     * bare label. It used to carry a caption too, which on the one card said the
     * status a third time — the dot, this line, and then the same words again inside
     * the control. The button's job here is the verb.
     */
    detail.textContent = state.status === 'high'
      ? state.summary
      : phase === 'beforeSend' && stage !== 'unconfigured'
        ? `${state.summary} Record it again to correct or add to what is saved.`
        : words.lead;
    item.append(name, detail);

    // One rule for both blocks: a pass that has already produced something says its
    // redo verb. For the first pass that is any configured site; for the second it is
    // a confirmation actually saved, which is the only thing that pass can produce.
    const done = phase === 'beforeSend' ? stage !== 'unconfigured' : state.status === 'high';
    const verb = done ? words.again : words.action;

    if (phase === 'beforeSend') {
      item.append(this.recordButton(primary, verb));
    } else if (stage !== 'unconfigured') {
      item.append(btn(verb, () => this.cb.onMarkConfirmation(), primary));
    }
    return item;
  }

  /**
   * What the wizard would still ask for, listed where the decision to open it is
   * made. `stepStates` is the same model the rail counts from, so this cannot
   * disagree with the chips the user sees a press later.
   */
  private outstanding(data: SetupData): HTMLElement {
    const wrap = el('div', 'cf-detected');
    const todo = stepStates(data)
      .filter((state) => state.todo > 0 && !PASS_STEPS.has(state.key));
    if (!todo.length) {
      // "Nothing else needs you" is about the *site*, not about this list — under a
      // pass block still asking to be finished it flatly contradicted the coral
      // button beside it. So it is said only when the passes agree with it, and
      // otherwise nothing is said: the blocks above are already the answer.
      if (outstandingPass(passStates(data)) === null) {
        const clear = el('p', 'cf-record-or');
        clear.textContent = 'Nothing else needs you.';
        wrap.append(clear);
      }
      return wrap;
    }
    wrap.append(sectionHead('Still to do by hand'));
    for (const state of todo) {
      wrap.append(this.reviewNote(`${SETUP_STEP_TITLES[state.key]} — `
        + `${state.todo} thing${state.todo === 1 ? '' : 's'} still to do.`));
    }
    return wrap;
  }

  /**
   * The two ways off this screen — **and on a site nobody has taught anything there
   * are none, so there is no footer at all.**
   *
   * Recording is the only way to set a site up. The wizard is still here, and it is
   * the right surface for *correcting* what a recording produced — a mis-identified
   * field, a prep step's timeout, the `Advanced (JSON)` keys no recording can reach —
   * but it is not a way to start one. It carried `Set up by hand ›` on exactly the
   * screen built to replace it, which made it a competing front door onto the surface
   * that puts `submitSelector` and `successSelector` last in a queue of twenty-five:
   * the reason they went unset on nearly every site, and the reason recording exists.
   * So the way in appears only once there is something to review.
   *
   * `Done` is withheld on the same site for the reason the footerless offer already
   * had: closing the panel having taught the extension nothing is not an outcome, and
   * the next posting on the site opens here again. The header `×` is still there to
   * get the card out of the way.
   *
   * **Which of the two is coral is decided by the pass blocks above**: while either
   * pass is outstanding the primary belongs to the one that is, and this footer
   * carries none.
   */
  private homeFooter(data: SetupData): HTMLElement | null {
    if (isUnconfigured(data)) return null;

    const footer = el('div', 'cf-footer');
    const settled = outstandingPass(passStates(data)) === null;

    // Only the mode changes. Which step the wizard opens on was decided once, in
    // `render`, and it is the same decision whichever door the wizard is reached
    // through — a first-time user walks from step 1, legend and all; anyone else
    // lands on the earliest step that still needs them. Re-deriving it here would
    // teleport the first of those into the middle of a panel they have never seen.
    footer.append(btn('Review configuration', () => {
      this.mode = 'wizard';
      this.repaint();
    }));
    footer.append(btn(ACTION_LABELS.done, () => this.cb.onClose(), settled));
    return footer;
  }

  /**
   * What the extension can already read on the page behind this card.
   *
   * `refreshSetup` runs the full detection sweep on every render, in every mode — so
   * a complete `data.fields` has always been in hand here and this screen read none
   * of it. What it asked for ("teach me this site") gave no sense of how much
   * teaching was left, and the same rows were two taps down a rail this screen does
   * not draw. Now the ask is concrete: here is the head start, record the rest.
   *
   * **After the buttons, not before.** The screen's job is the offer, and a count
   * above it demotes the two things the screen exists for — the same reason the flow
   * banner's resting state rides in the modal's footer rather than over its title.
   * Read in order: this is what recording does · do it · and here is what you already
   * have.
   *
   * Two things it must not say. The count line keeps all three statuses **at zero**,
   * because it is a key as much as a tally. And `none` is worded "not on this page"
   * from `SETUP_STATUS_TEXT`, never `STATUS_TEXT`'s "unmatched": detection returns a
   * row per *wanted* field, so nine `none`s is the ordinary state of any real form
   * and calling that unmatched blames the site — the exact cry-wolf failure
   * `setupSteps.fields` counts only the CV to avoid.
   */
  private detected(data: SetupData): HTMLElement {
    const wrap = el('div', 'cf-detected');
    wrap.append(sectionHead('What I can already read here'));

    const counts: Record<RowStatus, number> = { high: 0, low: 0, none: 0 };
    for (const row of data.fields) counts[row.status] += 1;
    wrap.append(summaryLine((['high', 'low', 'none'] as const).map((status) => ({
      dot: DOT[status],
      count: counts[status],
      word: SETUP_STATUS_TEXT[status].word,
      aria: SETUP_STATUS_TEXT[status].aria,
    }))));

    // Named, in `data.fields` order — which `orderFields` has already put in reading
    // order — because "5 found" answers how many and not which. Only the rows that
    // found something: a `none` row has no element and so nothing to name, and it is
    // already counted on the line above.
    const found = data.fields.filter((r) => r.status !== 'none');
    if (found.length) {
      const chips = el('div', 'cf-detected-chips');
      for (const row of found) {
        const chip = el('span', `chip ${DOT[row.status]}`);
        const suffix = SETUP_STATUS_TEXT[row.status].chip;
        chip.textContent = suffix ? `${row.label} · ${suffix}` : row.label;
        chips.append(chip);
      }
      wrap.append(chips);
    } else {
      // A heading promising what it can read, over three zeros, reads as a bug. The
      // count line still goes up — it is a key, and a reader has to be able to learn
      // the three dots from it — but the answer to "what did you find" has to be a
      // sentence when the answer is "nothing", and it belongs pointing back at the
      // buttons above rather than leaving the zero to speak for itself.
      const none = el('p', 'cf-record-or');
      none.textContent = 'Nothing here looks like a field it knows yet. '
        + 'Recording is how it learns.';
      wrap.append(none);
    }
    return wrap;
  }

  /* ---------------- Reviewing a recording ---------------- */

  /**
   * What was recorded, and what it became.
   *
   * The timeline leads because it is the thing the user has memory of — they did it
   * ninety seconds ago — and every row is editable, because the only decisions worth
   * re-examining are "what was that?" and "can we find it again?". The compiled
   * summary follows rather than leads: it is the answer, and the answer is only
   * checkable against the steps above it.
   */
  private reviewBody(recording: Recording, compiled: CompiledSetup): HTMLElement {
    const body = el('div', 'cf-body');

    const head = el('div', 'cf-step-head');
    const title = el('h2', 'cf-step-title');
    title.textContent = 'Check what was recorded';
    const lead = el('p', 'cf-step-lead');
    lead.textContent = compiled.flow === 'external'
      ? 'This posting handed off to the employer’s site, so it is being saved as two: '
        + 'what to press here, and how to fill the form there.'
      : 'The whole application happened on this site.';
    head.append(title, lead);
    body.append(head);

    // The flow was corrected, or nothing here matches what the user chose — say so
    // before they read a timeline split in a way they did not ask for.
    if (compiled.flowCorrected) {
      body.append(this.reviewNote(compiled.flow === 'external'
        ? 'You chose "apply on this site", but the posting handed off — it has been '
          + 'saved as a two-step application.'
        : 'You chose "apply on the employer’s site", but the application was made '
          + 'here — it has been saved as a one-step application.'));
    }
    for (const warning of compiled.warnings) body.append(this.reviewNote(warning));
    // After the warnings, and in `ok`: a note is what happens *next*, and reading it
    // before the things to look at now would make the outstanding half sound optional.
    for (const note of compiled.notes) body.append(this.reviewNote(note, 'ok'));

    if (!recording.steps.length) {
      body.append(this.reviewNote('Nothing was recorded.'));
      return body;
    }

    body.append(sectionHead('What you did'));
    const phase: RecordPhase = recording.phase ?? 'beforeSend';
    for (const step of recording.steps) body.append(this.reviewRow(step, phase));
    return body;
  }

  /**
   * One thing the review has to say out loud.
   *
   * Warnings are all `warn` and deliberately not graded among themselves. The tone is
   * the *dot* as much as the colour, and the coral `accent` banner has no dot of its
   * own — so grading one of them up to accent drew the single most consequential line
   * on this panel with a grey dash beside it, which reads as decoration. They are all
   * the same kind of thing anyway: something to look at before Save.
   *
   * `ok` is the second kind, and the only other one: a note, which is not something
   * to look at before Save but something that happens after it. The check mark is the
   * point — the before-sending pass ending without a confirmation is the *expected*
   * outcome, and it was worded as a failure for as long as there was only one pass.
   */
  private reviewNote(text: string, tone: 'warn' | 'ok' = 'warn'): HTMLElement {
    const note = el('div', `cf-flow ${tone}`);
    const headLine = el('div', 'cf-flow-head');
    headLine.append(el('span', `cf-dot ${tone}`));
    const line = el('div', 'cf-flow-titleline');
    const detail = el('div', 'cf-flow-detail');
    detail.textContent = text;
    line.append(detail);
    headLine.append(line);
    note.append(headLine);
    return note;
  }

  /**
   * One recorded step. The dot is the *selector's* strength, not a match status —
   * this row's question is "will we find this again", and a step identified only by
   * where it sits on the page is the thing most likely to stop working without
   * anyone noticing. It is never colour alone: `SELECTOR_STRENGTH_TEXT` puts the
   * word in the note and the fuller phrase in the dot's accessible name.
   */
  private reviewRow(step: RecordedStep, phase: RecordPhase): HTMLElement {
    const row = el('div', 'cf-row');
    const strength = step.target?.strength ?? 'fragile';
    const dot = el('span', `cf-dot ${strength === 'strong' ? 'ok' : strength === 'ok' ? 'warn' : 'none'}`);
    dot.setAttribute('aria-label', SELECTOR_STRENGTH_TEXT[strength].aria);

    const fieldWrap = el('div', 'cf-field');
    const name = document.createElement('b');
    name.textContent = step.action === 'input'
      ? `Filled in ${step.label || 'a field'}`
      : `Clicked ${step.label || 'an element'}`;
    const note = document.createElement('small');
    const where = step.target?.selector ?? 'no target';
    note.textContent = `${SELECTOR_STRENGTH_TEXT[strength].word} · ${where}`;
    note.title = where;
    fieldWrap.append(name, note);

    const actions = el('div', 'cf-actions');
    actions.append(this.bindSelect(step, phase));
    if (strength === 'fragile') {
      actions.append(btn(ACTION_LABELS.pick, () => this.cb.onRepickStep(step.id), false, `rec:${step.id}:pick`));
    }
    actions.append(iconBtn('✕', 'Remove step', () => this.cb.onRemoveStep(step.id)));

    row.append(dot, fieldWrap, actions);
    return row;
  }

  /**
   * The same decision the recorder bar offered while this was happening, offered
   * again now that the whole sequence is visible: is this a step to replay, or is it
   * something the extension should know?
   *
   * **It offers exactly what the bar offered, because it asks `marksFor` the same
   * question.** A review that could rebind a step to something the pass it came from
   * may not write is a way round the rule by the back door — and the compiler would
   * only drop it again with a warning nobody asked for. The confirmation is the case
   * that matters: chosen here, it would be a `successSelector` captured on a page
   * that was never a confirmation, and every later fill on the site would report
   * itself as applied.
   */
  private bindSelect(step: RecordedStep, phase: RecordPhase): HTMLElement {
    const select = document.createElement('select');
    select.className = 'cf-input cf-bind-select';
    select.dataset.k = `rec:${step.id}:bind`;
    select.setAttribute('aria-label', 'What this is');

    const keep = document.createElement('option');
    keep.value = '';
    keep.textContent = ACTION_LABELS.keepAsClick;
    select.append(keep);

    const option = (key: BindKey): HTMLOptionElement => {
      const node = document.createElement('option');
      node.value = key;
      node.textContent = bindLabel(key);
      return node;
    };

    // The leg orders the list the same way the bar's menu was ordered, so a step
    // recorded on the employer's site is re-decided against that page's marks.
    const offered = marksFor(phase, this.data?.compiled?.flow ?? 'internal', step.leg);

    // Grouped, and grouped by the same answer the bar's menu asked for — a recording
    // is corrected here having been made there, so a mark that read as "applying on
    // this page" in the menu must not read as something else in the review. Flat, the
    // sixteen fields ran straight past the eleven marks above them and the whole list
    // read as one very long thing rather than "what this does" then "which detail".
    for (const { id, keys } of markGroups(offered)) {
      const group = document.createElement('optgroup');
      group.label = MARK_GROUP_TEXT[id];
      for (const key of keys) group.append(option(key));
      select.append(group);
    }

    // A bind the model allows but this pass does not offer still has to be shown as
    // the current value rather than silently reset — a recording made by an older
    // build outlives the menu it was made from, and a select that quietly reads
    // "Keep as a step" over a stored `success` is worse than one that shows it.
    if (step.bind && !offered.includes(step.bind)) select.append(option(step.bind));
    select.value = step.bind ?? '';
    select.onchange = () => this.cb.onRebindStep(step.id, (select.value || null) as BindKey | null);
    return select;
  }

  private reviewFooter(): HTMLElement {
    const footer = el('div', 'cf-footer');
    footer.append(
      btn(ACTION_LABELS.discardRecording, () => this.cb.onDiscardRecording()),
      btn(ACTION_LABELS.saveRecording, () => this.cb.onSaveRecording(), true),
    );
    return footer;
  }

  /** The one step's own controls. Everything else in the wizard is chrome. */
  private stepBody(key: SetupStepKey, data: SetupData): HTMLElement {
    const body = el('div', 'cf-step-body');

    if (key === 'site') {
      body.append(this.recordLead());

      const identity = el('div', 'cf-identity');
      const nameInput = input('Name', data.name, 'site:name');
      const patternInput = input('URL pattern', data.urlPattern, 'site:pattern');
      const persistMeta = () => this.cb.onRename(nameInput.value.trim(), patternInput.value.trim());
      nameInput.onchange = persistMeta;
      patternInput.onchange = persistMeta;
      identity.append(field('Name', nameInput), field('URL pattern', patternInput));
      body.append(identity);

      // The raw JSON is this config, which is what this step is about — so it
      // lives here rather than taking a permanent third slot in the footer.
      const advanced = el('div', 'cf-addbar');
      advanced.append(btn('Advanced (JSON)', () => this.cb.onOpenOptions()));
      body.append(advanced);
    }

    if (key === 'prep') {
      // All three lists are the same thing — clicks and waits this site needs
      // around what the extension does — and they render in the order they can
      // happen: the unconditional list, then the two mutually exclusive endings.
      // Each of the other two used to live on a step about something else, where
      // it was the odd list out under rows it had nothing to do with.
      const head = el('div', 'cf-section-row');
      head.append(sectionHead('Run in order before filling'));
      // Only the first list has a Run button: `onRunPrep` replays the pre-fill
      // steps against the page you are looking at. Neither of the others can be
      // rehearsed that way — the CV steps act on a form the extension has not
      // filled yet, and "before leaving" ends by navigating away from the page.
      head.append(btn('Run steps ▶', () => this.cb.onRunPrep()));
      body.append(head);
      this.appendPrepList(body, data.prep, 'prep');

      // Ending one: the application is sent from this page, and on these sites
      // the file is attached but not yet accepted. Apply runs these before it
      // presses Send.
      body.append(sectionHead('After attaching the CV — extra clicks this site needs'));
      this.appendPrepList(body, data.submitCv, 'submitCv');

      // Ending two: the application is somewhere else, and the board wants its
      // own "Save job" pressed before the handoff.
      body.append(sectionHead('Before leaving — run on the posting first, e.g. “Save job”'));
      this.appendPrepList(body, data.beforeFollow, 'beforeFollow');
    }

    if (key === 'kind') {
      this.appendRedirectRows(body, data.redirect, data.verdict);
    }

    if (key === 'info') {
      for (const row of data.containers) {
        body.append(this.row('container', row,
          () => this.cb.onPickContainer(row.key as ContainerKey),
          () => this.cb.onClearContainer(row.key as ContainerKey)));
      }
    }

    if (key === 'fields') {
      body.append(sectionHead('Pick only what stays grey'));
      for (const row of data.fields) {
        body.append(this.row('field', row,
          () => this.cb.onPickField(row.key as FieldKey),
          () => this.cb.onClearField(row.key as FieldKey)));
      }
    }

    if (key === 'send') {
      // These two rows and nothing else. They are what Apply depends on, and
      // while they sat at the tail of a sixteen-row field list the confirmation
      // went unset on nearly every site — so anything else here is a step back
      // towards burying them. The CV-confirmation steps are a prep list and live
      // with the other two on `prep`.
      body.append(sectionHead('The button Apply presses'));
      body.append(this.row('send', data.submit,
        () => this.cb.onPickSubmit(),
        () => this.cb.onClearSubmit()));
      /*
       * The one row on this panel whose action is not Pick, because Pick is the one
       * control that cannot be right here: it asks the user to point at something
       * that is not on the page, and will not be until an application has really
       * gone in. That is the whole reason there is a second pass, and this row is
       * the second place it can be started from — the user applies by hand, on
       * their own schedule, and the bar waits for them to point at the reply.
       *
       * Once something *is* saved the ordinary controls come back: a correction can
       * be made on a page where a confirmation really is up, which is exactly where
       * someone re-picking this would be standing.
       */
      // The instruction lives in the heading rather than the row's note: the note
      // truncates to one line beside a control this wide, and "it is only on screen
      // once an application has really gone in" is the whole trick — it is why the
      // row's action is the second pass rather than a Pick.
      body.append(sectionHead(data.success.hasSave
        ? 'How this site says it worked'
        : 'How this site says it worked — only on screen once one has gone in'));
      if (data.success.hasSave) {
        body.append(this.row('send', data.success,
          () => this.cb.onPickSuccess(),
          () => this.cb.onClearSuccess()));
      } else {
        body.append(this.markRow(data.success));
      }
    }

    return body;
  }

  /**
   * The legend: what the dots, the `auto ·` / `saved ·` prefixes and the "to do"
   * chip actually mean. Open until dismissed once — none of that vocabulary is
   * guessable, and all of it is on screen from the first render.
   */
  private legend(data: SetupData): HTMLElement {
    const details = document.createElement('details');
    details.className = 'cf-legend';
    details.open = !data.helpSeen && !this.legendDismissed;

    const summary = document.createElement('summary');
    const label = el('span');
    label.textContent = 'What the rows mean';
    summary.append(label);
    details.append(summary);

    const body = el('div', 'cf-legend-body');

    // The dots are shown, not described — a colour key made of words is not a
    // key. Each is the real `.cf-dot`, glyph included.
    for (const { status, label } of DOT_LEGEND) {
      const line = el('div', 'cf-legend-dot');
      const text = el('span');
      text.textContent = label;
      line.append(el('span', `cf-dot ${status}`), text);
      body.append(line);
    }

    // One line each for the rest of the vocabulary. The full explanations are a
    // tap away behind each section's `?`; a legend that has to be scrolled past
    // to reach the work is worse than no legend.
    for (const key of ['autoVsSaved', 'picker', 'todoChip'] as const) {
      const entry = CONCEPT_HELP[key];
      const line = el('p', 'cf-legend-line');
      line.append(...richText(entry.short ?? entry.body));
      body.append(line);
    }

    const dismiss = btn('Got it', () => {
      this.legendDismissed = true;
      details.open = false;
      this.cb.onDismissHelp();
    });
    dismiss.className = 'cf-btn cf-legend-dismiss';
    body.append(dismiss);

    details.append(body);
    return details;
  }

  /**
   * The redirect rows, under the verdict each one argues for.
   *
   * Flat, the three read as three unrelated selectors. They are not: the
   * external marker says "this posting applies elsewhere" and the apply link
   * says "and here is what to press" — neither is any use without the other, and
   * a user who sets one and not the other has configured nothing. The
   * quick-apply marker answers the opposite question and belongs on its own.
   *
   * Driven by a table rather than by `REDIRECT_ROWS`' order, and with a trailing
   * catch-all group, so a new `RedirectSelectorKey` shows up unfiled instead of
   * silently not showing up at all.
   */
  private appendRedirectRows(body: HTMLElement, rows: SetupRow[], verdict: SetupVerdict): void {
    const grouped = new Set<string>();
    let verdictPlaced = false;
    const emit = (head: string, group: SetupRow[], answers = false) => {
      if (!group.length) return;
      body.append(sectionHead(head));
      // The verdict leads the group it argues for: it is the answer, and these
      // are the rows that decide it. Above both headings it was a caption about
      // nothing in particular, and the one thing on the step nobody read.
      if (answers) {
        body.append(verdictBanner(verdict));
        verdictPlaced = true;
      }
      for (const row of group) {
        body.append(this.row('redirect', row,
          () => this.cb.onPickRedirect(row.key),
          () => this.cb.onClearRedirect(row.key)));
      }
    };

    for (const { head, keys, kinds } of REDIRECT_GROUPS) {
      // Ordered by the group, not by the order the rows arrived in: the marker
      // ("this posting applies elsewhere") has to be read before the link that
      // says where, and `REDIRECT_ROWS` lists them the other way round.
      const group = keys
        .map((k) => rows.find((r) => r.key === k))
        .filter((r): r is SetupRow => !!r);
      for (const r of group) grouped.add(r.key);
      emit(head, group, kinds.includes(verdict.kind));
    }
    emit('Other', rows.filter((r) => !grouped.has(r.key)));
    // A group with no rows draws no heading, and must not swallow the verdict
    // with it — the step would then state no answer at all.
    if (!verdictPlaced) body.prepend(verdictBanner(verdict));
  }

  /** A step list plus its "+ step" bar; all three prep lists render identically. */
  private appendPrepList(body: HTMLElement, steps: PrepRow[], list: PrepListKey): void {
    steps.forEach((step, i) => body.append(this.prepRow(step, i, steps.length, list)));
    const addBar = el('div', 'cf-addbar');
    addBar.append(
      btn('+ Click', () => this.cb.onAddPrep('click', list)),
      btn('+ Wait for', () => this.cb.onAddPrep('waitFor', list)),
      btn('+ Delay', () => this.cb.onAddPrep('delay', list)),
    );
    body.append(addBar);
  }

  private prepRow(step: PrepRow, i: number, total: number, list: PrepListKey): HTMLElement {
    const row = el('div', 'cf-row');
    const selectorBased = step.action !== 'delay';
    const status = !selectorBased ? 'ok' : step.selector ? (step.resolves ? 'ok' : 'warn') : 'none';
    row.append(el('span', `cf-dot ${status}`));

    const info = el('div', 'cf-field');
    const name = el('b');
    name.textContent = `${i + 1}. ${PREP_LABEL[step.action]}`;
    const detail = el('small');
    detail.textContent = selectorBased
      ? (step.selector ?? 'no target — Pick one')
      : `${step.ms ?? 0} ms`;
    detail.title = detail.textContent;
    info.append(name, detail);
    row.append(info);

    const actions = el('div', 'cf-actions');
    if (step.action === 'delay' || step.action === 'waitFor') {
      const ms = document.createElement('input');
      ms.type = 'number';
      ms.className = 'cf-ms';
      ms.value = String(step.ms ?? (step.action === 'waitFor' ? 10000 : 500));
      ms.title = step.action === 'waitFor' ? 'timeout (ms)' : 'delay (ms)';
      ms.dataset.k = `prep:${list}:${i}:ms`;
      ms.onchange = () => this.cb.onSetPrepMs(i, Math.max(0, Number(ms.value) || 0), list);
      actions.append(ms);
    }
    if (selectorBased) {
      actions.append(btn(step.selector ? 'Re-pick' : 'Pick',
        () => this.cb.onPickPrepTarget(i, list), false, `prep:${list}:${i}`));
    }
    const up = iconBtn('↑', 'Move up', () => this.cb.onMovePrep(i, -1, list));
    const down = iconBtn('↓', 'Move down', () => this.cb.onMovePrep(i, 1, list));
    if (i === 0) up.setAttribute('disabled', 'true');
    if (i === total - 1) down.setAttribute('disabled', 'true');
    actions.append(up, down, iconBtn('✕', 'Remove step', () => this.cb.onRemovePrep(i, list)));
    row.append(actions);
    return row;
  }

  /**
   * The confirmation row while nothing is saved: the same shape as every other row,
   * with the second pass in place of a Pick that could only ever fail.
   *
   * What it replaced was a Pick plus a paragraph under the row explaining why the
   * Pick could not work — three things saying one. The heading above carries the
   * fact, the button carries the verb, and the row is the same two lines every other
   * row on this panel is.
   */
  private markRow(m: SetupRow): HTMLElement {
    const row = el('div', 'cf-row');
    row.append(el('span', `cf-dot ${DOT[m.status]}`));

    const info = el('div', 'cf-field');
    const name = el('b');
    name.textContent = m.label;
    const detail = el('small');
    detail.textContent = m.note;
    detail.title = m.note;
    info.append(name, detail);

    const actions = el('div', 'cf-actions');
    actions.append(btn(RECORD_PASS_TEXT.afterSend.action,
      () => this.cb.onMarkConfirmation(), false, `send:${m.key}`));
    row.append(info, actions);
    return row;
  }

  /**
   * `ns` namespaces the row's `data-k` — the same key (`applySelector`) means a
   * different row in a different step, and focus must not land on the wrong one.
   */
  private row(ns: string, m: SetupRow, onPick: () => void, onClear: () => void): HTMLElement {
    const row = el('div', 'cf-row');
    row.append(el('span', `cf-dot ${DOT[m.status]}`));

    const info = el('div', 'cf-field');
    const name = el('b');
    name.textContent = m.label;
    const detail = el('small');
    detail.textContent = m.note;
    detail.title = m.note;
    info.append(name, detail);
    row.append(info);

    // Plain, like every other per-row action here: the panel's one coral button is
    // Done in the footer. A Pick on each of a dozen rows read as a dozen CTAs.
    const actions = el('div', 'cf-actions');
    actions.append(btn(m.hasSave ? 'Re-pick' : ACTION_LABELS.pick, onPick, false, `${ns}:${m.key}`));
    if (m.hasSave) actions.append(btn('Clear', onClear, false, `${ns}:${m.key}:clear`));
    row.append(actions);
    return row;
  }

}

function el(tag: string, className = ''): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function btn(text: string, onClick: () => void, primary = false, k?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `cf-btn${primary ? ' primary' : ''}`;
  b.textContent = text;
  b.onclick = onClick;
  // `data-k` is how `Sheet` finds this control again after a rebuild. Only the
  // controls worth returning focus to carry one; see `Sheet.place`.
  if (k) b.dataset.k = k;
  return b;
}

/**
 * A button whose whole label is a glyph. It is marked so the narrow row rules can
 * hold it square: `.cf-actions .cf-btn { flex: 1 }` sizes every action by how many
 * the row happens to carry, which turned ↑ ↓ ✕ into 59–86px slabs and put the same
 * control at a different x on every prep row. The glyph is also hidden from the
 * accessibility tree — "↑" is not a name, `aria-label` is.
 */
function iconBtn(glyph: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = btn(glyph, onClick);
  b.className = 'cf-btn cf-btn-icon';
  b.setAttribute('aria-label', label);
  return b;
}

function input(placeholder: string, value: string, k: string): HTMLInputElement {
  const i = document.createElement('input');
  i.className = 'cf-input';
  i.placeholder = placeholder;
  i.value = value;
  i.dataset.k = k;
  return i;
}

function field(label: string, control: HTMLElement): HTMLElement {
  const wrap = el('label', 'cf-fld');
  const l = el('span', 'cf-fld-label');
  l.textContent = label;
  wrap.append(l, control);
  return wrap;
}

function sectionHead(text: string): HTMLElement {
  const h = el('div', 'cf-section');
  h.textContent = text;
  return h;
}

/**
 * The `kind` step's answer, drawn as the review modal's flow banner — same
 * object, same classes, one stylesheet (`primitives.css`).
 *
 * It used to be a `--text-sm` caption in a plain box with no status mark on it at
 * all, which made the one conclusion on the step quieter than the rows that led
 * to it. It carries a dot for the same reason every other status here does:
 * status is never colour alone, and `unknown` — the classifier guessing — is the
 * state the user has to act on, so it gets the `!`.
 */
function verdictBanner(verdict: SetupVerdict): HTMLElement {
  const tone = verdict.kind === 'unknown' ? 'warn' : 'ok';
  const box = el('div', `cf-flow cf-verdict ${tone}`);

  const head = el('div', 'cf-flow-head');
  const dot = el('span', `cf-dot ${tone}`);
  dot.setAttribute('role', 'img');
  dot.setAttribute('aria-label', tone === 'warn' ? 'assumed' : 'confirmed');

  const titleLine = el('div', 'cf-flow-titleline');
  const title = el('b', 'cf-flow-title');
  title.textContent = verdict.title;
  titleLine.append(title);

  const detail = el('span', 'cf-flow-detail');
  detail.textContent = verdict.detail;

  head.append(dot, titleLine, detail);
  box.append(head);
  return box;
}
