import { describe, it, expect, afterEach, vi } from 'vitest';
import { fillTextField } from './fill';

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
