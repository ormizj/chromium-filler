/**
 * Content-script orchestrator. On a matching page it waits for the form, runs
 * prep, extracts the job info, detects + fills fields (high-confidence only),
 * and shows the review modal. It never sends anything on its own: the modal's
 * Apply presses the site's Send button, and only because the user pressed Apply.
 * Handles popup messages, the modal's actions, and click-to-pick overrides.
 */

import type {
  FieldKey, FieldMatch, JobUrlEntry, ModalLayout, PrepAction, PrepStep, Profile, Settings,
  SiteConfig,
} from '../shared/types';
import { statusForUrl } from '../shared/jobUrls';
import { findMatchingConfig } from '../shared/matcher';
import { generateSelector } from '../shared/selector';
import { isExternalUrl } from '../shared/redirect';
import { DEFAULT_SETTINGS } from '../shared/defaults';
import {
  getState, getSettings, patchSettings, saveFieldOverride, clearFieldOverride,
  saveExtractSelector, clearExtractSelector, ensureConfigForUrl, mutateSiteConfig,
  saveRedirectSelector, clearRedirectSelector, type RedirectSelectorKey,
  saveSubmitSelector, clearSubmitSelector, saveSuccessSelector, clearSuccessSelector,
  mutateJobDetails,
} from '../shared/storage';
import { captureDetails, type JobDetails } from '../shared/jobDetails';
import { BUILD_ID } from '../shared/buildId';
import { getDoc, cvFileToFile } from '../shared/cvStore';
import { TEXT_FIELDS, FIELD_LABELS, orderFields } from '../shared/fieldKeys';
import { matchStatus } from '../shared/fieldStatus';
import {
  MSG, type FollowRedirectResponse, type Message, type SessionState, type StatusResponse,
} from '../shared/messages';
import { hostOf } from '../shared/url';
import { isRendered } from '../shared/visible';
import { findSubmitControl } from '../shared/submitDetect';
import { waitForSelector } from './waitForForm';
import { runPrepSteps } from './prep';
import { extractJob, previewContainer, type ExtractedJob } from './extract';
import { detectFields } from './fieldDetect';
import { detectRedirect, type RedirectDetection } from './redirectDetect';
import { fillTextField, fillFileInput, highlight, clearHighlights } from './fill';
import { startPicker } from './picker';
import { FillerModal, type ApplyState } from './modal/modal';
import {
  SetupPanel,
  type ContainerKey, type SetupRow, type PrepRow, type PrepListKey, type SetupVerdict,
} from './setupPanel';

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
  /** The cover letter as a file, for sites that ask for one instead of prose. */
  private coverFile: File | null = null;
  private matches: FieldMatch[] = [];
  private elements = new Map<FieldKey, HTMLElement>();
  private modal?: FillerModal;
  private setupPanel?: SetupPanel;
  private cancelPicker?: () => void;
  private hasRun = false;
  private submitReported = false;
  private submitArmed = false;
  /** The site's own confirmation appeared: this posting really was sent. */
  private applied = false;
  /**
   * The job database already had this URL down as `applied` when the page opened.
   *
   * The record was write-only from the page's point of view until this existed:
   * `applied` above only ever means "a confirmation appeared during *this*
   * page-load", so re-opening a posting handed the user a live Apply and the
   * extension would press the site's Send button a second time.
   *
   * Read straight from `getState()`, which was already fetching `jobUrls` on every
   * run and throwing them away — no new message and no new storage key.
   */
  private alreadyApplied = false;
  /** When that record says it went in, for the modal's banner. */
  private appliedAt?: number;
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
  /** User settings; the modal's default size and position live here. */
  private settings: Settings = DEFAULT_SETTINGS;
  /**
   * Where the user dragged the card *on this page*. Deliberately never persisted:
   * `settings.modalLayout` is the default, and only the Options simulator may
   * change it. Nudging the card aside to read the field underneath it is a
   * one-off gesture, not a preference, and it used to redefine where the modal
   * opened on every posting after it. Lives exactly as long as the page does.
   */
  private draggedLayout?: ModalLayout;
  /** The last posting text written to the archive, so re-renders don't rewrite it. */
  private capturedSignature?: string;

  async init(): Promise<void> {
    console.info(`${LOG} content script ready — v${chrome.runtime.getManifest().version} · build ${BUILD_ID}`);
    const state = await getState();
    this.profile = state.profile;
    this.settings = state.settings;
    this.config = findMatchingConfig(location.href, state.siteConfigs);
    this.readAppliedRecord(state.jobUrls);

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
   * Detects that the application was *actually sent*. `successSelector` becoming
   * VISIBLE is the only thing that counts, and that is a deliberate narrowing:
   *
   *  - A `submit` event proves nothing. It fires before the server answers, and
   *    a site that validates in JS sees it in the capture phase *and then*
   *    rejects the form — which recorded an application that never happened.
   *  - Presence in the DOM proves nothing either: sites routinely pre-render a
   *    hidden thank-you node and only reveal it once the server confirms.
   *
   * The consequence is that Apply is greyed out until a site has a
   * `successSelector` (see `applyState`), rather than sending something whose
   * outcome cannot be read back.
   *
   * The confirmation is often on a *different page* — Greenhouse lands on
   * `…/jobs/<id>/confirmation`. That is fine: this arms on every matching page,
   * so the fresh content script there reports, and the background attributes it
   * to the posting this tab was filling.
   */
  private setupSubmitDetection(): void {
    if (this.submitArmed) return;
    const selector = this.config?.successSelector;
    if (!selector) return;
    this.submitArmed = true;

    const report = () => {
      if (this.submitReported) return;
      this.submitReported = true;
      this.successObserver?.disconnect();
      chrome.runtime.sendMessage({ type: MSG.SUBMITTED, url: location.href });
      // Say so on screen. The site's own confirmation is often below the fold,
      // or behind this very modal, so "did that go through?" is otherwise a
      // question the user answers by scrolling around the page they just sent.
      this.applied = true;
      if (this.modal) this.showModal();
    };

    // Wait for the confirmation element to be VISIBLE, not merely present.
    const check = () => {
      const el = safeQuery(selector);
      if (el && isRendered(el)) { report(); return true; }
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
  }

  /**
   * Ask the database what it already knows about the page in front of the user.
   *
   * Only this exact URL. `applyStatusChain` marks both ends of a two-step posting
   * when one is applied, so the board posting and the employer's form each carry
   * their own `applied` entry and there is no `sourceUrl` chain left to walk.
   */
  private readAppliedRecord(urls: JobUrlEntry[]): void {
    this.alreadyApplied = statusForUrl(urls, location.href) === 'applied';
    this.appliedAt = this.alreadyApplied
      ? urls.find((e) => e.url === location.href)?.appliedAt
      : undefined;
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
    // Re-read per run, not once at startup: a status corrected in Options → Queue
    // has to reach the card that Re-run rebuilds, and this is the only moment the
    // page looks at the database.
    this.readAppliedRecord(state.jobUrls);

    const [cv, cover] = await Promise.all([getDoc('resume'), getDoc('coverLetter')]);
    this.cvFile = cv ? cvFileToFile(cv) : null;
    this.coverFile = cover ? cvFileToFile(cover) : null;
    this.session = await this.fetchSession();

    if (config.waitFor) await waitForSelector(config.waitFor, config.waitTimeoutMs ?? 15000);
    await runPrepSteps(config.prep);

    const detection = detectRedirect({
      root: document,
      pageUrl: location.href,
      config: this.config!.redirect,
      keepInBrowser: this.settings.keepInBrowser,
    });
    this.detection = detection;

    if (this.shouldFollow(detection)) {
      this.hasRun = true;
      await this.followRedirect(detection);
      return;
    }

    this.detectAndFill();
    // Picking a confirmation element mid-session has to arm the watcher now,
    // not on the next page load — `setupSubmitDetection` is a no-op until the
    // config has a `successSelector`, so the run at startup may have skipped it.
    this.setupSubmitDetection();
    this.noteApplying();
    this.showModal();
    this.hasRun = true;
  }

  /**
   * Tell the background which posting this tab is working on, so a confirmation
   * that renders on a *different* URL is still attributed here. Only once a
   * field was actually filled: a confirmation page that happens to match a
   * config would otherwise overwrite the posting with its own URL.
   */
  private noteApplying(): void {
    if (!this.matches.some((m) => m.filled)) return;
    chrome.runtime.sendMessage({ type: MSG.APPLYING, url: location.href })
      .catch(() => {});
  }

  /* ---------------- Two-step (redirect) postings ---------------- */

  private shouldFollow(det: RedirectDetection): boolean {
    if (det.kind !== 'redirect' || this.fillAnyway) return false;
    // Already applied for: following would re-open the employer's form for a job
    // that is finished, and on `redirectTarget: newTabCloseSource` it would close
    // the posting the user just opened to look at.
    if (this.alreadyApplied) return false;
    // An apply control that hands off to a phone app is not followable: with no
    // href the background answers `{ click: true }`, and clicking it is precisely
    // the app launch `settings.keepInBrowser` exists to prevent. Falling through
    // fills the page instead, and the modal's `appLink` banner says why.
    if (det.appLink) return false;
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

  /**
   * The fields there is something to fill *with*. Order does not matter here —
   * `detectFields` uses it as a tie-break and the report is sorted afterwards —
   * but membership does: a field with no value would report as unmatched on
   * every posting, which is noise about the profile, not about the page.
   */
  private wantedFields(): FieldKey[] {
    const text = Object.entries(this.profile.values)
      .filter(([, v]) => v != null && v !== '')
      .map(([k]) => k as FieldKey);
    if (this.cvFile) text.push('resume');
    // A cover-letter *file* is reason enough on its own: the upload it fills is
    // a different control from the textarea the text fills.
    if (this.coverFile && !text.includes('coverLetter')) text.push('coverLetter');
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
        highlight(d.element, matchStatus(match));
      }
      return match;
    });
    // Reading order, not detection order — see `orderFields`. Detection is left
    // to run in its own order because it uses that order as a tie-break.
    this.matches = orderFields(this.matches, (m) => m.field, (m) => this.hasValueFor(m.field));
  }

  /** Whether the *profile* can supply this field — the split `orderFields` sorts on. */
  private hasValueFor(field: FieldKey): boolean {
    if (field === 'resume') return !!this.cvFile;
    if (field === 'coverLetter') return !!this.coverFile || !!this.profile.values.coverLetter;
    return !!this.profile.values[field];
  }

  /**
   * Fill a single field's element from the profile. Returns whether it filled.
   *
   * The cover letter is the one field that can go either way: the page decides,
   * by whether the control it offers is an upload or something to type into.
   */
  private applyFill(field: FieldKey, el: HTMLElement): boolean {
    const fileInput = el instanceof HTMLInputElement && el.type === 'file' ? el : null;
    if (field === 'resume') {
      if (!this.cvFile || !fileInput) return false;
      return fillFileInput(fileInput, this.cvFile);
    }
    if (field === 'coverLetter' && fileInput) {
      if (!this.coverFile) return false;
      return fillFileInput(fileInput, this.coverFile);
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

  /**
   * Mark this posting skipped; the background closes the tab and opens the next.
   *
   * Refuses on a posting already applied to, and the reason is not tidiness: this
   * ends in `recordStatus`, which is a blunt overwrite rather than a promote, so a
   * skip here would file "skipped" over "applied" and lose the record of an
   * application that really was sent — and, because the sync merge derives status
   * from the newest history event, would carry that loss to the other device. The
   * modal retires the button; this is what makes it true.
   */
  private skipPosting(): void {
    if (this.applied || this.alreadyApplied) return;
    chrome.runtime.sendMessage({ type: MSG.SESSION_SKIP, url: location.href })
      .catch((e) => console.warn(LOG, 'skip failed', e));
  }

  private showModal(): void {
    if (!this.modal) {
      this.modal = new FillerModal({
        onRerun: () => this.run(),
        onApply: () => void this.apply(),
        onConfirm: (field) => this.confirmField(field),
        onPick: (field) => this.pick(field),
        onFollow: () => { this.followed = false; void this.followRedirect(this.detection!); },
        onFillAnyway: () => this.fillHere(),
        onSkip: () => this.skipPosting(),
        // The two ways out of a posting, from the overflow menu. Setup is a
        // direct call and not a message: the panel lives in this same content
        // script, and `openSetup` already folds the modal to its pill through
        // `arbitrateSheets`.
        onOpenSetup: () => void this.openSetup(),
        onOpenOptions: () => chrome.runtime.sendMessage({ type: MSG.OPEN_OPTIONS }),
        // Collapse to the pill rather than destroying the report: the fills stay
        // in place and the modal is one tap away, instead of only reachable
        // through a Reset & Re-run that would wipe them.
        onClose: () => this.modal?.minimize(),
        onFold: () => this.arbitrateSheets('modal'),
        onLayoutChange: (layout) => { this.draggedLayout = layout; },
        // The opposite of a drag, and the only setting a content script writes:
        // "give this posting the whole window" is a preference, decided while
        // looking at a posting, and it is meant to hold for the ones after it.
        // Mutating the snapshot as well keeps one source of truth — the next
        // `showModal` reads `this.settings` and renders the same answer.
        onFullscreen: (on) => {
          this.settings.modalFullscreen = on;
          void patchSettings({ modalFullscreen: on });
        },
      });
    }
    const job = extractJob(this.config!);
    this.captureJob(job);
    const det = this.detection;
    // An app-handoff apply link is deliberately *not* a redirect here, even when
    // a config marked the site two-step: the redirect branch of the footer leads
    // with "Open application", and there is nothing this can open. The `appLink`
    // banner replaces it and outranks it in `flowBanner` for the same reason.
    const appLink = !!det?.appLink;
    const isRedirect = det?.kind === 'redirect' && !this.fillAnyway && !appLink;
    this.modal.render({
      siteName: this.config!.name,
      jobTitle: job.title,
      jobDescription: job.description,
      jobRequirements: job.requirements,
      meta: job.meta,
      matches: this.matches,
      applyState: this.applyState(isRedirect),
      applied: this.applied,
      alreadyApplied: this.alreadyApplied,
      appliedAt: this.appliedAt,
      redirect: isRedirect
        ? { host: det!.href ? hostOf(det!.href) : undefined, reason: det!.reason, followed: this.followed }
        : undefined,
      appLink: appLink && !this.fillAnyway,
      via: this.landedFrom ? hostOf(this.landedFrom) : undefined,
      session: this.session,
      // The drag wins for this page. `render` rebuilds `ModalData` from scratch,
      // and `showModal` is re-entered by confirmField, pick, apply and the
      // message handlers — without this the card would snap back to the stored
      // default the moment any of them ran.
      layout: this.draggedLayout ?? this.settings.modalLayout,
      fullscreen: this.settings.modalFullscreen,
    });
    this.arbitrateSheets('modal');
  }

  /**
   * There is one slot on this page, and this is what enforces it.
   *
   * The two sheets are one object with two renderings — same stored rectangle,
   * same drag, same bottom-sheet breakpoint — so two of them expanded is two cards
   * fighting over the same pixels, which under 640px is literally the same
   * rectangle with nothing but DOM order deciding the winner. `who` is the sheet
   * that just claimed the slot; everything else folds to its pill.
   *
   * Folding, never destroying: a destroyed review modal takes the fill report with
   * it, and the only route back used to be a Reset & Re-run that wiped every field
   * it had just filled.
   *
   * Then the pills. A collapsed sheet shows one only when *nothing* is expanded —
   * both pills dock bottom-right, which is where an expanded card already is, and
   * on mobile that is underneath the sheet itself. With the slot free they stack,
   * and the rail index has to come from here because the two pills live in
   * separate shadow roots and neither stylesheet can see the other's.
   */
  private arbitrateSheets(who?: 'modal' | 'setup'): void {
    if (who === 'modal' && !this.modal?.isMinimized) this.setupPanel?.minimize();
    if (who === 'setup' && !this.setupPanel?.isMinimized) this.modal?.minimize();

    const sheets = [this.modal, this.setupPanel].filter((s) => !!s);
    const expanded = sheets.some((s) => !s.isMinimized);
    let slot = 0;
    for (const sheet of sheets) sheet.setSlot(expanded ? null : slot++);
  }

  /**
   * Keep what this page said, so the posting can be judged after the tab is gone.
   *
   * Every posting the extension reads is recorded, applied or not — a decision to
   * skip is only worth anything later if the thing skipped is still legible. The
   * export in Options is what reads this back.
   *
   * Extraction already happens once per render, and `showModal` is re-entered by
   * every confirmation, pick, apply and message; the signature guard turns that
   * into one storage write per distinct reading of the page rather than one per
   * render. Fire-and-forget, like `skipPosting`: nothing on screen waits for it.
   */
  private captureJob(job: ExtractedJob): void {
    const details: JobDetails = {
      url: location.href,
      title: job.title,
      site: this.config?.name,
      description: job.description,
      requirements: job.requirements,
      meta: job.meta,
      capturedAt: Date.now(),
    };
    const signature = JSON.stringify([details.title, details.description, details.requirements, details.meta]);
    if (signature === this.capturedSignature) return;
    this.capturedSignature = signature;
    void mutateJobDetails((map) => captureDetails(map, details))
      .catch((e) => console.warn(LOG, 'capture failed', e));
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

  /**
   * Pick a field's control from the review modal's report.
   *
   * The modal gets out of the way for the same reason the setup panel does in
   * `pickInto`: the picker reads `document.elementFromPoint`, which happily lands
   * on the sheet's own host, so a card left on screen is a card the user can pick
   * *from*. It used to rely on the toolbar's higher z-index alone, which stops the
   * toolbar being covered and does nothing about the card underneath it.
   */
  private pick(field: FieldKey): void {
    this.cancelPicker?.();
    const label = field;
    this.modal?.setHidden(true);
    const restore = () => this.modal?.setHidden(false);
    this.cancelPicker = startPicker(async (el) => {
      const control = resolveControl(el, field === 'resume');
      if (this.config) await saveFieldOverride(this.config.id, field, generateSelector(control));
      restore();
      await this.run();
    }, String(label), restore);
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
        onPickSubmit: () => this.pickSubmit(),
        onClearSubmit: () => void this.clearSubmit(),
        onPickSuccess: () => this.pickSuccess(),
        onClearSuccess: () => void this.clearSuccess(),
        onRename: (name, pattern) => this.renameConfig(name, pattern),
        // "Advanced (JSON)" is about *this config*, so it lands on the JSON that
        // holds it. Without `at`/`focus` it opened the options page on whatever
        // tab is default — the queue — and left the user to find the editor.
        onOpenOptions: () => chrome.runtime.sendMessage({
          type: MSG.OPEN_OPTIONS, hash: 'sites', at: 'configs-section', focus: '#configs-json',
        }),
        onDismissHelp: () => void this.dismissHelp(),
        onClose: () => this.closeSetup(),
        // The same three the review modal wires, because it is the same slot:
        // a drag holds for this page, fullscreen is a preference, and a fold
        // hands the slot to whatever is left.
        onFold: () => this.arbitrateSheets('setup'),
        onLayoutChange: (layout) => { this.draggedLayout = layout; },
        onFullscreen: (on) => {
          this.settings.modalFullscreen = on;
          void patchSettings({ modalFullscreen: on });
        },
      });
    }
    // Asking for setup again while it is folded means "bring it back", not
    // "re-scan the page behind a pill". `restore` is a no-op when it is already
    // open, and `refreshSetup` claims the slot either way.
    this.setupPanel.restore();
    await this.refreshSetup();
  }

  /**
   * Done — finished with this site, so the panel really goes. The header's `×`
   * does not come here; it minimizes, and the panel stays alive behind its pill.
   */
  private closeSetup(): void {
    this.cancelPicker?.();
    clearHighlights();
    this.setupPanel?.destroy();
    this.setupPanel = undefined;
    // Re-render an existing report against the config that was just edited —
    // picking the Send button has to bring Apply to life now, not after a
    // re-run that would wipe every field already filled. Never creates
    // a modal: a page the user only came to configure has nothing to report.
    // It also hands the slot back: `showModal` re-arbitrates, and with the panel
    // gone the review card is what takes it.
    if (this.modal) this.showModal();
    else this.arbitrateSheets();
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
    const submitCv = toPrepRows(config.submitCv);

    // How this posting applies: quick-apply here, or a handoff to the employer.
    const detection = detectRedirect({ root: document, pageUrl: location.href, config: config.redirect });
    this.detection = detection;
    const verdict: SetupVerdict = {
      title: detection.kind === 'redirect'
        ? 'External application'
        : detection.kind === 'quickApply'
          ? 'Quick apply'
          : 'Quick apply (assumed)',
      detail: detection.reason,
      kind: detection.kind,
    };
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
    // Same reading order as the review modal's report. This step lists every
    // field the extension knows, so the split matters more here than there: what
    // the user actually filled in comes first, and eleven rows for fields that
    // have nothing to fill them with stop sitting above the one that needs a Pick.
    const orderedFields = orderFields(
      fields, (r) => r.key as FieldKey, (r) => this.hasValueFor(r.key as FieldKey));

    // The Send button, found the same way Apply will find it. Highlighted like
    // the field rows, so "which button is that?" is answered on the page rather
    // than by reading a selector.
    const found = findSubmitControl(
      document,
      config.submitSelector,
      detected.map((d) => d.element).filter((e): e is HTMLElement => e != null),
    );
    if (found.element) highlight(found.element, found.source === 'override' ? 'high' : 'low');
    const submitRow: SetupRow = {
      key: 'submitSelector',
      label: 'Send button',
      status: found.element ? (found.source === 'override' ? 'high' : 'low') : 'none',
      note: !config.submitSelector
        ? (found.element ? `auto · ${clip(found.element.textContent ?? '', 40) || generateSelector(found.element)}` : 'not found — Apply is greyed out')
        : found.element ? `saved · ${config.submitSelector}`
        : 'saved selector · no match',
      hasSave: !!config.submitSelector,
    };

    // The confirmation element. Unlike every other row, "not set" is never fine:
    // it is what marks a posting applied, and Apply will not send without it.
    const successEl = config.successSelector ? safeQuery(config.successSelector) : null;
    if (successEl) highlight(successEl, 'high');
    const successRow: SetupRow = {
      key: 'successSelector',
      label: 'Confirmation element',
      // Green as soon as one is saved, whether or not it resolves right now:
      // being absent is the *normal* state before a submission, and the yellow
      // "saved selector · no match" the other rows use would cry wolf on every
      // healthy site. There is nothing to verify until an application is sent.
      status: config.successSelector ? 'high' : 'none',
      note: config.successSelector
        ? `saved · ${config.successSelector}${successEl ? ' · on screen now' : ''}`
        : 'not set — Apply is greyed out',
      hasSave: !!config.successSelector,
    };

    this.setupPanel.render({
      name: config.name,
      urlPattern: config.urlPatterns[0] ?? '',
      prep,
      containers,
      fields: orderedFields,
      verdict,
      redirect: redirectRows,
      beforeFollow,
      submitCv,
      submit: submitRow,
      success: successRow,
      helpSeen: (await getSettings()).helpSeen,
      // The same two the review modal renders from, off the same fields: one slot
      // means a panel that opens where the card the user configured opens, at the
      // size they configured it at. A drag on either sheet moves both.
      layout: this.draggedLayout ?? this.settings.modalLayout,
      fullscreen: this.settings.modalFullscreen,
    });
    this.arbitrateSheets('setup');
  }

  /**
   * The legend was dismissed. Persisted rather than kept in the panel, because
   * the next posting gets a brand-new panel in a brand-new content script — and
   * being re-taught the basics sixty times in a session is its own problem.
   */
  private async dismissHelp(): Promise<void> {
    if ((await getSettings()).helpSeen) return;
    await patchSettings({ helpSeen: true });
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

  /**
   * Save the button Apply presses. No `resolveControl` here, unlike a field pick:
   * the user is pointing at a button, and the wrapper it sits in is often what
   * actually carries the click handler — "helpfully" resolving inward would save
   * a selector for a `<span>` that does nothing when clicked.
   */
  private pickSubmit(): void {
    this.pickInto('Send button', async (el) => {
      if (this.config) await saveSubmitSelector(this.config.id, generateSelector(el));
    });
  }

  private async clearSubmit(): Promise<void> {
    if (this.config) await clearSubmitSelector(this.config.id);
    await this.refreshSetup();
  }

  /**
   * Save the site's confirmation element. Realistically picked with a real
   * confirmation on screen — after sending one application by hand — which is
   * why the row says so rather than assuming it can be guessed cold.
   */
  private pickSuccess(): void {
    this.pickInto('Confirmation element', async (el) => {
      if (this.config) await saveSuccessSelector(this.config.id, generateSelector(el));
    });
  }

  private async clearSuccess(): Promise<void> {
    if (this.config) await clearSuccessSelector(this.config.id);
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

  /**
   * Read-modify-write one of the config's step arrays: pre-fill, pre-handoff, or
   * the CV-confirmation steps Apply runs before it presses Send.
   */
  private async mutatePrep(fn: (prep: PrepStep[]) => void, list: PrepListKey = 'prep'): Promise<void> {
    if (!this.config) return;
    await mutateSiteConfig(this.config.id, (c) => {
      if (list === 'beforeFollow') {
        const steps = [...(c.redirect?.beforeFollow ?? [])];
        fn(steps);
        c.redirect = { ...c.redirect, beforeFollow: steps };
        return;
      }
      if (list === 'submitCv') {
        const steps = [...(c.submitCv ?? [])];
        fn(steps);
        c.submitCv = steps;
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

  /**
   * Press the site's own Send button, because the user pressed Apply. This is
   * the one place the extension acts on the form rather than reporting on it,
   * and it is still not an *auto*-submit: nothing here runs without that press.
   *
   * The CV-confirmation steps run first. On the sites that need them the file is
   * attached but not yet accepted, so sending before they run submits an
   * application with no CV — the exact failure `submitCv` was added to prevent.
   * Re-scanning between the two phases is deliberate: those steps often build
   * the rest of the form.
   */
  private async apply(): Promise<void> {
    // Never twice. The modal retires the button, but the UI must not be the only
    // thing between a finished posting and a second application — this method is
    // the sole caller of `target.click()`, so the guard belongs where the press
    // happens rather than only where it is offered.
    if (this.applied || this.alreadyApplied) {
      console.warn(LOG, 'apply: this posting is already recorded as applied');
      return;
    }
    if (this.config?.submitCv?.length) {
      try {
        await runPrepSteps(this.config.submitCv);
      } catch (e) {
        console.warn(LOG, 'CV confirmation steps failed', e);
      }
      this.detectAndFill();
      this.showModal();
    }

    const target = this.submitControl();
    if (!target) {
      // The modal already explains this: Apply is greyed and says why. Acting on
      // a guess here is how the wrong button gets pressed.
      console.warn(LOG, 'apply: no submit control found');
      return;
    }
    target.scrollIntoView({ block: 'center' });
    target.click();
  }

  /**
   * Whether Apply may run, and if not, which half is missing.
   *
   * A confirmation element is required, not merely useful: without one there is
   * no way to read back whether the submission was accepted, and pressing Send
   * anyway is how a rejected application gets recorded as sent. Refusing to send
   * what cannot be verified is the whole point — so "no confirmation configured"
   * greys Apply exactly as hard as "no button found", and says which it is.
   */
  private applyState(isRedirect: boolean): ApplyState {
    if (isRedirect) return 'noButton';
    if (!this.config?.successSelector) return 'noConfirmation';
    return this.submitControl() ? 'ready' : 'noButton';
  }

  /** The control Apply presses: the saved selector, else the best-scoring button. */
  private submitControl(): HTMLElement | null {
    return findSubmitControl(
      document,
      this.config?.submitSelector,
      [...this.elements.values()],
    ).element;
  }

  /**
   * Blank every field we filled and throw the card away.
   *
   * Reached only through `MSG.RESET`, i.e. the popup's "Reset & Re-run". It used
   * to sit in the review modal's `⋯` as well, which put an unconfirmed wipe of
   * the whole fill — and of the report describing it — one tap from Site setup,
   * on the surface whose entire job is showing what was filled. The popup is the
   * right home for it: there, starting over is what the button is for.
   */
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
/** One-line snippet for a setup row's note — container text is multi-line now. */
function clip(text: string, n: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
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

const controller = new Controller();
controller.init().catch((e) => console.error(LOG, 'init failed', e));
