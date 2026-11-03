/**
 * Content-script orchestrator, on every page and in every frame.
 *
 * The fill engine (`fillEngine.ts`) does the work: every input on the page goes
 * past it, and keeps going past it as the page changes. This file connects it to
 * everything else — the profile, the lessons and the documents in storage, the
 * review card, the queue chip, the popup's messages — and owns the decisions the
 * engine cannot make: what to learn from an answer the user typed, whether the
 * extension is on at all, and whether to show anything.
 *
 * In a subframe — an embedded application form — it fills and learns exactly as
 * in the top frame, but draws nothing: its rows travel to the top frame's card
 * (`MSG.FRAME_REPORT`), because a card inside a 600px iframe is not where anyone
 * looks.
 *
 * It never sends anything. Nothing in this file presses a site's button; the user
 * does that, on the site, when they are ready.
 */

import type { FieldId, FieldMatch, Lesson, LessonTarget, ModalLayout, Profile, Settings } from '../shared/types';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS } from '../shared/defaults';
import { getState, mutateLessons, mutateProfile, mutateTypedAnswers, setFillingOn } from '../shared/storage';
import { BUILD_ID } from '../shared/buildId';
import { getDoc, cvFileToFile } from '../shared/cvStore';
import { fieldLabel, fieldValue, setFieldValue } from '../shared/profileFields';
import { newLessonId, recordHits, teach } from '../shared/lessons';
import { uniqueSignature } from '../shared/inputSignature';
import { decideLearning, learningPolicy, normalizeAnswer } from '../shared/learning';
import { recordAnswer } from '../shared/typedAnswers';
import { hostOf } from '../shared/url';
import { MSG, type Message, type QueueTabState, type StatusResponse } from '../shared/messages';
import { FillEngine, type UserAnswer } from './fillEngine';
import type { Candidate } from './fieldDetect';
import { fieldsAnswering } from './answer';
import { clearHighlights } from './fill';
import { FillerModal, type ModalData } from './modal/modal';
import { QueueChip } from './queueChip';

const LOG = '[chromium-filler]';

/** Lesson hits are counted in storage at most this often — a long form fills in bursts. */
const HITS_FLUSH_MS = 2_000;

const DOC_KEYS = ['cv', 'coverLetterFile'];

/** How long after load the page asks a second time whether the queue opened it. */
const QUEUE_RECHECK_MS = 1_500;

/** How long the pill names a field it just learned. */
const LEARNED_FLASH_MS = 2_500;
/** How long a saved correction is named, with its Undo — long enough to reach for it. */
const UNDO_FLASH_MS = 6_000;
/** How long the pill says "Paused" after the card's switch, before it goes. */
const PAUSED_FLASH_MS = 4_000;
/** A subframe's report is sent at most this often — a sweep reports in bursts. */
const FRAME_REPORT_MS = 250;

