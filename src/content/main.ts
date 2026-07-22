/**
 * Content-script orchestrator. On a matching page it waits for the form, runs
 * prep, extracts the job info, detects + fills fields (high-confidence only),
 * and shows the review modal. Never submits. Handles popup messages, the
 * modal's actions, and click-to-pick overrides.
 */

import type { FieldKey, FieldMatch, PrepAction, PrepStep, Profile, SiteConfig } from '../shared/types';
import { findMatchingConfig } from '../shared/matcher';
import { generateSelector } from '../shared/selector';
import {
  getState, saveFieldOverride, clearFieldOverride,
  saveExtractSelector, clearExtractSelector, ensureConfigForUrl, mutateSiteConfig,
} from '../shared/storage';
import { BUILD_ID } from '../shared/buildId';
import { getCv, cvFileToFile } from '../shared/cvStore';
import { TEXT_FIELDS, FIELD_LABELS } from '../shared/fieldKeys';
import { MSG, type Message, type StatusResponse } from '../shared/messages';
import { waitForSelector } from './waitForForm';
import { runPrepSteps } from './prep';
import { extractJob, previewContainer } from './extract';
import { detectFields } from './fieldDetect';
import { fillTextField, fillFileInput, highlight, clearHighlights } from './fill';
import { startPicker } from './picker';
import { FillerModal } from './modal/modal';
import { SetupPanel, type ContainerKey, type SetupRow, type PrepRow } from './setupPanel';

const CONTAINER_LABELS: Record<ContainerKey, string> = {
  jobTitle: 'Job title',
  jobDescription: 'Description',
  jobRequirements: 'Requirements',
};

const LOG = '[chromium-filler]';

class Controller {
  private config?: SiteConfig;
  private profile: Profile = { values: {}, custom: {} };
  private cvFile: File | null = null;
  private matches: FieldMatch[] = [];
  private elements = new Map<FieldKey, HTMLElement>();
  private modal?: FillerModal;
  private setupPanel?: SetupPanel;
  private cancelPicker?: () => void;
  private hasRun = false;
  private submitReported = false;
  private successObserver?: MutationObserver;

