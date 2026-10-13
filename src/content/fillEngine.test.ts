import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FillEngine, type EngineDeps } from './fillEngine';
import type { Lesson, Profile } from '../shared/types';
import { isDisplayed } from '../shared/visible';

let profile: Profile;
let lessons: Lesson[];
let pageChanged: () => void;
let reports: number;

function engine(over: Partial<EngineDeps> = {}): FillEngine {
  return new FillEngine({
    profile: () => profile,
    lessons: () => lessons,
    docs: () => ({ cv: null, cover: null }),
    onReport: () => { reports++; },
    visible: isDisplayed,
    watch: (cb) => { pageChanged = cb; return () => {}; },
    host: 'jobs.test',
    isUserEvent: (e) => (e as Event & { user?: boolean }).user === true,
    ...over,
  });
}

const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;

/** The user typing — a trusted event in a browser, which jsdom cannot make. */
function userTypes(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(Object.assign(new Event('input', { bubbles: true }), { user: true }));
}

beforeEach(() => {
  profile = {
    values: { firstName: 'Ada', email: 'ada@example.test' },
    keywords: {},
    customFields: [{ id: 'c_visa', label: 'Sponsorship', kind: 'yesNo', value: 'No', keywords: [] }],
  };
  lessons = [];
  reports = 0;
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('FillEngine — a sweep', () => {
  it('fills what it is sure of and lists what it does not know', () => {
    document.body.innerHTML = `
      <label for="fn">First name</label><input id="fn">
      <label for="em">Email</label><input id="em" type="email">
      <label for="h">How did you hear about us?</label><input id="h">`;
    const e = engine();
    e.sweep();
    expect($('fn').value).toBe('Ada');
    expect($('em').value).toBe('ada@example.test');
    expect($('h').value).toBe('');
    // What needs the user leads the report.
    expect(e.rows.map((r) => r.question)).toEqual(['How did you hear about us?', 'First name', 'Email']);
    expect(e.rows[0].field).toBeUndefined();
    expect(reports).toBe(1);
  });

  it('never writes over an answer already in the box', () => {
    document.body.innerHTML = '<label for="fn">First name</label><input id="fn" value="Grace">';
    const e = engine();
    e.sweep();
    expect($('fn').value).toBe('Grace');
    expect(e.rows[0]).toMatchObject({ field: 'firstName', kept: true, filled: false });
  });

  it('does not report an unrecognised input that already holds an answer', () => {
    document.body.innerHTML = '<label for="x">Referral code</label><input id="x" value="ABC">';
    const e = engine();
    e.sweep();
    expect(e.rows).toHaveLength(0);
  });

  it('a recognised field with nothing in the profile is a row to check, not a fill', () => {
    document.body.innerHTML = '<label for="ph">Phone</label><input id="ph">';
    const e = engine();
    e.sweep();
    expect(e.rows[0]).toMatchObject({ field: 'phone', filled: false });
    expect(e.rows[0].valueToFill).toBeUndefined();
  });

  it('answers a radio group from a custom field', () => {
    document.body.innerHTML = `
      <fieldset><legend>Do you need sponsorship?</legend>
        <label><input type="radio" name="s" id="y"> Yes</label>
        <label><input type="radio" name="s" id="n"> No</label></fieldset>`;
    engine().sweep();
    expect($('n').checked).toBe(true);
  });

  it('with fill off, classifies and reports without writing', () => {
    document.body.innerHTML = '<label for="fn">First name</label><input id="fn">';
    const e = engine();
    e.sweep({ fill: false });
    expect($('fn').value).toBe('');
    expect(e.rows[0].field).toBe('firstName');
  });
});

describe('FillEngine — inputs that appear later', () => {
  it('fills a form that appears after the first sweep, and appends it without moving the report', () => {
    document.body.innerHTML = '<label for="h">How did you hear about us?</label><input id="h">';
    const e = engine();
    e.start();
    e.sweep();
    const before = e.rows.map((r) => r.id);

    document.body.insertAdjacentHTML('beforeend', '<label for="em">Email</label><input id="em">');
    pageChanged();

    expect($('em').value).toBe('ada@example.test');
    expect(e.rows.map((r) => r.id).slice(0, before.length)).toEqual(before);
    expect(e.rows.at(-1)).toMatchObject({ field: 'email', later: true });
    e.stop();
  });

  it('decides about each input once', () => {
    document.body.innerHTML = '<label for="fn">First name</label><input id="fn">';
    const e = engine();
    e.start();
    e.sweep();
    expect(e.sweep()).toBe(0);
    expect(e.rows).toHaveLength(1);
    e.stop();
  });

  it('never writes into a box the user has typed in', () => {
    document.body.innerHTML = '<label for="h">Notice period</label><input id="h">';
    const e = engine();
    e.start();
    e.sweep();
    userTypes($('h'), 'two weeks');
    profile.customFields!.push({ id: 'c_np', label: 'Notice period', kind: 'text', value: '1 month', keywords: [] });
    e.reconsider();
    expect($('h').value).toBe('two weeks');
    e.stop();
  });

  it('waits for a hidden tab to come back before sweeping', () => {
    const e = engine();
    e.start();
    const spy = vi.spyOn(e, 'sweep');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    pageChanged();
    expect(spy).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(spy).toHaveBeenCalledTimes(1);
    e.stop();
  });
});

describe('FillEngine — teaching', () => {
  it('a taught row fills in place', () => {
    document.body.innerHTML = `
      <label for="h">Given name</label><input id="h">
      <label for="em">Email</label><input id="em">`;
    const e = engine();
    e.sweep();
    const row = e.rows.find((r) => r.question === 'Given name')!;
    const at = e.rows.indexOf(row);
    expect(e.applyTeaching(row.id, { field: 'firstName' }, 'l1')).toBe(true);
    expect($('h').value).toBe('Ada');
    expect(e.rows.indexOf(row)).toBe(at);
    expect(row).toMatchObject({ field: 'firstName', taught: true, filled: true });
  });

  it('ignoring a row leaves it where it is, needing nothing', () => {
    document.body.innerHTML = '<label for="h">Middle name</label><input id="h">';
    const e = engine();
    e.sweep();
    e.applyTeaching(e.rows[0].id, { ignore: true });
    expect(e.rows[0].ignored).toBe(true);
    expect($('h').value).toBe('');
  });

  it('a lesson learned elsewhere fills an open row on reconsider', () => {
    document.body.innerHTML = '<label for="h">Given name</label><input id="h">';
    const e = engine();
    e.sweep();
    lessons = [{ id: 'l1', signature: { question: 'given name', kind: 'text' }, target: { field: 'firstName' }, label: 'Given name', createdAt: 0, hits: 0 }];
    e.reconsider();
    expect($('h').value).toBe('Ada');
  });

  it('counts the lessons that filled something', () => {
    lessons = [{ id: 'l1', signature: { question: 'given name', kind: 'text' }, target: { field: 'firstName' }, label: 'Given name', createdAt: 0, hits: 0 }];
    document.body.innerHTML = '<label for="h">Given name</label><input id="h">';
    const onLessonHits = vi.fn();
    engine({ onLessonHits }).sweep();
    expect(onLessonHits).toHaveBeenCalledWith(['l1']);
  });

  it('the picker can name an input no sweep listed', () => {
    document.body.innerHTML = '<input id="h" style="display:none">';
    const e = engine();
    e.sweep();
    expect(e.rows).toHaveLength(0);
    const row = e.rowForElement($('h'));
    expect(row?.field).toBeUndefined();
    expect(e.rows).toHaveLength(1);
  });
});

describe('FillEngine — reset', () => {
  it('empties what it filled and starts over', () => {
    document.body.innerHTML = '<label for="fn">First name</label><input id="fn"><label for="x">Nickname</label><input id="x" value="mine">';
    const e = engine();
    e.sweep();
    e.reset();
    expect($('fn').value).toBe('');
    expect($('x').value).toBe('mine');
    expect(e.rows).toHaveLength(0);
  });
});
