/**
 * Options page: the job queue (session control + URL database), the profile —
 * your details, your own fields, the CV and cover letter, and what the extension
 * has been taught — behavior settings, Sync, and Help.
 *
 * The five areas are tabs rather than one long scroll — the queue is the only
 * part used daily, and on a phone it used to sit behind everything else.
 *
 * Everything explanatory on this page renders from `shared/help.ts`, never from
 * copy written here: the same words have to reach the review card, and two
 * copies of an explanation is how they end up contradicting each other.
 */

import type {
  CustomField, CustomFieldKind, DocKind, JobUrlEntry, JobUrlStatus, Lesson, ModalLayout,
  Profile, TextFieldKey,
} from '../shared/types';
import type { SessionState, SyncState } from '../shared/messages';
import {
  activeLimits, ALL_LIMITS, clampLayout, DEFAULT_MODAL_LAYOUT, describeLimits, layoutLimits,
  modelledViewport, nudgeLayout, sampleScreen, snapLayout,
  type DragMode, type ModelledViewport, type ScreenMetrics, type ScreenSample,
} from '../shared/modalLayout';
// The real review modal, rendered over this page for the full-size preview —
// the same trick the dev harness uses. A mock of it would only ever be a lie
// about the thing being configured.
import { FillerModal, type ModalCallbacks, type ModalData } from '../content/modal/modal';
import { FIELD_ORDER, FIELD_LABELS } from '../shared/fieldKeys';
import { fieldLabel, newCustomField } from '../shared/profileFields';
import { dropField, forget, lessonsFor, targetField } from '../shared/lessons';
import { isFragile } from '../shared/inputSignature';
import { extractUrls } from '../shared/urlImport';
import {
  ALL_JOB_STATUSES, addUrls, applyStatus, deleteUrl, jobUrlStats, markOpenedDone, visibleUrls,
} from '../shared/jobUrls';
import { hostOf } from '../shared/url';
import { MSG } from '../shared/messages';
import {
  getProfile, saveProfile, mutateProfile, getSettings, saveSettings,
  getLessons, mutateLessons,
  getJobUrls, mutateJobUrls,
  getJobDetails, saveJobDetails, mutateJobDetails,
} from '../shared/storage';
import { pruneDetails } from '../shared/jobDetails';
import {
  EXPORT_FIELD_ORDER, buildExport, exportFilename, resolveExport, toCsv,
  type ExportFormat, type ExportSelection,
} from '../shared/jobExport';
import { EXPORT_FIELD_LABELS, JOB_STATUS_LABELS } from '../shared/labels';
import {
  buildSnapshot, mergeIntoLocal, parseSnapshot, snapshotFilename,
} from '../shared/syncSnapshot';
import { getCv, getDoc, setDoc, clearDoc } from '../shared/cvStore';
import { readSyncClient } from '../shared/syncConfig';
import {
  CONCEPT_HELP, SETTINGS_HELP, SYNC_SETUP_STEPS, SYNC_TROUBLESHOOTING,
  type GuideStep, type HelpEntry,
} from '../shared/help';
import { helpButton, helpPanel, richText } from '../ui/help';
import { setLimitAttrs } from '../ui/limits';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

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

const TABS = ['queue', 'profile', 'settings', 'sync', 'help'] as const;
type TabName = (typeof TABS)[number];

function selectTab(name: TabName, pushHash = true): void {
  const changed = $(`tab-${name}`).getAttribute('aria-selected') !== 'true';
  for (const tab of TABS) {
    const button = $(`tab-${tab}`);
    const panel = $(`panel-${tab}`);
    const active = tab === name;
    button.setAttribute('aria-selected', String(active));
    panel.hidden = !active;
  }
  // Which of the panel's two top corners a tab is standing on. The strip spans
  // the panel, so only the first and last tabs touch one; every other tab leaves
  // both corners exposed and they have to be rounded. See options.css.
  document.body.dataset.tabPos =
    name === TABS[0] ? 'first' : name === TABS[TABS.length - 1] ? 'last' : 'mid';
  // A tab switch is a navigation: the panel underneath has been replaced whole,
  // so keeping the old scroll offset opens the new one halfway down itself with
  // its first section — the one the tab is named after — above the viewport.
  //
  // Instant, not smooth: there is nothing left on screen to follow, and the
  // smooth scroll belongs to `revealSection`, which is a journey *to* a place.
  // Only on a real change, so the deep links that call `selectTab` and then
  // `revealSection` (boot, and the checklist's "Go →") are left alone when the
  // tab they name is already the open one.
  if (changed) window.scrollTo({ top: 0 });
  if (pushHash) location.hash = name;
}

const flashing = new WeakMap<Element, number>();

/**
 * Mark where a jump landed. Pressing the same Go twice has to re-play the ring,
 * and re-adding a class the element already carries restarts nothing — hence the
 * remove / reflow / add.
 */
function flashSection(el: HTMLElement): void {
  clearTimeout(flashing.get(el));
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
  flashing.set(el, window.setTimeout(() => el.classList.remove('flash'), 1200));
}

/**
 * Take the user to a section, not just to its tab. A bare `scrollIntoView` parks
 * the heading behind the sticky topbar, and focusing the control would scroll it
 * back under there — hence the measured offset and `preventScroll`. The bar is
 * measured per call because the tab strip is taller once it wraps.
 */
function revealSection(id: string, focus?: string): void {
  const el = $(id);
  const bar = document.querySelector<HTMLElement>('.topbar');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const top = el.getBoundingClientRect().top + window.scrollY - (bar?.offsetHeight ?? 0) - 12;
  window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
  if (focus) document.querySelector<HTMLElement>(focus)?.focus({ preventScroll: true });
  flashSection(el);
}

/**
 * `#sites&create=<url>`, `#queue&at=import-section&focus=%23urls-paste` — and the
 * legacy bare `#create=<url>` the popup still sends.
 *
 * `at` is a section id and `focus` a selector inside it; together they are what
 * lets a caller name a *place* rather than a tab. See `revealSection`.
 */
