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
  CONCEPT_HELP, DOT_LEGEND, SETUP_STEP_HELP, SETUP_STEP_TITLES,
} from '../shared/help';
import {
  SETUP_STEP_ICONS, SETUP_STEP_ORDER, firstStepWithWork, stepStates,
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
      const work = firstStepWithWork(stepStates(data));
      this.step = data.helpSeen && work >= 0 ? work : 0;
    }
    this.paint();
  }

  /** Jump to a step by key. Used by the dev harness, so each step is screenshottable. */
  setStep(key: SetupStepKey): void {
    const i = SETUP_STEP_ORDER.indexOf(key);
    if (i < 0) return;
    this.placed = true;
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

  /** The one step's own controls. Everything else in the wizard is chrome. */
  private stepBody(key: SetupStepKey, data: SetupData): HTMLElement {
    const body = el('div', 'cf-step-body');

    if (key === 'site') {
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
      const head = el('div', 'cf-section-row');
      head.append(sectionHead('Run in order before filling'));
      // Only the first list has a Run button: `onRunPrep` replays the pre-fill
      // steps against the page you are looking at, and "before leaving" ends by
      // navigating away from it.
      head.append(btn('Run steps ▶', () => this.cb.onRunPrep()));
      body.append(head);
      this.appendPrepList(body, data.prep, 'prep');

      // Both lists are the same thing — clicks and waits this site needs before
      // the extension acts — and they were a step apart, with the second one
      // buried under the redirect rows of a step about something else entirely.
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
      // In the order they happen: confirm the file, press the button, read the
      // answer. The two rows Apply depends on used to be the tail of a sixteen
      // row field list, which is most of why the confirmation went unset.
      body.append(sectionHead('After attaching the CV — extra clicks this site needs'));
      this.appendPrepList(body, data.submitCv, 'submitCv');

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
