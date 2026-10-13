import { describe, it, expect, afterEach } from 'vitest';
import { classify, collectCandidates, type Classified } from './fieldDetect';
import type { Lesson, Profile } from '../shared/types';
import { isDisplayed } from '../shared/visible';

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = '';
});

const EMPTY: Profile = { values: {}, keywords: {}, customFields: [] };

/** Everything on the page, classified at once — the engine's first sweep. */
function run(root: ParentNode, opts: { profile?: Profile; lessons?: Lesson[]; host?: string } = {}): Classified[] {
  const all = collectCandidates(root, { visible: isDisplayed });
  return classify(all, all, { profile: opts.profile ?? EMPTY, lessons: opts.lessons ?? [], host: opts.host ?? 'a.test' });
}

/** field -> the classified row that holds it. */
function byField(rows: Classified[]): Map<string, Classified> {
  return new Map(rows.filter((r) => r.field).map((r) => [r.field!, r]));
}
const idOf = (r?: Classified) => r?.cand.el.id;

describe('collectCandidates — what is ours to fill', () => {
  it('collects text inputs, selects, textareas, radios as groups, and uploads', () => {
    const root = mount(`
      <input id="a"><select id="b"><option>x</option></select><textarea id="c"></textarea>
      <input type="radio" name="r" id="r1"><input type="radio" name="r" id="r2">
      <input type="file" id="f" style="display:none">`);
    const cands = collectCandidates(root, { visible: isDisplayed });
    expect(cands.map((c) => c.el.id)).toEqual(['a', 'b', 'c', 'r1', 'f']);
    expect(cands[3].group?.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('never touches a login form, a search box or card details', () => {
    const root = mount(`
      <form><input id="user" autocomplete="email"><input type="password"></form>
      <form role="search"><input id="q"></form>
      <div role="search"><input id="q2"></div>
      <input id="cc" autocomplete="cc-number">
      <input id="otp" autocomplete="one-time-code">
      <input id="ok">`);
    expect(collectCandidates(root, { visible: isDisplayed }).map((c) => c.el.id)).toEqual(['ok']);
  });

  it('skips disabled, read-only and hidden inputs, and a group of checkboxes', () => {
    const root = mount(`
      <input id="d" disabled><input id="ro" readonly><input id="h" style="display:none">
      <input type="checkbox" name="lang" id="l1"><input type="checkbox" name="lang" id="l2">
      <input type="checkbox" name="agree" id="agree">`);
    expect(collectCandidates(root, { visible: isDisplayed }).map((c) => c.el.id)).toEqual(['agree']);
  });

  it('never offers our own UI', () => {
    const root = mount('<div id="chromium-filler-modal-host"><input id="mine"></div><input id="page">');
    expect(collectCandidates(root, { visible: isDisplayed }).map((c) => c.el.id)).toEqual(['page']);
  });
});

describe('classify — built-in heuristics', () => {
  it('detects email and phone by id with high confidence', () => {
    const by = byField(run(mount('<input id="email"><input id="phone">')));
    expect(idOf(by.get('email'))).toBe('email');
    expect(by.get('email')?.confidence).toBe('high');
    expect(idOf(by.get('phone'))).toBe('phone');
  });

  it('detects by label text and by autocomplete', () => {
    const by = byField(run(mount('<label for="x1">Phone number</label><input id="x1"><input id="q" autocomplete="email">')));
    expect(idOf(by.get('phone'))).toBe('x1');
    expect(idOf(by.get('email'))).toBe('q');
  });

  it('treats a placeholder-only match as low confidence', () => {
    expect(byField(run(mount('<input placeholder="Email address">'))).get('email')?.confidence).toBe('low');
  });

  it('treats the words written above the box as low confidence', () => {
    const rows = run(mount('<div><div>First name</div><div><input id="a"></div></div>'));
    expect(rows[0]).toMatchObject({ field: 'firstName', confidence: 'low' });
  });

  it('assigns first/last to their own inputs and never one input to two fields', () => {
    const by = byField(run(mount('<input id="first_name"><input id="last_name">')));
    expect(idOf(by.get('firstName'))).toBe('first_name');
    expect(idOf(by.get('lastName'))).toBe('last_name');
    expect(by.has('fullName')).toBe(false);
  });

  it('detects separator-free attribute names', () => {
    const by = byField(run(mount('<input name="firstname"><input name="lastname"><input name="emailaddress">')));
    expect(by.get('firstName')?.cand.el.getAttribute('name')).toBe('firstname');
    expect(by.get('email')?.cand.el.getAttribute('name')).toBe('emailaddress');
  });

  it('reports an input nothing recognises as a row to teach', () => {
    const rows = run(mount('<label for="h">How did you hear about us?</label><input id="h">'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'none', confidence: 'none' });
    expect(rows[0].field).toBeUndefined();
    expect(rows[0].cand.question).toBe('How did you hear about us?');
  });

  it('a field claimed by an earlier sweep is not claimed twice', () => {
    const root = mount('<input id="email">');
    const all = collectCandidates(root, { visible: isDisplayed });
    const rows = classify(all, all, { profile: EMPTY, lessons: [], host: 'a', claimed: new Set(['email']) });
    expect(rows[0].field).toBeUndefined();
  });
});

describe('classify — uploads', () => {
  it('a file input labelled as a CV, high; a lone unlabelled one, low', () => {
    expect(byField(run(mount('<label for="cv">Upload your CV / Resume</label><input id="cv" type="file">'))).get('resume')?.confidence).toBe('high');
    document.body.innerHTML = '';
    expect(byField(run(mount('<input type="file">'))).get('resume')?.confidence).toBe('low');
  });

  it('matches an accented "Résumé" label', () => {
    expect(idOf(byField(run(mount('<label for="cv">Résumé (PDF)</label><input id="cv" type="file">'))).get('resume'))).toBe('cv');
  });

  it('takes each of two labelled uploads, and never falls back onto the cover letter', () => {
    const by = byField(run(mount(`
      <label for="cv">Résumé</label><input id="cv" type="file">
      <label for="cl">Cover letter</label><input id="cl" type="file">`)));
    expect(idOf(by.get('resume'))).toBe('cv');
    expect(idOf(by.get('coverLetter'))).toBe('cl');
    document.body.innerHTML = '';
    expect(byField(run(mount('<input type="file">'))).has('coverLetter')).toBe(false);
  });

  it('still prefers a textarea for the cover letter when the page offers one', () => {
    const by = byField(run(mount(`
      <label for="clt">Cover letter</label><textarea id="clt"></textarea>
      <label for="cv">Résumé</label><input id="cv" type="file">`)));
    expect(idOf(by.get('coverLetter'))).toBe('clt');
    expect(idOf(by.get('resume'))).toBe('cv');
  });
});

describe('classify — the user\'s own fields', () => {
  const profile: Profile = {
    values: {},
    keywords: { firstName: ['christian name'] },
    customFields: [
      { id: 'c_exp', label: 'Years of experience', kind: 'text', value: '7', keywords: [] },
      { id: 'c_visa', label: 'Sponsorship', kind: 'yesNo', value: 'No', keywords: [] },
    ],
  };

  it('matches a custom field by its label, as a phrase in the question', () => {
    const rows = run(mount('<label for="a">How many years of experience do you have?</label><input id="a">'), { profile });
    expect(rows[0]).toMatchObject({ field: 'c_exp', source: 'keyword', confidence: 'high' });
  });

  it('matches a radio group by its legend', () => {
    const rows = run(mount(`
      <fieldset><legend>Do you require sponsorship?</legend>
        <label><input type="radio" name="s" value="y"> Yes</label>
        <label><input type="radio" name="s" value="n"> No</label></fieldset>`), { profile });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: 'c_visa', confidence: 'high' });
  });

  it('a wording the user added to a built-in field beats the guesses', () => {
    const rows = run(mount('<label for="a">Christian name</label><input id="a">'), { profile });
    expect(rows[0]).toMatchObject({ field: 'firstName', source: 'keyword' });
  });
});

describe('classify — lessons', () => {
  const lesson = (over: Partial<Lesson>): Lesson => ({
    id: 'l1', signature: { question: 'given name', kind: 'text' }, target: { field: 'firstName' },
    label: 'Given name', createdAt: 0, hits: 0, ...over,
  });

  it('a lesson decides the input, on any site', () => {
    const rows = run(mount('<label for="a">Given name</label><input id="a">'), { lessons: [lesson({})], host: 'other.test' });
    expect(rows[0]).toMatchObject({ field: 'firstName', source: 'lesson', confidence: 'high', lessonId: 'l1' });
  });

  it('a lesson outranks the heuristics', () => {
    const rows = run(mount('<label for="a">Email</label><input id="a">'), {
      lessons: [lesson({ signature: { question: 'email', kind: 'text' }, target: { field: 'c_work' } })],
    });
    expect(rows[0]).toMatchObject({ field: 'c_work', source: 'lesson' });
  });

  it('an ignore lesson takes the input out of the report', () => {
    const rows = run(mount('<label for="a">Middle name</label><input id="a">'), {
      lessons: [lesson({ signature: { question: 'middle name', kind: 'text' }, target: { ignore: true } })],
    });
    expect(rows[0].ignored).toBe(true);
  });

  it('two inputs one lesson cannot tell apart are both left for the user', () => {
    const rows = run(mount(`
      <label for="a">Name</label><input id="a">
      <label for="b">Name</label><input id="b">`), {
      lessons: [lesson({ signature: { question: 'name', kind: 'text' }, target: { field: 'fullName' } })],
    });
    expect(rows.map((r) => r.field)).toEqual([undefined, undefined]);
  });

  it('a lesson that carries its section fills only its own input', () => {
    const rows = run(mount(`
      <fieldset><legend>Reference 1</legend><label for="a">Name</label><input id="a"></fieldset>
      <fieldset><legend>Reference 2</legend><label for="b">Name</label><input id="b"></fieldset>`), {
      lessons: [lesson({ signature: { question: 'name', kind: 'text', section: 'reference 1' }, target: { field: 'c_ref' } })],
    });
    expect(rows[0].field).toBe('c_ref');
    expect(rows[1].field).not.toBe('c_ref');
  });
});
