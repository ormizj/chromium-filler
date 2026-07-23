/**
 * Options page: the job queue (session control + URL database), profile editor,
 * CV upload, behavior settings, the site-config JSON editor, and Help.
 *
 * The five areas are tabs rather than one long scroll — the queue is the only
 * part used daily, and on a phone it used to sit behind everything else.
 *
 * Everything explanatory on this page renders from `shared/help.ts`, never from
 * copy written here: the same words have to reach the on-page setup panel, and
 * two copies of an explanation is how the old per-surface CSS ended up
 * contradicting itself.
 */

import type {
  JobUrlEntry, JobUrlStatus, ModalLayout, Profile, RedirectTarget, SiteConfig, TextFieldKey,
} from '../shared/types';
import type { SessionState } from '../shared/messages';
import {
  activeLimits, ALL_LIMITS, clampLayout, DEFAULT_MODAL_LAYOUT, describeLimits, layoutLimits,
  modelledViewport, sampleScreen, snapLayout,
  type DragMode, type ModelledViewport, type ScreenMetrics, type ScreenSample,
} from '../shared/modalLayout';
// The real review modal, rendered over this page for the full-size preview —
// the same trick the dev harness uses. A mock of it would only ever be a lie
// about the thing being configured.
import { FillerModal, type ModalCallbacks, type ModalData } from '../content/modal/modal';
import { TEXT_FIELDS, FIELD_LABELS } from '../shared/fieldKeys';
import { configTemplate } from '../shared/configTemplate';
import { extractUrls } from '../shared/urlImport';
import { addUrls, applyStatus, jobUrlStats, removeUrl } from '../shared/jobUrls';
import { hostOf } from '../shared/url';
import { MSG } from '../shared/messages';
import {
  getProfile, saveProfile, getSettings, saveSettings,
  getSiteConfigs, saveSiteConfigs, getJobUrls, saveJobUrls, mutateJobUrls,
} from '../shared/storage';
import { getCv, setCv, clearCv } from '../shared/cvStore';
import {
  CONCEPT_HELP, CONFIG_HELP, PREP_HELP, REDIRECT_HELP, SETTINGS_HELP, describeConfig,
  type HelpEntry,
} from '../shared/help';
import { helpButton, helpPanel, richText } from '../ui/help';
import { setLimitAttrs } from '../ui/limits';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ALL_STATUSES: JobUrlStatus[] = ['new', 'opened', 'redirected', 'applied', 'skipped'];

/** How many rows to render before "Show more". A 500-URL import must not build 500 rows. */
const PAGE_SIZE = 50;

function setStatus(el: HTMLElement, text: string, kind: 'ok' | 'err' | '' = ''): void {
  el.textContent = text;
  el.className = `status ${kind}`.trim();
  // Errors stay until the next action — they usually name something to fix.
  if (text && kind !== 'err') {
    setTimeout(() => { el.textContent = ''; el.className = 'status'; }, 3000);
  }
}

/* ---------------- Tabs ---------------- */

const TABS = ['queue', 'profile', 'settings', 'sites', 'help'] as const;
type TabName = (typeof TABS)[number];

function selectTab(name: TabName, pushHash = true): void {
  for (const tab of TABS) {
    const button = $(`tab-${tab}`);
    const panel = $(`panel-${tab}`);
    const active = tab === name;
    button.setAttribute('aria-selected', String(active));
    panel.hidden = !active;
  }
  if (pushHash) {
    // Preserve any `create=` payload so a deep link survives a tab switch.
    const create = parseHash().create;
    location.hash = create ? `${name}&create=${encodeURIComponent(create)}` : name;
  }
}

/** `#sites&create=<url>` — and the legacy bare `#create=<url>` the popup still sends. */
function parseHash(): { tab?: TabName; create?: string } {
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return {};
  const parts = raw.split('&');
  const tab = TABS.find((t) => t === parts[0]);
  const createPart = parts.find((p) => p.startsWith('create='));
  const create = createPart ? decodeURIComponent(createPart.slice('create='.length)) : undefined;
  return { tab, create };
}

function initTabs(): void {
  for (const tab of TABS) {
    $(`tab-${tab}`).addEventListener('click', () => selectTab(tab));
  }
  // Arrow-key movement between tabs, as a tablist is expected to support.
  $('tab-queue').parentElement!.addEventListener('keydown', (e) => {
    const key = (e as KeyboardEvent).key;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
    const current = TABS.findIndex((t) => $(`tab-${t}`).getAttribute('aria-selected') === 'true');
    const next = (current + (key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
    selectTab(TABS[next]);
    $(`tab-${TABS[next]}`).focus();
  });
}

/* ---------------- Profile ---------------- */

async function initProfile(): Promise<void> {
  const container = $('profile-fields');
  const savebar = $('profile-savebar');
  const profile = await getProfile();

  for (const field of TEXT_FIELDS) {
    const key = field as TextFieldKey;
    const label = document.createElement('label');
    label.className = 'fld';
    label.textContent = FIELD_LABELS[field];
    const input = field === 'coverLetter'
      ? document.createElement('textarea')
      : document.createElement('input');
    input.dataset.field = key;
    (input as HTMLInputElement).value = profile.values[key] ?? '';
    if (input instanceof HTMLTextAreaElement) input.rows = 3;
    label.appendChild(input);
    container.appendChild(label);
  }

  // The behavior settings save silently on change while this form needs an
  // explicit Save; the difference has to be visible, or edits get lost on a
  // tab switch. The bar appears the moment anything is dirty.
  container.addEventListener('input', () => { savebar.hidden = false; });

  $('save-profile').addEventListener('click', async () => {
    const values: Profile['values'] = {};
    container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-field]').forEach((el) => {
      const v = el.value.trim();
      if (v) values[el.dataset.field as TextFieldKey] = v;
    });
    const current = await getProfile();
    await saveProfile({ ...current, values });
    savebar.hidden = true;
    setStatus($('profile-status'), 'Saved', 'ok');
  });

  window.addEventListener('beforeunload', (e) => {
    if (!savebar.hidden) e.preventDefault();
  });
}

