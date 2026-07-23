/**
 * The modal's whole reason to exist after a fill is "do I want this job?", and
 * that is a reading task. `textContent` cannot serve it: it welds every heading,
 * paragraph and bullet into one string and keeps the HTML source's own newlines
 * and indentation, which then rendered as ragged pre-wrap text.
 *
 * So these tests are about STRUCTURE surviving the walk, and about the junk that
 * shares a container with the description (the application form, the "similar
 * jobs" sidebar) not surviving it.
 */
import { describe, it, expect } from 'vitest';
import { extractBlocks, blocksToText, type JobBlock } from './jobText';

function root(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

/** Blocks as `kind:text` strings — the shape assertions read better this way. */
function shape(blocks: JobBlock[]): string[] {
  return blocks.map((b) => (b.kind === 'list' ? `list:${b.items.join('|')}` : `${b.kind}:${b.text}`));
}

describe('extractBlocks — structure survives', () => {
  it('keeps paragraphs apart instead of welding them together', () => {
    const blocks = extractBlocks(root('<p>First para.</p><p>Second para.</p>'));
    expect(shape(blocks)).toEqual(['para:First para.', 'para:Second para.']);
  });

  it('keeps headings as headings', () => {
    const blocks = extractBlocks(root('<h2>About the role</h2><p>We build things.</p>'));
    expect(shape(blocks)).toEqual(['heading:About the role', 'para:We build things.']);
  });

  it('keeps a list as one block of items', () => {
    const blocks = extractBlocks(root('<ul><li>Go</li><li>Rust</li></ul>'));
    expect(shape(blocks)).toEqual(['list:Go|Rust']);
  });

  it('collapses the source indentation that made pre-wrap text ragged', () => {
    // Exactly the shape of test/fixtures/sites/quick-board.html's #job-description.
    const blocks = extractBlocks(root(`
      <div>
        QuickBoard hosts the application itself. Nothing on this
        page should ever cause a handoff.
      </div>`));
    expect(shape(blocks)).toEqual([
      'para:QuickBoard hosts the application itself. Nothing on this page should ever cause a handoff.',
    ]);
  });

  it('splits a <br>-separated block into separate paragraphs', () => {
    const blocks = extractBlocks(root('<p>Line one<br>Line two<br><br>Line three</p>'));
    expect(shape(blocks)).toEqual(['para:Line one', 'para:Line two', 'para:Line three']);
  });

  it('does not emit a wrapper and its child as the same text twice', () => {
    const blocks = extractBlocks(root('<div><div><p>Only once.</p></div></div>'));
    expect(shape(blocks)).toEqual(['para:Only once.']);
  });

  it('reads a mixed posting in document order', () => {
    const blocks = extractBlocks(root(`
      <p>Acme is hiring.</p>
      <h3>Requirements</h3>
      <ul><li>8+ years</li><li>Kubernetes</li></ul>
      <p>Apply by Friday.</p>`));
    expect(shape(blocks)).toEqual([
      'para:Acme is hiring.',
      'heading:Requirements',
      'list:8+ years|Kubernetes',
      'para:Apply by Friday.',
    ]);
  });
});

describe('extractBlocks — the junk that shares the container', () => {
  it('leaves the application form out of the description', () => {
    // The generic fallbacks ([class*="content"], main, article) routinely swallow
    // the form, and quoting the user's own field labels back at them is noise.
    const blocks = extractBlocks(root(`
      <p>Great role.</p>
      <form><label>Full name</label><input><button>Send</button></form>`));
    expect(shape(blocks)).toEqual(['para:Great role.']);
  });

  it('leaves nav, aside and footer out', () => {
    // quick-board.html's <aside> is a decoy "Apply on company website" sidebar —
    // it is not part of the posting and must not read as if it were.
    const blocks = extractBlocks(root(`
      <nav>Home Jobs</nav>
      <p>The posting.</p>
      <aside><h2>Similar jobs</h2><a href="#">Apply on company website</a></aside>
      <footer>© Acme</footer>`));
    expect(shape(blocks)).toEqual(['para:The posting.']);
  });

  it('leaves script and style content out', () => {
    const blocks = extractBlocks(root('<style>.a{color:red}</style><p>Text.</p><script>var x=1</script>'));
    expect(shape(blocks)).toEqual(['para:Text.']);
  });

  it('skips hidden elements', () => {
    const blocks = extractBlocks(root(`
      <p hidden>Hidden by attribute.</p>
      <p style="display:none">Hidden by style.</p>
      <p aria-hidden="true">Hidden from a11y.</p>
      <p>Visible.</p>`));
    expect(shape(blocks)).toEqual(['para:Visible.']);
  });
});

describe('extractBlocks — tidying', () => {
  it('drops empty and single-character blocks', () => {
    const blocks = extractBlocks(root('<p></p><p>·</p><p>Real text.</p>'));
    expect(shape(blocks)).toEqual(['para:Real text.']);
  });

  it('drops a block identical to the one before it', () => {
    const blocks = extractBlocks(root('<p>Apply now</p><p>Apply now</p><p>Then wait</p>'));
    expect(shape(blocks)).toEqual(['para:Apply now', 'para:Then wait']);
  });

  it('folds bullet-prefixed paragraphs into one list', () => {
    // Boards ship bullets as sibling <p>s constantly; six one-line paragraphs
    // read as a wall, the same six as a list read as a list.
    const blocks = extractBlocks(root(`
      <p>You will need:</p>
      <p>• Go or Rust</p>
      <p>- Kubernetes</p>
      <p>Sound good?</p>`));
    expect(shape(blocks)).toEqual([
      'para:You will need:',
      'list:Go or Rust|Kubernetes',
      'para:Sound good?',
    ]);
  });

  it('returns nothing for an empty container', () => {
    expect(extractBlocks(root(''))).toEqual([]);
  });

  it('stops on a pathologically large container', () => {
    const many = Array.from({ length: 800 }, (_, i) => `<p>Para ${i}</p>`).join('');
    expect(extractBlocks(root(many)).length).toBeLessThanOrEqual(400);
  });
});

describe('blocksToText', () => {
  it('renders one clean line per block, so a snippet is readable', () => {
    const text = blocksToText([
      { kind: 'heading', text: 'Requirements' },
      { kind: 'list', items: ['Go', 'Rust'] },
      { kind: 'para', text: 'Apply by Friday.' },
    ]);
    expect(text).toBe('Requirements\nGo\nRust\nApply by Friday.');
  });

  it('is empty for no blocks', () => {
    expect(blocksToText([])).toBe('');
  });
});
