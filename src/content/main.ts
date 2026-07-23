/**
 * Content-script orchestrator. On a matching page it waits for the form, runs
 * prep, extracts the job info, detects + fills fields (high-confidence only),
 * and shows the review modal. Never submits. Handles popup messages, the
 * modal's actions, and click-to-pick overrides.
 */

import type { FieldKey, FieldMatch, PrepAction, PrepStep, Profile, SiteConfig } from '../shared/types';
import { findMatchingConfig } from '../shared/matcher';
import { generateSelector } from '../shared/selector';
import { isExternalUrl } from '../shared/redirect';
import {
  getState, saveFieldOverride, clearFieldOverride,
  saveExtractSelector, clearExtractSelector, ensureConfigForUrl, mutateSiteConfig,
  saveRedirectSelector, clearRedirectSelector, type RedirectSelectorKey,
} from '../shared/storage';
import { BUILD_ID } from '../shared/buildId';
import { getCv, cvFileToFile } from '../shared/cvStore';
import { TEXT_FIELDS, FIELD_LABELS } from '../shared/fieldKeys';
import {
  MSG, type FollowRedirectResponse, type Message, type SessionState, type StatusResponse,
} from '../shared/messages';
import { hostOf } from '../shared/url';
import { waitForSelector } from './waitForForm';
import { runPrepSteps } from './prep';
import { extractJob, previewContainer } from './extract';
import { detectFields } from './fieldDetect';
import { detectRedirect, type RedirectDetection } from './redirectDetect';
import { fillTextField, fillFileInput, highlight, clearHighlights } from './fill';
import { startPicker } from './picker';
import { FillerModal } from './modal/modal';
import { SetupPanel, type ContainerKey, type SetupRow, type PrepRow, type PrepListKey } from './setupPanel';

const CONTAINER_LABELS: Record<ContainerKey, string> = {
  jobTitle: 'Job title',
  jobDescription: 'Description',
  jobRequirements: 'Requirements',
};

