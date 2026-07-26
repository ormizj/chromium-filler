/**
 * Shadow-DOM review modal. Two views behind one header toggle:
 *
 *   Job     the posting — title, description, requirements, as real prose.
 *   Fields  the per-field report (filled / low-confidence / unmatched), with
 *           Confirm/Pick per row.
 *
 * Job is the default, and that ordering is the point. Once the form is filled the
 * user's question is "do I want this job?", not "which of sixteen fields matched";
 * most postings do not even have most of those fields, so an always-expanded
 * report buried the posting under rows nobody asked for. The report is still one
 * tap away, and the Fields tab carries a status dot, so nothing needing attention
 * can hide behind the toggle.
 *
 * On mobile this is the primary control: reaching the toolbar popup costs two or
 * three taps through the browser menu, so the modal carries the session actions
 * too, and closing it collapses to a pill instead of destroying it — the old
 * close button threw the report away, and the only route back (the popup's
 * "Reset & Re-run") wiped every field it had just filled.
 */

import type { FieldMatch, MatchConfidence } from '../../shared/types';
import type { SessionState } from '../../shared/messages';
import { progressDots } from '../../shared/queue';
import type { JobBlock } from '../../shared/jobText';
import type { JobMeta } from '../../shared/jobMeta';
import { FIELD_LABELS } from '../../shared/fieldKeys';
import { STATUS_LABELS, matchStatus, orderReport } from '../../shared/fieldStatus';
import { ACTION_LABELS, STATUS_TEXT } from '../../shared/labels';
import { flowBanner, type ApplyState } from '../../shared/flowState';
import { CONCEPT_HELP } from '../../shared/help';
import { helpButton, helpPanel } from '../../ui/help';
import { Sheet, type SheetCallbacks, type SheetData } from '../sheet';
import modalCss from './modal.css?inline';

export interface ModalCallbacks extends SheetCallbacks {
  onRerun(): void;
  /** Run the CV-confirmation steps, then press the site's own Send button. */
  onApply(): void;
  onConfirm(field: FieldMatch['field']): void;
  onPick(field: FieldMatch['field']): void;
  /** Follow (or re-try) the external application handoff. */
  onFollow(): void;
  /** Ignore the redirect verdict and fill this page after all. */
  onFillAnyway(): void;
  /** Mark this posting skipped, and move a session on to the next one. */
  onSkip(): void;
  /** Open the on-page setup wizard for this site — the modal folds to its pill. */
  onOpenSetup(): void;
  /** Open the options page. */
  onOpenOptions(): void;
  onClose(): void;
}

/** Set when the posting hands off to an external application instead of a form. */
export interface RedirectNotice {
  /** Destination host, when known. */
  host?: string;
  /** Why this was classified as a redirect (from the detector). */
  reason: string;
  /** True once the handoff has been triggered. */
  followed: boolean;
}

/** Which of the two views the card is showing. */
export type ModalView = 'job' | 'fields';

/**
 * Whether Apply can run here — now decided alongside every other step of the
 * flow, in `shared/flowState.ts`. Re-exported so `content/main.ts` and the dev
 * harness keep importing it from the modal, where it has always lived.
 */
export type { ApplyState };

export interface ModalData extends SheetData {
  siteName: string;
  jobTitle?: string;
  /** The posting, as blocks — see shared/jobText.ts. */
  jobDescription?: JobBlock[];
  jobRequirements?: JobBlock[];
  /** Company / location / employment type, as far as the posting states them. */
  meta?: JobMeta;
  matches: FieldMatch[];
  /** Whether Apply may run, and which half is missing when it may not. */
  applyState: ApplyState;
  /** The site's own confirmation appeared — this posting really was sent. */
  applied?: boolean;
  /**
   * The job database already had this URL down as `applied` when the page opened.
   *
   * Separate from `applied` because only one of them is a receipt for something
   * that just happened: the wording and the live region belong to that one. What
   * they share is `isApplied()` below — the renderings that are true of a finished
   * posting however it got that way.
   */
  alreadyApplied?: boolean;
  /** When the record says the application went in, if the entry carries it. */
  appliedAt?: number;
  redirect?: RedirectNotice;
  /**
   * This page's apply control hands off to a phone app and was left alone. Never
   * set together with `redirect`: there is nothing here to open, so the footer
   * must not offer to.
   */
  appLink?: boolean;
  /** Host of the board posting this page was reached from. */
  via?: string;
  /** Queue progress, when a session is running. Drives the strip and Skip action. */
  session?: SessionState;
  // `layout` and `fullscreen` come from SheetData — the geometry is the setup
  // panel's too, and both sheets share one slot on the page.
}

