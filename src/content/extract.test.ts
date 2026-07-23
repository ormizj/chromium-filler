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
