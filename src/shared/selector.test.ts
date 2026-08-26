import { describe, it, expect, afterEach } from 'vitest';
import { generateSelector, isStableClass, isStableId, pickSelector } from './selector';
import { countMatches, query } from './query';

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

describe('isStableClass', () => {
  it('accepts a class that names what the thing is', () => {
    expect(isStableClass('job-description')).toBe(true);
    expect(isStableClass('apply_button')).toBe(true);
    expect(isStableClass('postingHeadline')).toBe(true);
  });

  /**
   * The build-tool shapes. A CSS-modules or emotion class is regenerated on every
   * deploy, so a selector built on one is a selector that works until the next
   * release — which is worse than a structural path, because it looks meaningful.
   */
  it('rejects generated class names', () => {
    expect(isStableClass('css-1a2b3c')).toBe(false);
    expect(isStableClass('sc-bdVaJa')).toBe(false);
    expect(isStableClass('Button_root__x7f2q')).toBe(false);
    expect(isStableClass('styles_field_9ab3c')).toBe(false);
    expect(isStableClass('grid-1728394857')).toBe(false);
  });

  /**
   * State and layout classes are real words, and they are on half the page. A
   * selector built from one is unique by luck and stops being unique when the user
   * opens a menu.
   */
  it('rejects classes that carry no identity', () => {
    expect(isStableClass('active')).toBe(false);
    expect(isStableClass('open')).toBe(false);
    expect(isStableClass('container')).toBe(false);
    expect(isStableClass('row')).toBe(false);
    expect(isStableClass('btn')).toBe(false);
  });
});

describe('pickSelector — the ladder', () => {
  it('uses a stable unique id', () => {
    const root = mount(`<input id="email" />`);
    expect(pickSelector(root.querySelector('#email')!)).toMatchObject({
      selector: '#email', strategy: 'id', strength: 'strong',
    });
  });

  /**
   * Tag-qualified, unlike the old bare `[name="…"]`: a form, a `<meta>` and an
   * `<input>` can all carry the same `name`, and the bare form matched whichever
   * came first.
   */
  it('prefers a tag-qualified name when the id is unstable', () => {
    const root = mount(`<input id=":r7:" name="phone" />`);
    expect(pickSelector(root.querySelector('[name="phone"]')!)).toMatchObject({
      selector: 'input[name="phone"]', strategy: 'name', strength: 'strong',
    });
  });

  it('uses a data-test attribute when there is no id or name', () => {
    const root = mount(`<input data-testid="cv-upload" type="file" />`);
    expect(pickSelector(root.querySelector('[data-testid]')!)).toMatchObject({
      selector: '[data-testid="cv-upload"]', strategy: 'testid', strength: 'strong',
    });
  });

  it('uses an aria-label', () => {
    const root = mount(`<button aria-label="Attach CV"><svg></svg></button>`);
    expect(pickSelector(root.querySelector('button')!)).toMatchObject({
      selector: 'button[aria-label="Attach CV"]', strategy: 'aria', strength: 'strong',
    });
  });

  /**
   * The reason `:-cf-text()` exists. This button has nothing else — no id, no name,
   * no test id, no aria-label, and a hashed class — and its label is the only thing
   * about it that will still be true after the next deploy.
   */
  it('uses the label of a button that has nothing else', () => {
    const root = mount(`
      <div class="css-9a1f"><button class="css-1x2y">Save draft</button></div>
      <div class="css-9a1f"><button class="css-1x2y">Apply now</button></div>
    `);
    const el = root.querySelectorAll('button')[1]!;
    const pick = pickSelector(el);
    expect(pick).toMatchObject({ selector: 'button:-cf-text("Apply now")', strategy: 'text', strength: 'strong' });
    expect(query(document, pick.selector)).toBe(el);
  });

  it('never uses text for an input, which has none', () => {
    const root = mount(`<form class="css-1a2b"><input placeholder="Your email" /></form>`);
    const pick = pickSelector(root.querySelector('input')!);
    expect(pick.strategy).not.toBe('text');
  });

  it('uses a distinguishing attribute a form control carries', () => {
    const root = mount(`<div class="css-1a2b"><input placeholder="Your email" /></div>`);
    expect(pickSelector(root.querySelector('input')!)).toMatchObject({
      selector: 'input[placeholder="Your email"]', strategy: 'semantic',
    });
  });

  it('uses a class that names the thing', () => {
    const root = mount(`<section class="job-description"><p>x</p></section>`);
    expect(pickSelector(root.querySelector('section')!)).toMatchObject({
      selector: 'section.job-description', strategy: 'class', strength: 'ok',
    });
  });
});