/**
 * The `.chip` tint each outcome wears in the report. The dot classes are the
 * `MatchConfidence` values themselves; the chip's are the shared ok/warn/err
 * tints from primitives.css, so this is the one place the two vocabularies meet.
 */
const TAG_TONE: Record<MatchConfidence, string> = { high: 'ok', low: 'warn', none: 'err' };

/**
 * Is this posting finished, however it got that way?
 *
 * The card becomes a receipt on both — the `Sent` chip, the demoted title, the
 * legend, the pill, and the footer's two retired controls are all about a posting
 * with no decisions left, not about the moment a confirmation arrived. Only the
 * sentences distinguish the two, so only they read the flags directly.
 */
function isApplied(data: ModalData): boolean {
  return !!data.applied || !!data.alreadyApplied;
}

export class FillerModal extends Sheet<ModalData> {
  private cb: ModalCallbacks;
  /**
   * Kept across renders for the same reason the collapsed flag is: confirming a
   * field re-renders, and being thrown back to the Job view every time would make
   * the report unusable exactly when it is being used.
   */
  private view: ModalView = 'job';
  /**
   * Whether the note explaining the greyed-out Apply button is open. Lives here
   * rather than in `ModalData` for the same reason `view` does: it is the user's
   * reading state, and a re-render must not close what they just opened.
   */
  private applyHelp = false;

  constructor(cb: ModalCallbacks) {
    super('review', 'chromium-filler-modal-host', modalCss, cb);
    this.cb = cb;
  }

  render(data: ModalData): void {
    this.data = data;
    // A note about a button that is no longer grey is just wrong text on screen:
    // picking the Send button mid-session flips this without a further click.
    // But an applied posting *is* blocked while `applyState` reads `ready` — the
    // two controls are retired for a reason that has nothing to do with whether
    // Apply could physically run — so it must not close the note it just opened.
    if (data.applyState === 'ready' && !isApplied(data)) this.applyHelp = false;
    this.paint();
  }

  /** Re-render from the last data — what `Sheet` calls after a fold or a resize. */
  protected repaint(): void {
    if (this.data) this.render(this.data);
  }

  protected buildCard(): HTMLElement {
    const data = this.data!;
    const card = el('div', 'cf-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', `${data.siteName} — ${data.jobTitle ?? 'fill report'}`);

    card.append(this.header(data, card));
    // A two-step posting has no report and gets no toggle, so the Fields view
    // there would be an empty dead end with no way back to the job.
    const fields = this.view === 'fields' && !data.redirect;
    card.append(fields ? this.fieldsBody(data) : this.jobBody(data));
    // Where the strip goes: directly above the footer, never above the header —
    // the header is the sheet's title and drag handle and has to stay at the top
    // edge. Sitting with the footer puts "posting 8 of 13" beside the Skip that
    // moves it on, which is the decision the number is read for.
    if (data.session?.active) card.append(this.sessionStrip(data.session));
    card.append(this.footer(data));
    return card;
  }

  protected buildPill(): HTMLElement {
    return this.pill(this.data!);
  }

  /** Which view is showing — the dev harness boots straight into one. */
  setView(view: ModalView): void {
    if (this.view === view) return;
    this.view = view;
    if (this.data) this.render(this.data);
  }

  /**
   * Open or close the note behind the greyed-out Apply button. Public for the
   * same reason `setView` is: it is only reachable by clicking, and a screenshot
   * cannot click.
   */
  setApplyHelp(open: boolean): void {
    if (this.applyHelp === open) return;
    this.applyHelp = open;
    if (this.data) this.render(this.data);
  }

  /* ---------------- Chrome ---------------- */

