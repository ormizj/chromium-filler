import { describe, it, expect, afterEach, vi } from 'vitest';
import { fillCheckbox, fillRadioGroup, fillTextField, hasValue } from './fill';

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('fillTextField', () => {
  it('sets an input value and dispatches bubbling input + change events', () => {
    const root = mount(`<input id="email" />`);
    const el = root.querySelector('input')!;
    const input = vi.fn();
    const change = vi.fn();
    el.addEventListener('input', input);
    el.addEventListener('change', change);

    const ok = fillTextField(el, 'you@example.com');

    expect(ok).toBe(true);
    expect(el.value).toBe('you@example.com');
    expect(input).toHaveBeenCalledOnce();
    expect(change).toHaveBeenCalledOnce();
  });

  it('fills a textarea', () => {
    const root = mount(`<textarea></textarea>`);
    const el = root.querySelector('textarea')!;
    expect(fillTextField(el, 'a cover letter')).toBe(true);
    expect(el.value).toBe('a cover letter');
  });

  it('selects a matching <select> option by value', () => {
    const root = mount(`
      <select>
        <option value="">--</option>
        <option value="us">United States</option>
        <option value="il">Israel</option>
      </select>`);
    const el = root.querySelector('select')!;
    expect(fillTextField(el, 'il')).toBe(true);
    expect(el.value).toBe('il');
  });

  it('selects a <select> option by visible text (case-insensitive)', () => {
    const root = mount(`
      <select>
        <option value="1">United States</option>
        <option value="2">Israel</option>
      </select>`);
    const el = root.querySelector('select')!;
    expect(fillTextField(el, 'israel')).toBe(true);
    expect(el.value).toBe('2');
  });

  it('does not pick an unrelated option that merely contains the value', () => {
    // Country lists are alphabetical and often carry no ISO value, so a
    // substring match on a short value hits "A-us-tralia" long before it
    // reaches "United States" — and the modal would report it as filled.
    const root = mount(`
      <select>
        <option>Select a country</option>
        <option>Australia</option>
        <option>Belarus</option>
        <option>United States</option>
      </select>`);
    const el = root.querySelector('select')!;
    expect(fillTextField(el, 'US')).toBe(false);
    expect(el.selectedIndex).toBe(0);
  });

  it('still resolves an unambiguous prefix (a value the user typed short)', () => {
    const root = mount(`
      <select>
        <option>Select…</option>
        <option>United Kingdom</option>
        <option>United States</option>
      </select>`);
    const el = root.querySelector('select')!;
    expect(fillTextField(el, 'United States of')).toBe(false); // no option matches
    expect(fillTextField(el, 'United King')).toBe(true);
    expect(el.value).toBe('United Kingdom');
  });

  it('returns false when a select has no matching option', () => {
    const root = mount(`<select><option value="1">One</option></select>`);
    const el = root.querySelector('select')!;
    expect(fillTextField(el, 'nope')).toBe(false);
  });
});

describe('fillChoice — radio groups and checkboxes', () => {
  const radios = () => {
    document.body.innerHTML = `
      <label><input type="radio" name="v" id="y" value="1"> Yes</label>
      <label><input type="radio" name="v" id="n" value="0"> No</label>`;
    return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
  };

  it('picks the radio whose label matches the value', () => {
    const group = radios();
    expect(fillRadioGroup(group, 'No')).toBe(true);
    expect(group[1].checked).toBe(true);
  });

  it('matches on the value attribute too', () => {
    const group = radios();
    expect(fillRadioGroup(group, '1')).toBe(true);
    expect(group[0].checked).toBe(true);
  });

  it('refuses to guess between options', () => {
    document.body.innerHTML = `
      <label><input type="radio" name="l"> Senior engineer</label>
      <label><input type="radio" name="l"> Senior manager</label>`;
    const group = Array.from(document.querySelectorAll<HTMLInputElement>('input'));
    expect(fillRadioGroup(group, 'senior')).toBe(false);
    expect(group.some((r) => r.checked)).toBe(false);
  });

  it('ticks a checkbox for yes and leaves it for no', () => {
    document.body.innerHTML = '<input type="checkbox" id="c">';
    const box = document.getElementById('c') as HTMLInputElement;
    expect(fillCheckbox(box, 'No')).toBe(true);
    expect(box.checked).toBe(false);
    expect(fillCheckbox(box, 'Yes')).toBe(true);
    expect(box.checked).toBe(true);
    expect(fillCheckbox(box, 'maybe')).toBe(false);
  });
});

describe('hasValue — what the engine must leave alone', () => {
  it('reads text, select, radio and checkbox state', () => {
    document.body.innerHTML = `
      <input id="t" value="x"><input id="e">
      <select id="s1"><option value="">Choose…</option><option>A</option></select>
      <select id="s2"><option>A</option><option selected>B</option></select>
      <input type="radio" name="r" id="r1"><input type="radio" name="r" id="r2" checked>
      <input type="radio" name="q" id="q1">
      <input type="checkbox" id="cb" checked>`;
    const $ = (id: string) => document.getElementById(id) as HTMLElement;
    expect(hasValue($('t'))).toBe(true);
    expect(hasValue($('e'))).toBe(false);
    expect(hasValue($('s1'))).toBe(false);
    expect(hasValue($('s2'))).toBe(true);
    expect(hasValue($('r1'), [$('r1'), $('r2')] as HTMLInputElement[])).toBe(true);
    expect(hasValue($('q1'), [$('q1')] as HTMLInputElement[])).toBe(false);
    expect(hasValue($('cb'))).toBe(true);
  });

  it('a select whose first option is a prompt counts as empty', () => {
    document.body.innerHTML = '<select id="s"><option>Please select</option><option>Spain</option></select>';
    expect(hasValue(document.getElementById('s') as HTMLElement)).toBe(false);
  });
});
