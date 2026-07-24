import { describe, it, expect } from 'vitest';
import { findSubmitControl } from './submitDetect';

/** Build a detached document body from markup and return it as the search root. */
function root(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

describe('findSubmitControl', () => {
  it('takes a saved selector over anything it would have guessed', () => {
    const el = root(`
      <form>
        <button type="submit">Submit application</button>
        <button id="mine" type="button">Go</button>
      </form>`);
    const found = findSubmitControl(el, '#mine');
    expect(found.source).toBe('override');
    expect(found.element?.id).toBe('mine');
    expect(found.selectorUsed).toBe('#mine');
  });

  it('falls back to the heuristic when the saved selector no longer resolves', () => {
    const el = root('<form><button type="submit">Submit application</button></form>');
    const found = findSubmitControl(el, '#gone');
    expect(found.source).toBe('heuristic');
    expect(found.element?.textContent).toBe('Submit application');
  });

  it('survives a malformed saved selector instead of throwing', () => {
    const el = root('<form><button type="submit">Apply now</button></form>');
    expect(() => findSubmitControl(el, '#[[not-a-selector')).not.toThrow();
    expect(findSubmitControl(el, '#[[not-a-selector').source).toBe('heuristic');
  });

  it('finds the submit button by its text', () => {
    const el = root(`
      <form>
        <input name="email" />
        <button type="button">Apply now</button>
      </form>`);
    expect(findSubmitControl(el).element?.textContent).toBe('Apply now');
  });

  it('reads an input[type=submit] from its value attribute', () => {
    const el = root('<form><input type="submit" value="Send application" /></form>');
    const found = findSubmitControl(el);
    expect(found.source).toBe('heuristic');
    expect((found.element as HTMLInputElement).value).toBe('Send application');
  });

  it('reads a control labelled only by aria-label', () => {
    const el = root('<form><button type="button" aria-label="Submit your application"></button></form>');
    expect(findSubmitControl(el).source).toBe('heuristic');
  });

  it('matches a label with diacritics and odd casing', () => {
    const el = root('<form><button type="button">SOUMETTRE · Apply</button></form>');
    expect(findSubmitControl(el).element?.textContent).toContain('Apply');
  });

  /**
   * The single most damaging mistake this can make. "Save job" sits next to the
   * real button on most boards and pressing it silently loses the application.
   */
  it('never chooses a Save / Cancel / Back / draft control', () => {
    for (const label of ['Save job', 'Save', 'Cancel', 'Back', 'Save as draft', 'Search jobs']) {
      const el = root(`<form><button type="submit">${label}</button></form>`);
      expect(findSubmitControl(el).source, label).toBe('none');
    }
  });

  it('does not mistake the file-picker button for the submit button', () => {
    const el = root(`
      <form>
        <button type="button">Upload CV</button>
        <button type="button">Browse…</button>
      </form>`);
    expect(findSubmitControl(el).source).toBe('none');
  });

  it('reports none rather than guessing when nothing scores', () => {
    const el = root('<form><button type="submit">Continue</button></form>');
    const found = findSubmitControl(el);
    expect(found.source).toBe('none');
    expect(found.element).toBeNull();
  });

  it('ignores a hidden button', () => {
    const el = root(`
      <form>
        <button type="submit" style="display:none">Submit application</button>
        <button type="submit">Apply now</button>
      </form>`);
    expect(findSubmitControl(el).element?.textContent).toBe('Apply now');
  });

  it('ignores a disabled button', () => {
    const el = root(`
      <form>
        <button type="submit" disabled>Submit application</button>
        <button type="submit">Apply now</button>
      </form>`);
    expect(findSubmitControl(el).element?.textContent).toBe('Apply now');
  });

  /**
   * A board page is a search form plus an application form. Scoring alone would
   * happily return the header's "Apply filters", so the form carrying the fields
   * that were just filled has to win.
   */
  it('prefers the form holding the filled fields over another form on the page', () => {
    const host = root(`
      <form id="search"><button type="submit">Apply filters</button></form>
      <form id="apply">
        <input id="email" name="email" />
        <button type="submit">Apply</button>
      </form>`);
    const within = host.querySelector('#email') as HTMLElement;
    const found = findSubmitControl(host, undefined, [within]);
    expect(found.element?.closest('form')?.id).toBe('apply');
  });

  it('still finds a button that sits outside the form it submits', () => {
    const host = root(`
      <form id="apply"><input id="email" name="email" /></form>
      <button type="submit" form="apply">Submit application</button>`);
    const within = host.querySelector('#email') as HTMLElement;
    expect(findSubmitControl(host, undefined, [within]).element?.textContent)
      .toBe('Submit application');
  });

  it('accepts a div acting as a button via role', () => {
    const el = root('<form><div role="button" tabindex="0">Submit application</div></form>');
    expect(findSubmitControl(el).source).toBe('heuristic');
  });

  it('prefers an explicit submit button over a plain one with a weaker label', () => {
    const el = root(`
      <form>
        <button type="button">Apply</button>
        <button type="submit">Submit application</button>
      </form>`);
    expect(findSubmitControl(el).element?.textContent).toBe('Submit application');
  });
});
