import { describe, it, expect, afterEach } from 'vitest';
import { countMatches, elementText, query, queryAll, textSelector } from './query';

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('query — plain CSS', () => {
  it('finds an element', () => {
    mount(`<input id="email" />`);
    expect(query(document, '#email')).toBe(document.querySelector('#email'));
  });

  /**
   * The whole reason there is a helper. Six copies of this try/catch existed, and
   * `prep.ts` had none at all — a saved selector that stops parsing (a site config
   * hand-edited in the JSON editor, or one written by an older build) threw out of
   * `runStep` and aborted the whole prep list.
   */
  it('returns null for a malformed selector instead of throwing', () => {
    expect(() => query(document, 'div:::')).not.toThrow();
    expect(query(document, 'div:::')).toBeNull();
    expect(queryAll(document, 'div:::')).toEqual([]);
    expect(countMatches(document, 'div:::')).toBe(0);
  });

  it('treats an absent selector as no match', () => {
    expect(query(document, undefined)).toBeNull();
    expect(query(document, '')).toBeNull();
    expect(countMatches(document, undefined)).toBe(0);
  });

  it('counts every match', () => {
    mount(`<p></p><p></p><p></p>`);
    expect(countMatches(document, 'p')).toBe(3);
  });
});

describe('elementText', () => {
  it('collapses whitespace and lowercases, so markup layout cannot change the answer', () => {
    const root = mount(`<button>\n   Apply   now\n  </button>`);
    expect(elementText(root.querySelector('button')!)).toBe('apply now');
  });

  it('ignores markup that carries no text, like an icon', () => {
    const root = mount(`<button><svg></svg><span>Send</span></button>`);
    expect(elementText(root.querySelector('button')!)).toBe('send');
  });
});

describe('query — the :-cf-text() pseudo', () => {
  /**
   * The point of the whole grammar: on a board with no ids, no test ids and hashed
   * classes, the label is the only durable handle on the button that sends the
   * application. Structure is exactly what a re-render changes.
   */
  it('picks the one control with that label', () => {
    const root = mount(`
      <div><button class="x1a">Save draft</button></div>
      <div><button class="x9f">Apply now</button></div>
    `);
    expect(query(document, 'button:-cf-text("Apply now")')).toBe(root.querySelector('.x9f'));
  });

  it('matches regardless of case and surrounding whitespace', () => {
    const root = mount(`<button>  APPLY   NOW </button>`);
    expect(query(document, 'button:-cf-text("apply now")')).toBe(root.querySelector('button'));
  });

  /**
   * Equality, never "contains". A container whose text merely includes the label is
   * not the control, and on a job page that container is the whole posting.
   */
  it('does not match a container that merely contains the text', () => {
    mount(`<div>Ready? <button>Apply now</button> Good luck.</div>`);
    expect(queryAll(document, 'div:-cf-text("Apply now")')).toEqual([]);
    expect(query(document, 'button:-cf-text("Apply now")')).not.toBeNull();
  });

  /**
   * A wrapper holding nothing *but* the control does have the same text, and so does
   * match. That is not a bug to paper over here — it is real ambiguity, and the
   * place to answer it is `pickSelector`, which only keeps a candidate that resolves
   * to exactly one element. Silently preferring the innermost match would make the
   * uniqueness check a lie.
   */
  it('reports a bare wrapper as the ambiguity it is, rather than resolving it', () => {
    mount(`<div><button>Apply now</button></div>`);
    expect(countMatches(document, '*:-cf-text("Apply now")')).toBeGreaterThan(1);
  });

  it('narrows the compound it is attached to', () => {
    const root = mount(`<a href="#">Apply now</a><button>Apply now</button>`);
    expect(query(document, 'button:-cf-text("Apply now")')).toBe(root.querySelector('button'));
    expect(query(document, 'a:-cf-text("Apply now")')).toBe(root.querySelector('a'));
  });

  it('counts text matches too, so the generator can verify uniqueness', () => {
    mount(`<button>Go</button><button>Go</button>`);
    expect(countMatches(document, 'button:-cf-text("Go")')).toBe(2);
  });

  it('reads a literal containing escaped quotes', () => {
    const root = mount(`<button>Say "hi"</button>`);
    expect(query(document, textSelector('button', 'Say "hi"'))).toBe(root.querySelector('button'));
  });

  /**
   * Terminal-only, and at most one. That restriction is what keeps this a `split`
   * rather than a selector parser — and a selector we cannot resolve exactly must
   * resolve to *nothing*, never to a best guess at what it meant.
   */
  it('refuses a non-terminal pseudo rather than guessing', () => {
    mount(`<div><button>Apply</button><input id="in" /></div>`);
    expect(queryAll(document, 'button:-cf-text("Apply") + input')).toEqual([]);
  });

  it('refuses a selector carrying two of them', () => {
    mount(`<button>Apply</button>`);
    expect(queryAll(document, 'button:-cf-text("Apply"):-cf-text("Apply")')).toEqual([]);
  });

  /**
   * `pickSelector` always writes a compound, so this only has to not crash — but a
   * bare pseudo standing for `*` is what a hand-edited config will most likely say.
   */
  it('stands for * with no compound before it', () => {
    const root = mount(`<button>Apply</button>`);
    expect(queryAll(document, ':-cf-text("Apply")')).toContain(root.querySelector('button'));
  });

  it('searches within the root it is given', () => {
    const a = mount(`<button>Apply</button>`);
    mount(`<button>Apply</button>`);
    expect(queryAll(a, 'button:-cf-text("Apply")').length).toBe(1);
  });
});

describe('textSelector', () => {
  it('escapes so the literal survives a round trip', () => {
    expect(textSelector('button', 'Say "hi"')).toBe('button:-cf-text("Say \\"hi\\"")');
    expect(textSelector('button', 'a\\b')).toBe('button:-cf-text("a\\\\b")');
  });

  it('collapses the whitespace it stores, so the stored form matches what is read back', () => {
    expect(textSelector('h1', '  Senior\n  Engineer ')).toBe('h1:-cf-text("Senior Engineer")');
  });
});