function parseHash(): { tab?: TabName; at?: string; focus?: string } {
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return {};
  const parts = raw.split('&');
  const tab = TABS.find((t) => t === parts[0]);
  const param = (name: string) => {
    const hit = parts.find((p) => p.startsWith(`${name}=`));
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : undefined;
  };
  return { tab, at: param('at'), focus: param('focus') };
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

/**
 * Say, in a gradient at each end of the page, that there is more of it.
 *
 * This page scrolls in the window and the platform scrollbar is an overlay that
 * is invisible at rest, so a section clipped by the bottom of the viewport looks
 * exactly like a section that ends there — which is the whole reason the queue's
 * lower rows and the simulator's buttons kept going unnoticed.
 *
 * A `ResizeObserver` on `<main>` and not just a scroll listener: switching tab,
 * opening a `?`, and rendering the queue all change how far the page scrolls
 * without scrolling it, and a fade left showing at the very bottom is worse than
 * no fade at all. The 4px slack absorbs fractional device-pixel scroll heights,
 * where `scrollY` never quite reaches its own maximum.
 */
function initScrollFade(): void {
  const update = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const tokens = [];
    if (window.scrollY > 4) tokens.push('up');
    if (window.scrollY < max - 4) tokens.push('down');
    document.body.dataset.scroll = tokens.join(' ');
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  new ResizeObserver(update).observe(document.querySelector('main')!);
  update();
}

/* ---------------- Profile ---------------- */

/**
 * Write back only the fields a given form owns, leaving the rest of the profile
 * alone. Two forms now edit `profile.values` — the grid here and the cover
 * letter's own section — and the old "collect everything, replace `values`"
 * would have had each of them delete the other's field on save.
 */
async function saveValues(inputs: Iterable<HTMLInputElement | HTMLTextAreaElement>): Promise<void> {
  const current = await getProfile();
  const values: Profile['values'] = { ...current.values };
  for (const el of inputs) {
    const key = el.dataset.field as TextFieldKey;
    const v = el.value.trim();
    if (v) values[key] = v;
    else delete values[key];
  }
  await saveProfile({ ...current, values });
}

/** A form whose edits need an explicit Save, with the dirty bar that says so. */
function bindSavebar(form: HTMLElement, savebar: HTMLElement, save: () => Promise<void>): void {
  // The behavior settings save silently on change while these forms need an
  // explicit Save; the difference has to be visible, or edits get lost on a
  // tab switch. The bar appears the moment anything is dirty.
  form.addEventListener('input', () => { savebar.hidden = false; });
  window.addEventListener('beforeunload', (e) => {
    if (!savebar.hidden) e.preventDefault();
  });
  savebar.querySelector('button')!.addEventListener('click', async () => {
    await save();
    savebar.hidden = true;
  });
}

async function initProfile(): Promise<void> {
  const container = $('profile-fields');
  const savebar = $('profile-savebar');
  const profile = await getProfile();

  // `FIELD_ORDER`, so the form you type into is in the same order as the report
  // you read afterwards. The two documents are excluded — each has its own
  // section below, because each is a file as well as (or instead of) a value.
  for (const field of FIELD_ORDER) {
    if (field === 'resume' || field === 'coverLetter') continue;
    const key = field as TextFieldKey;
    const label = document.createElement('label');
    label.className = 'fld';
    label.textContent = FIELD_LABELS[field];
    const input = document.createElement('input');
    input.dataset.field = key;
    input.value = profile.values[key] ?? '';
    label.appendChild(input);
    container.appendChild(label);
  }

  bindSavebar(container, savebar, async () => {
    await saveValues(container.querySelectorAll<HTMLInputElement>('[data-field]'));
    setStatus($('profile-status'), 'Saved', 'ok');
  });
}

/* ---------------- Wordings ---------------- */

/**
 * A list of wordings as chips, with a box to add one. Enter or a comma adds what
 * is typed; × on a chip removes it. `onChange` gets the whole new list — the
 * caller decides where it is stored.
 */
function chipEditor(values: string[], placeholder: string, label: string, onChange: (next: string[]) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'chipedit';
  let list = [...values];

  const draw = () => {
    wrap.replaceChildren(...list.map((v, i) => {
      const chip = document.createElement('span');
      chip.className = 'chip chipedit-chip';
      const text = document.createElement('span');
      text.textContent = v;
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'chipedit-x';
      x.textContent = '×';
      x.setAttribute('aria-label', `Remove “${v}”`);
      x.addEventListener('click', () => {
        list = list.filter((_, j) => j !== i);
        onChange(list);
        draw();
        input.focus();
      });
      chip.append(text, x);
      return chip;
    }), input);
  };

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'chipedit-input';
  input.placeholder = placeholder;
  input.setAttribute('aria-label', label);
  const commit = () => {
    const words = input.value.split(',').map((w) => w.trim()).filter(Boolean)
      .filter((w) => !list.some((x) => x.toLowerCase() === w.toLowerCase()));
    input.value = '';
    if (!words.length) return;
    list = [...list, ...words];
    onChange(list);
    draw();
    input.focus();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
    if (e.key === 'Backspace' && !input.value && list.length) {
      list = list.slice(0, -1);
      onChange(list);
      draw();
      input.focus();
    }
  });
  input.addEventListener('blur', commit);
  draw();
  return wrap;
}

/**
 * Extra wordings for the built-in fields, behind a disclosure: the built-ins
 * already know the common phrasings, and sixteen chip editors in the open would
 * bury the form. This is for the board that asks for "Christian name".
 */
async function initWordings(): Promise<void> {
  const body = $('wordings-body');
  const profile = await getProfile();
  body.replaceChildren(...FIELD_ORDER.map((field) => {
    const row = document.createElement('div');
    row.className = 'wording-row';
    const name = document.createElement('span');
    name.className = 'wording-name';
    name.textContent = FIELD_LABELS[field];
    row.append(name, chipEditor(profile.keywords?.[field] ?? [], 'Add a wording…', `Other wordings for ${FIELD_LABELS[field]}`, (next) => {
      void mutateProfile((p) => ({ ...p, keywords: { ...p.keywords, [field]: next } }))
        .then(() => setStatus($('wordings-status'), 'Saved', 'ok'));
    }));
    return row;
  }));
}

/* ---------------- Your own fields ---------------- */

const KIND_LABELS: Record<CustomFieldKind, string> = {
  text: 'Short answer',
  longText: 'Long answer',
  yesNo: 'Yes / No',
};

/** Save one custom field's edit, without rewriting the others. */
async function patchCustomField(id: string, patch: Partial<CustomField>): Promise<void> {
  await mutateProfile((p) => ({
    ...p,
    customFields: (p.customFields ?? []).map((f) => (f.id === id ? { ...f, ...patch } : f)),
  }));
  setStatus($('custom-status'), 'Saved', 'ok');
}

/** The answer box, shaped by the kind: a line, a paragraph, or Yes/No. */
function answerControl(field: CustomField): HTMLElement {
  if (field.kind === 'yesNo') {
    const select = document.createElement('select');
    select.className = 'custom-value';
    for (const v of ['', 'Yes', 'No']) select.append(new Option(v || 'Choose…', v));
    select.value = field.value;
    select.addEventListener('change', () => void patchCustomField(field.id, { value: select.value }));
    return select;
  }
  const box = field.kind === 'longText' ? document.createElement('textarea') : document.createElement('input');
  box.className = 'custom-value';
  if (box instanceof HTMLTextAreaElement) box.rows = 3;
  box.value = field.value;
  box.placeholder = 'Your answer';
  box.addEventListener('change', () => void patchCustomField(field.id, { value: box.value.trim() }));
  return box;
}

function customCard(field: CustomField, lessons: Lesson[]): HTMLElement {
  const card = document.createElement('div');
  card.className = 'custom-card';
  card.dataset.field = field.id;

  const head = document.createElement('div');
  head.className = 'custom-head';
  const name = document.createElement('input');
  name.className = 'custom-name';
  name.value = field.label;
  name.placeholder = 'Field name, e.g. Years of experience';
  name.setAttribute('aria-label', 'Field name');
  name.addEventListener('change', () => {
    const label = name.value.trim();
    if (label) void patchCustomField(field.id, { label });
    else name.value = field.label;
  });

  const kind = document.createElement('select');
  kind.className = 'custom-kind';
  kind.setAttribute('aria-label', 'Kind of answer');
  for (const [k, label] of Object.entries(KIND_LABELS)) kind.append(new Option(label, k));
  kind.value = field.kind;
  kind.addEventListener('change', async () => {
    await patchCustomField(field.id, { kind: kind.value as CustomFieldKind });
    await renderCustomFields();
  });

  // Remove asks first when lessons point at the field: they would be deleted with
  // it, and a lesson is something the user taught, not something to lose by a
  // stray press. The confirm is the button itself, worded with the count.
  const used = lessonsFor(lessons, field.id).length;
  const remove = document.createElement('button');
  remove.className = 'btn-danger custom-remove';
  remove.textContent = 'Remove';
  let armed = false;
  remove.addEventListener('click', async () => {
    if (used && !armed) {
      armed = true;
      remove.textContent = `Remove, and ${used} lesson${used === 1 ? '' : 's'}?`;
      return;
    }
    await mutateProfile((p) => ({ ...p, customFields: (p.customFields ?? []).filter((f) => f.id !== field.id) }));
    await mutateLessons((l) => dropField(l, field.id));
    await renderCustomFields();
    await renderLearned();
  });
  remove.addEventListener('blur', () => {
    if (!armed) return;
    armed = false;
    remove.textContent = 'Remove';
  });
  head.append(name, kind, remove);

  const answer = document.createElement('label');
  answer.className = 'custom-line';
  const answerCap = document.createElement('span');
  answerCap.className = 'custom-cap';
  answerCap.textContent = 'Answer';
  answer.append(answerCap, answerControl(field));

  const words = document.createElement('div');
  words.className = 'custom-line';
  const wordsCap = document.createElement('span');
  wordsCap.className = 'custom-cap';
  wordsCap.textContent = 'Answers questions like';
  words.append(wordsCap, chipEditor(field.keywords, 'Add a wording…', `Questions ${field.label} answers`, (next) => {
    void patchCustomField(field.id, { keywords: next });
  }));

  card.append(head, answer, words);
  if (used) {
    const meta = document.createElement('small');
    meta.className = 'custom-meta';
    meta.textContent = `Also answers ${used} question${used === 1 ? '' : 's'} you taught it — listed under What it has learned.`;
    card.append(meta);
  }
  return card;
}

