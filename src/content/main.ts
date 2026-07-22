/**
 * Content-script orchestrator. On a matching page it waits for the form, runs
 * prep, extracts the job info, detects + fills fields (high-confidence only),
 * and shows the review modal. Never submits. Handles popup messages, the
 * modal's actions, and click-to-pick overrides.
 */

import type { FieldKey, FieldMatch, Profile, SiteConfig } from '../shared/types';
import { findMatchingConfig } from '../shared/matcher';
import { generateSelector } from '../shared/selector';
import { getState, saveFieldOverride } from '../shared/storage';
import { getCv, cvFileToFile } from '../shared/cvStore';
import { MSG, type Message, type StatusResponse } from '../shared/messages';
import { waitForSelector } from './waitForForm';
import { runPrepSteps } from './prep';
import { extractJob } from './extract';
import { detectFields } from './fieldDetect';
import { fillTextField, fillFileInput, highlight, clearHighlights } from './fill';
import { startPicker } from './picker';
import { FillerModal } from './modal/modal';

const LOG = '[chromium-filler]';

class Controller {
  private config?: SiteConfig;
  private profile: Profile = { values: {}, custom: {} };
  private cvFile: File | null = null;
  private matches: FieldMatch[] = [];
  private elements = new Map<FieldKey, HTMLElement>();
  private modal?: FillerModal;
  private cancelPicker?: () => void;
  private hasRun = false;

  async init(): Promise<void> {
    const state = await getState();
    this.profile = state.profile;
    this.config = findMatchingConfig(location.href, state.siteConfigs);

    chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
      this.handleMessage(msg, sendResponse);
      return true; // async response
    });

    if (this.config && state.settings.autoRunOnLoad) {
      this.run().catch((e) => console.error(LOG, 'auto-run failed', e));
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
      const selector = generateSelector(el);
      if (this.config) await saveFieldOverride(this.config.id, field, selector);
      await this.run();
    }, String(label));
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

const controller = new Controller();
controller.init().catch((e) => console.error(LOG, 'init failed', e));