/** Only the top frame draws. A subframe fills, learns and reports upward. */
const IS_TOP = window === window.top;

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
  /** Where the user dragged the card *on this page*. Never persisted. */
  private draggedLayout?: ModalLayout;
  /** The user asked for the card (popup Fill, the chip) — show it whatever it holds. */
  private wanted = false;
  /** `openCardWhenFilled` has opened the card on this page. Once only: a × after it is the user's word. */
  private autoOpened = false;
  /** The engine is running on this page — the switch is on, or the user pressed Fill. */
  private running = false;
  /** The card's own switch turned the extension off — this page says so before it goes. */
  private pausingHere = false;
  /** What the pill says for a moment instead of the counts. */
  private flash?: ModalData['flash'];
  private flashTimer?: ReturnType<typeof setTimeout>;
  private pendingHits: string[] = [];
  private hitsTimer?: ReturnType<typeof setTimeout>;
  /** Answers are learned one at a time: each is a read-modify-write of storage. */
  private learning: Promise<void> = Promise.resolve();
  /** The last answer recorded per input — a box counts once per value per page. */
  private recorded = new WeakMap<Element, string>();
  /** Embedded forms' rows, by `frameId:doc`, in the order they first reported. */
  private frameRows = new Map<string, FieldMatch[]>();
  /** This document, as the top frame tells a frame's successive pages apart. */
  private readonly doc = Math.random().toString(36).slice(2, 10);
  private frameTimer?: ReturnType<typeof setTimeout>;
  /** A field just learned in this frame, for the top frame's pill. */
  private learnedForTop?: string;
  /** A correction just saved in this frame, for the top frame's pill and its Undo. */
  private savedForTop?: { label: string; token: string };
  /**
   * The last correction this frame saved to the profile — what Undo puts back. Kept
   * by the frame that saved it, because only that frame holds the input whose
   * lesson Undo writes.
   */
  private lastSave?: {
    token: string; rowId: string; cand: Candidate; lessonId?: string;
    field: FieldId; previous?: string; next: string;
  };
  /** The top frame: the correction the pill's Undo is offered for, wherever it was saved. */
  private undoToken?: string;

  constructor() {
    this.engine = new FillEngine({
      profile: () => this.profile,
      lessons: () => this.lessons,
      docs: () => ({ cv: this.cvFile, cover: this.coverFile }),
      onReport: () => this.onReport(),
      onLessonHits: (ids) => this.countHits(ids),
      onAnswer: (a) => this.onAnswer(a),
    });
  }

  async init(): Promise<void> {
    if (IS_TOP) console.info(`${LOG} content script ready — v${chrome.runtime.getManifest().version} · build ${BUILD_ID}`);
    await this.loadState();
    await this.loadDocs();

    chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => this.handleMessage(msg, sendResponse));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') void this.onStorageChanged(Object.keys(changes));
    });

    this.queue = (await this.ask<QueueTabState>({ type: MSG.QUEUE_TAB })) ?? { inQueue: false };
    if (this.queue.inQueue) this.showChip();
    // Asked once more a moment later: a fast page can load before the session has
    // finished writing down that it opened this tab.
    else setTimeout(() => void this.recheckQueue(), QUEUE_RECHECK_MS);

    if (this.settings.fillAutomatically) this.startEngine();
  }

  private startEngine(): void {
    this.running = true;
    this.engine.start();
    this.engine.repaint();
    this.engine.sweep();
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
   * lesson learned elsewhere — or the on/off switch. Every open row on this page
   * gets another look; the engine never moves a row, and never writes into a box
   * that already has an answer.
   */
  private async onStorageChanged(keys: string[]): Promise<void> {
    const relevant = keys.some((k) => ['profile', 'lessons', 'settings', 'jobUrls', ...DOC_KEYS].includes(k));
    if (!relevant) return;
    // A lesson hit is a write this page made; reading it back is not news.
    if (keys.length === 1 && keys[0] === 'lessons' && this.hitsInFlight) return;
    const wasOn = this.settings.fillAutomatically;
    await this.loadState();
    if (keys.some((k) => DOC_KEYS.includes(k))) await this.loadDocs();
    const on = this.settings.fillAutomatically;
    if (wasOn && !on) { this.pause(); return; }
    if (!wasOn && on) { this.resume(); return; }
    if (this.engine.hasRun) this.engine.reconsider();
    else this.render();
  }

  /**
   * Switched off — from the popup, the card, or another tab of this browser. Stop
   * watching, stop learning, take every mark off the page. What was filled stays
   * filled: pausing is not undoing. The report is kept in the engine, so switching
   * back on brings the same card back.
   */
  private pause(): void {
    this.running = false;
    this.engine.stop();
    clearHighlights();
    this.wanted = false;
    if (!this.modal) return;
    if (this.pausingHere) {
      // The switch was pressed on this card: say so where the user is looking, then go.
      this.pausingHere = false;
      this.modal.minimize();
      this.setFlash({ paused: true }, PAUSED_FLASH_MS, () => {
        if (!this.settings.fillAutomatically) this.dropCard();
      });
      return;
    }
    this.dropCard();
  }

  private resume(): void {
    this.startEngine();
    this.render();
  }

  private dropCard(): void {
    this.modal?.destroy();
    this.modal = undefined;
    this.chip?.setCardOpen(false);
  }

  /* ---------------- Learning ---------------- */

  private onAnswer(a: UserAnswer): void {
    this.learning = this.learning
      .then(() => this.learn(a))
      .catch((e) => console.warn(LOG, 'could not learn from an answer', e));
  }

  /**
   * The user committed an answer. `decideLearning` says what it means: a lesson
   * linking the question to the profile field it equals, a "leave it alone" when
   * they replaced our fill with something unrelated, a record of an answer no
   * field holds — or nothing. The box is never written: it holds the user's answer.
   */
  private async learn(a: UserAnswer): Promise<void> {
    const matches = fieldsAnswering(this.profile, a.cand, { cv: this.cvFile, cover: this.coverFile });
    const decision = decideLearning(
      { kind: a.cand.kind, value: a.answer, matches, before: a.before },
      learningPolicy(this.settings),
    );

    if (decision.lesson) {
      const target = decision.lesson;
      const learned = await this.teachAt(a.cand, a.rowId, a.lessonId, target);
      if (learned && 'field' in target) this.announceLearned(fieldLabel(this.profile, target.field));
    }

    if (decision.update) await this.saveCorrection(a, decision.update.field);

    if (decision.record) {
      const key = normalizeAnswer(a.answer);
      if (this.recorded.get(a.cand.el) !== key) {
        this.recorded.set(a.cand.el, key);
        await mutateTypedAnswers((list) => recordAnswer(list, {
          value: a.answer,
          question: a.cand.question,
          kind: a.cand.kind,
          field: decision.record!.field,
        }, Date.now()));
      }
    }
  }

  /**
   * A lesson for this input. A row a lesson decided keeps that lesson's signature,
   * so the new target replaces the old one — a fresh, less specific signature would
   * sit beside it and the old, more specific lesson would keep winning.
   */
  private async teachAt(cand: Candidate, rowId: string, lessonId: string | undefined, target: LessonTarget): Promise<boolean> {
    const host = hostOf(location.href);
    const previous = lessonId ? this.lessons.find((l) => l.id === lessonId) : undefined;
    let signature = previous?.signature;
    if (!signature) {
      const all = this.engine.allCandidates();
      const index = all.findIndex((c) => c.el === cand.el);
      if (index >= 0) signature = uniqueSignature(all.map((c) => c.parts), index, host);
    }
    if (!signature) return false;
    const id = newLessonId();
    this.lessons = await mutateLessons((list) => teach(list, {
      signature: signature!,
      target,
      label: cand.question || 'Unlabelled field',
      taughtOn: host,
    }, Date.now(), id));
    this.engine.learned(rowId, target, id);
    return true;
  }

  /**
   * The user corrected what we filled: the field takes their answer, in the profile
   * (stamped, so it syncs). The pill names it and offers Undo for a moment.
   */
  private async saveCorrection(a: UserAnswer, field: FieldId): Promise<void> {
    const previous = fieldValue(this.profile, field);
    this.profile = await mutateProfile((p) => setFieldValue(p, field, a.answer));
    this.engine.saved(a.rowId, field, a.answer);
    const token = Math.random().toString(36).slice(2, 10);
    this.lastSave = { token, rowId: a.rowId, cand: a.cand, lessonId: a.lessonId, field, previous, next: a.answer };
    const label = fieldLabel(this.profile, field);
    if (IS_TOP) this.offerUndo(label, token);
    else { this.savedForTop = { label, token }; this.onReport(); }
  }

  private offerUndo(label: string, token: string): void {
    this.undoToken = token;
    this.setFlash({ saved: label, undo: true }, UNDO_FLASH_MS, () => {
      if (this.undoToken === token) this.undoToken = undefined;
      this.render();
    });
  }

  /** The pill's Undo, in the top frame: the frame that saved the correction undoes it. */
  private undo(): void {
    const token = this.undoToken;
    if (!token) return;
    this.undoToken = undefined;
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = undefined;
    this.flash = undefined;
    this.render();
    if (this.lastSave?.token === token) this.undoSave(token);
    else chrome.runtime.sendMessage({ type: MSG.UNDO_TAB, token }).catch(() => {});
  }

  /**
   * Put the detail back — unless it has changed again since — and stop filling the
   * box it was typed into: a correction undone says the box was not that field (a
   * referee's name typed over yours), not that the profile was wrong.
   */
  private undoSave(token: string): void {
    const save = this.lastSave;
    if (!save || save.token !== token) return;
    this.lastSave = undefined;
    this.learning = this.learning
      .then(async () => {
        this.profile = await mutateProfile((p) =>
          normalizeAnswer(fieldValue(p, save.field) ?? '') === normalizeAnswer(save.next)
            ? setFieldValue(p, save.field, save.previous ?? '')
            : p);
        await this.teachAt(save.cand, save.rowId, save.lessonId, { ignore: true });
      })
      .catch((e) => console.warn(LOG, 'could not undo', e));
  }

  /** "Learned · Email" on the pill — in this frame's card, or the top frame's. */
  private announceLearned(label: string): void {
    if (IS_TOP) this.setFlash({ learned: label }, LEARNED_FLASH_MS);
    else { this.learnedForTop = label; this.onReport(); }
  }

  private setFlash(flash: ModalData['flash'], ms: number, then?: () => void): void {
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flash = flash;
    this.render();
    this.flashTimer = setTimeout(() => {
      this.flash = undefined;
      this.flashTimer = undefined;
      if (then) then();
      else this.render();
    }, ms);
  }

  /* ---------------- Messages ---------------- */

  private status(): StatusResponse {
    const rows = this.allRows();
    return {
      filledCount: rows.filter((r) => r.filled).length,
      reportedCount: rows.length,
      fresh: rows.filter((r) => !r.field && !r.ignored && !r.answered).length,
      hasRun: this.engine.hasRun || this.frameRows.size > 0,
      modalMinimized: this.modal?.isMinimized ?? false,
      inQueue: this.queue.inQueue,
    };
  }

  /**
   * Returns whether a response will follow. A subframe acts on RUN and RESET but
   * never answers: the popup's question is about the page, and the top frame — which
   * holds every frame's rows — is the one that can answer it.
   */
  private handleMessage(msg: Message, sendResponse: (r: unknown) => void): boolean {
    const reply = (work?: Promise<void> | void) => {
      if (!IS_TOP) return false;
      void Promise.resolve(work).then(() => sendResponse(this.status()));
      return true;
    };
    switch (msg.type) {
      case MSG.RUN:
        return reply(this.fillNow());
      case MSG.RESET:
        return reply(this.reset());
      case MSG.STATUS:
        return reply();
      case MSG.SHOW_REPORT:
        if (!IS_TOP) return false;
        this.wanted = true;
        this.render();
        this.modal?.restore();
        return reply();
      case MSG.FRAME_REPORT:
        if (IS_TOP) this.takeFrameReport(msg);
        return false;
      case MSG.UNDO_SAVE:
        this.undoSave(msg.token);
        return false;
      default:
        return false;
    }
  }

  /** An embedded form reported. Its rows keep their place after this frame's own. */
  private takeFrameReport(msg: Extract<Message, { type: typeof MSG.FRAME_REPORT }>): void {
    const key = `${msg.frameId ?? 0}:${msg.doc}`;
    this.frameRows.set(key, msg.rows.map((r) => ({ ...r, id: `${key}:${r.id}` })));
    if (msg.saved) this.offerUndo(msg.saved.label, msg.saved.token);
    else if (msg.learned) this.setFlash({ learned: msg.learned }, LEARNED_FLASH_MS);
    else this.render();
  }

  private allRows(): FieldMatch[] {
    return [...this.engine.rows, ...[...this.frameRows.values()].flat()];
  }

  /**
   * The popup's Fill and the card's Fill again: sweep now, whatever the switch
   * says, and show the card. With the extension off this is the only way a page is
   * ever filled, so it also starts the watch — the user has asked for this page, and
   * a form that opens a moment later is part of what they asked for.
   */
  private async fillNow(): Promise<void> {
    await this.loadState();
    await this.loadDocs();
    this.wanted = true;
    this.running = true;
    this.engine.start();
    // A fresh look at everything still open, then anything new.
    this.engine.reconsider();
    this.engine.sweep();
    this.render();
    this.modal?.restore();
  }

  /* ---------------- Showing it ---------------- */

  /** The engine reported. A subframe passes it up; the top frame draws it. */
  private onReport(): void {
    if (!IS_TOP) { this.reportToTop(); return; }
    this.render();
  }

  private reportToTop(): void {
    if (this.frameTimer) return;
    this.frameTimer = setTimeout(() => {
      this.frameTimer = undefined;
      const learned = this.learnedForTop;
      const saved = this.savedForTop;
      this.learnedForTop = undefined;
      this.savedForTop = undefined;
      chrome.runtime.sendMessage({
        type: MSG.FRAME_REPORT,
        doc: this.doc,
        rows: this.engine.rows,
        ...(learned ? { learned } : {}),
        ...(saved ? { saved } : {}),
      }).catch(() => {});
    }, FRAME_REPORT_MS);
  }

  /**
   * Whether to draw anything — the top frame's call, and the one place
   * `showActivePill` is read:
   *
   *   - the user asked, or the card already exists → it stays
   *   - the extension is on and `showActivePill` → the pill, on every page, so the
   *     user can always tell it is filling and learning
   *   - a queue tab → the pill, as soon as there is a row
   *   - something was filled → the pill
   *   - otherwise → nothing at all
   */
  private shouldShow(): boolean {
    if (!IS_TOP) return false;
    if (this.wanted || this.modal) return true;
    if (this.running && this.settings.fillAutomatically && this.settings.showActivePill) return true;
    const rows = this.allRows();
    if (this.queue.inQueue) return rows.length > 0;
    return rows.some((r) => r.filled);
  }

  private render(): void {
    if (!this.shouldShow()) return;
    const first = !this.modal;
    if (!this.modal) {
      this.modal = new FillerModal({
        onRerun: () => this.fillTab(),
        onSkip: () => this.skipPosting(),
        onToggle: (on) => this.toggle(on),
        onClose: () => this.modal?.minimize(),
        onUndo: () => this.undo(),
        onFold: () => this.chip?.setCardOpen(!this.modal?.isMinimized),
        onLayoutChange: (layout) => { this.draggedLayout = layout; },
      });
      if (!this.wanted) this.modal.minimize();
    }

    const rows = this.allRows();
    this.modal.render({
      siteName: hostOf(location.href),
      matches: rows,
      alreadyDone: this.alreadyDone,
      doneAt: this.doneAt,
      profileEmpty: this.profileEmpty(),
      on: this.settings.fillAutomatically,
      flash: this.flash,
      queue: this.queue.inQueue && this.queue.progress
        ? { active: true, batchSize: 0, progress: this.queue.progress }
        : undefined,
      layout: this.draggedLayout ?? this.settings.modalLayout,
    });
    // Decided on every report, not when the card is made: the first sweep of a
    // page often fills nothing, and the form behind "Apply now" arrives later.
    if (first) this.chip?.setCardOpen(!this.modal.isMinimized);
    if (this.settings.openCardWhenFilled && !this.autoOpened && rows.some((r) => r.filled)) {
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
    if (!IS_TOP) return;
    this.chip = new QueueChip(() => {
      this.wanted = true;
      this.render();
      this.modal?.restore();
    });
    this.chip.render(this.queue.progress);
  }

  /* ---------------- The card's actions ---------------- */

  /** Fill again, in every frame of the tab — an embedded form included. */
  private fillTab(): void {
    chrome.runtime.sendMessage({ type: MSG.FILL_TAB }).catch(() => void this.fillNow());
  }

  /**
   * The card's switch. Off is the popup's off: every tab on this browser stands
   * down, through the settings change (`onStorageChanged` → `pause`). This page is
   * the one that says so first.
   */
  private toggle(on: boolean): void {
    if (!on) this.pausingHere = true;
    setFillingOn(on).catch((e) => console.warn(LOG, 'could not switch', e));
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
   * "Reset this page", where starting over is what the button is for — never from
   * the card, whose job is showing what was filled.
   */
  private reset(): void {
    this.engine.reset();
    this.wanted = false;
    this.autoOpened = false;
    this.frameRows.clear();
    if (!IS_TOP) { this.reportToTop(); return; }
    this.dropCard();
    this.render();
  }
}

const controller = new Controller();
controller.init().catch((e) => console.error(LOG, 'init failed', e));
