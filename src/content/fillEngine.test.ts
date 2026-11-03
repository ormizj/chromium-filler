import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FillEngine, IDLE_STOP_MS, WAKE_THROTTLE_MS, type EngineDeps, type UserAnswer } from './fillEngine';
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

const user = (type: string) => Object.assign(new Event(type, { bubbles: true }), { user: true });

/** The user typing — a trusted event in a browser, which jsdom cannot make. */
function userTypes(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(user('input'));
}

/** The user typing and leaving the box — the browser's `change` on blur. */
function userAnswers(el: HTMLInputElement, value: string): void {
  userTypes(el, value);
  el.dispatchEvent(user('change'));
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

describe('FillEngine — learning from what the user types', () => {
  it('hands a committed answer on, with the row as it was', () => {
    document.body.innerHTML = '<label for="h">Preferred contact</label><input id="h">';
    const onAnswer = vi.fn<(a: UserAnswer) => void>();
    const e = engine({ onAnswer });
    e.start();
    e.sweep();
    userAnswers($('h'), 'ada@example.test');
    expect(onAnswer).toHaveBeenCalledOnce();
    expect(onAnswer.mock.calls[0][0]).toMatchObject({
      answer: 'ada@example.test',
      before: { confidence: 'none', filled: false, source: 'none' },
    });
    expect(e.rows[0].answered).toBe(true);
    e.stop();
  });

  it('typing without leaving the box commits nothing — learning waits for the blur', () => {
    document.body.innerHTML = '<label for="h">Preferred contact</label><input id="h">';
    const onAnswer = vi.fn();
    const e = engine({ onAnswer });
    e.start();
    e.sweep();
    userTypes($('h'), 'ada@');
    expect(onAnswer).not.toHaveBeenCalled();
    e.stop();
  });

  it('our own fills are never mistaken for the user', () => {
    document.body.innerHTML = '<label for="fn">First name</label><input id="fn">';
    const onAnswer = vi.fn();
    const e = engine({ onAnswer });
    e.start();
    e.sweep();
    expect($('fn').value).toBe('Ada');
    expect(onAnswer).not.toHaveBeenCalled();
    e.stop();
  });

  it('a correction says what we had written there', () => {
    document.body.innerHTML = '<label for="fn">First name</label><input id="fn">';
    const onAnswer = vi.fn<(a: UserAnswer) => void>();
    const e = engine({ onAnswer });
    e.start();
    e.sweep();
    userAnswers($('fn'), 'Grace');
    expect(onAnswer.mock.calls[0][0].before).toMatchObject({ field: 'firstName', filled: true, filledValue: 'Ada' });
    expect(e.rows[0]).toMatchObject({ filled: false, answered: true });
    e.stop();
  });

  it('an input no sweep listed gets a row at the end when the user answers it', () => {
    document.body.innerHTML = '<label for="x">Referral code</label><input id="x" value="ABC">';
    const onAnswer = vi.fn();
    const e = engine({ onAnswer });
    e.start();
    e.sweep();
    expect(e.rows).toHaveLength(0);
    userAnswers($('x'), 'XYZ');
    expect(e.rows).toHaveLength(1);
    expect(e.rows[0]).toMatchObject({ later: true, answered: true });
    e.stop();
  });

  it('a contenteditable commits as focus leaves, if its text changed', () => {
    document.body.innerHTML = '<label id="l">Summary</label><div id="ce" contenteditable="true" aria-labelledby="l"></div>';
    const onAnswer = vi.fn<(a: UserAnswer) => void>();
    const e = engine({ onAnswer });
    e.start();
    e.sweep();
    const ce = $<HTMLDivElement>('ce');
    ce.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    ce.textContent = 'Hello';
    ce.dispatchEvent(user('input'));
    ce.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(onAnswer.mock.calls[0]?.[0].answer).toBe('Hello');
    e.stop();
  });

  it('a learned row changes in place and writes nothing', () => {
    document.body.innerHTML = `
      <label for="h">Preferred contact</label><input id="h">
      <label for="em">Email</label><input id="em">`;
    const e = engine();
    e.start();
    e.sweep();
    const row = e.rows.find((r) => r.question === 'Preferred contact')!;
    const at = e.rows.indexOf(row);
    userAnswers($('h'), 'ADA@example.test');
    e.learned(row.id, { field: 'email' }, 'l1');
    expect($('h').value).toBe('ADA@example.test');
    expect(e.rows.indexOf(row)).toBe(at);
    expect(row).toMatchObject({ field: 'email', learned: true, source: 'lesson', confidence: 'high' });
    e.stop();
  });

  it('a corrected row says the profile took the answer, and writes nothing', () => {
    document.body.innerHTML = '<label for="fn">First name</label><input id="fn">';
    const e = engine();
    e.start();
    e.sweep();
    userAnswers($('fn'), 'John');
    profile = { ...profile, values: { ...profile.values, firstName: 'John' } };
    e.saved(e.rows[0].id, 'firstName', 'John');
    expect($('fn').value).toBe('John');
    expect(e.rows[0]).toMatchObject({ field: 'firstName', saved: true, answered: true, valueToFill: 'John' });
    e.stop();
  });

  it('names every recognised input on the page, and only those', () => {
    document.body.innerHTML = `
      <label for="fn">First name</label><input id="fn">
      <label for="x">Favourite colour</label><input id="x">`;
    const e = engine();
    e.sweep();
    const chips = [...document.querySelectorAll('[data-cf-tag]')].map((t) => t.textContent);
    expect(chips).toEqual(['First name']);
  });

  it('a learned "leave it alone" sets the row aside', () => {
    document.body.innerHTML = '<label for="h">Middle name</label><input id="h">';
    const e = engine();
    e.sweep();
    e.learned(e.rows[0].id, { ignore: true });
    expect(e.rows[0]).toMatchObject({ ignored: true, learned: true });
    expect(e.rows[0].field).toBeUndefined();
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
});

describe('FillEngine — the watch while the user works', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('stands down after a long quiet, and comes back — and looks — when the user acts', () => {
    vi.useFakeTimers();
    let watching = 0;
    const e = engine({ watch: (cb) => { watching++; pageChanged = cb; return () => { watching--; }; } });
    e.start();
    e.sweep();
    vi.advanceTimersByTime(IDLE_STOP_MS + 1);
    expect(watching).toBe(0);

    document.body.innerHTML = '<label for="em">Email</label><input id="em">';
    document.dispatchEvent(user('pointerdown'));
    expect(watching).toBe(1);
    expect($('em').value).toBe('ada@example.test');
    e.stop();
  });

  it('a user working the page keeps the watch from standing down', () => {
    vi.useFakeTimers();
    let watching = 0;
    const e = engine({ watch: () => { watching++; return () => { watching--; }; } });
    e.start();
    vi.advanceTimersByTime(IDLE_STOP_MS - WAKE_THROTTLE_MS);
    document.dispatchEvent(user('keydown'));
    vi.advanceTimersByTime(IDLE_STOP_MS - 1);
    expect(watching).toBe(1);
    e.stop();
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