/** Redirect-classification selectors, in the order the setup panel lists them. */
const REDIRECT_ROWS: Array<{ key: RedirectSelectorKey; label: string }> = [
  { key: 'applySelector', label: 'External apply link' },
  { key: 'quickApplySelector', label: 'Quick-apply marker' },
  { key: 'markerSelector', label: 'External marker' },
];

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
  private submitArmed = false;
  private successObserver?: MutationObserver;
  /** Latest quick-apply vs. external-redirect verdict for this page. */
  private detection?: RedirectDetection;
  /** The handoff has been triggered once; don't fire it again on a re-run. */
  private followed = false;
  /** The user overrode a redirect verdict and wants this page filled. */
  private fillAnyway = false;
  /** Board posting this page was reached from, when it is a tracked destination. */
  private landedFrom?: string;
  /** Queue-session snapshot, refreshed per run so the modal can show progress. */
  private session?: SessionState;

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
    if (this.submitArmed) return;
    this.submitArmed = true;
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
      postingKind: this.detection?.kind,
      redirectHref: this.detection?.href,
      landedFrom: this.landedFrom,
      modalMinimized: this.modal?.isMinimized ?? false,
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
      case MSG.SHOW_REPORT:
        this.modal?.restore();
        sendResponse(this.status());
        return;
      case MSG.REDIRECT_LANDED:
        await this.onRedirectLanded(msg.sourceUrl);
        sendResponse(this.status());
        return;
      default:
        sendResponse(this.status());
    }
  }

  /**
   * Full flow: wait -> prep -> classify -> (follow handoff | detect -> fill) -> modal.
   *
   * Boards mix two shapes of posting, so the branch is per page: a posting whose
   * apply button leaves for the employer's own ATS has no form to fill here, and
   * gets handed off (and recorded) instead.
   */
  async run(): Promise<void> {
    if (!this.config) return;
    const config = this.config;

    // Refresh profile + CV each run (user may have edited them).
    const state = await getState();
    this.profile = state.profile;
    this.config = findMatchingConfig(location.href, state.siteConfigs) ?? config;

    const cv = await getCv();
    this.cvFile = cv ? cvFileToFile(cv) : null;
    this.session = await this.fetchSession();

    if (config.waitFor) await waitForSelector(config.waitFor, config.waitTimeoutMs ?? 15000);
    await runPrepSteps(config.prep);

    const detection = detectRedirect({
      root: document,
      pageUrl: location.href,
      config: this.config!.redirect,
    });
    this.detection = detection;

    if (this.shouldFollow(detection)) {
      this.hasRun = true;
      await this.followRedirect(detection);
      return;
    }

    this.detectAndFill();
    this.showModal();
    this.hasRun = true;
  }

  /* ---------------- Two-step (redirect) postings ---------------- */

  private shouldFollow(det: RedirectDetection): boolean {
    if (det.kind !== 'redirect' || this.fillAnyway) return false;
    // Setup mode is for inspecting the page, not leaving it.
    if (this.setupPanel) return false;
    // Never bounce straight back to the board that sent us here.
    if (this.landedFrom && det.href && !isExternalUrl(this.landedFrom, det.href)) return false;
    return true;
  }

  /**
   * Hand off to the external application: do the board's own bookkeeping first
   * (typically clicking "Save job" so the site records the application on its
   * side), then let the background open + track the destination.
   */
  private async followRedirect(det: RedirectDetection): Promise<void> {
    this.showModal();
    if (this.followed) return;
    this.followed = true;
    console.info(LOG, 'external application —', det.reason);

    // Board-side bookkeeping must never block the handoff: a missing Save button
    // (not signed in, markup changed) is a warning, not a dead end.
    const steps = this.config?.redirect?.beforeFollow ?? [];
    await runPrepSteps(steps.map((s) => ({ ...s, optional: true })));

    let resp: FollowRedirectResponse | undefined;
    try {
      resp = await chrome.runtime.sendMessage({
        type: MSG.FOLLOW_REDIRECT, sourceUrl: location.href, href: det.href,
      });
    } catch (e) {
      console.warn(LOG, 'follow-redirect message failed', e);
    }
    this.showModal();

    if (resp?.navigate) { location.href = resp.navigate; return; }
    if (resp?.click) det.element?.click();
  }

  /** The user disagrees with the redirect verdict: fill this page after all. */
  private async fillHere(): Promise<void> {
    this.fillAnyway = true;
    await this.run();
  }

  /**
   * This tab is where a tracked handoff landed. Adopt the provenance, and if the
   * destination ATS has no config of its own, create one so the ordinary
   * heuristics can fill it now and the site is set up for next time.
   */
  private async onRedirectLanded(sourceUrl: string): Promise<void> {
    this.landedFrom = sourceUrl;
    if (!this.config) {
      this.config = await ensureConfigForUrl(location.href);
      this.setupSubmitDetection();
      console.info(LOG, 'redirect destination — created config', this.config.id);
    }
    if (!this.hasRun) await this.run();
    else this.showModal();
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

  /** Ask the background where this posting sits in the queue session, if any. */
  private async fetchSession(): Promise<SessionState | undefined> {
    try {
      return await chrome.runtime.sendMessage({ type: MSG.SESSION_STATE });
    } catch {
      return undefined;
    }
  }

  /** Mark this posting skipped; the background closes the tab and opens the next. */
  private skipPosting(): void {
    chrome.runtime.sendMessage({ type: MSG.SESSION_SKIP, url: location.href })
      .catch((e) => console.warn(LOG, 'skip failed', e));
  }

  private showModal(): void {
    if (!this.modal) {
      this.modal = new FillerModal({
        onRerun: () => this.run(),
        onReset: () => this.reset(),
        onSubmitCv: () => this.submitCv(),
        onConfirm: (field) => this.confirmField(field),
        onPick: (field) => this.pick(field),
        onFollow: () => { this.followed = false; void this.followRedirect(this.detection!); },
        onFillAnyway: () => this.fillHere(),
        onSkip: () => this.skipPosting(),
        // Collapse to the pill rather than destroying the report: the fills stay
        // in place and the modal is one tap away, instead of only reachable
        // through a Reset & Re-run that would wipe them.
        onClose: () => this.modal?.minimize(),
      });
    }
    const job = extractJob(this.config!);
    const det = this.detection;
    const isRedirect = det?.kind === 'redirect' && !this.fillAnyway;
    this.modal.render({
      siteName: this.config!.name,
      jobTitle: job.title,
      jobDescription: job.description,
      jobRequirements: job.requirements,
      matches: this.matches,
      canSubmitCv: !!this.config!.submitCv?.length,
      redirect: isRedirect
        ? { host: det!.href ? hostOf(det!.href) : undefined, reason: det!.reason, followed: this.followed }
        : undefined,
      via: this.landedFrom ? hostOf(this.landedFrom) : undefined,
      session: this.session,
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
        onAddPrep: (action, list) => this.addPrep(action, list),
        onPickPrepTarget: (i, list) => this.pickPrepTarget(i, list),
        onMovePrep: (i, dir, list) => this.movePrep(i, dir, list),
        onRemovePrep: (i, list) => this.removePrep(i, list),
        onSetPrepMs: (i, ms, list) => this.setPrepMs(i, ms, list),
        onRunPrep: () => this.runPrep(),
        onPickContainer: (key) => this.pickContainer(key),
        onClearContainer: (key) => this.clearContainer(key),
        onPickField: (field) => this.pickFieldForSetup(field),
        onClearField: (field) => this.clearFieldForSetup(field),
        onPickRedirect: (key) => this.pickRedirect(key as RedirectSelectorKey),
        onClearRedirect: (key) => this.clearRedirect(key as RedirectSelectorKey),
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
    const toPrepRows = (steps: PrepStep[] | undefined): PrepRow[] => (steps ?? []).map((s) => ({
      action: s.action,
      selector: s.selector,
      ms: s.ms,
      resolves: s.selector ? safeQuery(s.selector) != null : undefined,
    }));
    const prep = toPrepRows(config.prep);
    const beforeFollow = toPrepRows(config.redirect?.beforeFollow);

    // How this posting applies: quick-apply here, or a handoff to the employer.
    const detection = detectRedirect({ root: document, pageUrl: location.href, config: config.redirect });
    this.detection = detection;
    const verdict = detection.kind === 'redirect'
      ? `External application — ${detection.reason}`
      : detection.kind === 'quickApply'
        ? `Quick apply — ${detection.reason}`
        : `Quick apply (assumed) — ${detection.reason}`;
    if (detection.element) highlight(detection.element, detection.kind === 'redirect' ? 'high' : 'low');

    const redirectRows: SetupRow[] = REDIRECT_ROWS.map(({ key, label }) => {
      const saved = config.redirect?.[key];
      const el = saved ? safeQuery(saved) : null;
      const usedHere = detection.source === 'override' && key === 'applySelector' && !!detection.href;
      return {
        key,
        label,
        status: saved ? (el ? 'high' : 'low') : 'none',
        note: !saved ? 'not set'
          : !el ? 'saved selector · no match'
          : usedHere && detection.href ? `saved · → ${hostOf(detection.href)}`
          : `saved · ${saved}`,
        hasSave: !!saved,
      };
    });

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
      verdict,
      redirect: redirectRows,
      beforeFollow,
    });
  }

  private pickRedirect(key: RedirectSelectorKey): void {
    this.pickInto(REDIRECT_ROWS.find((r) => r.key === key)!.label, async (el) => {
      if (this.config) await saveRedirectSelector(this.config.id, key, generateSelector(el));
    });
  }

  private async clearRedirect(key: RedirectSelectorKey): Promise<void> {
    if (this.config) await clearRedirectSelector(this.config.id, key);
    await this.refreshSetup();
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

  /** Read-modify-write one of the config's step arrays (pre-fill or pre-handoff). */
  private async mutatePrep(fn: (prep: PrepStep[]) => void, list: PrepListKey = 'prep'): Promise<void> {
    if (!this.config) return;
    await mutateSiteConfig(this.config.id, (c) => {
      if (list === 'beforeFollow') {
        const steps = [...(c.redirect?.beforeFollow ?? [])];
        fn(steps);
        c.redirect = { ...c.redirect, beforeFollow: steps };
        return;
      }
      const prep = [...(c.prep ?? [])];
      fn(prep);
      c.prep = prep;
    });
  }

  /** Add a step. Selector-based actions launch the picker to choose their target. */
  private addPrep(action: PrepAction, list: PrepListKey): void {
    if (action === 'delay') {
      void this.mutatePrep((p) => { p.push({ action: 'delay', ms: 500 }); }, list).then(() => this.refreshSetup());
      return;
    }
    this.pickInto(`step target (${action})`, (el) =>
      this.mutatePrep((p) => { p.push({ action, selector: generateSelector(el) }); }, list));
  }

  private pickPrepTarget(index: number, list: PrepListKey): void {
    this.pickInto('step target', (el) =>
      this.mutatePrep((p) => {
        if (p[index]) p[index] = { ...p[index], selector: generateSelector(el) };
      }, list));
  }

  private async movePrep(index: number, dir: -1 | 1, list: PrepListKey): Promise<void> {
    await this.mutatePrep((p) => {
      const j = index + dir;
      if (j < 0 || j >= p.length) return;
      [p[index], p[j]] = [p[j], p[index]];
    }, list);
    await this.refreshSetup();
  }

  private async removePrep(index: number, list: PrepListKey): Promise<void> {
    await this.mutatePrep((p) => { p.splice(index, 1); }, list);
    await this.refreshSetup();
  }

  private async setPrepMs(index: number, ms: number, list: PrepListKey): Promise<void> {
    await this.mutatePrep((p) => { if (p[index]) p[index] = { ...p[index], ms }; }, list);
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
