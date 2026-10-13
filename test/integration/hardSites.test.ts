/**
 * Integration tests for the three hard test sites. These reconstruct each
 * site's *loaded* form DOM (after the slow load, after the modal opens) and
 * assert detection behaves on nasty markup: late injection, modal forms with no
 * id/name (accessible-name only), hashed ids, and an unmappable field that must
 * surface as a question to teach — and then be filled by the lesson.
 *
 * The full click/wait timing is covered by the Playwright E2E suite; here we
 * lock down the matching logic deterministically.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { classify, collectCandidates, type Classified } from '../../src/content/fieldDetect';
import type { Lesson, Profile } from '../../src/shared/types';
import { isDisplayed } from '../../src/shared/visible';

const HID = (s: string) => `fld-${s}-a1b2c3d4e5f6`;
const PROFILE: Profile = { values: {}, keywords: {}, customFields: [] };

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

/** Every input on the page, classified at once, keyed by the field each became. */
function detect(lessons: Lesson[] = []): Map<string, Classified> & { unknown: Classified[] } {
  const all = collectCandidates(document, { visible: isDisplayed });
  const rows = classify(all, all, { profile: PROFILE, lessons, host: 'chaos.test' });
  const by = new Map(rows.filter((r) => r.field).map((r) => [r.field!, r])) as Map<string, Classified> & { unknown: Classified[] };
  by.unknown = rows.filter((r) => !r.field && !r.ignored);
  return by;
}

afterEach(() => {
  document.body.innerHTML = '';
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
    const by = detect();
    expect(by.get('firstName')?.confidence).toBe('high');
    expect(by.get('lastName')?.confidence).toBe('high');
    expect(by.get('email')?.confidence).toBe('high');
    expect(by.get('phone')?.confidence).toBe('high');
    expect(by.get('resume')?.cand.el.id).toBe('resume-file');
    expect(by.get('resume')?.confidence).toBe('high');
  });
});

describe('ModalLever — modal form, accessible-name only, hidden CV input', () => {
  it('detects name/email/phone from aria-label + wrapping label, and the hidden upload', () => {
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
    const by = detect();
    expect(by.get('fullName')?.confidence).toBe('high');
    expect(by.get('email')?.confidence).toBe('high');
    expect(by.get('phone')?.confidence).toBe('high');
    // An invisible file input is still the control that takes the file.
    expect(by.get('resume')?.cand.el.id).toBe('resume-hidden');
    expect(by.get('resume')?.confidence).toBe('high');
  });
});

describe('ChaosForm — hashed ids, an unmappable field, and teaching it', () => {
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
    const by = detect();
    expect(by.get('firstName')?.confidence).toBe('high'); // wrapping label "Given name"
    expect(by.get('lastName')?.confidence).toBe('high');  // label + placeholder "Family name"
    expect(by.get('email')?.confidence).toBe('high');     // aria-label
    expect(by.get('coverLetter')?.confidence).toBe('high');
    expect(by.get('resume')?.cand.el.id).toBe(HID('cv'));
  });

  it('lists the disguised city field as a question to teach', () => {
    mountChaos();
    const by = detect();
    expect(by.has('city')).toBe(false);
    expect(by.unknown.map((r) => r.cand.question)).toContain('Where are you located?');
  });

  it('a lesson then fills the city field — by its wording, not its hashed id', () => {
    mountChaos();
    const by = detect([{
      id: 'l1', signature: { question: 'where are you located', kind: 'text' }, target: { field: 'city' },
      label: 'Where are you located?', createdAt: 0, hits: 0,
    }]);
    expect(by.get('city')?.cand.el.id).toBe(HID('loc'));
    expect(by.get('city')?.source).toBe('lesson');
    expect(by.get('city')?.confidence).toBe('high');
  });
});