async function renderCustomFields(): Promise<void> {
  const [profile, lessons] = await Promise.all([getProfile(), getLessons()]);
  const list = $('custom-fields');
  const fields = profile.customFields ?? [];
  list.replaceChildren(...fields.map((f) => customCard(f, lessons)));
  $('custom-empty').hidden = fields.length > 0;
}

function initCustomFields(): Promise<void> {
  attachHelp($('custom-heading'), CONCEPT_HELP.customFields);
  $('custom-add').addEventListener('click', async () => {
    const field = newCustomField('', 'text');
    field.label = 'New field';
    await mutateProfile((p) => ({ ...p, customFields: [...(p.customFields ?? []), field] }));
    await renderCustomFields();
    const name = document.querySelector<HTMLInputElement>(`.custom-card[data-field="${field.id}"] .custom-name`);
    name?.focus();
    name?.select();
  });
  return renderCustomFields();
}

/* ---------------- What it has learned ---------------- */

/**
 * Every lesson, under the field it answers — so the question "why did it put my
 * phone number there?" has a place to be answered, and undone. Grouped rather than
 * listed by date, because a wrong lesson is found by the field it went wrong on.
 */
async function renderLearned(): Promise<void> {
  const [profile, lessons] = await Promise.all([getProfile(), getLessons()]);
  const box = $('learned-list');
  $('learned-empty').hidden = lessons.length > 0;

  const groups = new Map<string, Lesson[]>();
  for (const l of lessons) {
    const key = targetField(l) ?? '__ignore';
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  const order = [...groups.keys()].sort((a, b) => {
    if (a === '__ignore') return 1;
    if (b === '__ignore') return -1;
    return fieldLabel(profile, a).localeCompare(fieldLabel(profile, b));
  });

  box.replaceChildren(...order.map((key) => {
    const group = document.createElement('div');
    group.className = 'learned-group';
    const head = document.createElement('h4');
    head.className = 'learned-head';
    head.textContent = key === '__ignore' ? 'Ignored questions' : fieldLabel(profile, key);
    group.append(head);
    for (const lesson of groups.get(key)!) {
      const row = document.createElement('div');
      row.className = 'learned-row';
      const text = document.createElement('div');
      text.className = 'learned-text';
      const q = document.createElement('span');
      q.className = 'learned-q';
      q.textContent = `“${lesson.label}”`;
      const meta = document.createElement('small');
      const bits = [
        lesson.taughtOn ? `taught on ${lesson.taughtOn}` : undefined,
        lesson.hits ? `used ${lesson.hits} time${lesson.hits === 1 ? '' : 's'}` : 'not used yet',
        lesson.signature.section ? `in “${lesson.signature.section}”` : undefined,
      ].filter(Boolean);
      meta.textContent = bits.join(' · ');
      text.append(q, meta);
      if (isFragile(lesson.signature)) {
        const chip = document.createElement('span');
        chip.className = 'chip warn';
        chip.textContent = lesson.signature.host ? 'this site only' : 'by position';
        chip.title = lesson.signature.host
          ? 'The page gave this box no words of its own, so the lesson only applies on the site it was taught on.'
          : 'Several identical boxes on that page: the lesson remembers which one by its position.';
        text.append(chip);
      }
      const remove = document.createElement('button');
      remove.className = 'btn-ghost learned-remove';
      remove.textContent = 'Forget';
      remove.setAttribute('aria-label', `Forget the lesson for “${lesson.label}”`);
      remove.addEventListener('click', async () => {
        await mutateLessons((l) => forget(l, lesson.id));
        await renderLearned();
        await renderCustomFields();
      });
      row.append(text, remove);
      group.append(row);
    }
    return group;
  }));
}

function initLearned(): Promise<void> {
  attachHelp($('learned-heading'), CONCEPT_HELP.teaching);
  return renderLearned();
}

/* ---------------- The two documents ---------------- */

/**
 * A stored document's row: the picker, what is held, and Remove. One function
 * for both, so the CV and the cover-letter upload cannot drift apart.
 */
function initDoc(kind: DocKind, ids: { input: string; current: string; clear: string }): Promise<void> {
  const input = $<HTMLInputElement>(ids.input);
  const current = $(ids.current);
  const show = async () => {
    const doc = await getDoc(kind);
    current.textContent = doc
      ? `Current: ${doc.name} (${Math.round(doc.data.byteLength / 1024)} KB)`
      : 'None stored.';
  };
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    await setDoc(kind, file);
    await show();
  });
  $(ids.clear).addEventListener('click', async () => {
    await clearDoc(kind);
    input.value = '';
    await show();
  });
  return show();
}

async function initCv(): Promise<void> {
  await initDoc('resume', { input: 'cv-input', current: 'cv-current', clear: 'clear-cv' });
}

/** Text *and* file — see `CONCEPT_HELP.coverLetter` for why both are offered. */
async function initCoverLetter(): Promise<void> {
  const text = $<HTMLTextAreaElement>('cover-text');
  text.dataset.field = 'coverLetter';
  text.value = (await getProfile()).values.coverLetter ?? '';

  const section = $('cover-section');
  attachHelp(section.querySelector('h2')!, CONCEPT_HELP.coverLetter);
  section.querySelector('.hint')!.textContent = CONCEPT_HELP.coverLetter.short ?? '';

  bindSavebar(text, $('cover-savebar'), () => saveValues([text]));
  await initDoc('coverLetter', {
    input: 'cover-input', current: 'cover-current', clear: 'clear-cover',
  });
}

/* ---------------- Inline help ---------------- */

/**
 * Attaches a `?` to a control's label, disclosing that setting's explanation
 * directly beneath it. The catalog is the copy; this only decides where it goes.
 */
function attachHelp(
  anchor: HTMLElement,
  entry: HelpEntry,
  /**
   * Where the panel goes. A sibling of the anchor by default — but a `.setrow`
   * lives in a `repeat(auto-fit, …)` grid, and a panel inserted *after* one is a
   * new grid item: pressing a `?` on the first setting shunted every following
   * row into a different column. Those callers place it inside the row instead,
   * so the row grows and nothing else moves.
   */
  place: (panel: HTMLElement) => void = (panel) => anchor.after(panel),
): void {
  let panel: HTMLElement | undefined;
  anchor.append(helpButton(entry.title, false, (open) => {
    panel?.remove();
    panel = undefined;
    if (open) {
      panel = helpPanel(entry);
      place(panel);
    }
  }));
}

