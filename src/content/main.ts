/**
 * Content-script orchestrator, on every page.
 *
 * The fill engine (`fillEngine.ts`) does the work: every input on the page goes
 * past it, and keeps going past it as the page changes. This file connects it to
 * everything else — the profile, the lessons and the documents in storage, the
 * review card, the queue chip, the popup's messages — and owns the one decision
 * the engine cannot make: whether to show anything at all.
 *
 * It never sends anything. Nothing in this file presses a site's button; the user
 * does that, on the site, when they are ready.
 */

import type { FieldId, Lesson, ModalLayout, Profile, Settings } from '../shared/types';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS } from '../shared/defaults';
import { getState, mutateLessons, mutateProfile } from '../shared/storage';
import { BUILD_ID } from '../shared/buildId';
import { getDoc, cvFileToFile } from '../shared/cvStore';
import { fieldChoices, newCustomField } from '../shared/profileFields';
import { newLessonId, recordHits, teach } from '../shared/lessons';
import { uniqueSignature } from '../shared/inputSignature';
import { hostOf } from '../shared/url';
import { MSG, type Message, type QueueTabState, type StatusResponse } from '../shared/messages';
import { FillEngine } from './fillEngine';
import { startPicker } from './picker';
import { FillerModal, type TeachChoice } from './modal/modal';
import { QueueChip } from './queueChip';

const LOG = '[chromium-filler]';

/** Lesson hits are counted in storage at most this often — a long form fills in bursts. */
const HITS_FLUSH_MS = 2_000;

const DOC_KEYS = ['cv', 'coverLetterFile'];

/** How long after load the page asks a second time whether the queue opened it. */
const QUEUE_RECHECK_MS = 1_500;