/* ---------------- CV ---------------- */

async function initCv(): Promise<void> {
  const input = $<HTMLInputElement>('cv-input');
  const current = $('cv-current');
  const show = async () => {
    const cv = await getCv();
    current.textContent = cv ? `Current: ${cv.name} (${Math.round(cv.data.byteLength / 1024)} KB)` : 'No CV stored.';
  };
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    await setCv(file);
    await show();
  });
  $('clear-cv').addEventListener('click', async () => {
    await clearCv();
    input.value = '';
    await show();
  });
  await show();
}

/* ---------------- Inline help ---------------- */

/**
 * Attaches a `?` to a control's label, disclosing that setting's explanation
 * directly beneath it. The catalog is the copy; this only decides where it goes.
 */
function attachHelp(anchor: HTMLElement, entry: HelpEntry, insertAfter: HTMLElement = anchor): void {
  let panel: HTMLElement | undefined;
  anchor.append(helpButton(entry.title, false, (open) => {
    panel?.remove();
    panel = undefined;
    if (open) {
      panel = helpPanel(entry);
      insertAfter.after(panel);
    }
  }));
}

/** `key — what it does`, the shape used by both the Sites reference and Help. */
function referenceRow(key: string, entry: HelpEntry): HTMLElement {
  const row = document.createElement('div');
  row.className = 'reference-row';

  const name = document.createElement('code');
  name.className = 'reference-key';
  name.textContent = key;

  const body = document.createElement('div');
  body.className = 'reference-text';
  const p = document.createElement('p');
  p.append(...richText(entry.body));
  body.append(p);

  if (entry.when) {
    const when = document.createElement('p');
    when.className = 'cf-help-when';
    when.append(...richText(entry.when));
    body.append(when);
  }
  if (entry.example) {
    const example = document.createElement('code');
    example.className = 'cf-help-example';
    example.textContent = entry.example;
    body.append(example);
  }

  row.append(name, body);
  return row;
}

/** The whole config schema, key by key. Shared by the Sites tab and Help. */
function renderReference(into: HTMLElement): void {
  const groups: Array<[string, Record<string, HelpEntry>]> = [
    ['Site config', CONFIG_HELP],
    ['redirect — two-step postings', REDIRECT_HELP],
    ['Prep step actions', PREP_HELP],
  ];
  into.replaceChildren(...groups.flatMap(([title, entries]) => {
    const head = document.createElement('h4');
    head.className = 'reference-head';
    head.textContent = title;
    return [head, ...Object.entries(entries).map(([key, entry]) => referenceRow(key, entry))];
  }));
}

/** The Help tab. Static content, all of it from the catalog. */
function initHelp(): void {
  const flow = [
    'You save your details and your CV once, here.',
    'You open a job posting — by hand, or from the queue.',
    'The extension checks whether one of your site configs matches that URL.',
    'It waits for the form, runs that site’s setup steps, and works out whether the '
      + 'posting applies here or on the employer’s own site.',
    'It fills every field it is confident about, CV included, and shows you a review.',
    'You check the review, fix anything it flagged, and press the site’s own Send.',
  ];
  $('help-flow').replaceChildren(...flow.map((text) => {
    const li = document.createElement('li');
    li.append(...richText(text));
    return li;
  }));

  const concepts: Array<keyof typeof CONCEPT_HELP> = [
    'howItWorks', 'neverSubmits', 'dots', 'autoVsSaved', 'picker', 'todoChip',
    'urlPattern', 'twoStep', 'sessions', 'successSelector',
  ];
  $('help-concepts').replaceChildren(...concepts.map((key) => helpPanel(CONCEPT_HELP[key])));

  renderReference($('help-reference'));

  // Written here rather than in the catalog: these are symptoms, not settings,
  // and each one is a pointer at the entry that explains the cause.
  const trouble: HelpEntry[] = [
    {
      title: 'Nothing was filled at all',
      body: 'Either no site config matches this URL — the popup says “no config” — or '
        + 'the form had not loaded yet. Open the posting, press “Set up this site”, and '
        + 'check the URL pattern, then give the site a `waitFor` selector.',
    },
    {
      title: 'One field stayed grey',
      body: 'The guessing found nothing for it. In the setup panel press Pick on that '
        + 'row and tap the real input on the page; the selector is saved for this site '
        + 'and it will be right every time after that.',
    },
    {
      title: 'It navigated away from a posting I wanted to fill',
      body: 'It classified the posting as applying on the employer’s site. Press “Fill '
        + 'this page instead” in the modal, then set a quick-apply marker under '
        + 'Application type so the same board is judged correctly next time.',
    },
    {
      title: 'It never marked a posting applied',
      body: 'Applied is only recorded once the site’s own confirmation becomes visible. '
        + 'Give that site a `successSelector` pointing at its thank-you element — '
        + 'without one, only a full-page-navigation submit counts.',
    },
    {
      title: 'The queue opened far too many tabs',
      body: 'Lower “Tabs at once” on the Queue tab. A session keeps that many postings '
        + 'open and opens the next as you finish each one; on a phone use 1–2.',
    },
  ];
  $('help-trouble').replaceChildren(...trouble.map(helpPanel));
}

/* ---------------- Settings ---------------- */