/**
 * Each settings row gets the catalog's one-line `short` as its caption and the full
 * entry behind a `?`. The reference captions every settings row, and writing those
 * lines into the HTML meant the row and the `?` beside it could disagree — which
 * they had already started to. The `?` is anchored in the title so it sits inline
 * with it; the panel opens below the whole row, past the caption.
 *
 * Module scope rather than inside `initSettings`, because the Sync section renders
 * its row the same way and a second copy is how the two would drift.
 */
function attachRowHelp(control: HTMLElement, entry: HelpEntry): void {
  const row = control.closest('.setrow') as HTMLElement;
  const text = row.querySelector('.setrow-text') as HTMLElement;
  // The `?` goes in the text block, so it rides at the end of the title it
  // explains. Anchoring it inside the `h5` — which is what this did — drove a
  // control through the middle of a text block; the caption is no longer in
  // there at all, so nothing runs through anything now.
  attachHelp(text, entry, (panel) => {
    panel.classList.add('setrow-help');
    row.append(panel);
  });
  if (entry.short) {
    // A span, not a <p>: this used to live inside the text block, half of which
    // are the control's own <label> and take phrasing content only.
    const caption = document.createElement('span');
    caption.className = 'setrow-caption';
    caption.textContent = entry.short;
    // A *sibling* of the text block, and the last thing in the row. Inside the
    // block it made that block two lines tall, and `align-items: center` then
    // centred the toggle against both — so every switch on this page sat half a
    // line below the title it belongs to. Last, not straight after the text: its
    // `flex: 1 0 100%` starts a new line, which between the title and the control
    // would have taken the control down with it. The lazily-built `?` panel is
    // appended to the row too, so it still opens beneath this.
    row.append(caption);
  }
}

/** The Help tab. Static content, all of it from the catalog. */
function initHelp(): void {
  const flow = [
    'You save your details and your CV once, on the Profile tab — and any questions you '
      + 'get asked a lot as fields of your own.',
    'You open a job posting — by hand, or from the queue.',
    'Every input on the page goes past the extension. What it recognises is filled and '
      + 'outlined green; what it only suspects is outlined yellow; what it does not know is '
      + 'listed on the review card.',
    'More fields appearing — a form opening, the next page of one — are filled as they appear.',
    'You teach it the questions it did not know, once each. From then on they fill on every site.',
    'You check the page and press the site’s own Submit button. Then close the tab: on a '
      + 'queue tab that finishes the posting and opens the next.',
  ];
  $('help-flow').replaceChildren(...flow.map((text) => {
    const li = document.createElement('li');
    li.append(...richText(text));
    return li;
  }));

  const concepts: Array<keyof typeof CONCEPT_HELP> = [
    'howItWorks', 'neverSubmits', 'teaching', 'customFields', 'dots', 'picker', 'leftAlone',
    'sessions', 'queueChip', 'markedDone', 'syncClient',
  ];
  $('help-concepts').replaceChildren(...concepts.map((key) => helpPanel(CONCEPT_HELP[key])));

  // Written here rather than in the catalog: these are symptoms, not settings,
  // and each one is a pointer at the entry that explains the cause.
  const trouble: HelpEntry[] = [
    {
      title: 'Nothing was filled at all',
      body: 'Check “Fill automatically” in Settings, and that your details are on the Profile '
        + 'tab. A page with a password box on its form is left alone on purpose — that is a '
        + 'login or a sign-up. Otherwise press Fill in the popup: it fills the page whatever '
        + 'the settings say.',
    },
    {
      title: 'A question stayed grey',
      body: 'Nothing recognised it. Press Teach on its row in the review card and say what it '
        + 'is — one of your details, one of your own fields, or a new field made there and '
        + 'then. It is filled at once, and every site asking it the same way is filled from '
        + 'then on.',
    },
    {
      title: 'It filled a box with the wrong thing',
      body: 'Press Not this on that row and choose the right field, or “Ignore this question”. '
        + 'If the wrong answer came from a lesson, forget it under Profile → What it has learned.',
    },
    {
      title: 'A field is not on the card at all',
      body: 'Some fields are drawn in ways the extension cannot read as a question. Press '
        + 'Teach in the popup, tap the field on the page, and Confirm — the card opens on it.',
    },
    {
      title: 'The queue opened far too many tabs',
      body: 'Lower “Tabs at once” on the Queue tab. A session keeps that many postings '
        + 'open and opens the next as you close each one; on a phone use 1–2.',
    },
  ];
  $('help-trouble').replaceChildren(...trouble.map(helpPanel));

  renderSyncGuide();
}

/**
 * Copy a read-only field's value, saying so in `statusEl` either way. The
 * clipboard refuses when the document is not focused — trivially the case with
 * devtools open — and an unhandled rejection left the user with no message at
 * all beside a field that had not been copied. The redirect URI is the one value
 * sync setup cannot proceed without, so a failure has to say so and select the
 * field for copying by hand.
 */
async function copyField(field: HTMLInputElement, statusEl: HTMLElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(field.value);
    setStatus(statusEl, 'Copied — paste it into the OAuth client in Google Cloud', 'ok');
  } catch {
    field.select();
    setStatus(statusEl, 'Could not reach the clipboard — the address is selected, copy it with ⌘/Ctrl+C', 'err');
  }
}

/**
 * Help → Setting up sync: the numbered guide and the errors Google shows when a
 * step went wrong. The step that creates the client carries this browser's own
 * redirect URI, because that one value is derived from the extension ID and is
 * the one most often pasted into the wrong box.
 */
function renderSyncGuide(): void {
  $('sync-guide-steps').replaceChildren(...SYNC_SETUP_STEPS.map(guideStep));
  $('sync-guide-trouble').replaceChildren(...SYNC_TROUBLESHOOTING.map(helpPanel));
}

function guideStep(step: GuideStep, i: number): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'guide-step';

  const num = document.createElement('span');
  num.className = 'guide-num';
  num.setAttribute('aria-hidden', 'true');
  num.textContent = String(i + 1);

  const content = document.createElement('div');
  content.className = 'guide-content';
  const title = document.createElement('b');
  title.className = 'guide-title';
  title.textContent = step.title;
  const body = document.createElement('p');
  body.className = 'guide-body';
  body.append(...richText(step.body));
  content.append(title, body);

  if (step.showsRedirectUri) {
    const box = document.createElement('div');
    box.className = 'guide-uri';
    const field = document.createElement('input');
    field.type = 'text';
    field.readOnly = true;
    field.id = 'sync-guide-uri';
    field.value = chrome.identity.getRedirectURL();
    field.setAttribute('aria-label', 'This browser\u2019s redirect URI');
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn';
    copy.textContent = 'Copy';
    const status = document.createElement('p');
    status.className = 'status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    copy.onclick = () => copyField(field, status);
    box.append(field, copy);
    content.append(box, status);
  }

  if (step.link) {
    const a = document.createElement('a');
    a.className = 'btn guide-link';
    a.href = step.link.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = `${step.link.label} ↗`;
    content.append(a);
  }

  li.append(num, content);
  return li;
}

/* ---------------- Settings ---------------- */