  async init(): Promise<void> {
    console.info(`${LOG} content script ready — v${chrome.runtime.getManifest().version} · build ${BUILD_ID}`);
    const state = await getState();
    this.profile = state.profile;
    this.config = findMatchingConfig(location.href, state.siteConfigs);

    chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
      this.handleMessage(msg, sendResponse);
      return true; // async response
    });

    if (this.config) {
      this.setupSubmitDetection();
      if (state.settings.autoRunOnLoad) {
        this.run().catch((e) => console.error(LOG, 'auto-run failed', e));
      }
    }
  }

  /**
   * Detects that the application was *actually sent* — we never submit for the
   * user, so this watches for their submission completing. Detecting "sent"
   * reliably is the hard part, so the policy is deliberate:
   *
   *  - If the config defines `successSelector`, THAT is the authoritative signal:
   *    we close only when the confirmation element appears. A bare `submit` event
   *    is ignored, because AJAX submissions fire it before the server responds
   *    and may still fail — we must not close a tab on a failed attempt.
   *  - If no `successSelector` is set, we fall back to the form `submit` event.
   *    This suits full-page-navigation flows, where the tab leaves before any
   *    in-page confirmation could render, so the submit event is all we get.
   *
   * Either way we report once; the background marks the URL applied and, if the
   * setting is on, closes the tab after the configured delay.
   */
  private setupSubmitDetection(): void {
    const report = () => {
      if (this.submitReported) return;
      this.submitReported = true;
      this.successObserver?.disconnect();
      chrome.runtime.sendMessage({ type: MSG.SUBMITTED, url: location.href });
    };

    const selector = this.config?.successSelector;
    if (selector) {
      // Authoritative: wait for the confirmation element to be VISIBLE. Presence
      // alone is not enough — sites commonly pre-render a hidden success node and
      // only reveal it after the server confirms.
      const check = () => {
        const el = safeQuery(selector);
        if (el && isVisible(el)) { report(); return true; }
        return false;
      };
      if (check()) return;
      this.successObserver = new MutationObserver(() => check());
      // Observe both structure and the attributes that flip visibility, since the
      // reveal is often a style/class/hidden change on an existing element.
      this.successObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden'],
      });
    } else {
      // Fallback: best-effort for navigation flows with no in-page confirmation.
      document.addEventListener('submit', report, true);
    }
  }

  private status(): StatusResponse {
    return {
      siteMatched: !!this.config,
      siteName: this.config?.name,
      configId: this.config?.id,
      filledCount: this.matches.filter((m) => m.filled).length,
      reportedCount: this.matches.length,
      hasRun: this.hasRun,
    };
  }

  private async handleMessage(msg: Message, sendResponse: (r: unknown) => void): Promise<void> {
    switch (msg.type) {
      case MSG.STATUS:
        sendResponse(this.status());
        return;
      case MSG.RUN:
        await this.run();
        sendResponse(this.status());
        return;
      case MSG.RESET:
        this.reset();
        sendResponse(this.status());
        return;
      case MSG.PICK:
        this.pick(msg.field);
        sendResponse(this.status());
        return;
      case MSG.SETUP:
        await this.openSetup();
        sendResponse(this.status());
        return;
      default:
        sendResponse(this.status());
    }
  }

  /** Full flow: wait -> prep -> extract -> detect -> fill -> modal. */
  async run(): Promise<void> {
    if (!this.config) return;
    const config = this.config;

    // Refresh profile + CV each run (user may have edited them).
    const state = await getState();
    this.profile = state.profile;
    this.config = findMatchingConfig(location.href, state.siteConfigs) ?? config;

    const cv = await getCv();
    this.cvFile = cv ? cvFileToFile(cv) : null;

    if (config.waitFor) await waitForSelector(config.waitFor, config.waitTimeoutMs ?? 15000);
    await runPrepSteps(config.prep);

    this.detectAndFill();
    this.showModal();
    this.hasRun = true;
  }

  private wantedFields(): FieldKey[] {
    const text = Object.entries(this.profile.values)
      .filter(([, v]) => v != null && v !== '')
      .map(([k]) => k as FieldKey);
    if (this.cvFile) text.push('resume');
    return text;
  }

  private detectAndFill(): void {
    const config = this.config!;
    clearHighlights();
    this.elements.clear();

    const detected = detectFields({
      root: document,
      fields: this.wantedFields(),
      overrides: config.fieldOverrides,
      autoDetect: config.autoDetect !== false,
    });
    // Resume override lives on cvUpload.
    if (config.cvUpload) {
      const el = safeQuery(config.cvUpload);
      const resume = detected.find((d) => d.field === 'resume');
      if (el && resume) { resume.element = el; resume.source = 'override'; resume.confidence = 'high'; resume.selectorUsed = config.cvUpload; }
    }

    this.matches = detected.map((d) => {
      const value = d.field === 'resume' ? undefined : this.profile.values[d.field];
      const selectorUsed = d.selectorUsed ?? (d.element ? generateSelector(d.element) : undefined);
      const required = d.element
        ? d.element.hasAttribute('required') || d.element.getAttribute('aria-required') === 'true'
        : false;
      const match: FieldMatch = {
        field: d.field,
        source: d.source,
        confidence: d.confidence,
        selectorUsed,
        valueToFill: value,
        filled: false,
        required,
      };
      if (d.element) {
        this.elements.set(d.field, d.element);
        if (d.confidence === 'high') match.filled = this.applyFill(d.field, d.element);
        highlight(d.element, match.filled ? 'high' : d.confidence);
      }
      return match;
    });
  }

  /** Fill a single field's element from profile/CV. Returns whether it filled. */
  private applyFill(field: FieldKey, el: HTMLElement): boolean {
    if (field === 'resume') {
      if (!this.cvFile || !(el instanceof HTMLInputElement)) return false;
      return fillFileInput(el, this.cvFile);
    }
    const value = this.profile.values[field];
    if (value == null || value === '') return false;
    return fillTextField(el, value);
  }

  private showModal(): void {
    if (!this.modal) {
      this.modal = new FillerModal({
        onRerun: () => this.run(),
        onReset: () => this.reset(),
        onSubmitCv: () => this.submitCv(),
        onConfirm: (field) => this.confirmField(field),
        onPick: (field) => this.pick(field),
        onClose: () => this.modal?.destroy(),
      });
    }
    const job = extractJob(this.config!);
    this.modal.render({
      siteName: this.config!.name,
      jobTitle: job.title,
      jobDescription: job.description,
      jobRequirements: job.requirements,
      matches: this.matches,
      canSubmitCv: !!this.config!.submitCv?.length,
    });
  }

  private confirmField(field: FieldKey): void {
    const el = this.elements.get(field);
    if (!el) return;
    const ok = this.applyFill(field, el);
    const m = this.matches.find((x) => x.field === field);
    if (m) m.filled = ok;
    highlight(el, ok ? 'high' : 'low');
    this.showModal();
  }

  private pick(field: FieldKey): void {
    this.cancelPicker?.();
    const label = field;
    this.cancelPicker = startPicker(async (el) => {
      const control = resolveControl(el, field === 'resume');
      if (this.config) await saveFieldOverride(this.config.id, field, generateSelector(control));
      await this.run();
    }, String(label));
  }

  /* ---------------- On-page Setup mode ---------------- */

  /** Enter visual setup: ensure a config exists for this URL, then show the panel. */
  private async openSetup(): Promise<void> {
    const isNew = !this.config;
    this.config = await ensureConfigForUrl(location.href);
    if (isNew) this.setupSubmitDetection();

    if (!this.setupPanel) {
      this.setupPanel = new SetupPanel({
        onAddPrep: (action) => this.addPrep(action),
        onPickPrepTarget: (i) => this.pickPrepTarget(i),
        onMovePrep: (i, dir) => this.movePrep(i, dir),
        onRemovePrep: (i) => this.removePrep(i),
        onSetPrepMs: (i, ms) => this.setPrepMs(i, ms),
        onRunPrep: () => this.runPrep(),
        onPickContainer: (key) => this.pickContainer(key),
        onClearContainer: (key) => this.clearContainer(key),
        onPickField: (field) => this.pickFieldForSetup(field),
        onClearField: (field) => this.clearFieldForSetup(field),
        onRename: (name, pattern) => this.renameConfig(name, pattern),
        onOpenOptions: () => chrome.runtime.sendMessage({ type: MSG.OPEN_OPTIONS }),
        onClose: () => this.closeSetup(),
      });
    }
    await this.refreshSetup();
  }

  private closeSetup(): void {
    this.cancelPicker?.();
    clearHighlights();
    this.setupPanel?.destroy();
    this.setupPanel = undefined;
  }

  /**
   * Recompute the panel from the live DOM + config. Beyond saved selectors this
   * also runs the same heuristics as the fill flow, so already-matchable fields
   * and containers show up (green/yellow) and get outlined on the page — the
   * user only needs to Pick the ones that stay grey.
   */
  private async refreshSetup(): Promise<void> {
    if (!this.setupPanel || !this.config) return;
    // Re-read the config so freshly-saved selectors show up.
    const fresh = findMatchingConfig(location.href, (await getState()).siteConfigs);
    if (fresh) this.config = fresh;
    const config = this.config;

    clearHighlights();

    // Prerequisite steps, in run order.
    const prep: PrepRow[] = (config.prep ?? []).map((s) => ({
      action: s.action,
      selector: s.selector,
      ms: s.ms,
      resolves: s.selector ? safeQuery(s.selector) != null : undefined,
    }));

    // Job-info containers: explicit selector, else generic fallback (auto).
    const containers: SetupRow[] = (['jobTitle', 'jobDescription', 'jobRequirements'] as ContainerKey[])
      .map((key) => {
        const p = previewContainer(config, key);
        if (p.el) highlight(p.el, 'high');
        const snippet = p.text ? clip(p.text, 50) : '';
        const saved = !!config.extract[key];
        const note = p.source === 'override' ? `saved · ${snippet}`
          : p.source === 'auto' ? `auto · ${snippet}`
          : p.source === 'override-miss' ? 'saved selector · no match'
          : 'not set';
        return {
          key,
          label: CONTAINER_LABELS[key],
          status: p.el ? 'high' : 'none',
          note,
          hasSave: saved,
        };
      });

    // Form fields: run detection (overrides + heuristics) exactly like the fill flow.
    const detected = detectFields({
      root: document,
      fields: [...TEXT_FIELDS, 'resume' as FieldKey],
      overrides: config.fieldOverrides,
      autoDetect: config.autoDetect !== false,
    });
    if (config.cvUpload) {
      const el = safeQuery(config.cvUpload);
      const resume = detected.find((d) => d.field === 'resume');
      if (el && resume) { resume.element = el; resume.source = 'override'; resume.confidence = 'high'; resume.selectorUsed = config.cvUpload; }
    }

    const fields: SetupRow[] = detected.map((d) => {
      const fillable = d.element ? isFillable(d.element, d.field === 'resume') : false;
      // A saved override that points at a non-fillable node (e.g. a label/div)
      // resolves but can't be filled — surface it as a warning, not false-green.
      const status = d.element && !fillable ? 'low' : d.confidence;
      if (d.element) highlight(d.element, status);
      const hasSave = d.field === 'resume' ? !!config.cvUpload : !!config.fieldOverrides?.[d.field];
      const where = d.element ? (d.selectorUsed ?? generateSelector(d.element)) : '';
      const note = d.element && !fillable ? `not a form field — re-pick · ${where}`
        : d.source === 'override' ? `saved · ${where}`
        : d.source === 'heuristic' ? `auto${d.confidence === 'low' ? ' (low)' : ''} · ${where}`
        : 'not found';
      return {
        key: d.field,
        label: FIELD_LABELS[d.field],
        status,
        note,
        hasSave,
      };
    });

    this.setupPanel.render({
      name: config.name,
      urlPattern: config.urlPatterns[0] ?? '',
      prep,
      containers,
      fields,
    });
  }

  private pickContainer(key: ContainerKey): void {
    this.pickInto(CONTAINER_LABELS[key], async (el) => {
      if (this.config) await saveExtractSelector(this.config.id, key, generateSelector(el));
    });
  }

  private async clearContainer(key: ContainerKey): Promise<void> {
    if (this.config) await clearExtractSelector(this.config.id, key);
    await this.refreshSetup();
  }

  private pickFieldForSetup(field: FieldKey): void {
    this.pickInto(FIELD_LABELS[field], async (el) => {
      // The user may click a label/wrapper; save the actual fillable control.
      const control = resolveControl(el, field === 'resume');
      if (this.config) await saveFieldOverride(this.config.id, field, generateSelector(control));
    });
  }

  private async clearFieldForSetup(field: FieldKey): Promise<void> {
    if (this.config) await clearFieldOverride(this.config.id, field);
    await this.refreshSetup();
  }

  private async renameConfig(name: string, pattern: string): Promise<void> {
    if (!this.config) return;
    await mutateSiteConfig(this.config.id, (c) => {
      if (name) c.name = name;
      if (pattern) c.urlPatterns[0] = pattern;
    });
    await this.refreshSetup();
  }

  /* --- Prerequisite steps --- */

  /** Read-modify-write the config's prep array. */
  private async mutatePrep(fn: (prep: PrepStep[]) => void): Promise<void> {
    if (!this.config) return;
    await mutateSiteConfig(this.config.id, (c) => {
      const prep = [...(c.prep ?? [])];
      fn(prep);
      c.prep = prep;
    });
  }

  /** Add a step. Selector-based actions launch the picker to choose their target. */
  private addPrep(action: PrepAction): void {
    if (action === 'delay') {
      void this.mutatePrep((p) => { p.push({ action: 'delay', ms: 500 }); }).then(() => this.refreshSetup());
      return;
    }
    this.pickInto(`step target (${action})`, (el) =>
      this.mutatePrep((p) => { p.push({ action, selector: generateSelector(el) }); }));
  }

  private pickPrepTarget(index: number): void {
    this.pickInto('step target', (el) =>
      this.mutatePrep((p) => { if (p[index]) p[index] = { ...p[index], selector: generateSelector(el) }; }));
  }

  private async movePrep(index: number, dir: -1 | 1): Promise<void> {
    await this.mutatePrep((p) => {
      const j = index + dir;
      if (j < 0 || j >= p.length) return;
      [p[index], p[j]] = [p[j], p[index]];
    });
    await this.refreshSetup();
  }

  private async removePrep(index: number): Promise<void> {
    await this.mutatePrep((p) => { p.splice(index, 1); });
    await this.refreshSetup();
  }

  private async setPrepMs(index: number, ms: number): Promise<void> {
    await this.mutatePrep((p) => { if (p[index]) p[index] = { ...p[index], ms }; });
    await this.refreshSetup();
  }

  /** Run the saved steps now so the form/description appears, then re-scan the page. */
  private async runPrep(): Promise<void> {
    if (!this.config) return;
    try {
      await runPrepSteps(this.config.prep);
    } catch (e) {
      console.warn(LOG, 'setup: prep run failed', e);
    }
    await this.refreshSetup();
  }

  /**
   * Run the picker for setup: hide the panel so it can't be picked by accident,
   * hand the chosen element to `onPick`, then restore + rescan. The panel is
   * re-highlighted by `refreshSetup`, so callers only persist.
   */
  private pickInto(label: string, onPick: (el: Element) => Promise<void>): void {
    this.cancelPicker?.();
    this.setupPanel?.setHidden(true);
    const restore = () => this.setupPanel?.setHidden(false);
    this.cancelPicker = startPicker(async (el) => {
      await onPick(el);
      restore();
      await this.refreshSetup();
    }, label, restore);
  }

  private async submitCv(): Promise<void> {
    if (!this.config?.submitCv?.length) return;
    await runPrepSteps(this.config.submitCv);
    this.detectAndFill();
    this.showModal();
  }

  private reset(): void {
    this.cancelPicker?.();
    clearHighlights();
    for (const [field, el] of this.elements) {
      const m = this.matches.find((x) => x.field === field);
      if (m?.filled && field !== 'resume' && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
        fillTextField(el, '');
      }
    }
    this.elements.clear();
    this.matches = [];
    this.hasRun = false;
    this.modal?.destroy();
    this.modal = undefined;
  }
}