async function initSettings(): Promise<void> {
  const autoRun = $<HTMLInputElement>('auto-run');
  const closeOnSubmit = $<HTMLInputElement>('close-on-submit');
  const closeDelay = $<HTMLInputElement>('close-delay');
  const redirectTarget = $<HTMLSelectElement>('redirect-target');

  const settings = await getSettings();
  autoRun.checked = settings.autoRunOnLoad;
  closeOnSubmit.checked = settings.closeTabOnSubmit;
  closeDelay.value = String(settings.closeTabDelayMs);
  redirectTarget.value = settings.redirectTarget;

  const persist = async () => {
    const s = await getSettings();
    await saveSettings({
      ...s,
      autoRunOnLoad: autoRun.checked,
      closeTabOnSubmit: closeOnSubmit.checked,
      closeTabDelayMs: Math.max(0, Number(closeDelay.value) || 0),
      redirectTarget: redirectTarget.value as RedirectTarget,
    });
    setStatus($('settings-status'), 'Saved', 'ok');
  };

  autoRun.addEventListener('change', persist);
  closeOnSubmit.addEventListener('change', persist);
  closeDelay.addEventListener('change', persist);
  redirectTarget.addEventListener('change', persist);

  // A `?` on each control, disclosing the same words the setup panel uses. The
  // panel goes after the control's own <label>, so it reads as an answer to it.
  attachHelp(autoRun.parentElement!, SETTINGS_HELP.autoRunOnLoad);
  attachHelp(closeOnSubmit.parentElement!, SETTINGS_HELP.closeTabOnSubmit);
  // These two are column labels, so the `?` hangs off the caption while the
  // panel still opens below the whole field.
  attachHelp($('close-delay-label'), SETTINGS_HELP.closeTabDelayMs, closeDelay.parentElement!);
  attachHelp($('redirect-target-label'), SETTINGS_HELP.redirectTarget, redirectTarget.parentElement!);

  await initModalLayout(settings.modalLayout);
}

/* ---------------- Review-modal size & position ---------------- */

/**
 * A scale model of the user's own viewport, dragged and resized directly.
 *
 * The modal is a floating card over someone else's page, and where it sits is a
 * matter of taste and of screen — there is no correct default. Picking it by
 * trial and error on a live posting means re-running the fill for every nudge, so
 * the choice is made here instead, against a stand-in page.
 *
 * The frame is the user's own screen to scale — not this window: `modelledViewport`
 * takes the display minus the OS bars and minus the browser chrome measured from
 * this very tab, so someone running with a bookmarks bar gets the shorter, wider
 * frame they actually have. Every drag then maps 1:1 onto real CSS pixels and the
 * readout can state them plainly. "Preview at full size" renders the *actual*
 * `FillerModal` over this page — the model is for placing, the preview is for
 * believing.
 */
