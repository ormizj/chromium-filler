import { describe, it, expect, afterEach } from 'vitest';
import { startRecording, type RecorderHandle } from './recorder';
import type { RecordedStep } from '../shared/recording';

let handle: RecorderHandle | undefined;
let steps: RecordedStep[] = [];

function record(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  steps = [];
  handle = startRecording({ leg: 'posting', startedAt: Date.now(), onStep: (s) => steps.push(s) });
  return root;
}

afterEach(() => {
  handle?.stop();
  handle = undefined;
  document.body.innerHTML = '';
});

const click = (el: Element) =>
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

function change(el: HTMLInputElement | HTMLTextAreaElement, value?: string): void {
  // jsdom refuses a programmatic value on a file input, which is the same rule real
  // browsers enforce — an attached file arrives as a `change` with nothing set here.
  if (value !== undefined) el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('what the recorder watches', () => {
  it('records a click with a selector and the control’s own words', () => {
    const root = record(`<button id="go">Apply now</button>`);
    click(root.querySelector('#go')!);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      action: 'click', label: 'Apply now', target: { selector: '#go' },
    });
  });

  /**
   * Half of the selector quality is choosing the right element to name. A click
   * lands on whatever `<span>` the button happens to wrap its label in, and a span
   * has nothing to be identified by — which is precisely what forces the structural
   * path this whole part exists to avoid.
   */
  it('names the control, not the span inside it that was actually hit', () => {
    const root = record(`<button id="go"><span class="lbl">Apply</span></button>`);
    click(root.querySelector('.lbl')!);
    expect(steps[0].target?.selector).toBe('#go');
  });

  it('records a plain element when the click was not on a control', () => {
    const root = record(`<section id="body">Read me</section>`);
    click(root.querySelector('#body')!);
    expect(steps[0].target?.selector).toBe('#body');
  });

  /**
   * Pressing a label makes the browser raise a second click on the control it names.
   * That is one gesture, and recording it twice puts a step in the config that
   * replays a press the user never made.
   */
  it('counts a label and the control it activates as one press', () => {
    const root = record(`<label id="l">Remote <input id="cb" type="checkbox" /></label>`);
    click(root.querySelector('#l')!);
    expect(steps).toHaveLength(1);
    expect(steps[0].action).toBe('click');
  });

  /**
   * A tick is one gesture that raises two events, and the second is worse than
   * redundant: a checkbox is never a profile field, so it arrives as an unbound
   * `input` step, which the compiler drops — and "I agree to the terms" quietly does
   * not make it into the config. The click is the record.
   */
  it('records a ticked box once, as the click it was', () => {
    const root = record(`<input id="cb" type="checkbox" />`);
    click(root.querySelector('#cb')!);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ action: 'click', target: { selector: '#cb' } });
  });

  it('records typing as the field it went into, guessed', () => {
    const root = record(`<label for="e">Email</label><input id="e" name="email" />`);
    change(root.querySelector('#e')!, 'someone@example.com');
    expect(steps[0]).toMatchObject({
      action: 'input', bind: 'field:email', bindSource: 'auto', target: { selector: '#e' },
    });
  });

  it('treats an unlabelled upload as the CV, as a guess', () => {
    const root = record(`<input id="f" type="file" />`);
    change(root.querySelector('#f')!);
    expect(steps[0]).toMatchObject({ action: 'input', bind: 'field:resume', bindSource: 'auto' });
  });

  it('records a field it cannot name, so the user can bind it themselves', () => {
    const root = record(`<input id="mystery" />`);
    change(root.querySelector('#mystery')!);
    expect(steps[0]).toMatchObject({ action: 'input', target: { selector: '#mystery' } });
    expect(steps[0].bind).toBeUndefined();
  });
});

describe('what the recorder must not do', () => {
  /**
   * The user is filling in their real name, address and salary expectation. Where
   * those went is the config; what they were is nobody's business, and a recording
   * is written to `chrome.storage.session` and rendered in a review panel.
   */
  it('never stores what was typed', () => {
    const root = record(`<input id="e" name="email" />`);
    change(root.querySelector('#e')!, 'someone@example.com');
    expect(JSON.stringify(steps)).not.toContain('someone@example.com');
    expect(steps[0]).not.toHaveProperty('value');
  });

  /**
   * The inverse of `picker.ts`, which cancels every click it sees. The user is
   * really applying for this job; a recorder that swallowed the press would record a
   * sequence that never happened and leave them stuck on the first step.
   */
  it('lets the page have the click', () => {
    const root = record(`<button id="go">Go</button>`);
    let pageSaw = false;
    root.querySelector('#go')!.addEventListener('click', (e) => {
      pageSaw = true;
      expect(e.defaultPrevented).toBe(false);
    });
    click(root.querySelector('#go')!);
    expect(pageSaw).toBe(true);
  });

  it('ignores its own bar and the sheets', () => {
    const root = record(`
      <div data-cf-recorder="bar"><button id="done">Done</button></div>
      <div id="chromium-filler-setup-host"><button id="pick">Pick</button></div>
      <div data-cf-picker="bar"><button id="confirm">Confirm</button></div>
    `);
    click(root.querySelector('#done')!);
    click(root.querySelector('#pick')!);
    click(root.querySelector('#confirm')!);
    expect(steps).toEqual([]);
  });

  it('stops watching when it is stopped', () => {
    const root = record(`<button id="go">Go</button>`);
    handle!.stop();
    click(root.querySelector('#go')!);
    expect(steps).toEqual([]);
  });
});

describe('the shape of a step', () => {
  it('times each step from the start of the recording, not the epoch', () => {
    const root = record(`<button id="go">Go</button>`);
    click(root.querySelector('#go')!);
    expect(steps[0].at).toBeGreaterThanOrEqual(0);
    expect(steps[0].at).toBeLessThan(60_000);
  });

  it('stamps the leg and the page it happened on', () => {
    const root = record(`<button id="go">Go</button>`);
    click(root.querySelector('#go')!);
    expect(steps[0].leg).toBe('posting');
    expect(steps[0].url).toBe(location.href);
  });

  it('gives every step a distinct id, which is what the review edits by', () => {
    const root = record(`<button id="a">A</button><button id="b">B</button>`);
    click(root.querySelector('#a')!);
    click(root.querySelector('#b')!);
    expect(steps[0].id).not.toBe(steps[1].id);
  });
});

describe('while something else is being pointed at', () => {
  /**
   * The picker and the recorder both listen on `document` in the capture phase, and
   * the recorder is attached first — so marking the confirmation banner used to
   * record a click on the confirmation banner too, which the compiler would then
   * faithfully replay on every later visit.
   */
  it('records nothing while a click-to-pick is running', () => {
    const root = record(`<button id="go">Go</button><div data-cf-picker="bar"></div>`);
    click(root.querySelector('#go')!);
    expect(steps).toEqual([]);

    root.querySelector('[data-cf-picker]')!.remove();
    click(root.querySelector('#go')!);
    expect(steps).toHaveLength(1);
  });
});