async function initSettings(): Promise<void> {
  const fillAuto = $<HTMLInputElement>('fill-auto');
  const openCard = $<HTMLInputElement>('open-card-queue');
  const markDone = $<HTMLInputElement>('mark-done-on-close');
  const closeOnSkip = $<HTMLInputElement>('close-on-skip');
  const closeDelay = $<HTMLInputElement>('close-delay');
  const keepInBrowser = $<HTMLInputElement>('keep-in-browser');
  const modalFullscreen = $<HTMLInputElement>('modal-fullscreen');

  const settings = await getSettings();
  fillAuto.checked = settings.fillAutomatically;
  openCard.checked = settings.openCardOnQueueTabs;
  markDone.checked = settings.markDoneOnClose;
  closeOnSkip.checked = settings.closeTabOnSkip;
  closeDelay.value = String(settings.closeTabDelayMs);
  keepInBrowser.checked = settings.keepInBrowser;
  modalFullscreen.checked = settings.modalFullscreen;

  const persist = async () => {
    const s = await getSettings();
    await saveSettings({
      ...s,
      fillAutomatically: fillAuto.checked,
      openCardOnQueueTabs: openCard.checked,
      markDoneOnClose: markDone.checked,
      closeTabOnSkip: closeOnSkip.checked,
      closeTabDelayMs: Math.max(0, Number(closeDelay.value) || 0),
      keepInBrowser: keepInBrowser.checked,
      modalFullscreen: modalFullscreen.checked,
    });
    setStatus($('settings-status'), 'Saved', 'ok');
  };

  for (const control of [fillAuto, openCard, markDone, closeOnSkip, closeDelay, keepInBrowser, modalFullscreen]) {
    control.addEventListener('change', persist);
  }

  attachRowHelp(fillAuto, SETTINGS_HELP.fillAutomatically);
  attachRowHelp(openCard, SETTINGS_HELP.openCardOnQueueTabs);
  attachRowHelp(markDone, SETTINGS_HELP.markDoneOnClose);
  attachRowHelp(closeOnSkip, SETTINGS_HELP.closeTabOnSkip);
  attachRowHelp(closeDelay, SETTINGS_HELP.closeTabDelayMs);
  attachRowHelp(keepInBrowser, SETTINGS_HELP.keepInBrowser);
  attachRowHelp(modalFullscreen, SETTINGS_HELP.modalFullscreen);
  attachHelp($('queue-settings-heading'), CONCEPT_HELP.sessions);

  // What the stored rectangle *is* — that a drag on a page does not write it, that
  // it is desktop-only. The hint paragraphs below are the simulator's own
  // operating instructions and stay where they are.
  attachHelp($('panels-heading'), SETTINGS_HELP.modalLayout);

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
   * Every limit chip, built once and only ever shown or hidden — they are
   * rewritten on every `pointermove`, and rebuilding the block each time would
   * throw away and re-create six elements per frame. They flow now rather than
   * holding six reserved cells; `.sim-limits` reserves the one row's height that
   * keeps the buttons below from moving. See options.css.
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
        commit(snapLayout(nudgeLayout(start, mode, dx, dy), vp.width, vp.height, mode));
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
      commit(nudgeLayout(layout, mode, d[0] * step, d[1] * step));
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
  onRerun: () => {}, onConfirm: () => {}, onTeach: () => {}, onPoint: () => {},
  onSkip: () => {}, onClose: () => {}, onOpenOptions: () => {},
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
      {
        id: 'p1', question: 'Full name', kind: 'text', field: 'fullName', fieldLabel: 'Full name',
        source: 'heuristic', confidence: 'high', filled: true, required: false, valueToFill: 'Ada Lovelace',
      },
      {
        id: 'p2', question: 'Where are you based?', kind: 'text',
        source: 'none', confidence: 'none', filled: false, required: false,
      },
    ],
    choices: [],
    layout,
  };
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
  markedDone: 'ok',
};

function renderStats(list: JobUrlEntry[]): void {
  const s = jobUrlStats(list);
  const cards: Array<[string, number, string]> = [
    ['Total', s.total, 'total'],
    ['New', s.new, 'new'],
    ['Opened', s.opened, 'opened'],
    ['Redirected', s.redirected, 'redirected'],
    ['Applied', s.applied, 'applied'],
    ['Skipped', s.skipped, 'skipped'],
    [JOB_STATUS_LABELS.markedDone, s.markedDone, 'markedDone'],
  ];
  $('url-stats').replaceChildren(...cards.map(([k, n, cls]) => {
    const card = document.createElement('div');
    card.className = `cf-stat ${cls}`.trim();
    const num = document.createElement('div');
    num.className = 'cf-stat-n';
    num.textContent = String(n);
    const key = document.createElement('div');
    key.className = 'cf-stat-k';
    key.textContent = k;
    card.append(num, key);
    return card;
  }));
}

