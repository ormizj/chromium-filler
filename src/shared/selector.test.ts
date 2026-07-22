import { describe, it, expect, afterEach } from 'vitest';
import { generateSelector, isStableId } from './selector';

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isStableId', () => {
  it('accepts human-readable ids', () => {
    expect(isStableId('email')).toBe(true);
    expect(isStableId('first_name')).toBe(true);
    expect(isStableId('candidate-phone')).toBe(true);
  });

  it('rejects framework-generated / hashed ids', () => {
    expect(isStableId(':r1:')).toBe(false);
    expect(isStableId('input-a1b2c3d4e5f6')).toBe(false);
    expect(isStableId('field_1728394857')).toBe(false);
    expect(isStableId('')).toBe(false);
  });
});

describe('generateSelector', () => {
  it('uses a stable unique id', () => {
    const root = mount(`<input id="email" />`);
    const el = root.querySelector('#email')!;
    expect(generateSelector(el)).toBe('#email');
  });

  it('re-selects the same element via the generated selector', () => {
    const root = mount(`
      <form>
        <div><input id="email" /></div>
        <div><input name="phone" /></div>
        <div><input placeholder="nothing useful" /></div>
      </form>
    `);
    for (const el of Array.from(root.querySelectorAll('input'))) {
      const sel = generateSelector(el);
      expect(document.querySelectorAll(sel).length).toBe(1);
      expect(document.querySelector(sel)).toBe(el);
    }
  });

  it('prefers name when id is unstable', () => {
    const root = mount(`<input id=":r7:" name="phone" />`);
    const el = root.querySelector('[name="phone"]')!;
    expect(generateSelector(el)).toBe('[name="phone"]');
  });

  it('uses a data-test attribute when no id/name', () => {
    const root = mount(`<input data-testid="cv-upload" type="file" />`);
    const el = root.querySelector('[data-testid="cv-upload"]')!;
    expect(generateSelector(el)).toBe('[data-testid="cv-upload"]');
  });

  it('does not use an id that appears more than once', () => {
    const root = mount(`<input id="dup" name="a" /><input id="dup" name="b" />`);
    const second = root.querySelectorAll('#dup')[1]!;
    const sel = generateSelector(second);
    expect(sel).not.toBe('#dup');
    expect(document.querySelector(sel)).toBe(second);
  });

  it('falls back to a structural path when there are no useful attributes', () => {
    const root = mount(`<section><span></span><span></span><span data-x></span></section>`);
    const el = root.querySelectorAll('span')[2]!;
    const sel = generateSelector(el);
    expect(document.querySelector(sel)).toBe(el);
  });
});