describe('pickSelector — verification', () => {
  it('rejects an id that appears more than once', () => {
    const root = mount(`<input id="dup" name="a" /><input id="dup" name="b" />`);
    const second = root.querySelectorAll('#dup')[1]!;
    const pick = pickSelector(second);
    expect(pick.selector).not.toBe('#dup');
    expect(query(document, pick.selector)).toBe(second);
  });

  /**
   * The gap the old generator had: rungs 1-3 checked uniqueness and rung 4 did not,
   * so a structural path whose segments were all un-indexed could match two
   * elements and nothing noticed. Every rung is verified now, including the last.
   */
  it('always returns a selector that resolves to exactly the element it was given', () => {
    const root = mount(`
      <main>
        <section><div><span>a</span><span>b</span></div></section>
        <section><div><span>c</span><span>d</span></div></section>
        <form id="app">
          <input name="email" /><input name="email" />
          <label>CV <input type="file" /></label>
        </form>
      </main>
    `);
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const { selector } = pickSelector(el);
      expect(countMatches(document, selector), `${el.tagName}: ${selector}`).toBe(1);
      expect(query(document, selector)).toBe(el);
    }
  });

  it('scopes an ambiguous name to the form that owns it', () => {
    const root = mount(`
      <form id="search"><input name="q" /></form>
      <form id="apply"><input name="q" /></form>
    `);
    const el = root.querySelector('#apply input')!;
    const pick = pickSelector(el);
    expect(query(document, pick.selector)).toBe(el);
    expect(pick.selector).toContain('#apply');
  });
});

describe('pickSelector — anchoring, and the end of div > div > div', () => {
  /**
   * The whole point of Part 1. The old generator walked to `<html>` unless it met a
   * stable id, so on any hashed-class SPA every picked element got a root-anchored
   * path — the longest and most fragile handle available, chosen for elements that
   * had a perfectly good landmark three levels up.
   */
  it('anchors on the nearest identifiable ancestor instead of walking to the root', () => {
    const root = mount(`
      <div class="css-a1"><div class="css-b2"><div class="css-c3">
        <form data-testid="application">
          <div class="css-d4"><div class="css-e5"><span>x</span></div></div>
        </form>
      </div></div></div>
    `);
    const el = root.querySelector('span')!;
    const pick = pickSelector(el);
    expect(pick.selector.startsWith('[data-testid="application"]')).toBe(true);
    expect(query(document, pick.selector)).toBe(el);
    expect(pick.selector).not.toContain('html');
    expect(pick.selector).not.toContain('body');
  });

  it('caps how far it will walk from its anchor, rather than emitting any path that works', () => {
    const root = mount(`
      <div data-testid="far">
        <div class="css-1"><div class="css-2"><div class="css-3"><div class="css-4">
          <span>deep</span>
        </div></div></div></div>
      </div>
    `);
    const el = root.querySelector('span')!;
    const pick = pickSelector(el);
    expect(query(document, pick.selector)).toBe(el);
    // Too far from the anchor to call it anything but fragile — the review says so
    // and offers a re-pick, which is the honest answer for a handle like this.
    expect(pick.strength).toBe('fragile');
  });

  it('reports a bare structural path as fragile', () => {
    const root = mount(`<section><span></span><span></span><span></span></section>`);
    const el = root.querySelectorAll('span')[2]!;
    const pick = pickSelector(el);
    expect(query(document, pick.selector)).toBe(el);
    expect(pick.strength).toBe('fragile');
    expect(pick.strategy).toBe('path');
  });
});

describe('generateSelector', () => {
  it('is pickSelector’s selector, so the existing call sites are unchanged', () => {
    const root = mount(`<input id="email" />`);
    const el = root.querySelector('#email')!;
    expect(generateSelector(el)).toBe(pickSelector(el).selector);
  });
});
