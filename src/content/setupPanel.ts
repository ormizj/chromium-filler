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
import type {
  BindKey, CompiledSetup, RecordFlow, Recording, RecordedStep,
} from '../shared/recording';
import { SELECTOR_STRENGTH_TEXT } from '../shared/labels';
import { bindLabel, fieldMarks } from './recorderBar';
import {
  CONCEPT_HELP, DOT_LEGEND, SETUP_STEP_HELP, SETUP_STEP_TITLES,
} from '../shared/help';
import {
  SETUP_STEP_ICONS, SETUP_STEP_ORDER, firstStepWithWork, isUnconfigured, stepStates,
  type ContainerKey, type PrepListKey, type PrepRow, type RowStatus, type SetupRow,
  type SetupSnapshot, type SetupStepKey, type SetupVerdict, type StepState,
} from '../shared/setupSteps';
import type { PostingKind } from '../shared/redirect';
import { ACTION_LABELS } from '../shared/labels';
import { helpButton, helpPanel, richText } from '../ui/help';
import { Sheet, type SheetCallbacks, type SheetData } from './sheet';
import setupCss from './setupPanel.css?inline';

// Re-exported so the Controller, the dev harness and the E2E keep one import
// path for the row shapes, while the pure step model owns their definitions.
export type {
  ContainerKey, PrepListKey, PrepRow, RowStatus, SetupRow, SetupStepKey, SetupVerdict,
} from '../shared/setupSteps';

const DOT: Record<RowStatus, string> = { high: 'ok', low: 'warn', none: 'none' };

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
  /** Set this site up by doing it once. The flow decides what the bar asks for. */
  onStartRecording(flow: RecordFlow): void;
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

/**
 * What the review's per-step dropdown leads with: the flow and job-info marks, in
 * the order they come up while applying. The five that matter stay at the top of a
 * control the user is scanning.
 *
 * The sixteen profile fields follow, under a heading of their own. They used to be
 * left out entirely, because a field was corrected from the recorder bar while the
 * cursor was still in it — but the bar has no such control any more, and the one
 * bind the extension still guesses for itself is exactly a field. This is now the
 * only place a wrong guess can be refused, so it has to offer them.
 */
