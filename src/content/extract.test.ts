/**
 * Container resolution is where the description's quality is decided: the generic
 * fallbacks are broad on purpose (a board that names nothing still has to show
 * something), which means what they match is routinely bigger than the posting.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { extractJob, previewContainer } from './extract';
import type { SiteConfig } from '../shared/types';

function config(extract: SiteConfig['extract'] = {}): SiteConfig {
  return {
    id: 'test', name: 'Test', urlPatterns: ['*://*/*'], extract,
    fieldOverrides: {}, prep: [],
  } as unknown as SiteConfig;
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.title = 'Test page';
});

describe('previewContainer', () => {
  it('uses the configured selector and reports it as an override', () => {
    document.body.innerHTML = '<div id="jd"><p>The posting.</p></div>';
    const p = previewContainer(config({ jobDescription: '#jd' }), 'jobDescription');
    expect(p.source).toBe('override');
    expect(p.text).toBe('The posting.');
  });

  it('reports a configured selector that matches nothing as a miss', () => {
    const p = previewContainer(config({ jobDescription: '#gone' }), 'jobDescription');
    expect(p.source).toBe('override-miss');
    expect(p.blocks).toEqual([]);
  });

  it('falls back to a generic container when nothing is configured', () => {
    document.body.innerHTML = '<div class="job-description"><p>Found by fallback.</p></div>';
    const p = previewContainer(config(), 'jobDescription');
    expect(p.source).toBe('auto');
    expect(p.text).toBe('Found by fallback.');
  });

  it('has no fallback for requirements — it is shown only when configured', () => {
    document.body.innerHTML = '<main><p>Everything.</p></main>';
    expect(previewContainer(config(), 'jobRequirements').source).toBe('none');
  });
});

describe('extractJob', () => {
  it('keeps the posting structured instead of welding it into one string', () => {
    document.body.innerHTML = `
      <div id="jd">
        <p>Acme is hiring.</p>
        <h3>What you will do</h3>
        <ul><li>Own the pipeline</li><li>Mentor</li></ul>
      </div>`;
    const job = extractJob(config({ jobDescription: '#jd' }));
    expect(job.description).toEqual([
      { kind: 'para', text: 'Acme is hiring.' },
      { kind: 'heading', text: 'What you will do' },
      { kind: 'list', items: ['Own the pipeline', 'Mentor'] },
    ]);
  });

  it('does not quote the application form back at the user', () => {
    // The `main` fallback swallows the form on most boards; the form's own labels
    // are the single most common contamination of a "description".
    document.body.innerHTML = `
      <main>
        <p>Great role.</p>
        <form><label>Full name</label><input id="n"><button>Send</button></form>
      </main>`;
    const job = extractJob(config());
    expect(job.description).toEqual([{ kind: 'para', text: 'Great role.' }]);
  });

  it('normalizes the title rather than passing the source whitespace through', () => {
    document.body.innerHTML = '<h1>  Staff   Platform\n  Engineer  </h1>';
    expect(extractJob(config()).title).toBe('Staff Platform Engineer');
  });

  it('falls back to the document title when no title container matches', () => {
    document.title = 'QuickBoard — apply here';
    expect(extractJob(config()).title).toBe('QuickBoard — apply here');
  });

  it('returns empty block lists rather than undefined when nothing is found', () => {
    const job = extractJob(config());
    expect(job.description).toEqual([]);
    expect(job.requirements).toEqual([]);
  });
});

/**
 * The fallbacks match on substrings of `id` and `class`, and a board's
 * "show the description" *button* matches `[id*="description"]` just as well as
 * the description does — better, in fact, because it comes first in the document.
 * That is exactly what `test/fixtures/sites/slow-boards.html` does, and the modal
 * showed a posting whose entire body was the words "Show full description".
 */
describe('previewContainer — a control is never the posting', () => {
  const SLOW_BOARDS = `
    <h1 id="job-title">Staff Platform Engineer</h1>
    <button id="expand-description">Show full description</button>
    <div id="job-description" class="desc">SlowBoards is hiring a Staff Platform Engineer.</div>
  `;

  it('walks past a button that matched the id fallback, to the real container', () => {
    document.body.innerHTML = SLOW_BOARDS;
    const p = previewContainer(config(), 'jobDescription');
    expect(p.text).toBe('SlowBoards is hiring a Staff Platform Engineer.');
    expect(p.text).not.toMatch(/show full description/i);
  });

  it('does the same through extractJob, which is what the modal renders', () => {
    document.body.innerHTML = SLOW_BOARDS;
    const job = extractJob(config());
    expect(job.title).toBe('Staff Platform Engineer');
    expect(job.description.map((b) => ('text' in b ? b.text : '')).join(' '))
      .not.toMatch(/show full description/i);
  });

  it('reports nothing rather than a control when the control is all there is', () => {
    document.body.innerHTML = '<button id="expand-description">Show full description</button>';
    const p = previewContainer(config(), 'jobDescription');
    expect(p.source).toBe('none');
    expect(p.blocks).toEqual([]);
  });

  // The same rule for an explicit selector: a saved override that resolves to a
  // control is a mis-pick, and the setup panel's "no longer matches" dot is a far
  // better answer than a button's label presented as the job.
  it('treats an override that lands on a control as a miss', () => {
    document.body.innerHTML = SLOW_BOARDS;
    const p = previewContainer(config({ jobDescription: '#expand-description' }), 'jobDescription');
    expect(p.source).toBe('override-miss');
  });
});