  private header(data: ModalData, card: HTMLElement): HTMLElement {
    const header = el('div', 'cf-header');
    header.append(el('div', 'cf-grip'));

    const site = el('span', 'cf-site');
    site.textContent = data.via ? `${data.siteName} · via ${data.via}` : data.siteName;

    const close = el('button', 'cf-close');
    close.textContent = '×';
    close.setAttribute('aria-label', 'Minimize');
    close.onclick = () => this.cb.onClose();

    // Icon-only, so the label is spoken rather than shown, and `aria-pressed`
    // carries the state — a toggle, not a button that does two different things.
    // Offered on a two-step posting too: that page is nothing but prose to read,
    // which is the case the extra room is worth the most in.
    const full = document.createElement('button');
    full.className = 'cf-fullscreen';
    full.setAttribute('aria-pressed', String(!!data.fullscreen));
    full.setAttribute('aria-label', data.fullscreen
      ? ACTION_LABELS.exitFullscreen
      : ACTION_LABELS.fullscreen);
    full.onclick = () => this.setFullscreen(!data.fullscreen);

    header.append(site);
    // The outcome, on the one strip of the card that is always visible — the body
    // scrolls, and on a long posting the confirmation banner scrolls away with it.
    if (isApplied(data)) {
      const chip = el('span', 'chip ok cf-sent-chip');
      chip.textContent = 'Sent';
      header.append(chip);
    }
    // A two-step posting has no report to switch to: there is no form on this
    // page, so an empty Fields view would be a dead end.
    if (!data.redirect) header.append(this.viewToggle(data));
    header.append(full, close);

    this.makeDraggable(card, header);
    return header;
  }