async function initModalLayout(initial: ModalLayout): Promise<void> {
  const frame = $('sim');
  const card = $('sim-card');
  const grip = $('sim-grip');
  const readout = $('sim-readout-text');
  const limitsSr = $('sim-readout-sr');
  const sizeChip = $('sim-size');
  const guides = {
    top: frame.querySelector<HTMLElement>('.sim-guide.top')!,
    right: frame.querySelector<HTMLElement>('.sim-guide.right')!,
    bottom: frame.querySelector<HTMLElement>('.sim-guide.bottom')!,
    left: frame.querySelector<HTMLElement>('.sim-guide.left')!,
  };

  /**
   * The layout the user chose. Deliberately NOT the layout being displayed: the
   * frame clamps for painting only, and a viewport-driven repaint must never write
   * back — `modal.ts` follows the same rule for the same reason. This panel used to
   * assign the clamped value here, so opening the options window short enough for
   * one repaint permanently shrank a card configured on a big screen.
   */
  let layout = initial;
  let scale = 1;
  let preview: FillerModal | undefined;
  let saveTimer: number | undefined;
  let screenSample: ScreenSample | undefined;

  /**
   * The screen being modelled. Read fresh every time — toggling the bookmarks bar
   * changes the chrome and only fires `resize` — but through `sampleScreen`, which
   * holds the reading still while the window itself is being resized. Otherwise the
   * frame changes shape as the user drags the window edge, which is precisely the
   * one thing this frame is supposed to be telling the truth about.
   */
  const viewport = () => {
    const metrics: ScreenMetrics = {
      availWidth: window.screen?.availWidth ?? window.innerWidth,
      availHeight: window.screen?.availHeight ?? window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      framed: window.top !== window.self,
    };
    screenSample = sampleScreen(screenSample, metrics);
    return modelledViewport(screenSample);
  };

  /**
   * Every limit chip, rendered once and only ever shown or hidden. Adding and
   * removing them reflowed the readout and shifted the buttons under it mid-drag.
   */
  const chips = new Map(ALL_LIMITS.map(({ key, label, tone }) => {
    const el = document.createElement('span');
    el.className = `chip ${tone} is-off`;
    el.textContent = label;
    return [key, el] as const;
  }));
  $('sim-limits').replaceChildren(...chips.values());

  /** The frame stands in for that screen, so it has to have its shape. */
  const measure = () => {
    const width = frame.clientWidth;
    if (!width) return false; // hidden tab panel: nothing to scale against yet
    const vp = viewport();
    const height = `${Math.round(width * (vp.height / vp.width))}px`;
    if (frame.style.height !== height) frame.style.height = height;
    scale = width / vp.width;
    return true;
  };

  /**
   * `from` says which of the two views the change came from. The preview is not
   * re-placed from its own drag: it is already where the pointer put it, and
   * writing back mid-gesture only fights it.
   */
  const paint = (from: 'frame' | 'preview' = 'frame') => {
    if (!scale) return;
    const vp = viewport();
    // Clamped for display only — see `layout` above.
    const shown = clampLayout(layout, vp.width, vp.height);
    card.style.width = `${shown.width * scale}px`;
    card.style.height = `${shown.height * scale}px`;
    card.style.right = `${shown.right * scale}px`;
    card.style.bottom = `${shown.bottom * scale}px`;

    // Which edges have run out of room, on the card and on the screen it is stuck
    // against. Without this a drag that hit a wall looks like one that stopped.
    const limits = layoutLimits(shown, vp.width, vp.height);
    setLimitAttrs(card, limits);
    for (const [side, state] of Object.entries(limits)) {
      guides[side as keyof typeof limits].classList.toggle('on', state === 'screen');
    }
    sizeChip.textContent = `${shown.width} × ${shown.height}`;

    const on = activeLimits(limits);
    for (const [key, el] of chips) el.classList.toggle('is-off', !on.has(key));
    readout.textContent =
      `${shown.width} × ${shown.height} px · ${shown.right} from the right`
      + ` · ${shown.bottom} from the bottom · ${describeScreen(vp)}`;
    // A hidden chip is not announced, and toggling one is not a text change, so the
    // live region carries the words itself. Status is never colour alone.
    limitsSr.textContent = describeLimits(limits).map((l) => l.label).join(', ');
    if (from === 'frame') preview?.place(shown);
  };

  // Debounced: a drag is a stream of pointermoves, and each one would otherwise
  // be a storage write that every open tab hears about.
  const save = () => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(async () => {
      const s = await getSettings();
      await saveSettings({ ...s, modalLayout: layout });
      setStatus($('settings-status'), 'Saved', 'ok');
    }, 250);
  };

  /**
   * Apply a delta in real viewport pixels. Because the card is anchored
   * bottom-right, every mode is expressed as a change to
   * `right`/`bottom`/`width`/`height` rather than to a top-left origin — and the
   * signs invert with it: dragging left grows the width, because it is the *left*
   * edge that moves.
   */
  const nudge = (from: ModalLayout, mode: DragMode, dx: number, dy: number): ModalLayout => {
    switch (mode) {
      case 'move': return { ...from, right: from.right - dx, bottom: from.bottom - dy };
      case 'resize-x': return { ...from, width: from.width - dx };
      case 'resize-y': return { ...from, height: from.height - dy };
      default: return { ...from, width: from.width - dx, height: from.height - dy };
    }
  };

  /**
   * Commit a layout the user actually asked for. This is the only place a clamp is
   * allowed to stick: a drag is a decision, a repaint is not.
   */
  const commit = (next: ModalLayout, from: 'frame' | 'preview' = 'frame') => {
    const vp = viewport();
    layout = clampLayout(next, vp.width, vp.height);
    paint(from);
  };

  /** One pointer gesture, snapped on the way so "flush" is aimable rather than lucky. */
  const drag = (el: HTMLElement, mode: DragMode) => {
    el.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const vp0 = viewport();
      // From what is on screen, not from what is stored: if the stored card is
      // bigger than this screen it is being *shown* clamped, and a drag that
      // started from the stored numbers would jump on the first pixel of movement.
      const start = { x: e.clientX, y: e.clientY, ...clampLayout(layout, vp0.width, vp0.height) };
      el.setPointerCapture(e.pointerId);
      frame.classList.add('is-dragging');

      const onMove = (ev: PointerEvent) => {
        const vp = viewport();
        const dx = (ev.clientX - start.x) / scale;
        const dy = (ev.clientY - start.y) / scale;
        commit(snapLayout(nudge(start, mode, dx, dy), vp.width, vp.height, mode));
      };
      const onUp = (ev: PointerEvent) => {
        el.releasePointerCapture(ev.pointerId);
        el.removeEventListener('pointermove', onMove);
        frame.classList.remove('is-dragging');
        save();
      };

      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp, { once: true });
      el.addEventListener('pointercancel', onUp, { once: true });
    });
  };

  /**
   * The same gestures from the keyboard. The card was `role="application"` with no
   * keyboard path at all; now each handle *is* the mode, so arrows need no modifier
   * to mean different things — Shift only changes the step. No snapping here: the
   * reason to reach for the keys is to place a pixel exactly.
   */
  const keys = (el: HTMLElement, mode: DragMode) => {
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    el.addEventListener('keydown', (e: KeyboardEvent) => {
      const d = deltas[e.key];
      if (!d) return;
      e.preventDefault();   // the panel would otherwise scroll under the card
      e.stopPropagation();  // a handle's arrows must not also move the card
      const step = e.shiftKey ? 10 : 1;
      commit(nudge(layout, mode, d[0] * step, d[1] * step));
      save();
    });
  };

  const handles: [HTMLElement, DragMode][] = [
    [card, 'move'],
    [grip, 'resize'],
    [$('sim-edge-x'), 'resize-x'],
    [$('sim-edge-y'), 'resize-y'],
  ];
  for (const [el, mode] of handles) {
    drag(el, mode);
    keys(el, mode);
  }

  /**
   * The preview is the same control, at 1:1 — so it binds both ways. The frame
   * already drives it (`paint` re-renders it on every nudge); these two callbacks
   * are the return leg: dragging the real card moves the model and saves, and its
   * close button closes it here rather than doing nothing, which is what a dead
   * `onClose` amounted to. Without the return leg the two disagree the moment the
   * preview is touched, and the preview is the one the user believes.
   */
  const previewButton = $<HTMLButtonElement>('sim-preview');
  const closePreview = () => {
    preview?.destroy();
    preview = undefined;
    previewButton.textContent = 'Preview at full size';
    previewButton.setAttribute('aria-pressed', 'false');
  };

  previewButton.addEventListener('click', () => {
    if (preview) return closePreview();
    preview = new FillerModal({
      ...PREVIEW_CALLBACKS,
      onClose: closePreview,
      // Live while it moves, saved when it lands — the same split the modal makes
      // between reporting and persisting.
      onLayoutPreview: (l) => commit(l, 'preview'),
      onLayoutChange: (l) => { commit(l, 'preview'); save(); },
    });
    const vp = viewport();
    preview.render(previewData(clampLayout(layout, vp.width, vp.height)));
    previewButton.textContent = 'Close preview';
    previewButton.setAttribute('aria-pressed', 'true');
  });

  $('sim-reset').addEventListener('click', () => {
    layout = DEFAULT_MODAL_LAYOUT;
    paint();
    save();
  });

  // The Settings panel is `hidden` until its tab is selected, and a hidden
  // element has no width to scale against — measuring at boot yields a frame one
  // pixel tall. A ResizeObserver covers every way it can gain a size (tab click,
  // a `#settings` deep link, the window changing) without having to enumerate
  // them; the window listener is still needed because `scale` also depends on
  // the viewport, which can change while the frame's own width does not.
  new ResizeObserver(() => { if (measure()) paint(); }).observe(frame);
  window.addEventListener('resize', () => { if (measure()) paint(); });
  measure();
  paint();
}