class Controller {
  private profile: Profile = DEFAULT_PROFILE;
  private lessons: Lesson[] = [];
  private settings: Settings = DEFAULT_SETTINGS;
  private cvFile: File | null = null;
  private coverFile: File | null = null;
  private engine: FillEngine;
  private modal?: FillerModal;
  private chip?: QueueChip;
  private queue: QueueTabState = { inQueue: false };
  /** The job database has this URL down as done. Re-read on every storage change. */
  private alreadyDone = false;
  private doneAt?: number;
  /** Rows Confirm has been pressed on — an acknowledgement, never a status. */
  private confirmed = new Set<string>();
  private cancelPicker?: () => void;
  /** Where the user dragged the card *on this page*. Never persisted. */
  private draggedLayout?: ModalLayout;
  /** The user asked for the card (popup Fill, Teach, the chip) — show it whatever it holds. */
  private wanted = false;
  /** `openCardWhenFilled` has opened the card on this page. Once only: a × after it is the user's word. */
  private autoOpened = false;
  private pendingHits: string[] = [];
  private hitsTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.engine = new FillEngine({
      profile: () => this.profile,
      lessons: () => this.lessons,
      docs: () => ({ cv: this.cvFile, cover: this.coverFile }),
      onReport: () => this.onReport(),
      onLessonHits: (ids) => this.countHits(ids),
      showLabels: () => this.wanted || this.queue.inQueue,
    });
  }

  async init(): Promise<void> {
    console.info(`${LOG} content script ready — v${chrome.runtime.getManifest().version} · build ${BUILD_ID}`);
    await this.loadState();
    await this.loadDocs();

    chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
      this.handleMessage(msg, sendResponse);
      return true; // async response
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') void this.onStorageChanged(Object.keys(changes));
    });

    this.queue = (await this.ask<QueueTabState>({ type: MSG.QUEUE_TAB })) ?? { inQueue: false };
    if (this.queue.inQueue) this.showChip();
    // Asked once more a moment later: a fast page can load before the session has
    // finished writing down that it opened this tab.
    else setTimeout(() => void this.recheckQueue(), QUEUE_RECHECK_MS);

    if (this.settings.fillAutomatically) {
      this.engine.start();
      this.engine.sweep();
    }
  }

  private async loadState(): Promise<void> {
    const state = await getState();
    this.profile = state.profile;
    this.lessons = state.lessons;
    this.settings = state.settings;
    const entry = state.jobUrls.find((e) => e.url === location.href);
    this.alreadyDone = entry?.status === 'done';
    this.doneAt = this.alreadyDone
      ? entry?.history.filter((e) => e.status === 'done').at(-1)?.at
      : undefined;
  }

  /** The CV and the cover letter as real `File`s. */
  private async loadDocs(): Promise<void> {
    const [cv, cover] = await Promise.all([getDoc('resume'), getDoc('coverLetter')]);
    this.cvFile = cv ? cvFileToFile(cv) : null;
    this.coverFile = cover ? cvFileToFile(cover) : null;
  }

  /**
   * Something changed in Options, or on another tab: a new detail, a new field, a
   * lesson taught elsewhere. Every open row on this page gets another look — the
   * engine never moves a row, and never writes into a box that already has an answer.
   */
  private async onStorageChanged(keys: string[]): Promise<void> {
    const relevant = keys.some((k) => ['profile', 'lessons', 'settings', 'jobUrls', ...DOC_KEYS].includes(k));
    if (!relevant) return;
    // A lesson hit is a write this page made; reading it back is not news.
    if (keys.length === 1 && keys[0] === 'lessons' && this.hitsInFlight) return;
    await this.loadState();
    if (keys.some((k) => DOC_KEYS.includes(k))) await this.loadDocs();
    if (this.engine.hasRun) this.engine.reconsider();
    else this.render();
  }

  private status(): StatusResponse {
    const rows = this.engine.rows;
    return {
      filledCount: rows.filter((r) => r.filled).length,
      reportedCount: rows.length,
      toTeach: rows.filter((r) => !r.field && !r.ignored).length,
      hasRun: this.engine.hasRun,
      modalMinimized: this.modal?.isMinimized ?? false,
      inQueue: this.queue.inQueue,
    };
  }

  private async handleMessage(msg: Message, sendResponse: (r: unknown) => void): Promise<void> {
    switch (msg.type) {
      case MSG.STATUS:
        sendResponse(this.status());
        return;
      case MSG.RUN:
        await this.fillNow();
        sendResponse(this.status());
        return;
      case MSG.RESET:
        this.reset();
        sendResponse(this.status());
        return;
      case MSG.TEACH:
        this.point();
        sendResponse(this.status());
        return;
      case MSG.SHOW_REPORT:
        this.wanted = true;
        this.render();
        this.modal?.restore();
        sendResponse(this.status());
        return;
      default:
        sendResponse(this.status());
    }
  }

  /**
   * The popup's Fill and the card's Fill again: sweep now, whatever the setting
   * says, and show the card. With `fillAutomatically` off this is the only way a
   * page is ever filled, so it also starts the watch — the user has asked for this
   * page, and a form that opens a moment later is part of what they asked for.
   */
  private async fillNow(): Promise<void> {
    await this.loadState();
    await this.loadDocs();
    this.wanted = true;
    this.engine.start();
    // A fresh look at everything still open, then anything new.
    this.engine.reconsider();
    this.engine.sweep();
    this.render();
    this.modal?.restore();
  }

  /* ---------------- Showing it ---------------- */

  /**
   * The engine reported. Whether to show anything is this file's call:
   *
   *   - something was filled, or the user asked → the card exists, folded to its pill
   *   - something was filled, with `openCardWhenFilled` → it opens expanded, once
   *   - a queue tab → the pill, as soon as there is a row
   *   - otherwise → nothing at all. A page with a search box and a newsletter field
   *     the extension did not recognise is not a page to put a pill on.
   */
  private onReport(): void {
    this.render();
  }

  private shouldShow(): boolean {
    if (this.wanted || this.modal) return true;
    const rows = this.engine.rows;
    if (this.queue.inQueue) return rows.length > 0;
    return rows.some((r) => r.filled);
  }

  private render(): void {
    if (!this.shouldShow()) return;
    const first = !this.modal;
    if (!this.modal) {
      this.modal = new FillerModal({
        onRerun: () => void this.fillNow(),
        onConfirm: (id) => this.confirm(id),
        onTeach: (id, choice) => void this.teach(id, choice),
        onPoint: () => this.point(),
        onSkip: () => this.skipPosting(),
        onClose: () => this.modal?.minimize(),
        onFold: () => this.chip?.setCardOpen(!this.modal?.isMinimized),
        onLayoutChange: (layout) => { this.draggedLayout = layout; },
      });
      if (!this.wanted) this.modal.minimize();
    }

    this.modal.render({
      siteName: hostOf(location.href),
      matches: this.engine.rows,
      confirmed: [...this.confirmed],
      alreadyDone: this.alreadyDone,
      doneAt: this.doneAt,
      profileEmpty: this.profileEmpty(),
      choices: fieldChoices(this.profile),
      queue: this.queue.inQueue && this.queue.progress
        ? { active: true, batchSize: 0, progress: this.queue.progress }
        : undefined,
      layout: this.draggedLayout ?? this.settings.modalLayout,
    });
    // Decided on every report, not when the card is made: the first sweep of a
    // page often fills nothing, and the form behind "Apply now" arrives later.
    if (first) this.chip?.setCardOpen(!this.modal.isMinimized);
    if (this.settings.openCardWhenFilled && !this.autoOpened && this.engine.rows.some((r) => r.filled)) {
      this.autoOpened = true;
      this.modal.restore();
    }
  }

  private profileEmpty(): boolean {
    const p = this.profile;
    return !Object.values(p.values).some((v) => v)
      && !(p.customFields ?? []).some((f) => f.value)
      && !this.cvFile && !this.coverFile;
  }

  private async recheckQueue(): Promise<void> {
    const state = await this.ask<QueueTabState>({ type: MSG.QUEUE_TAB });
    if (!state?.inQueue || this.queue.inQueue) return;
    this.queue = state;
    this.showChip();
    this.render();
  }

  private showChip(): void {
    this.chip = new QueueChip(() => {
      this.wanted = true;
      this.render();
      this.modal?.restore();
    });
    this.chip.render(this.queue.progress);
  }

  /* ---------------- The card's actions ---------------- */

  private confirm(id: string): void {
    if (this.engine.confirm(id)) this.confirmed.add(id);
    this.render();
  }

  /**
   * Teach one row. A new field is made first, so the lesson has something to point
   * at; then the lesson is keyed on the shortest signature that names this input
   * alone among every input on the page (`uniqueSignature`), stored, and applied —
   * which fills the row in place.
   */
  private async teach(id: string, choice: TeachChoice): Promise<void> {
    const cand = this.engine.candidateFor(id);
    if (!cand) return;

    let target: { field: FieldId } | { ignore: true };
    if ('newField' in choice) {
      const field = newCustomField(choice.newField.label, 'text', choice.newField.value);
      this.profile = await mutateProfile((p) => ({ ...p, customFields: [...(p.customFields ?? []), field] }));
      target = { field: field.id };
    } else {
      target = choice;
    }

    const all = this.engine.allCandidates();
    const index = all.findIndex((c) => c.el === cand.el);
    if (index < 0) return;
    const host = hostOf(location.href);
    const signature = uniqueSignature(all.map((c) => c.parts), index, host);
    const lessonId = newLessonId();
    this.lessons = await mutateLessons((list) => teach(list, {
      signature,
      target,
      label: cand.question || 'Unlabelled field',
      taughtOn: host,
    }, Date.now(), lessonId));
    this.engine.applyTeaching(id, target, lessonId);
    // The same lesson may answer other open rows here — the second "Given name" on
    // page two, say. Nothing filled moves.
    this.engine.reconsider();
  }

  /**
   * Point at a field the report did not list, then teach it. The card gets out of
   * the way first: the picker reads `elementFromPoint`, which would land on it.
   */
  private point(): void {
    this.cancelPicker?.();
    this.modal?.setHidden(true);
    const restore = () => this.modal?.setHidden(false);
    this.cancelPicker = startPicker((el) => {
      restore();
      const control = resolveControl(el) as HTMLElement;
      this.wanted = true;
      if (!this.engine.hasRun) this.engine.sweep({ fill: false });
      const row = this.engine.rowForElement(control);
      this.render();
      if (row) this.modal?.openTeach(row.id);
      else this.modal?.restore();
    }, 'field to teach', restore);
  }

  /**
   * Mark this posting done; the background closes the tab and opens the next.
   * Refuses on a posting already done — there is nothing left for it to finish.
   */
  private skipPosting(): void {
    if (this.alreadyDone) return;
    chrome.runtime.sendMessage({ type: MSG.SESSION_SKIP, url: this.queue.url ?? location.href })
      .catch((e) => console.warn(LOG, 'skip failed', e));
  }

  /* ---------------- Lesson hits ---------------- */

  private hitsInFlight = false;

  private countHits(ids: string[]): void {
    this.pendingHits.push(...ids);
    if (this.hitsTimer) return;
    this.hitsTimer = setTimeout(() => {
      this.hitsTimer = undefined;
      const batch = this.pendingHits.splice(0);
      this.hitsInFlight = true;
      void mutateLessons((list) => recordHits(list, batch))
        .then((list) => { this.lessons = list; })
        .catch((e) => console.warn(LOG, 'lesson hits not counted', e))
        .finally(() => { setTimeout(() => { this.hitsInFlight = false; }, 0); });
    }, HITS_FLUSH_MS);
  }

  /* ---------------- Helpers ---------------- */

  private async ask<T>(message: Message): Promise<T | undefined> {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch {
      return undefined;
    }
  }

  /**
   * Empty what was filled and start the report over. Reached only from the popup's
   * "Reset & Re-run", where starting over is what the button is for — never from
   * the card, whose job is showing what was filled.
   */
  private reset(): void {
    this.cancelPicker?.();
    this.engine.reset();
    this.confirmed.clear();
    this.wanted = false;
    this.autoOpened = false;
    this.modal?.destroy();
    this.modal = undefined;
    this.chip?.setCardOpen(false);
  }
}

const CONTROL = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]),'
  + 'textarea, select, [contenteditable=""], [contenteditable=true]';

/**
 * The user may pick a label or a wrapper instead of the input itself. Resolve to
 * the real control: the label's target, a descendant control, or the nearest
 * control in the surrounding field group. Falls back to the picked node.
 */
function resolveControl(el: Element): Element {
  if (el.matches(CONTROL)) return el;
  if (el instanceof HTMLLabelElement && el.control?.matches(CONTROL)) return el.control;
  const inside = el.querySelector(CONTROL);
  if (inside) return inside;
  const wrapper = el.closest('label, fieldset, [class*="field" i], [class*="form-group" i], [class*="question" i], [class*="input" i]');
  const near = wrapper?.querySelector(CONTROL);
  if (near) return near;
  return el;
}

const controller = new Controller();
controller.init().catch((e) => console.error(LOG, 'init failed', e));
