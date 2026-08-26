import { describe, it, expect } from 'vitest';
import { elementChain, stepChain, describeElement, MAX_CHAIN } from './elementChain';

/**
 * The stack is what `document.elementsFromPoint` hands back — innermost first.
 * Built by hand here because jsdom implements neither that call nor layout.
 */
function stackFor(el: Element): Element[] {
  const out: Element[] = [];
  for (let cur: Element | null = el; cur; cur = cur.parentElement) out.push(cur);
  if (document.documentElement && !out.includes(document.documentElement)) {
    out.push(document.documentElement);
  }
  return out;
}

/** A rect reader that gives every element its own box, so nothing is pruned. */
const distinct = (el: Element) => {
  const i = [...document.querySelectorAll('*')].indexOf(el);
  return { x: i, y: i, width: 100 - i, height: 100 - i };
};

function html(markup: string): void {
  document.body.innerHTML = markup;
}

describe('elementChain — the run of elements under one point', () => {
  it('reads outermost first, so the first click lands on the box around the thing', () => {
    html('<article id="posting"><div class="job-header"><h2><span>Senior</span></h2></div></article>');
    const span = document.querySelector('span')!;
    const chain = elementChain(stackFor(span), { rectOf: distinct });
    expect(chain.map((e) => e.tagName)).toEqual(['ARTICLE', 'DIV', 'H2', 'SPAN']);
  });

  it('always ends on the element that was actually under the pointer', () => {
    html('<div><p><b>x</b></p></div>');
    const b = document.querySelector('b')!;
    const chain = elementChain(stackFor(b), { rectOf: distinct });
    expect(chain[chain.length - 1]).toBe(b);
  });

  it('never offers the page itself — <html> and <body> are not candidates', () => {
    html('<div><span>x</span></div>');
    const span = document.querySelector('span')!;
    const chain = elementChain(stackFor(span), { rectOf: distinct });
    expect(chain.some((e) => e === document.body || e === document.documentElement)).toBe(false);
  });

  it('drops everything the extension drew, so a card left on screen is not pickable', () => {
    html('<div data-cf-picker="bar"><div class="wrap"><button>Send</button></div></div>');
    const button = document.querySelector('button')!;
    const chain = elementChain(stackFor(button), {
      rectOf: distinct,
      isOwn: (el) => !!el.closest('[data-cf-picker]'),
    });
    expect(chain).toEqual([]);
  });

  it('drops a wrapper drawing the same box as its child — that click would look dead', () => {
    html('<section><div class="pad"><button>Send</button></div></section>');
    const button = document.querySelector('button')!;
    const same = new Map<Element, DOMRectLike>([
      [document.querySelector('section')!, { x: 0, y: 0, width: 300, height: 300 }],
      [document.querySelector('.pad')!, { x: 10, y: 10, width: 80, height: 40 }],
      [button, { x: 10, y: 10, width: 80, height: 40 }],
    ]);
    const chain = elementChain(stackFor(button), { rectOf: (el) => same.get(el) ?? distinct(el) });
    expect(chain.map((e) => e.tagName)).toEqual(['SECTION', 'BUTTON']);
  });

  it(`stops climbing at ${MAX_CHAIN} above the innermost, so a wrap stays short`, () => {
    html('<div><div><div><div><div><div><div><span>x</span></div></div></div></div></div></div></div>');
    const span = document.querySelector('span')!;
    const chain = elementChain(stackFor(span), { rectOf: distinct });
    expect(chain).toHaveLength(MAX_CHAIN + 1);
    expect(chain[chain.length - 1]).toBe(span);
  });

  it('caps after pruning, not before — a run of wrappers does not eat the budget', () => {
    html('<main><div><div><div><section><span>x</span></section></div></div></div></main>');
    const span = document.querySelector('span')!;
    const box = { x: 0, y: 0, width: 200, height: 200 };
    // The three middle divs draw exactly the section's box, so none of them counts.
    const rects = new Map<Element, DOMRectLike>();
    for (const el of document.querySelectorAll('div, section')) rects.set(el, box);
    const chain = elementChain(stackFor(span), {
      rectOf: (el) => rects.get(el) ?? distinct(el),
    });
    expect(chain.map((e) => e.tagName)).toEqual(['MAIN', 'SECTION', 'SPAN']);
  });

  it('is empty for an empty stack rather than throwing', () => {
    expect(elementChain([], { rectOf: distinct })).toEqual([]);
  });
});

describe('stepChain — moving through it', () => {
  it('steps inward and wraps back to the outermost', () => {
    expect(stepChain(3, 0, 1)).toBe(1);
    expect(stepChain(3, 2, 1)).toBe(0);
  });

  it('steps outward and wraps back to the innermost', () => {
    expect(stepChain(3, 1, -1)).toBe(0);
    expect(stepChain(3, 0, -1)).toBe(2);
  });

  it('stays put when there is nowhere to go', () => {
    expect(stepChain(1, 0, 1)).toBe(0);
    expect(stepChain(0, 0, -1)).toBe(0);
  });
});

describe('describeElement — what the toolbar reads back', () => {
  it('names an element by a stable id', () => {
    html('<input id="email">');
    expect(describeElement(document.querySelector('input')!)).toBe('input#email');
  });

  it('ignores a generated id, which would be a different one next deploy', () => {
    html('<div id="css-1a2b3c4d"><span>x</span></div>');
    expect(describeElement(document.querySelector('div')!)).toBe('div');
  });

  it('falls back to a class that says what the thing is', () => {
    html('<div class="row job-header"><span>x</span></div>');
    // `row` is a layout word on half the page; `job-header` is the name.
    expect(describeElement(document.querySelector('div')!)).toBe('div.job-header');
  });

  it('is just the tag when nothing on it is worth quoting', () => {
    html('<div class="row"><button>Send</button></div>');
    expect(describeElement(document.querySelector('button')!)).toBe('button');
  });
});

type DOMRectLike = { x: number; y: number; width: number; height: number };