const BIND_CHOICES: BindKey[] = [
  'submit', 'success', 'jobDescription', 'jobTitle', 'jobRequirements',
  'applySelector', 'quickApplySelector', 'markerSelector',
  'company', 'location', 'employmentType',
];

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
   * `offer` is where a site nobody has configured opens: two buttons and a way past
   * them. It is a screen of its own rather than a block on step 1 because the panel
   * does not *open* on step 1 — `firstStepWithWork` sends a returning user to the
   * earliest unfinished step, and a brand-new config always has work on `fields` or
   * `send`. As a block it was four presses of Back away from anyone who needed it.
   */
  private mode: 'offer' | 'wizard' | 'review' = 'wizard';
  /** The `?` explanations the user opened — a re-scan mid-read must not close one. */
  private openHelp = new Set<SetupStepKey>();
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
      // A site nobody has taught anything gets the offer to record. Everyone else
      // gets the wizard, at the earliest step that still needs them.
      if (isUnconfigured(data)) this.mode = 'offer';
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
    this.mode = on ? 'review' : 'wizard';
    // Coming out of a review lands on the earliest step that still needs anything,
    // which after a good recording is usually nothing at all.
    if (!on && this.data) this.step = Math.max(0, firstStepWithWork(stepStates(this.data)));
    this.repaint();
  }

  /**
   * Show the opening offer, or leave it for the wizard. Exposed so the dev harness
   * can render it and the Controller can put it back after a discarded recording.
   */
  showOffer(on: boolean): void {
    this.mode = on ? 'offer' : 'wizard';
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
    header.append(title, full, close);
    this.makeDraggable(card, header);

    if (this.mode === 'review' && data.recording && data.compiled) {
      card.append(header, this.reviewBody(data.recording, data.compiled), this.reviewFooter());
      return card;
    }

    if (this.mode === 'offer') {
      card.append(header, this.offerBody(), this.offerFooter());
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
   * The front door: set this site up by applying to one job while the extension
   * watches. Everything below it on this step — and the five steps after it — is the
   * way to correct what that produced, or to build a config by hand for a site you
   * would rather not apply to yet.
   *
   * Two buttons because there are two shapes of application and the extension cannot
   * know which this is until the user has already done it. They name **where the
   * application gets made**, not what the extension will do, because that is the
   * question someone looking at a posting can actually answer. Getting it wrong
   * costs nothing: `compileRecording` believes what happened, not what was picked.
   */
  private recordLead(isOffer = false): HTMLElement {
    const wrap = el('div', 'cf-record-lead');

    if (!isOffer) {
      // On the `site` step this is the way to record a site *again* — to mark the
      // description you forgot — so it says which of the two it is. The offer screen
      // has already explained itself in full above.
      const lead = el('p', 'cf-record-lead-text');
      lead.textContent = 'Record this site again to correct or add to what is saved. '
        + 'Nothing already set is lost unless the new recording covers it.';
      wrap.append(lead);
    }

    const actions = el('div', 'cf-record-actions');
    actions.append(
      btn(ACTION_LABELS.record, () => this.cb.onStartRecording('internal'), isOffer),
      btn(ACTION_LABELS.recordExternal, () => this.cb.onStartRecording('external')),
    );
    wrap.append(actions);

    if (!isOffer) {
      const or = el('p', 'cf-record-or');
      or.textContent = 'Or correct it by hand below.';
      wrap.append(or);
    }
    return wrap;
  }

  /**
   * The opening screen for a site nobody has set up: what recording is, the two
   * flows, and one way past to the wizard.
   *
   * It is the whole card rather than a block on a step because it is an *offer*, and
   * an offer competing with a progress rail and six numbered steps reads as the least
   * of seven things to do. The rail comes back the moment the wizard does.
   */
  private offerBody(): HTMLElement {
    const body = el('div', 'cf-body');

    const head = el('div', 'cf-step-head');
    const title = el('h2', 'cf-step-title');
    title.textContent = 'Teach the extension this site';
    head.append(title);

    const lead = el('p', 'cf-step-lead');
    lead.append(...richText(CONCEPT_HELP.recording.body));
    head.append(lead);
    body.append(head, this.recordLead(true));

    const marking = el('p', 'cf-record-or');
    marking.textContent = CONCEPT_HELP.marking.short ?? '';
    body.append(marking);
    return body;
  }

  /**
   * One way out, and it is not a primary: the two Record buttons above it are what
   * this screen is for, and a coral "Set up by hand" would point at the long way
   * round on the one screen built to avoid it.
   */
  private offerFooter(): HTMLElement {
    const footer = el('div', 'cf-footer');
    footer.append(
      btn('Set up by hand ›', () => this.showOffer(false)),
      btn(ACTION_LABELS.done, () => this.cb.onClose()),
    );
    return footer;
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

    if (!recording.steps.length) {
      body.append(this.reviewNote('Nothing was recorded.'));
      return body;
    }

    body.append(sectionHead('What you did'));
    for (const step of recording.steps) body.append(this.reviewRow(step));
    return body;
  }

  /**
   * One thing the review has to say out loud.
   *
   * All of them are `warn`, and deliberately not graded. The tone is the *dot* as
   * much as the colour, and the coral `accent` banner has no dot of its own — so
   * grading the missing confirmation up to accent drew the single most consequential
   * line on this panel with a grey dash beside it, which reads as decoration. They
   * are all the same kind of thing anyway: something to look at before Save.
   */
  private reviewNote(text: string): HTMLElement {
    const note = el('div', 'cf-flow warn');
    const headLine = el('div', 'cf-flow-head');
    headLine.append(el('span', 'cf-dot warn'));
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
  private reviewRow(step: RecordedStep): HTMLElement {
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
    actions.append(this.bindSelect(step));
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
   */
  private bindSelect(step: RecordedStep): HTMLElement {
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

    for (const key of BIND_CHOICES) select.append(option(key));

    // Grouped rather than appended flat: sixteen fields run past the eleven above
    // them, and without a heading the list reads as one very long thing rather than
    // "what this does" followed by "which of my details it is".
    const fields = document.createElement('optgroup');
    fields.label = 'Form fields';
    for (const key of fieldMarks()) fields.append(option(key));
    select.append(fields);

    // A bind the model allows but neither list offers still has to be shown as the
    // current value rather than silently reset.
    const offered = [...BIND_CHOICES, ...fieldMarks()];
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
      // The instruction lives in the heading rather than the row's note: the note
      // truncates to one line, and "pick this once a confirmation is on screen" is
      // the whole trick — it does not exist on the page you are looking at.
      body.append(sectionHead('How this site says it worked — pick it with a confirmation on screen'));
      body.append(this.row('send', data.success,
        () => this.cb.onPickSuccess(),
        () => this.cb.onClearSuccess()));
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