/**
 * Name the screen being modelled, with the arithmetic showing. A user who has just
 * turned their bookmarks bar on should be able to see where the missing pixels
 * went rather than wonder why the frame changed shape.
 */
function describeScreen(vp: ModelledViewport): string {
  if (vp.source === 'reference') {
    return `on a modelled ${vp.width} × ${vp.height} desktop screen`;
  }
  const chrome = vp.chromeMeasured
    ? `${vp.chromeHeight}px of browser chrome`
    : `about ${vp.chromeHeight}px of browser chrome, estimated`;
  return `on your ${vp.width + vp.chromeWidth} × ${vp.height + vp.chromeHeight} screen,`
    + ` ${vp.width} × ${vp.height} visible (${chrome})`;
}

/** The preview modal is a mannequin: its buttons must not do anything real. */
const PREVIEW_CALLBACKS: ModalCallbacks = {
  onRerun: () => {}, onReset: () => {}, onSubmitCv: () => {},
  onConfirm: () => {}, onPick: () => {}, onFollow: () => {},
  onFillAnyway: () => {}, onSkip: () => {}, onClose: () => {},
};

function previewData(layout: ModalLayout): ModalData {
  return {
    siteName: 'Example Careers',
    jobTitle: 'Staff Platform Engineer',
    jobDescription: [
      { kind: 'para', text: 'This is a preview of the review modal at the size and position you have chosen. Drag the card in the frame above to move it.' },
      { kind: 'heading', text: 'What you would see here' },
      { kind: 'list', items: ['The posting’s description', 'Its requirements', 'The fill report, behind the Fields tab'] },
    ],
    // A sample report, so the Fields tab shows its status dot: the preview is
    // meant to answer "does this size work", and an empty report would hide the
    // one piece of chrome most likely to be clipped by a bad one.
    matches: [
      { field: 'fullName', source: 'heuristic', confidence: 'high', filled: true, required: false, valueToFill: 'Ada Lovelace' },
      { field: 'city', source: 'none', confidence: 'none', filled: false, required: false },
    ],
    canSubmitCv: false,
    layout,
  };
}

/* ---------------- Site configs ---------------- */

function validateConfigs(data: unknown): asserts data is SiteConfig[] {
  if (!Array.isArray(data)) throw new Error('Top level must be an array of configs.');
  data.forEach((c, i) => {
    if (typeof c?.id !== 'string' || !c.id) throw new Error(`Config #${i + 1}: missing "id".`);
    if (!Array.isArray(c?.urlPatterns) || c.urlPatterns.length === 0) {
      throw new Error(`Config "${c.id}": "urlPatterns" must be a non-empty array.`);
    }
    if (typeof c?.extract !== 'object') throw new Error(`Config "${c.id}": missing "extract" object.`);
  });
}

/** Which config's plain-English summary is showing, by id. */
let explainedConfig: string | undefined;

/**
 * The saved configs as selectable chips. Picking one writes out what it will
 * actually do, in a sentence — until this existed, reading the JSON was the
 * only way to find out, and the JSON explains nothing about itself.
 */
function renderConfigSummary(configs: SiteConfig[]): void {
  const box = $('configs-summary');
  box.replaceChildren(...configs.map((c) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip chip-btn';
    chip.textContent = c.name || c.id;
    chip.title = c.urlPatterns.join('\n');
    chip.setAttribute('aria-pressed', String(explainedConfig === c.id));
    chip.addEventListener('click', () => {
      explainedConfig = explainedConfig === c.id ? undefined : c.id;
      renderConfigSummary(configs);
    });
    return chip;
  }));

  const explain = $('configs-explain');
  const chosen = configs.find((c) => c.id === explainedConfig);
  explain.hidden = !chosen;
  if (chosen) explain.replaceChildren(...richText(describeConfig(chosen)));
}

async function initConfigs(): Promise<void> {
  const ta = $<HTMLTextAreaElement>('configs-json');
  const configs = await getSiteConfigs();
  ta.value = JSON.stringify(configs, null, 2);
  renderConfigSummary(configs);
  renderReference($('configs-reference-body'));

  $('save-configs').addEventListener('click', async () => {
    try {
      const parsed = JSON.parse(ta.value);
      validateConfigs(parsed);
      await saveSiteConfigs(parsed);
      ta.value = JSON.stringify(parsed, null, 2);
      renderConfigSummary(parsed);
      setStatus($('configs-status'), 'Saved', 'ok');
    } catch (e) {
      setStatus($('configs-status'), (e as Error).message, 'err');
    }
  });

  $('add-template').addEventListener('click', () => appendTemplate(ta));
}

function appendTemplate(ta: HTMLTextAreaElement, url?: string): void {
  let arr: SiteConfig[] = [];
  try { arr = JSON.parse(ta.value); if (!Array.isArray(arr)) arr = []; } catch { arr = []; }
  arr.push(configTemplate(url));
  ta.value = JSON.stringify(arr, null, 2);
  $('configs-section').scrollIntoView({ behavior: 'smooth' });
}

/* ---------------- URL import ---------------- */

let previewUrls: string[] = [];

