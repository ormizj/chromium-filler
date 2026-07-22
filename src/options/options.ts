/**
 * Options page: profile editor, CV upload, behavior settings, site-config JSON
 * editor, and the job-URL database with the paste-a-dump importer.
 */

import type { JobUrlEntry, JobUrlStatus, Profile, SiteConfig, TextFieldKey } from '../shared/types';
import { TEXT_FIELDS, FIELD_LABELS } from '../shared/fieldKeys';
import { extractUrls } from '../shared/urlImport';
import { addUrls, applyStatus, jobUrlStats, removeUrl } from '../shared/jobUrls';
import { MSG } from '../shared/messages';
import {
  getProfile, saveProfile, getSettings, saveSettings,
  getSiteConfigs, saveSiteConfigs, getJobUrls, saveJobUrls, mutateJobUrls,
} from '../shared/storage';
import { getCv, setCv, clearCv } from '../shared/cvStore';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function setStatus(el: HTMLElement, text: string, kind: 'ok' | 'err' | '' = ''): void {
  el.textContent = text;
  el.className = `status ${kind}`.trim();
  if (text) setTimeout(() => { el.textContent = ''; el.className = 'status'; }, 3000);
}

/* ---------------- Profile ---------------- */

async function initProfile(): Promise<void> {
  const container = $('profile-fields');
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

  $('save-profile').addEventListener('click', async () => {
    const values: Profile['values'] = {};
    container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-field]').forEach((el) => {
      const v = el.value.trim();
      if (v) values[el.dataset.field as TextFieldKey] = v;
    });
    const current = await getProfile();
    await saveProfile({ ...current, values });
    setStatus($('profile-status'), 'Saved', 'ok');
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

  const settings = await getSettings();
  autoRun.checked = settings.autoRunOnLoad;
  closeOnSubmit.checked = settings.closeTabOnSubmit;
  closeDelay.value = String(settings.closeTabDelayMs);

  const persist = async () => {
    const s = await getSettings();
    await saveSettings({
      ...s,
      autoRunOnLoad: autoRun.checked,
      closeTabOnSubmit: closeOnSubmit.checked,
      closeTabDelayMs: Math.max(0, Number(closeDelay.value) || 0),
    });
  };

  autoRun.addEventListener('change', persist);
  closeOnSubmit.addEventListener('change', persist);
  closeDelay.addEventListener('change', persist);
}

/* ---------------- Site configs ---------------- */

function configTemplate(url?: string): SiteConfig {
  let host = 'example.com';
  try { if (url) host = new URL(url).host; } catch { /* ignore */ }
  return {
    id: host.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || `site-${Date.now()}`,
    name: host,
    urlPatterns: [`*://${host}/*`],
    waitFor: 'form',
    waitTimeoutMs: 15000,
    prep: [],
    extract: { jobTitle: 'h1', jobDescription: '[class*="description"]' },
    fieldOverrides: {},
    autoDetect: true,
  };
}

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