  /**
   * The Job/Fields switch. The Fields tab carries the report's worst status as a
   * dot, so a field that still needs the user is advertised on the closed tab —
   * hiding the report must not mean hiding a problem.
   */
  private viewToggle(data: ModalData): HTMLElement {
    const wrap = el('div', 'cf-views');
    wrap.setAttribute('role', 'tablist');

    const tab = (view: ModalView, label: string, dot?: MatchConfidence) => {
      const b = document.createElement('button');
      b.className = `cf-view${this.view === view ? ' active' : ''}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(this.view === view));
      if (dot) {
        const d = el('span', `cf-dot ${dot}`);
        d.setAttribute('role', 'img');
        d.setAttribute('aria-label', STATUS_LABELS[dot]);
        b.append(d);
      }
      b.append(document.createTextNode(label));
      b.onclick = () => this.setView(view);
      return b;
    };

    wrap.append(tab('job', 'Job'), tab('fields', 'Fields', worstStatus(data.matches)));
    return wrap;
  }

  /**
   * Two decisions and nothing else: send this one, or move on. Everything that
   * is about the *extension* rather than the posting — Re-run, and the two ways
   * out — goes behind the overflow, because at 390px a row of five buttons makes
   * the two that matter no easier to hit than the three that do not.
   */
  private footer(data: ModalData): HTMLElement {
    const footer = el('div', 'cf-footer');
    // The resting state — "filled, nothing has been sent yet" — belongs against
    // the button it is about, not above the job title. The Job view leads with
    // the posting on purpose, and a fill-status line at the top of it inverted
    // that; down here the sentence and the control that acts on it are one
    // object, which is what "where do I actually apply?" was asking for.
    const banner = this.flowBanner(data);
    if (banner.classList.contains('quiet')) footer.append(banner);

    const actions = el('div', 'cf-footer-actions');
    // A posting you do not want is worth skipping whether or not you can apply
    // to it here, so Skip is on every branch. The label names the consequence:
    // during a session skipping also pulls in the next posting.
    const skip = btn(data.session?.active ? ACTION_LABELS.skipNext : ACTION_LABELS.skip, () => this.cb.onSkip());

    // Finished, by either route: nothing here is a decision any more, and an Apply
    // that still looked live would invite a second application to the same job.
    //
    // Ahead of the redirect branch, and it has to be. The controller declines to
    // follow a handoff on an applied posting, so a two-step posting opened again
    // arrives here with `redirect` *and* `alreadyApplied` set — and this branch
    // second would have put a live "Open application" primary on a job already
    // applied for. `flowState.classify` orders the two the same way.
    if (isApplied(data)) {
      const done = btn(ACTION_LABELS.applied, () => {}, true);
      done.setAttribute('aria-disabled', 'true');
      done.classList.add('cf-applied-btn');
      // Skip retires beside it, and not only for symmetry: `skipPosting` writes a
      // status, and `recordStatus` is a blunt overwrite rather than a promote, so
      // pressing it here would file "skipped" over "applied" and lose the record
      // of an application that really was sent — on this device and, through the
      // history union the sync merge derives status from, on the other one too.
      this.retire(skip, 'Skip — this posting is already applied to, press to find out why');
      actions.append(
        done,
        skip,
        this.overflow([
          ...this.commonMenuItems(),
          // Only when there is somewhere to go: an applied quick-apply posting has
          // no external application, and an item that opens nothing is worse than
          // no item. Between the ways out and Re-run, so the two fixed ends of the
          // list hold on every branch.
          ...(data.redirect ? [btn(ACTION_LABELS.openApplication, () => this.cb.onFollow())] : []),
          btn(ACTION_LABELS.rerun, () => this.cb.onRerun()),
        ]),
      );
      footer.append(actions);
      return footer;
    }

    if (data.redirect) {
      // Same shape as below — the primary action, Skip, then the overflow. "Fill
      // this page instead" is an override of a verdict the user has not been
      // given reason to doubt, and as a third button it pushed the primary one
      // off the right edge at 390px.
      actions.append(
        btn(data.redirect.followed ? ACTION_LABELS.openApplicationAgain : ACTION_LABELS.openApplication, () => this.cb.onFollow(), true),
        skip,
        this.overflow([
          ...this.commonMenuItems(),
          btn(ACTION_LABELS.fillAnyway, () => this.cb.onFillAnyway()),
        ]),
      );
      footer.append(actions);
      return footer;
    }

    const apply = btn(ACTION_LABELS.apply, () => this.cb.onApply(), true);
    if (data.applyState !== 'ready') {
      this.retire(apply, data.applyState === 'noConfirmation'
        ? 'Apply — this site has no confirmation configured, press to find out why'
        : 'Apply — no Send button found on this page, press to find out why');
    }

    actions.append(
      apply,
      skip,
      this.overflow([
        ...this.commonMenuItems(),
        btn(ACTION_LABELS.rerun, () => this.cb.onRerun()),
      ]),
    );

    footer.append(actions);
    return footer;
  }

  /* ---------------- The flow banner ---------------- */

  /**
   * What happened, and what to do about it — the first thing in either view.
   *
   * This replaces three unrelated renderings that never appeared together and,
   * between them, still left the card silent in the commonest case: an `applied`
   * banner, a `redirect` notice further down the body, and an explanation of the
   * greyed-out Apply that only existed *after* the user pressed it. A posting
   * that was simply filled and waiting said nothing at all.
   *
   * `shared/flowState.ts` decides which state this is and words it; this only
   * draws it. The `applied` case additionally takes the `.cf-applied` class and
   * `role="status"`, both of which the E2E suite reads back.
   */
  private flowBanner(data: ModalData): HTMLElement {
    const flow = flowBanner({
      applyState: data.applyState,
      applied: data.applied,
      alreadyApplied: data.alreadyApplied,
      appliedAt: data.appliedAt,
      redirect: data.redirect,
      appLink: data.appLink,
      filled: data.matches.filter((m) => m.filled).length,
      total: data.matches.length,
      siteName: data.siteName,
    });

    // `.cf-applied` is what makes the card a receipt, and both applied states earn
    // it — the loudness is about a posting being finished, not about the instant a
    // confirmation landed.
    const done = flow.key === 'applied' || flow.key === 'alreadyApplied';
    const box = el('div', `cf-flow ${flow.tone}${done ? ' cf-applied' : ''}`);
    // A live region only where something genuinely arrived without the user
    // having moved focus. On the resting states it would announce the same
    // sentence after every Confirm — and on `alreadyApplied` there is nothing to
    // announce at all: the record was already there when the page opened.
    if (flow.key === 'applied') box.setAttribute('role', 'status');

    const head = el('div', 'cf-flow-head');
    // Status is never colour alone — the quiet states carry no dot because they
    // report no status, only where you are.
    if (flow.tone === 'ok' || flow.tone === 'warn') {
      const dot = el('span', `cf-dot ${flow.tone}`);
      dot.setAttribute('role', 'img');
      dot.setAttribute('aria-label', flow.tone === 'ok' ? 'applied' : 'unavailable');
      head.append(dot);
    }

    // The title line and the detail are the head's own children, not a wrapper's:
    // the head is a grid, and it is being a grid that centres the dot on the
    // title's row whatever height the `?` gives it.
    const titleLine = el('div', 'cf-flow-titleline');
    const title = el('b', 'cf-flow-title');
    title.textContent = flow.title;
    titleLine.append(title);
    const detail = el('span', 'cf-flow-detail');
    detail.textContent = flow.detail;
    head.append(titleLine, detail);

    // The long form stays behind a disclosure: the blocked states have a
    // paragraph's worth of explanation each, and rendering it inline filled the
    // card with prose before the user could reach the posting.
    //
    // It sits on the title's line rather than at the head's right edge: after a
    // `flex: 1` text block the `?` ended up a card's width away from the words
    // it explains, reading as a control belonging to the banner as a whole.
    if (flow.help) {
      titleLine.append(helpButton(flow.title, this.applyHelp, (open) => this.setApplyHelp(open)));
    }
    box.append(head);
    if (flow.help && this.applyHelp) box.append(helpPanel(CONCEPT_HELP[flow.help]));

    return box;
  }

  /* ---------------- The two views ---------------- */

  /** The posting. The default view, and the reason the modal is worth reading. */
  private jobBody(data: ModalData): HTMLElement {
    const body = el('div', 'cf-body');

    // Top of the body, above the title: the site's own confirmation is often
    // below the fold or hidden behind this very card, so "did that go through?"
    // was a question the user answered by scrolling around the page they sent.
    // The resting state is the exception and rides with the footer instead —
    // see `placeBanner`.
    const banner = this.flowBanner(data);
    if (!banner.classList.contains('quiet')) body.append(banner);

    if (data.jobTitle) {
      // Once the application is in, the posting is no longer the headline — it is
      // the receipt's subject line. `.cf-title` at 24px next to a 13px "sent"
      // banner said the opposite, which is why the confirmation was hard to find.
      const t = el('h2', `cf-title${isApplied(data) ? ' cf-title-sub' : ''}`);
      t.textContent = data.jobTitle;
      body.append(t);
    }

    // Company · location · type, the reference's lead under the title. Rendered only
    // from what the posting actually states (shared/jobMeta.ts), so a board that
    // publishes none of it gets no empty row rather than three blank chips.
    const meta = [data.meta?.company, data.meta?.location, data.meta?.employmentType]
      .filter((v): v is string => !!v);
    if (meta.length) {
      const row = el('div', 'cf-jobmeta');
      for (const value of meta) {
        const chip = el('span', 'chip accent');
        chip.textContent = value;
        row.append(chip);
      }
      body.append(row);
    }

    // The one thing left to tell someone whose application is in: that there is
    // nothing left to do here. Without it the card just stops, and a user who had
    // been told to review before applying kept looking for the next step.
    //
    // Two sentences, because the two states are answering different questions.
    // Fresh: "did that go through?" — yes, and you can close this. Revisited: "why
    // can I not do anything?" — because it is already done, and here is where to
    // change that if the record is wrong.
    if (isApplied(data)) {
      const done = el('p', 'cf-empty');
      done.textContent = data.applied
        ? 'Recorded as applied — safe to close this tab.'
        : 'Nothing to do here. Change the status in Options → Queue if this is wrong.';
      body.append(done);
    }

    if (data.redirect) {
      // The banner above already says where the application lives; this is the
      // detector's own evidence for having said so, kept small and last.
      const why = el('small', 'cf-why');
      why.textContent = data.redirect.reason;
      body.append(why);
    }

    const description = data.jobDescription ?? [];
    if (description.length) body.append(prose(description));

    const requirements = data.jobRequirements ?? [];
    if (requirements.length) {
      const label = el('div', 'cf-section');
      label.textContent = 'Requirements';
      body.append(label, prose(requirements));
    }

    if (!description.length && !requirements.length && !data.redirect) {
      const empty = el('p', 'cf-empty');
      empty.textContent = 'No description found on this page.';
      body.append(empty);
    }

    // The report at a glance, without leaving the Job view: filled / to-check /
    // unmatched as three tiles. A two-step posting has no report to summarize, so
    // it gets none. The Fields tab's summary line stays the greyscale fallback.
    if (!data.redirect && data.matches.length) body.append(this.statSummary(data.matches));

    return body;
  }

  /** The three-stat summary — the same counts the Fields summary line carries. */
  private statSummary(matches: FieldMatch[]): HTMLElement {
    const counts = statCounts(matches);
    const wrap = el('div', 'cf-stats');
    for (const status of ['high', 'low', 'none'] as const) {
      const tile = el('div', `cf-stat ${status}`);
      const n = el('div', 'cf-stat-n');
      n.textContent = String(counts[status]);
      const k = el('div', 'cf-stat-k');
      // The same dot the rows and the key carry: the tile's number is coloured
      // by status, and colour on its own is not a status anywhere else here.
      const dot = el('span', `cf-dot ${status}`);
      dot.setAttribute('role', 'img');
      dot.setAttribute('aria-label', STATUS_LABELS[status]);
      const word = el('span');
      word.textContent = STATUS_TEXT[status].tile;
      k.append(dot, word);
      tile.append(n, k);
      wrap.append(tile);
    }
    return wrap;
  }

  /** The fill report: what went in, what needs a look, what was never found. */
  private fieldsBody(data: ModalData): HTMLElement {
    const body = el('div', 'cf-body');
    // The same banner as the Job view. Switching tabs must not change what the
    // card claims has happened — the report's own legend would otherwise be the
    // only thing on screen talking about whether anything was sent.
    const banner = this.flowBanner(data);
    if (!banner.classList.contains('quiet')) body.append(banner);

    // The counts and the key are one line. Three colours and a row of buttons
    // mean nothing on their own, and as a separate legend under the rows the key
    // sat below sixteen of them — read, if at all, after the colours it explains.
    // Each count wears its own dot instead: icon, number, word. A status stays on
    // the line at zero, because this is a key as well as a tally.
    const counts = statCounts(data.matches);
    const summary = el('p', 'cf-summary');
    for (const status of ['high', 'low', 'none'] as const) {
      const dot = el('span', `cf-dot ${status}`);
      dot.setAttribute('role', 'img');
      dot.setAttribute('aria-label', STATUS_LABELS[status]);
      const label = el('span');
      // One vocabulary with the tiles and the rows — the words come from labels.ts.
      label.textContent = `${counts[status]} ${STATUS_TEXT[status].word}`;
      summary.append(dot, label);
    }
    body.append(summary);

    // Sorted here rather than in `main.ts`, and on every render: what a row needs
    // from the user outranks which field it is, and confirming or picking one
    // changes that — so the row leaving the top of the report is how the card
    // shows the work going down. See `orderReport`. The counts above and the tab
    // dot are aggregates, so neither cares about the order.
    const report = el('div', 'cf-report');
    for (const m of orderReport(data.matches)) report.append(this.row(m));
    body.append(report);

    // Only once it has been sent. "Nothing has been sent yet" now rides in the
    // footer next to Apply, and repeating it here — forty pixels above that same
    // sentence — was the report saying the same thing twice. What survives is the
    // part the footer cannot say: that this report is a record, not a plan.
    //
    // The two states cannot share the sentence. After a fresh send this report
    // really is the one that went in. On a revisit it is a *new* fill of the same
    // form, which happens to match because the profile has not changed — claiming
    // it as the submitted application would be inventing a record the extension
    // does not keep.
    if (isApplied(data)) {
      const sent = el('small', 'cf-legend-send');
      sent.textContent = data.applied
        ? 'Already sent — this report is what went in.'
        : 'Already applied — this is a fresh fill, not the application that was sent.';
      body.append(sent);
    }

    return body;
  }

  private pill(data: ModalData): HTMLElement {
    const pill = el('button', 'cf-pill');
    const filled = data.matches.filter((m) => m.filled).length;
    // Collapsed, the dot is the only status left on screen, so it has to carry
    // the same meaning as the rows it is hiding.
    const dot = el('span', `cf-dot ${isApplied(data) ? 'ok' : pillStatus(data, filled)}`);
    pill.setAttribute('aria-label', 'Reopen the fill report');
    const label = el('span');
    // Collapsed, this is the only thing left on screen — so once the posting is
    // sent, that is what it has to say. A fill count reads as unfinished work.
    label.textContent = data.applied ? 'Application sent'
      : data.alreadyApplied ? 'Already applied'
      : data.redirect ? 'External application'
      : `${filled}/${data.matches.length} filled`;
    pill.append(dot, label);
    pill.onclick = () => this.restore();
    return pill;
  }

  /**
   * Where this posting sits in the queue. Read-only on purpose: the footer's
   * "Skip → next" is the action, and a second Skip button here just duplicated
   * it a few pixels away.
   */
  private sessionStrip(session: SessionState): HTMLElement {
    const strip = el('div', 'cf-session');
    const text = el('span', 'cf-progress');
    const { done, total, applied, queued } = session.progress;
    text.textContent = `${done}/${total} done · ${applied} applied · ${queued} waiting`;
    strip.append(text);

    // The reference's `.qdots`: the same progress as a shape, so the strip reads as
    // a position in the queue and not only as a sentence. Aria-hidden — the sentence
    // beside it already says all of this, and a screen reader does not need it twice.
    const dots = progressDots(session.progress);
    if (dots.length) {
      const row = el('div', 'cf-qdots');
      row.setAttribute('aria-hidden', 'true');
      for (const kind of dots) row.append(el('span', `cf-qd ${kind}`));
      strip.append(row);
    }
    return strip;
  }

  /**
   * The two that are on every branch: where to configure this site, and where
   * everything else lives.
   *
   * They belong in the menu and not in the footer because they are about the
   * *extension*, not about this posting — the same rule that put Re-run here.
   * Before this the card was a dead end: a posting whose fields came out wrong
   * could only be fixed by closing the modal, opening the popup and pressing
   * Site setup from there.
   *
   * They *lead* every branch's menu, and that is a fact about which end of the
   * popover is near the hand rather than about their importance. The menu opens
   * upward (`.cf-more-menu` is anchored `bottom: 100%`), so the item last in DOM
   * order is the one sitting against the `⋯` the thumb has just pressed — the
   * cheapest place to reach, which belongs to Re-run rather than to the two
   * items that navigate away from the posting entirely.
   *
   * "Add links" used to be a third. It is the one errand here that has nothing
   * to do with the posting on screen — you do not queue up more postings from
   * inside one you are reviewing — and the popup's Queue button already opens
   * the importer from a surface you reach without a job page at all.
   */
  private commonMenuItems(): HTMLButtonElement[] {
    return [
      btn(ACTION_LABELS.openOptions, () => this.cb.onOpenOptions()),
      btn(ACTION_LABELS.siteSetup, () => this.cb.onOpenSetup()),
    ];
  }

  /**
   * Take a footer button out of service without taking away the press.
   *
   * `aria-disabled`, never the `disabled` property: a disabled button swallows
   * pointer events, so the one thing the user does about a grey control — press it
   * — could not answer them. It still takes the tap, and the tap opens the note.
   *
   * The name is spoken as well, because "unavailable" is true of the action but
   * would leave a screen-reader user with no idea that pressing it is still worth
   * doing. The visible label stays a prefix of `name`.
   */
  private retire(button: HTMLButtonElement, name: string): void {
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('aria-label', name);
    button.onclick = () => this.setApplyHelp(!this.applyHelp);
  }

  /** A "more" button whose menu holds the secondary footer actions. */
  private overflow(items: HTMLButtonElement[]): HTMLElement {
    const wrap = el('div', 'cf-more');
    const toggle = btn('⋯', () => {});
    toggle.setAttribute('aria-label', 'More actions');
    toggle.setAttribute('aria-expanded', 'false');
    const menu = el('div', 'cf-more-menu');
    (menu as HTMLElement).hidden = true;
    // Ghost inside the popover, as the reference's menu is: the menu already has a
    // border, and one around each item made it a stack of boxes. Applied here so
    // every caller's items match, rather than at each call site.
    const setOpen = (open: boolean) => {
      menu.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    };
    for (const item of items) {
      item.classList.add('btn-ghost');
      // Choosing an item closes the menu. Re-run rebuilds the card and took it
      // with it, so this never showed; the two ways out do not — they open
      // another tab and leave this one exactly as it was, and a menu still
      // hanging open over the report when the user comes back is the popover
      // having outlived the choice it was opened to make.
      const choose = item.onclick!;
      item.onclick = (e) => { setOpen(false); choose.call(item, e); };
    }
    menu.append(...items);
    toggle.onclick = (e) => {
      e.stopPropagation();
      setOpen(menu.hidden);
    };
    wrap.append(toggle, menu);
    return wrap;
  }

  private row(m: FieldMatch): HTMLElement {
    const status = matchStatus(m);
    const row = el('div', 'cf-row');
    const dot = el('span', `cf-dot ${status}`);
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', STATUS_LABELS[status]);
    row.append(dot);

    const field = el('div', 'cf-field');
    const name = el('b');
    name.textContent = FIELD_LABELS[m.field] ?? m.field;
    const detail = el('small');
    if (m.confidence === 'none') detail.textContent = 'not found';
    else if (m.field === 'resume') detail.textContent = m.filled ? 'CV attached' : (m.selectorUsed ?? 'file input');
    else detail.textContent = `${m.valueToFill ?? ''} · ${m.selectorUsed ?? ''}`.trim();
    detail.title = detail.textContent ?? '';
    field.append(name, detail);
    row.append(field);

    // The outcome in a word, beside the dot that colours it. Status was carried by
    // the dot alone, so reading a row meant knowing the key; the reference tags
    // every row, and the word comes from the same catalog the legend and the tiles
    // render from.
    const tag = el('span', `chip cf-tag ${TAG_TONE[status]}`);
    tag.textContent = STATUS_TEXT[status].word;
    row.append(tag);

    const actions = el('div', 'cf-actions');
    // Anything matched but not filled can be retried in place; only a field with
    // no element at all has nothing for Confirm to act on.
    // Secondary, deliberately: the reference draws every per-row action as a plain
    // button (design/reference/states-gallery.html), and the coral fill belongs to
    // the footer's Apply alone. As a primary, sixteen rows of Confirm outshouted
    // the one control that actually sends anything.
    if (!m.filled && m.confidence !== 'none') {
      actions.append(btn(ACTION_LABELS.confirm, () => this.cb.onConfirm(m.field)));
    }
    actions.append(btn(ACTION_LABELS.pick, () => this.cb.onPick(m.field)));
    row.append(actions);
    return row;
  }
}

/**
 * The pill's dot summarizes the whole report. A redirect notice has no fields to
 * summarize, so it stays neutral-positive: nothing failed, there was simply
 * nothing to fill.
 */
function pillStatus(data: ModalData, filled: number): MatchConfidence {
  if (data.redirect || data.matches.length === 0) return 'high';
  if (filled === data.matches.length) return 'high';
  return filled > 0 ? 'low' : 'none';
}

/**
 * The report split into its three buckets, keyed by the same `matchStatus` the
 * dots use — so the summary line, the stat tiles and the row dots can never
 * count a field into different columns. `high` = actually filled, `none` = no
 * field matched, `low` = everything left (a guess, or a confident match the
 * field would not take).
 */
function statCounts(matches: FieldMatch[]): Record<MatchConfidence, number> {
  const counts: Record<MatchConfidence, number> = { high: 0, low: 0, none: 0 };
  for (const m of matches) counts[matchStatus(m)] += 1;
  return counts;
}

/**
 * The worst outcome in the report — what the closed Fields tab has to advertise.
 * Green only when every field actually took its value.
 */
function worstStatus(matches: FieldMatch[]): MatchConfidence {
  if (!matches.length) return 'high';
  const statuses = matches.map(matchStatus);
  if (statuses.includes('none')) return 'none';
  return statuses.includes('low') ? 'low' : 'high';
}

/** Render extracted blocks as the prose they were on the page. */
function prose(blocks: JobBlock[]): HTMLElement {
  const wrap = el('div', 'cf-prose');
  for (const block of blocks) {
    if (block.kind === 'heading') {
      const h = document.createElement('h4');
      h.textContent = block.text;
      wrap.append(h);
    } else if (block.kind === 'list') {
      const ul = document.createElement('ul');
      for (const item of block.items) {
        const li = document.createElement('li');
        li.textContent = item;
        ul.append(li);
      }
      wrap.append(ul);
    } else {
      const p = document.createElement('p');
      p.textContent = block.text;
      wrap.append(p);
    }
  }
  return wrap;
}

function el(tag: string, className = ''): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function btn(text: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `cf-btn${primary ? ' primary' : ''}`;
  b.textContent = text;
  b.onclick = onClick;
  return b;
}
