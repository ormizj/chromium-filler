/**
 * Options page: the job queue (session control + URL database), profile editor,
 * CV upload, behavior settings, and the site-config JSON editor.
 *
 * The four areas are tabs rather than one long scroll — the queue is the only
 * part used daily, and on a phone it used to sit behind everything else.
 */

import type {
  JobUrlEntry, JobUrlStatus, Profile, RedirectTarget, SiteConfig, TextFieldKey,
} from '../shared/types';
import type { SessionState } from '../shared/messages';
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

const TABS = ['queue', 'profile', 'settings', 'sites'] as const;
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

/** Names of the saved configs, so the JSON blob isn't the only way to see them. */
function renderConfigSummary(configs: SiteConfig[]): void {
  const box = $('configs-summary');
  box.replaceChildren(...configs.map((c) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = c.name || c.id;
    chip.title = c.urlPatterns.join('\n');
    return chip;
  }));
}

async function initConfigs(): Promise<void> {
  const ta = $<HTMLTextAreaElement>('configs-json');
  const configs = await getSiteConfigs();
  ta.value = JSON.stringify(configs, null, 2);
  renderConfigSummary(configs);

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

/* ---------------- Boot ---------------- */

async function main(): Promise<void> {
  initTabs();
  await Promise.all([initProfile(), initCv(), initSettings(), initConfigs(), initSession(), initUrls()]);

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
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local' || area === 'session') void renderQueue();
  });
}

main().catch((e) => console.error('[chromium-filler] options failed', e));