function renderPreview(): void {
  const box = $('urls-preview');
  if (previewUrls.length === 0) { box.replaceChildren(); return; }

  const head = document.createElement('b');
  head.textContent = `${previewUrls.length} URL(s) found.`;
  const ul = document.createElement('ul');
  ul.append(...previewUrls.map((u) => {
    const li = document.createElement('li');
    li.textContent = u;
    return li;
  }));
  const add = document.createElement('button');
  add.className = 'primary';
  add.textContent = `Add ${previewUrls.length} to the queue`;
  add.addEventListener('click', addParsed);

  box.replaceChildren(head, ul, add);
}

async function addParsed(): Promise<void> {
  const before = previewUrls.length;
  let added = 0;
  await mutateJobUrls((list) => {
    const res = addUrls(list, previewUrls);
    added = res.added;
    return res.list;
  });
  previewUrls = [];
  ($('urls-paste') as HTMLTextAreaElement).value = '';
  renderPreview();
  await renderQueue();
  const dupes = before - added;
  setStatus(
    $('extract-status'),
    `Added ${added} new URL(s)${dupes > 0 ? ` · ${dupes} already in the queue` : ''}`,
    'ok',
  );
}

/* ---------------- Queue ---------------- */

let urlFilter: JobUrlStatus | 'all' = 'all';
let urlQuery = '';
let shownCount = PAGE_SIZE;

function fmtDate(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Host + a trimmed path — a full wrapped URL made every row a different height. */
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const tail = `${u.pathname}${u.search}`.replace(/\/$/, '');
    return tail && tail !== '/' ? `${u.host}${tail}` : u.host;
  } catch {
    return url;
  }
}

const STATUS_KIND: Record<JobUrlStatus, string> = {
  new: '',
  opened: 'accent',
  redirected: 'accent',
  applied: 'ok',
  skipped: '',
};

function renderStats(list: JobUrlEntry[]): void {
  const s = jobUrlStats(list);
  const cards: Array<[string, number, string]> = [
    ['Total', s.total, ''],
    ['New', s.new, 'new'],
    ['Opened', s.opened, 'opened'],
    ['Redirected', s.redirected, 'redirected'],
    ['Applied', s.applied, 'applied'],
    ['Skipped', s.skipped, 'skipped'],
  ];
  $('url-stats').replaceChildren(...cards.map(([k, n, cls]) => {
    const card = document.createElement('div');
    card.className = `stat ${cls}`.trim();
    const num = document.createElement('div');
    num.className = 'n';
    num.textContent = String(n);
    const key = document.createElement('div');
    key.className = 'k';
    key.textContent = k;
    card.append(num, key);
    return card;
  }));
}

function renderFilters(list: JobUrlEntry[]): void {
  const stats = jobUrlStats(list);
  const counts: Record<string, number> = { all: stats.total, ...stats };
  const box = $('url-filters');
  box.replaceChildren(...(['all', ...ALL_STATUSES] as const).map((key) => {
    const b = document.createElement('button');
    b.className = 'filter';
    b.type = 'button';
    b.setAttribute('aria-pressed', String(urlFilter === key));
    b.textContent = `${key === 'all' ? 'All' : key} ${counts[key] ?? 0}`;
    b.addEventListener('click', () => {
      urlFilter = key as JobUrlStatus | 'all';
      shownCount = PAGE_SIZE;
      void renderQueue();
    });
    return b;
  }));
}

function visibleEntries(list: JobUrlEntry[]): JobUrlEntry[] {
  const q = urlQuery.trim().toLowerCase();
  return list.filter((e) => {
    if (urlFilter !== 'all' && e.status !== urlFilter) return false;
    if (q && !e.url.toLowerCase().includes(q)) return false;
    return true;
  });
}

async function renderQueue(): Promise<void> {
  const list = await getJobUrls();
  renderStats(list);
  renderFilters(list);
  await renderSession(list);

  const shown = visibleEntries(list);
  const page = shown.slice(0, shownCount);
  const ul = $('urls-list');

  if (page.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.style.border = 'none';
    empty.textContent = list.length === 0
      ? 'No postings yet — paste some links under “Import URLs”.'
      : 'Nothing matches this filter.';
    ul.replaceChildren(empty);
  } else {
    ul.replaceChildren(...page.map(urlRow));
  }

  const more = $<HTMLButtonElement>('show-more');
  more.hidden = shown.length <= shownCount;
  more.textContent = `Show more (${shown.length - page.length} left)`;
}

function urlRow(entry: JobUrlEntry): HTMLElement {
  const li = document.createElement('li');

  const meta = document.createElement('div');
  meta.className = 'meta';
  const a = document.createElement('a');
  a.href = entry.url;
  a.target = '_blank';
  a.rel = 'noreferrer';
  a.textContent = shortUrl(entry.url);
  a.title = entry.url;

  const sub = document.createElement('div');
  sub.className = 'sub';
  const chip = document.createElement('span');
  chip.className = `chip ${STATUS_KIND[entry.status]}`.trim();
  chip.textContent = entry.status;

  const info = document.createElement('small');
  const bits = [`added ${fmtDate(entry.addedAt)}`];
  if (entry.appliedAt) bits.push(`applied ${fmtDate(entry.appliedAt)}`);
  // Two-step postings: show which end of the handoff this row is.
  if (entry.redirectUrl) bits.push(`→ ${hostOf(entry.redirectUrl)}`);
  if (entry.sourceUrl) bits.push(`via ${hostOf(entry.sourceUrl)}`);
  info.textContent = bits.join(' · ');
  info.title = [
    ...(entry.sourceUrl ? [`from ${entry.sourceUrl}`] : []),
    ...(entry.redirectUrl ? [`applies at ${entry.redirectUrl}`] : []),
    ...entry.history.map((h) => `${h.status} @ ${new Date(h.at).toLocaleString()}`),
  ].join('\n');

  sub.append(chip, info);
  meta.append(a, sub);

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(inlineActions(entry), rowMenu(entry));

  li.append(meta, actions);
  return li;
}

async function setEntryStatus(url: string, status: JobUrlStatus): Promise<void> {
  await mutateJobUrls((all) => applyStatus(all, url, status));
  await renderQueue();
}