function safeQuery(selector: string): HTMLElement | null {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

/** Truncate to `n` chars with an ellipsis. */
function clip(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n)}…` : text;
}

const TEXTLIKE_SELECTOR =
  'input:not([type=file]):not([type=hidden]):not([type=submit]):not([type=button])' +
  ':not([type=reset]):not([type=image]):not([type=checkbox]):not([type=radio]),' +
  'textarea, select, [contenteditable=""], [contenteditable=true]';

/** True when an element can actually receive a fill (text control, or file input for the CV). */
function isFillable(el: Element, forFile: boolean): boolean {
  return forFile ? el.matches('input[type=file]') : el.matches(TEXTLIKE_SELECTOR);
}

/**
 * The user may pick a label or a wrapper instead of the input itself. Resolve to
 * the real fillable control: the label's target, a descendant control, or the
 * nearest control in the surrounding field group. Falls back to the picked node.
 */
function resolveControl(el: Element, forFile: boolean): Element {
  const sel = forFile ? 'input[type=file]' : TEXTLIKE_SELECTOR;
  if (el.matches(sel)) return el;
  if (el instanceof HTMLLabelElement && el.control?.matches(sel)) return el.control;
  const inside = el.querySelector(sel);
  if (inside) return inside;
  const wrapper = el.closest('label, [class*="field" i], [class*="form-group" i], [class*="input" i]');
  const near = wrapper?.querySelector(sel);
  if (near) return near;
  return el;
}

/** True when an element is actually rendered (not display:none/hidden/zero-box). */
function isVisible(el: HTMLElement): boolean {
  if (el.hidden) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  return el.getClientRects().length > 0;
}

const controller = new Controller();
controller.init().catch((e) => console.error(LOG, 'init failed', e));