function renderFilters(list: JobUrlEntry[]): void {
  const stats = jobUrlStats(list);
  const counts: Record<string, number> = { all: stats.total, ...stats };
  const box = $('url-filters');
  box.replaceChildren(...(['all', ...ALL_JOB_STATUSES] as const).map((key) => {
    const b = document.createElement('button');
    b.className = 'filter';
    b.type = 'button';
    b.setAttribute('aria-pressed', String(urlFilter === key));
    b.textContent = `${key === 'all' ? 'All' : JOB_STATUS_LABELS[key]} ${counts[key] ?? 0}`;
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
  // Removed postings stay in the database as tombstones so a sync cannot
  // resurrect them (see jobUrls.deleteUrl); they are never shown.
  return visibleUrls(list).filter((e) => {
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
    // Which of the two it is turns on whether anything is *there*, not on how
    // long the stored list is: removed postings stay as tombstones, so after
    // Clear all the raw list is still full and this read "Nothing matches this
    // filter." to someone who had not set one.
    empty.textContent = visibleUrls(list).length === 0
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
  // A status this build does not know (a newer peer's, arriving by sync) gets no
  // tone rather than a broken class, and is shown under its own name.
  chip.className = `chip ${STATUS_KIND[entry.status as JobUrlStatus] ?? ''}`.trim();
  chip.textContent = JOB_STATUS_LABELS[entry.status as JobUrlStatus] ?? entry.status;

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
  for (const s of ALL_JOB_STATUSES) {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = JOB_STATUS_LABELS[s];
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

  for (const s of ALL_JOB_STATUSES) {
    const b = document.createElement('button');
    b.textContent = s === entry.status ? `✓ ${JOB_STATUS_LABELS[s]}` : `Mark ${JOB_STATUS_LABELS[s].toLowerCase()}`;
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
 *
 * The removal is a tombstone, not a splice, so that a sync from the other device
 * cannot resurrect it. Undo is then simply the previous status logged again as a
 * later event, which is also how the other device will read it.
 */
async function removeWithUndo(entry: JobUrlEntry): Promise<void> {
  await mutateJobUrls((all) => deleteUrl(all, entry.url));
  await renderQueue();

  showToast(`Removed ${shortUrl(entry.url)}`, 'Undo', async () => {
    await mutateJobUrls((all) => applyStatus(all, entry.url, entry.status));
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

  // The one setting on this page with no `?` — its catalog entry has been written
  // since the session landed and nothing rendered it. Not `attachRowHelp`: this
  // control is not in a `.setrow`, it is a bare labelled input in the session
  // card. The panel goes after that whole card, because the anchor sits inside a
  // `<label>` and a panel there would be part of the input's click target.
  attachHelp($('batch-label'), SETTINGS_HELP.sessionBatchSize,
    (panel) => $('session-panel').after(panel));

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
  // The section's own intro, from the catalog rather than written into the
  // markup — the hand-written version had drifted into calling our action
  // "submit", which is the site's control, not ours.
  attachHelp($('urls-heading'), CONCEPT_HELP.sessions);
  $('urls-section').querySelector('.hint')!.textContent = CONCEPT_HELP.sessions.short ?? '';

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
    // The saved postings go with it, and that is the half worth warning about:
    // the queue can be re-imported from the board, the archive cannot be re-read
    // once the postings are down.
    // With sync on this is not a local delete: the entries are tombstoned so the
    // other browser does not resurrect them, which means it clears there too.
    const shared = (await getSettings()).syncEnabled
      ? ' Sync is on, so this also clears the other browser at the next sync.'
      : '';
    $('clear-confirm-label').textContent =
      `Delete all ${list.length} posting(s), their history and the saved job archive? `
      + `Export first if you want to keep it. This cannot be undone.${shared}`;
    confirmBox.hidden = false;
  });
  $('clear-cancel').addEventListener('click', () => { confirmBox.hidden = true; });

  // Closing every `opened` posting at once — a session that was dealt with outside
  // the extension leaves them mid-flow for ever. Undoable row by row from each
  // status menu, but it touches many rows at once, so it names the count first.
  const doneBox = $('mark-done-confirm');
  attachHelp($('mark-done-label'), CONCEPT_HELP.markedDone, (panel) => doneBox.after(panel));
  $('mark-opened-done').addEventListener('click', async () => {
    const opened = visibleUrls(await getJobUrls()).filter((e) => e.status === 'opened').length;
    if (opened === 0) { setStatus($('queue-status'), 'No “opened” postings', 'err'); return; }
    const shared = (await getSettings()).syncEnabled
      ? ' Sync is on, so the other browser gets the change at the next sync.'
      : '';
    $('mark-done-confirm-label').textContent =
      `Mark all ${opened} opened posting(s) as done? `
      + `You can change any of them back from its status menu.${shared}`;
    doneBox.hidden = false;
  });
  $('mark-done-cancel').addEventListener('click', () => { doneBox.hidden = true; });
  $('mark-done-really').addEventListener('click', async () => {
    let changed = 0;
    await mutateJobUrls((all) => {
      const out = markOpenedDone(all);
      changed = out.changed;
      return out.list;
    });
    doneBox.hidden = true;
    await renderQueue();
    setStatus($('queue-status'), `Marked ${changed} posting(s) done`, 'ok');
  });
  $('clear-really').addEventListener('click', async () => {
    // Tombstone rather than truncate. A bare `saveJobUrls([])` is undone by the
    // next sync — the other device still holds every entry, and a union can only
    // grow — so the clear would appear to work and then silently reverse itself.
    await mutateJobUrls((all) => all.reduce((list, e) => deleteUrl(list, e.url), all));
    await saveJobDetails({});
    confirmBox.hidden = true;
    shownCount = PAGE_SIZE;
    await renderQueue();
    setStatus($('queue-status'), 'Queue cleared', 'ok');
  });

  $('export-jobs').addEventListener('click', () => void exportJobs());
  attachHelp($('archive-heading'), CONCEPT_HELP.exportJobs);
  // What the ticks mean and how a selection survives the schema growing — the
  // entry existed and nothing rendered it. The panel goes after the whole
  // `<details>`, not after the anchor: the anchor is inside the `<summary>`, and
  // an explanation folded away with the disclosure it explains is unreachable
  // until you open the thing you were asking about.
  attachHelp($('export-options-label'), SETTINGS_HELP.exportOptions,
    (panel) => $('export-options').after(panel));
  await renderExportOptions();

  document.addEventListener('click', () => closeAllMenus());

  // Collect captures whose posting has since been deleted. Once per page load
  // rather than per render, so a row removed with Undo still on screen keeps its
  // text until the user has actually let it go.
  //
  // This is a read-modify-write, and it is the last thing boot does before
  // `data-ready` goes up — anything writing captures underneath a booting
  // options page races it and loses. Nothing a user does has that shape; the
  // E2E archive spec does, and waits for the flag rather than pretending
  // otherwise.
  const known = (await getJobUrls()).map((e) => e.url);
  await mutateJobDetails((map) => pruneDetails(map, known));

  await renderQueue();
}

/* ---------------- What to export ---------------- */

/** One checkbox or radio, at a full tap target, labelled from the catalog. */
function checkRow(
  id: string,
  label: string,
  on: boolean,
  onChange: (on: boolean) => void,
  radio?: string,
): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.className = 'check';
  const box = document.createElement('input');
  box.type = radio ? 'radio' : 'checkbox';
  if (radio) box.name = radio;
  box.id = id;
  box.checked = on;
  box.addEventListener('change', () => onChange(box.checked));
  const text = document.createElement('span');
  text.textContent = label;
  wrap.append(box, text);
  return wrap;
}

/**
 * The Archive panel: one checkbox per column, one per posting status, and the
 * two formats.
 *
 * Both lists are walked from the model — `EXPORT_FIELD_LABELS` and
 * `ALL_JOB_STATUSES` — rather than written into options.html, which is what
 * makes a new column or a new status arrive here as a checkbox by itself. A
 * change saves immediately, like every other control on this page; only the
 * summary is re-rendered afterwards, because rebuilding the grid would take the
 * focus out from under the box just ticked.
 */
async function renderExportOptions(): Promise<void> {
  const chosen = resolveExport((await getSettings()).exportOptions);
  const fields = new Set(chosen.fields);
  const statuses = new Set(chosen.statuses);

  $('export-fields').replaceChildren(...EXPORT_FIELD_ORDER.map((f) => checkRow(
    `export-field-${f}`, EXPORT_FIELD_LABELS[f], fields.has(f),
    (on) => void patchExport((sel) => ({ ...sel, fields: { ...sel.fields, [f]: on } })),
  )));

  $('export-statuses').replaceChildren(...ALL_JOB_STATUSES.map((s) => checkRow(
    `export-status-${s}`, JOB_STATUS_LABELS[s], statuses.has(s),
    (on) => void patchExport((sel) => ({ ...sel, statuses: { ...sel.statuses, [s]: on } })),
  )));

  const formats: Array<[ExportFormat, string]> = [['json', 'JSON'], ['csv', 'CSV (spreadsheet)']];
  $('export-format').replaceChildren(...formats.map(([value, label]) => checkRow(
    `export-format-${value}`, label, chosen.format === value,
    () => void patchExport((sel) => ({ ...sel, format: value })),
    'export-format-choice',
  )));

  await refreshExportSummary();
}

/**
 * Serialized through a promise chain, like `session.ts` and `sync.ts`: each edit
 * is a read-modify-write of one settings object, so two ticks in quick
 * succession would otherwise both read the same snapshot and the second would
 * erase the first. Ticking a column off is exactly the gesture people repeat.
 */
let exportWrites: Promise<void> = Promise.resolve();

async function patchExport(edit: (sel: ExportSelection) => ExportSelection): Promise<void> {
  exportWrites = exportWrites.then(async () => {
    const settings = await getSettings();
    await saveSettings({ ...settings, exportOptions: edit(settings.exportOptions ?? {}) });
  });
  await exportWrites;
  await refreshExportSummary();
}

/**
 * What pressing Export would produce, in one line — and the only place the
 * empty selection is caught. Nothing here can be "fixed" for the user: a file
 * with no columns is a file of empty objects, so the button goes dead and says
 * which tick is missing.
 */
async function refreshExportSummary(): Promise<void> {
  const chosen = resolveExport((await getSettings()).exportOptions);
  const button = $<HTMLButtonElement>('export-jobs');
  const summary = $('export-summary');
  button.disabled = chosen.fields.length === 0 || chosen.statuses.length === 0;

  if (chosen.fields.length === 0) {
    summary.textContent = 'Pick at least one column to export.';
    return;
  }
  if (chosen.statuses.length === 0) {
    summary.textContent = 'Pick at least one kind of posting to export.';
    return;
  }

  const count = buildExport(await getJobUrls(), {}, {
    statuses: chosen.statuses, fields: ['url'],
  }).length;
  const kinds = chosen.statuses.map((s) => JOB_STATUS_LABELS[s].toLowerCase()).join(', ');
  summary.textContent =
    `${count} posting(s) — ${kinds} — with ${chosen.fields.length} of `
    + `${EXPORT_FIELD_ORDER.length} columns, as ${chosen.format.toUpperCase()}.`;
}

/**
 * Write the chosen postings out as one file.
 *
 * A plain anchor download, deliberately: the options page is an extension page,
 * so this needs no `downloads` permission, and the background could not do it
 * anyway — an MV3 service worker has no `URL.createObjectURL`.
 */
async function exportJobs(): Promise<void> {
  const status = $('export-status');
  const chosen = resolveExport((await getSettings()).exportOptions);
  const [list, details] = await Promise.all([getJobUrls(), getJobDetails()]);
  const jobs = buildExport(list, details, { statuses: chosen.statuses, fields: chosen.fields });
  if (jobs.length === 0) {
    setStatus(status, 'Nothing matches what you chose to export', 'err');
    return;
  }

  // The BOM is what makes a spreadsheet read this as UTF-8 rather than as the
  // local codepage, which is where an accented company name goes wrong.
  const [text, type] = chosen.format === 'csv'
    ? [`﻿${toCsv(jobs, chosen.fields)}`, 'text/csv;charset=utf-8']
    : [JSON.stringify(jobs, null, 2), 'application/json'];
  const href = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = href;
  a.download = exportFilename(new Date(), chosen);
  a.click();
  URL.revokeObjectURL(href);

  // Only worth saying when the text was part of what was asked for.
  const wanted = chosen.fields.includes('description');
  const missing = wanted ? jobs.filter((j) => (j.description ?? []).length === 0).length : 0;
  setStatus(
    status,
    missing === 0
      ? `Exported ${jobs.length} posting(s)`
      : `Exported ${jobs.length} posting(s) — ${missing} with no saved text`,
    'ok',
  );
}

/* ---------------- Sync ---------------- */

/**
 * Options → Settings → Sync. Two ways to move the same database: through a
 * Google account, or as a file you carry yourself. Both end in the same
 * `mergeJobs`, so importing a backup and syncing cannot disagree about what
 * combining two databases means.
 */
async function initSync(): Promise<void> {
  const toggle = $<HTMLInputElement>('sync-enabled');
  const account = $('sync-account');
  const status = $('sync-status');
  const fileStatus = $('sync-file-status');
  const importInput = $<HTMLInputElement>('sync-import-input');

  attachHelp($('sync-heading'), SETTINGS_HELP.syncEnabled);
  attachRowHelp(toggle, SETTINGS_HELP.syncEnabled);
  attachHelp($('sync-client-heading'), CONCEPT_HELP.syncClient);

  toggle.checked = (await getSettings()).syncEnabled;
  toggle.addEventListener('change', async () => {
    await saveSettings({ ...(await getSettings()), syncEnabled: toggle.checked });
    setStatus(status, `Job database sync ${toggle.checked ? 'on' : 'off'}`, 'ok');
    await renderSync();
  });

  /**
   * Which account, and when it last ran. Written directly rather than through
   * `setStatus`, which clears anything non-error after three seconds: this is a
   * standing label, not a transient message, and it is the one thing most likely
   * to be wrong (the second machine authorized as a different account).
   */
  function showAccount(text: string, bad = false): void {
    account.textContent = text;
    account.className = `status ${bad ? 'err' : ''}`.trim();
  }

  async function renderSync(state?: SyncState): Promise<void> {
    const s = state ?? (await sendBg<SyncState>(MSG.SYNC_STATE));
    // The refresh token decides this, not the account label. An account line can
    // be blank — the email comes from the id_token and a consent screen without
    // the `email` claim returns none — and inferring "not connected" from that
    // disabled Disconnect on the one state that most needs clearing.
    const connected = s?.connected === true;
    $<HTMLButtonElement>('sync-connect').textContent = connected ? 'Switch account' : 'Connect';
    // Disabled rather than hidden: `.btn` sets a `display`, which beats the UA
    // stylesheet's `[hidden]`, so a hidden button here is simply a visible one.
    // It also keeps the row from reflowing under the pointer on connect.
    $<HTMLButtonElement>('sync-now').disabled = !connected || !toggle.checked;
    $<HTMLButtonElement>('sync-disconnect').disabled = !connected;

    // Connect is what a missing client actually blocks, so it is disabled with
    // the account line pointing at the form below rather than failing there.
    $<HTMLButtonElement>('sync-connect').disabled = s?.configured === false;

    if (s?.configured === false) {
      showAccount('Sync needs a Google OAuth client — see “Google OAuth client” below, and its setup guide', true);
    } else if (connected) {
      const when = s.lastSyncAt ? `last synced ${fmtDate(s.lastSyncAt)}` : 'not synced yet';
      // Google did not say which account, so the honest thing is to say so
      // rather than print "undefined" where the email goes.
      showAccount(`Syncing through ${s.account ?? 'a Google account'} — ${when}`);
    } else {
      showAccount('Not connected to a Google account');
    }
    if (s?.lastError) setStatus(status, s.lastError, 'err');
  }

  /* --- The OAuth client, entered here rather than built in --- */

  const clientId = $<HTMLInputElement>('sync-client-id');
  const clientSecret = $<HTMLInputElement>('sync-client-secret');
  const clientStatus = $('sync-client-status');
  const redirect = $<HTMLInputElement>('sync-redirect-uri');

  // Derived from this browser's extension ID, so it differs between machines and
  // cannot be printed in the help text — each browser's has to go on the client.
  redirect.value = chrome.identity.getRedirectURL();

  // The id is prefilled from what is stored; the secret deliberately is not. It
  // is write-only here, so a screen-share does not carry it, and leaving the
  // field blank on save keeps whatever is already stored.
  const stored = await readSyncClient();
  clientId.value = stored.clientId;
  clientSecret.placeholder = stored.clientSecret ? 'Stored — type to replace' : 'GOCSPX-…';

  $('sync-client-save').addEventListener('click', async () => {
    // Emptying the id is how a credential is taken back off this machine, so the
    // secret goes with it rather than being left behind on its own.
    const wanted = clientId.value.trim();
    const secret = wanted
      ? clientSecret.value.trim() || (await readSyncClient()).clientSecret
      : '';
    const s = await sendBg<SyncState>(MSG.SYNC_SET_CLIENT, {
      clientId: wanted,
      clientSecret: secret,
    });
    if (!s || 'error' in s) {
      return setStatus(clientStatus, String((s as { error?: string })?.error), 'err');
    }
    clientSecret.value = '';
    clientId.value = s.clientId ?? '';
    clientSecret.placeholder = s.clientId ? 'Stored — type to replace' : 'GOCSPX-…';
    setStatus(
      clientStatus,
      s.clientId ? 'Saved. Press Connect to authorize a Google account.' : 'Client removed.',
      'ok',
    );
    await renderSync(s);
  });

  $('sync-redirect-copy').addEventListener('click', () => copyField(redirect, clientStatus));

  // The guide is the Help tab's last section, not a second copy here.
  $('sync-guide-open').addEventListener('click', () => {
    selectTab('help');
    revealSection('sync-guide-section');
  });

  $('sync-connect').addEventListener('click', async () => {
    setStatus(status, 'Waiting for Google…');
    const s = await sendBg<SyncState>(MSG.SYNC_CONNECT);
    if (!s || 'error' in s) return setStatus(status, String((s as { error?: string })?.error), 'err');
    // The toggle, not the account, is what makes Sync now pressable. It is on by
    // default, but a user may have switched it off — and then naming the disabled
    // button would be the last step of a walkthrough that does nothing.
    setStatus(status, toggle.checked
      ? 'Connected. Press Sync now to combine the two databases.'
      : 'Connected. Switch “Sync the job database” on above to start syncing.', 'ok');
    await renderSync(s);
  });

  $('sync-disconnect').addEventListener('click', async () => {
    // The database stays; only the tokens go. Saying so matters — "disconnect"
    // reads like "delete" next to a list of sixty postings.
    await renderSync(await sendBg<SyncState>(MSG.SYNC_DISCONNECT));
    setStatus(status, 'Disconnected. The job database on this device is untouched.', 'ok');
  });

  $('sync-now').addEventListener('click', () => void runSync(false));

  async function runSync(confirmed: boolean): Promise<void> {
    setStatus(status, 'Syncing…');
    const s = await sendBg<SyncState>(MSG.SYNC_NOW, { confirmed });
    if (!s) return setStatus(status, 'No answer from the extension', 'err');
    // Same check as Connect and Save client beside it. Without it a throw from
    // outside `syncNow`'s own catch arrives as `{error}`, which carries no
    // `lastError` — so the run below reported "Synced", in green, for a sync
    // that did not happen, next to an account line that read "Not connected".
    if ('error' in s) {
      return setStatus(status, String((s as { error?: string }).error), 'err');
    }
    if (s.pending) {
      // The one check before the first merge: connecting the wrong account would
      // fold a stranger's job list into this one, and only the counts show it.
      showToast(
        `Combine ${s.pending.remote} posting(s) from ${s.account} with ${s.pending.local} here?`,
        'Combine',
        () => void runSync(true),
      );
      setStatus(status, 'Waiting for confirmation');
      return;
    }
    await renderSync(s);
    if (!s.lastError) setStatus(status, 'Synced', 'ok');
    await renderQueue();
  }

  /* --- The same database as a file --- */

  $('sync-export').addEventListener('click', async () => {
    // Same anchor download as the archive export, and for the same reasons: no
    // `downloads` permission, and a service worker has no `URL.createObjectURL`.
    const snapshot = await buildSnapshot();
    const blob = new Blob([JSON.stringify(snapshot)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = snapshotFilename(new Date());
    a.click();
    URL.revokeObjectURL(href);
    setStatus(fileStatus, `Exported ${snapshot.jobUrls.length} posting(s)`, 'ok');
  });

  $('sync-import').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    importInput.value = '';
    try {
      const before = (await buildSnapshot()).jobUrls.length;
      const merged = await mergeIntoLocal(parseSnapshot(await file.text()));
      const added = merged.jobUrls.length - before;
      setStatus(
        fileStatus,
        added > 0
          ? `Combined — ${added} posting(s) added, ${merged.jobUrls.length} in total`
          : `Combined — nothing new, ${merged.jobUrls.length} in total`,
        'ok',
      );
      await renderQueue();
    } catch (e) {
      setStatus(fileStatus, (e as Error).message, 'err');
    }
  });

  await renderSync();
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
/** Where the checklist's dismissal is kept. Not a setting: it changes nothing the extension does. */
const START_DISMISSED_KEY = 'gettingStartedDismissed';

async function renderGettingStarted(): Promise<void> {
  const section = $('start-section');
  const dismissed = (await chrome.storage.local.get(START_DISMISSED_KEY))[START_DISMISSED_KEY];
  if (dismissed) { section.hidden = true; return; }

  const [profile, cv, urls] = await Promise.all([getProfile(), getCv(), getJobUrls()]);

  // `at` is the section the step is actually about and `focus` the control it
  // wants pressed or typed into: the tab alone is not an answer, and for the two
  // queue steps it is not even a change — the checklist is already on that tab.
  // `focus` is a selector rather than an id because the profile inputs are built
  // from the field list and only carry `data-field`.
  const steps: Array<{
    label: string; done: boolean; tab?: TabName; at?: string; focus?: string;
  }> = [
    {
      label: 'Add your details',
      done: Object.values(profile.values).some((v) => v?.trim()),
      tab: 'profile',
      at: 'profile-section',
      focus: '#profile-fields [data-field]',
    },
    { label: 'Upload your CV', done: !!cv, tab: 'profile', at: 'cv-section', focus: '#cv-input' },
    {
      label: 'Paste some job links',
      done: urls.length > 0,
      tab: 'queue',
      at: 'import-section',
      focus: '#urls-paste',
    },
    {
      label: 'Add a field for a question you get asked a lot',
      done: (profile.customFields ?? []).length > 0,
      tab: 'profile',
      at: 'custom-section',
      focus: '#custom-add',
    },
    {
      // Named for what the tick actually means. Nothing here requires a
      // session: "Open all new now" flips every posting to `opened`, applying
      // or skipping writes a status, and a sync can arrive carrying finished
      // ones — so a step reading "Start a session" ticked itself with the
      // session panel never touched. There is no persistent "a session was
      // started" record to test instead, so the label is what moves. The Go
      // button still points at the session panel: starting one is the way to do
      // this that the extension is built around.
      label: 'Open some postings from the queue',
      done: urls.some((u) => u.status !== 'new'),
      tab: 'queue',
      at: 'session-panel',
      focus: '#session-toggle',
    },
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
      go.addEventListener('click', () => {
        selectTab(step.tab!);
        // selectTab unhides the panel synchronously, so the section can be
        // measured immediately.
        if (step.at) revealSection(step.at, step.focus);
      });
      li.append(go);
    }
    return li;
  }));
}

function initGettingStarted(): void {
  $('start-dismiss').addEventListener('click', async () => {
    $('start-section').hidden = true;
    await chrome.storage.local.set({ [START_DISMISSED_KEY]: true });
  });
}

/* ---------------- Boot ---------------- */

async function main(): Promise<void> {
  initTabs();
  initScrollFade();
  initHelp();
  initGettingStarted();
  await Promise.all([
    initProfile(), initWordings(), initCustomFields(), initLearned(), initCv(), initCoverLetter(),
    initSettings(), initSession(), initUrls(), initSync(),
  ]);
  await renderGettingStarted();

  const { tab, at, focus } = parseHash();
  selectTab(tab ?? 'queue', false);

  // `&at=<section>` finishes the journey. A tab is not a destination: the URL
  // importer is the third section of the Queue tab and the config JSON is below
  // a reference and a chip row, so a link that only switched tab left the user
  // to find the thing it was sent for. Same helper the checklist's "Go →" uses,
  // and it has to run after the panels are built and shown.
  if (at) revealSection(at, focus);

  // The session runs in the background; reflect its progress without a reload.
  // The checklist ticks off the same events, so it refreshes here too — and a
  // lesson taught on a page lands in the Learned list while this tab is open.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' || area === 'session') {
      void renderQueue();
      void renderGettingStarted();
    }
    if (area === 'local' && 'lessons' in changes) {
      void renderLearned();
      void renderCustomFields();
    }
  });

  // Boot is done — every read this page makes at startup has landed, and so has
  // the capture prune, which is a read-modify-write of storage. `load` says
  // nothing about that: it fires while `main` is still awaiting. Anything that
  // writes storage underneath a booting options page has to wait for this or it
  // races the prune, and the E2E archive spec is exactly that shape.
  document.body.dataset.ready = '1';
}

main().catch((e) => console.error('[chromium-filler] options failed', e));