/** Desktop: status select + Remove, side by side. CSS hides this under 640px. */
function inlineActions(entry: JobUrlEntry): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'inline-actions actions';

  const status = document.createElement('select');
  status.setAttribute('aria-label', `Status for ${shortUrl(entry.url)}`);
  for (const s of ALL_STATUSES) {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    if (s === entry.status) opt.selected = true;
    status.appendChild(opt);
  }
  status.addEventListener('change', () => setEntryStatus(entry.url, status.value as JobUrlStatus));

  const remove = document.createElement('button');
  remove.textContent = 'Remove';
  remove.addEventListener('click', () => removeWithUndo(entry));

  wrap.append(status, remove);
  return wrap;
}

/** Narrow: one 44px ⋮ button holding the same actions. CSS hides it above 640px. */
function rowMenu(entry: JobUrlEntry): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'rowmenu';

  const toggle = document.createElement('button');
  toggle.textContent = '⋮';
  toggle.setAttribute('aria-label', `Actions for ${shortUrl(entry.url)}`);
  toggle.setAttribute('aria-expanded', 'false');

  const menu = document.createElement('div');
  menu.className = 'rowmenu-list';
  menu.hidden = true;

  for (const s of ALL_STATUSES) {
    const b = document.createElement('button');
    b.textContent = s === entry.status ? `✓ ${s}` : `Mark ${s}`;
    b.addEventListener('click', () => setEntryStatus(entry.url, s));
    menu.append(b);
  }
  const remove = document.createElement('button');
  remove.className = 'btn-danger';
  remove.textContent = 'Remove';
  remove.addEventListener('click', () => removeWithUndo(entry));
  menu.append(remove);

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllMenus(menu);
    menu.hidden = !menu.hidden;
    toggle.setAttribute('aria-expanded', String(!menu.hidden));
  });

  wrap.append(toggle, menu);
  return wrap;
}

function closeAllMenus(except?: HTMLElement): void {
  document.querySelectorAll<HTMLElement>('.rowmenu-list').forEach((m) => {
    if (m !== except) m.hidden = true;
  });
  document.querySelectorAll('.rowmenu > button').forEach((b) => b.setAttribute('aria-expanded', 'false'));
}

/* ---------------- Undo ---------------- */

let undoTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Remove is a single tap on a row that is easy to mis-hit on a phone, and the
 * entry carries a status history that cannot be reconstructed — so it gets a
 * grace period rather than a confirmation dialog in the way of every delete.
 */
async function removeWithUndo(entry: JobUrlEntry): Promise<void> {
  const list = await getJobUrls();
  const index = list.findIndex((e) => e.url === entry.url);
  await mutateJobUrls((all) => removeUrl(all, entry.url));
  await renderQueue();

  showToast(`Removed ${shortUrl(entry.url)}`, 'Undo', async () => {
    await mutateJobUrls((all) => {
      if (all.some((e) => e.url === entry.url)) return all;
      const next = [...all];
      next.splice(Math.min(index < 0 ? next.length : index, next.length), 0, entry);
      return next;
    });
    await renderQueue();
  });
}

function showToast(label: string, action: string, onAction: () => void): void {
  const toast = $('toast');
  const button = $<HTMLButtonElement>('toast-action');
  $('toast-label').textContent = label;
  button.textContent = action;
  toast.hidden = false;

  const clone = button.cloneNode(true) as HTMLButtonElement;
  button.replaceWith(clone);
  clone.addEventListener('click', () => {
    toast.hidden = true;
    clearTimeout(undoTimer);
    onAction();
  });

  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { toast.hidden = true; }, 6000);
}

/* ---------------- Session ---------------- */

function sendBg<T>(type: string, extra: Record<string, unknown> = {}): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...extra }, (resp) => {
      if (chrome.runtime.lastError) return resolve(undefined);
      resolve(resp as T);
    });
  });
}

let session: SessionState | undefined;

async function renderSession(list: JobUrlEntry[]): Promise<void> {
  session = await sendBg<SessionState>(MSG.SESSION_STATE);
  const lead = $('session-lead');
  const sub = $('session-sub');
  const toggle = $<HTMLButtonElement>('session-toggle');
  const batch = $<HTMLInputElement>('batch-size');

  const p = session?.progress;
  const queued = p?.queued ?? list.filter((e) => e.status === 'new').length;

  if (session?.active) {
    lead.textContent = `Running — ${p?.inFlight ?? 0} tab(s) open`;
    toggle.textContent = 'Stop session';
    toggle.className = '';
  } else {
    lead.textContent = queued > 0 ? `${queued} posting(s) waiting` : 'Queue is empty';
    toggle.textContent = 'Start session';
    toggle.className = 'primary';
    toggle.disabled = queued === 0;
  }
  sub.textContent = p
    ? `${p.applied} applied · ${p.skipped} skipped · ${p.done}/${p.total} done`
    : '';

  if (document.activeElement !== batch) {
    batch.value = String(session?.batchSize ?? (await getSettings()).sessionBatchSize);
  }
}

async function initSession(): Promise<void> {
  const batch = $<HTMLInputElement>('batch-size');

  // A phone cannot hold five job pages in memory, let alone on screen.
  if (matchMedia('(pointer: coarse)').matches) {
    const settings = await getSettings();
    if (settings.sessionBatchSize > 2) batch.placeholder = '2 suggested on mobile';
  }

  batch.addEventListener('change', async () => {
    const size = Math.min(20, Math.max(1, Number(batch.value) || 1));
    batch.value = String(size);
    const s = await getSettings();
    await saveSettings({ ...s, sessionBatchSize: size });
    // Resizing while running takes effect immediately: a bigger window tops up,
    // a smaller one simply stops refilling until it drains to the new size.
    if (session?.active) await sendBg(MSG.SESSION_START, { batchSize: size });
    await renderQueue();
  });

  $('session-toggle').addEventListener('click', async () => {
    if (session?.active) {
      await sendBg(MSG.SESSION_STOP);
    } else {
      await sendBg(MSG.SESSION_START, { batchSize: Number(batch.value) || undefined });
    }
    await renderQueue();
  });
}