async function initConfigs(): Promise<void> {
  const ta = $<HTMLTextAreaElement>('configs-json');
  const configs = await getSiteConfigs();
  ta.value = JSON.stringify(configs, null, 2);

  $('save-configs').addEventListener('click', async () => {
    try {
      const parsed = JSON.parse(ta.value);
      validateConfigs(parsed);
      await saveSiteConfigs(parsed);
      ta.value = JSON.stringify(parsed, null, 2);
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

/* ---------------- URL database ---------------- */

let previewUrls: string[] = [];

function renderPreview(): void {
  const box = $('urls-preview');
  if (previewUrls.length === 0) { box.innerHTML = ''; return; }
  const items = previewUrls.map((u) => `<li>${escapeHtml(u)}</li>`).join('');
  box.innerHTML = `<b>${previewUrls.length} URL(s) found.</b>
    <ul>${items}</ul>
    <button id="add-parsed" class="primary">Add ${previewUrls.length} to database</button>`;
  $('add-parsed').addEventListener('click', addParsed);
}

async function addParsed(): Promise<void> {
  let added = 0;
  await mutateJobUrls((list) => {
    const res = addUrls(list, previewUrls);
    added = res.added;
    return res.list;
  });
  previewUrls = [];
  ($('urls-paste') as HTMLTextAreaElement).value = '';
  renderPreview();
  await renderUrlList();
  setStatus($('extract-status'), `Added ${added} new URL(s)`, 'ok');
}

let urlFilter: JobUrlStatus | 'all' = 'all';

function fmtDate(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function renderStats(list: JobUrlEntry[]): void {
  const s = jobUrlStats(list);
  const cards: Array<[string, number, string]> = [
    ['Total', s.total, ''],
    ['New', s.new, 'new'],
    ['Opened', s.opened, 'opened'],
    ['Applied', s.applied, 'applied'],
    ['Skipped', s.skipped, 'skipped'],
  ];
  $('url-stats').innerHTML = cards
    .map(([k, n, cls]) => `<div class="stat ${cls}"><div class="n">${n}</div><div class="k">${k}</div></div>`)
    .join('');
}

async function renderUrlList(): Promise<void> {
  const list = await getJobUrls();
  renderStats(list);
  const shown = urlFilter === 'all' ? list : list.filter((e) => e.status === urlFilter);
  const ul = $('urls-list');
  ul.innerHTML = '';
  for (const entry of shown) ul.appendChild(urlRow(entry));
}

function urlRow(entry: JobUrlEntry): HTMLElement {
  const li = document.createElement('li');

  const meta = document.createElement('div');
  meta.className = 'meta';
  const a = document.createElement('a');
  a.href = entry.url;
  a.target = '_blank';
  a.rel = 'noreferrer';
  a.textContent = entry.url;
  const info = document.createElement('small');
  const bits = [`added ${fmtDate(entry.addedAt)}`];
  if (entry.appliedAt) bits.push(`applied ${fmtDate(entry.appliedAt)}`);
  bits.push(`${entry.history.length} event(s)`);
  info.textContent = bits.join(' · ');
  info.title = entry.history.map((h) => `${h.status} @ ${new Date(h.at).toLocaleString()}`).join('\n');
  meta.append(a, info);

  const status = document.createElement('select');
  for (const s of ['new', 'opened', 'applied', 'skipped'] as const) {
    const opt = document.createElement('option');
    opt.value = s; opt.textContent = s;
    if (s === entry.status) opt.selected = true;
    status.appendChild(opt);
  }
  status.addEventListener('change', async () => {
    await mutateJobUrls((all) => applyStatus(all, entry.url, status.value as JobUrlStatus));
    await renderUrlList();
  });

  const remove = document.createElement('button');
  remove.textContent = 'Remove';
  remove.addEventListener('click', async () => {
    await mutateJobUrls((all) => removeUrl(all, entry.url));
    await renderUrlList();
  });

  li.append(meta, status, remove);
  return li;
}

async function initUrls(): Promise<void> {
  $('extract-urls').addEventListener('click', () => {
    const raw = ($('urls-paste') as HTMLTextAreaElement).value;
    previewUrls = extractUrls(raw);
    renderPreview();
    if (previewUrls.length === 0) setStatus($('extract-status'), 'No URLs found', 'err');
  });

  $('open-new').addEventListener('click', async () => {
    const list = await getJobUrls();
    const urls = list.filter((e) => e.status === 'new').map((e) => e.url);
    if (urls.length === 0) { setStatus($('extract-status'), 'No “new” URLs to open', 'err'); return; }
    chrome.runtime.sendMessage({ type: MSG.OPEN_URLS, urls });
    setTimeout(renderUrlList, 600);
  });

  $('clear-urls').addEventListener('click', async () => {
    await saveJobUrls([]);
    await renderUrlList();
  });

  $<HTMLSelectElement>('url-filter').addEventListener('change', async (e) => {
    urlFilter = (e.target as HTMLSelectElement).value as JobUrlStatus | 'all';
    await renderUrlList();
  });

  await renderUrlList();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ));
}

/* ---------------- Boot ---------------- */

async function main(): Promise<void> {
  await Promise.all([initProfile(), initCv(), initSettings(), initConfigs(), initUrls()]);

  // Deep link from popup: #create=<url> pre-adds a config template.
  const m = location.hash.match(/create=([^&]+)/);
  if (m) {
    const url = decodeURIComponent(m[1]);
    appendTemplate($<HTMLTextAreaElement>('configs-json'), url);
  }
}

main().catch((e) => console.error('[chromium-filler] options failed', e));
