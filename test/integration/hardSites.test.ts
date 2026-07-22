/**
 * Integration tests for the three hard test sites. These reconstruct each
 * site's *loaded* form DOM (post slow-load / post prep) and assert the matcher +
 * field detector behave correctly on nasty markup: late injection, modal forms
 * with no id/name (accessible-name only), hashed ids, and an unmappable field
 * that must surface as unmatched so it can be fixed via Pick.
 *
 * The full click/wait timing is covered by the Playwright E2E suite; here we
 * lock down the matching logic deterministically.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { detectFields } from '../../src/content/fieldDetect';
import { findMatchingConfig } from '../../src/shared/matcher';
import type { FieldKey, SiteConfig } from '../../src/shared/types';
import configsJson from '../fixtures/test-site-configs.json';

const CONFIGS = configsJson as SiteConfig[];
const HID = (s: string) => `fld-${s}-a1b2c3d4e5f6`;

const PROFILE_FIELDS: FieldKey[] = [
  'firstName', 'lastName', 'fullName', 'email', 'phone', 'city', 'coverLetter', 'resume',
];

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

function detect(fields: FieldKey[], overrides?: Partial<Record<FieldKey, string>>) {
  const detected = detectFields({ root: document, fields, overrides });
  return new Map(detected.map((d) => [d.field, d]));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('config URL matching', () => {
  it('matches each site by its served and file URLs', () => {
    expect(findMatchingConfig('http://localhost:5199/sites/slow-boards.html', CONFIGS)?.id).toBe('slow-boards');
    expect(findMatchingConfig('file:///x/y/modal-lever.html', CONFIGS)?.id).toBe('modal-lever');
    expect(findMatchingConfig('https://host/sites/chaos-form.html', CONFIGS)?.id).toBe('chaos-form');
    expect(findMatchingConfig('https://example.com/other', CONFIGS)).toBeUndefined();
  });
});

describe('SlowBoards — standard fields injected late', () => {
  it('detects all fields once the form is present', () => {
    mount(`
      <form id="application-form">
        <label for="first_name">First name</label><input id="first_name" name="first_name" />
        <label for="last_name">Last name</label><input id="last_name" name="last_name" />
        <label for="email">Email</label><input id="email" name="email" type="email" />
        <label for="phone">Phone</label><input id="phone" name="phone" placeholder="+1 555" />
        <label for="resume-file">Résumé (PDF)</label><input id="resume-file" type="file" />
      </form>`);
    const by = detect(['firstName', 'lastName', 'email', 'phone', 'resume']);
    expect(by.get('firstName')?.confidence).toBe('high');
    expect(by.get('lastName')?.confidence).toBe('high');
    expect(by.get('email')?.confidence).toBe('high');
    expect(by.get('phone')?.confidence).toBe('high');
    expect(by.get('resume')?.element?.id).toBe('resume-file');
    expect(by.get('resume')?.confidence).toBe('high');
  });
});

describe('ModalLever — modal form, accessible-name only, override CV input', () => {
  it('detects name/email/phone from aria-label + wrapping label; CV via override', () => {
    mount(`
      <form id="modal-form">
        <label>Full name <input aria-label="Full name" /></label>
        <input aria-label="Email address" placeholder="Email address" />
        <label>Phone number <input /></label>
        <div class="dropzone">
          <input id="resume-hidden" type="file" aria-label="Résumé upload"
                 style="position:absolute;width:1px;height:1px;opacity:0" />
        </div>
      </form>`);
    const config = CONFIGS.find((c) => c.id === 'modal-lever')!;
    const by = detect(['fullName', 'email', 'phone', 'resume'], config.fieldOverrides);
    // Resume override lives on cvUpload, applied like the orchestrator does.
    const resumeEl = document.querySelector(config.cvUpload!);

    expect(by.get('fullName')?.confidence).toBe('high');
    expect(by.get('email')?.confidence).toBe('high');
    expect(by.get('phone')?.confidence).toBe('high');
    expect(resumeEl?.id).toBe('resume-hidden'); // override target exists even though hidden
  });
});

describe('ChaosForm — hashed ids, unmappable field, Pick recovery', () => {
  function mountChaos(): void {
    mount(`
      <form id="chaos-form">
        <label>Given name <input id="${HID('gn')}" /></label>
        <label for="${HID('sn')}">Family name</label>
        <input id="${HID('sn')}" placeholder="Family name" />
        <input id="${HID('em')}" aria-label="Email address" placeholder="you@company.com" />
        <label for="${HID('loc')}">Where are you located?</label>
        <input id="${HID('loc')}" />
        <label for="${HID('cl')}">Cover letter</label>
        <textarea id="${HID('cl')}"></textarea>
        <label for="${HID('cv')}">Attach CV</label>
        <input id="${HID('cv')}" type="file" />
      </form>`);
  }

  it('matches by accessible name despite hashed ids, and coverLetter/CV on step 2', () => {
    mountChaos();
    const by = detect(PROFILE_FIELDS);
    expect(by.get('firstName')?.confidence).toBe('high'); // wrapping label "Given name"
    expect(by.get('lastName')?.confidence).toBe('high');  // label + placeholder "Family name"
    expect(by.get('email')?.confidence).toBe('high');     // aria-label
    expect(by.get('coverLetter')?.confidence).toBe('high');
    expect(by.get('resume')?.element?.id).toBe(HID('cv'));
  });

  it('leaves the disguised city field unmatched (must be Picked)', () => {
    mountChaos();
    const by = detect(PROFILE_FIELDS);
    expect(by.get('city')?.element).toBeNull();
    expect(by.get('city')?.confidence).toBe('none');
  });

  it('a Pick override then resolves the city field', () => {
    mountChaos();
    const by = detect(PROFILE_FIELDS, { city: `#${HID('loc')}` });
    expect(by.get('city')?.element?.id).toBe(HID('loc'));
    expect(by.get('city')?.source).toBe('override');
    expect(by.get('city')?.confidence).toBe('high');
  });
});