/* ---------------- Queue actions ---------------- */

async function initUrls(): Promise<void> {
  $('extract-urls').addEventListener('click', () => {
    const raw = ($('urls-paste') as HTMLTextAreaElement).value;
    previewUrls = extractUrls(raw);
    renderPreview();
    if (previewUrls.length === 0) setStatus($('extract-status'), 'No URLs found', 'err');
  });

  $('url-search').addEventListener('input', (e) => {
    urlQuery = (e.target as HTMLInputElement).value;
    shownCount = PAGE_SIZE;
    void renderQueue();
  });

  $('show-more').addEventListener('click', () => {
    shownCount += PAGE_SIZE;
    void renderQueue();
  });

  $('open-new').addEventListener('click', async () => {
    const list = await getJobUrls();
    const urls = list.filter((e) => e.status === 'new').map((e) => e.url);
    if (urls.length === 0) { setStatus($('queue-status'), 'No “new” URLs to open', 'err'); return; }
    await sendBg(MSG.OPEN_URLS, { urls });
    setStatus($('queue-status'), `Opening ${urls.length}…`, 'ok');
    setTimeout(renderQueue, 600);
  });

  // Clearing the database is unrecoverable and used to happen on one tap.
  const confirmBox = $('clear-confirm');
  $('clear-urls').addEventListener('click', async () => {
    const list = await getJobUrls();
    if (list.length === 0) { setStatus($('queue-status'), 'Queue is already empty', 'err'); return; }
    $('clear-confirm-label').textContent =
      `Delete all ${list.length} posting(s) and their history? This cannot be undone.`;
    confirmBox.hidden = false;
  });
  $('clear-cancel').addEventListener('click', () => { confirmBox.hidden = true; });
  $('clear-really').addEventListener('click', async () => {
    await saveJobUrls([]);
    confirmBox.hidden = true;
    shownCount = PAGE_SIZE;
    await renderQueue();
    setStatus($('queue-status'), 'Queue cleared', 'ok');
  });

  document.addEventListener('click', () => closeAllMenus());

  await renderQueue();
}

/* ---------------- Getting started ---------------- */

/**
 * The first-run checklist. Every step's tick is derived from storage rather
 * than remembered, so it cannot claim something is done that is not — and the
 * whole card disappears once the list is finished or dismissed.
 *
 * It lives on the Queue tab because that is where the page opens, and a new
 * user's problem is not "which tab" but "what am I supposed to do first".
 */
async function renderGettingStarted(): Promise<void> {
  const section = $('start-section');
  const settings = await getSettings();
  if (settings.helpSeen) { section.hidden = true; return; }

  const [profile, cv, urls, configs] = await Promise.all([
    getProfile(), getCv(), getJobUrls(), getSiteConfigs(),
  ]);

  const steps: Array<{ label: string; done: boolean; tab?: TabName }> = [
    {
      label: 'Add your details',
      done: Object.values(profile.values).some((v) => v?.trim()),
      tab: 'profile',
    },
    { label: 'Upload your CV', done: !!cv, tab: 'profile' },
    { label: 'Paste some job links', done: urls.length > 0, tab: 'queue' },
    {
      // The seeded example config matches only the local test fixture, so it is
      // not evidence that the user has set up a site of their own.
      label: 'Open a posting and press “Set up this site”',
      done: configs.some((c) => c.id !== 'example-fixture'),
    },
    { label: 'Start a session', done: urls.some((u) => u.status !== 'new'), tab: 'queue' },
  ];

  // Nothing left to guide: stop taking up the top of the page.
  section.hidden = steps.every((s) => s.done);
  if (section.hidden) return;

  $('start-steps').replaceChildren(...steps.map((step) => {
    const li = document.createElement('li');
    li.className = `startstep${step.done ? ' done' : ''}`;

    const mark = document.createElement('span');
    mark.className = 'startstep-mark';
    mark.textContent = step.done ? '✓' : '';
    // The tick is a state, not decoration, and the class carrying it is invisible
    // to a screen reader.
    mark.setAttribute('aria-label', step.done ? 'done' : 'to do');

    const label = document.createElement('span');
    label.className = 'startstep-label';
    label.textContent = step.label;

    li.append(mark, label);
    if (step.tab && !step.done) {
      const go = document.createElement('button');
      go.className = 'btn-ghost startstep-go';
      go.textContent = 'Go →';
      go.addEventListener('click', () => selectTab(step.tab!));
      li.append(go);
    }
    return li;
  }));
}

function initGettingStarted(): void {
  $('start-dismiss').addEventListener('click', async () => {
    $('start-section').hidden = true;
    const settings = await getSettings();
    await saveSettings({ ...settings, helpSeen: true });
  });
}

/* ---------------- Boot ---------------- */

async function main(): Promise<void> {
  initTabs();
  initHelp();
  initGettingStarted();
  await Promise.all([initProfile(), initCv(), initSettings(), initConfigs(), initSession(), initUrls()]);
  await renderGettingStarted();

  // Deep link: `#sites&create=<url>` (and the bare `#create=<url>` the popup and
  // setup panel still send) pre-adds a config template on the Sites tab.
  const { tab, create } = parseHash();
  if (create) {
    selectTab('sites', false);
    appendTemplate($<HTMLTextAreaElement>('configs-json'), create);
  } else {
    selectTab(tab ?? 'queue', false);
  }

  // The session runs in the background; reflect its progress without a reload.
  // The checklist ticks off the same events, so it refreshes here too.
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local' || area === 'session') {
      void renderQueue();
      void renderGettingStarted();
    }
  });
}

main().catch((e) => console.error('[chromium-filler] options failed', e));
