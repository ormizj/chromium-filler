import { describe, it, expect } from 'vitest';
import type { SiteConfig } from './types';
import {
  CONCEPT_HELP, CONFIG_HELP, DOT_LEGEND, PREP_HELP, REDIRECT_HELP, SETTINGS_HELP,
  SETUP_STEP_HELP, describeConfig, type HelpEntry,
} from './help';

/** Every catalog, flattened, so the shape rules are asserted once for all of them. */
const ALL: Array<[string, HelpEntry]> = [
  ...Object.entries(CONFIG_HELP),
  ...Object.entries(REDIRECT_HELP),
  ...Object.entries(SETTINGS_HELP),
  ...Object.entries(PREP_HELP),
  ...Object.entries(SETUP_STEP_HELP),
  ...Object.entries(CONCEPT_HELP),
];

describe('help catalog', () => {
  it('gives every entry a title and a body', () => {
    for (const [key, entry] of ALL) {
      expect(entry.title.trim(), key).not.toBe('');
      expect(entry.body.trim(), key).not.toBe('');
    }
  });

  // A body that only repeats its own title is a placeholder, not an explanation —
  // exactly the state this whole feature exists to fix.
  it('never restates the title as the body', () => {
    for (const [key, entry] of ALL) {
      expect(entry.body.trim().toLowerCase(), key).not.toBe(entry.title.trim().toLowerCase());
      expect(entry.body.trim().length, key).toBeGreaterThan(entry.title.trim().length);
    }
  });

  it('documents every row of every setup step', () => {
    for (const [key, group] of Object.entries(SETUP_STEP_HELP)) {
      for (const row of group.rows ?? []) {
        expect(row.label.trim(), `${key} row label`).not.toBe('');
        expect(row.body.trim(), `${key}.${row.label}`).not.toBe('');
      }
    }
  });

  /**
   * A row built from a catalog entry has to carry that entry's example with it.
   * The concrete selector is what the wizard is missing at the moment it matters
   * — you are on the step, about to press Pick — and it already exists one
   * surface away, on the Sites reference. Asserted through the entry rather than
   * against a literal, because a second copy of the string is the drift this
   * whole file exists to prevent.
   */
  it('carries the catalog example onto the row that quotes it', () => {
    const row = SETUP_STEP_HELP.kind.rows?.find((r) => r.label === 'Quick-apply marker');
    expect(row?.example).toBe(REDIRECT_HELP.quickApplySelector.example);
    expect(row?.example?.trim()).toBeTruthy();
  });

  /**
   * The legend is read at a glance, above the work itself. The first attempt
   * used the full bodies and filled an entire phone screen with prose before
   * the user could reach a single row.
   */
  it('gives the legend concepts a one-line form', () => {
    for (const key of ['dots', 'autoVsSaved', 'todoChip', 'picker'] as const) {
      const short = CONCEPT_HELP[key].short;
      expect(short, key).toBeTruthy();
      expect(short!.length, `${key} is too long for a legend line`).toBeLessThan(90);
    }
  });

  /**
   * `richText` renders backticks and nothing else — no bold, no italic. A
   * `*word*` therefore ships as two literal asterisks on the Sites reference,
   * the Help tab and every `?` that quotes the entry, and nothing else here
   * would fail: the shape rules above only ask that a body be non-empty.
   *
   * The backtick spans come out first, because several bodies legitimately
   * quote `*` as the URL-pattern glob. `example` is exempt for the same reason
   * from the other side — it is rendered as a whole `<code>`, never through
   * `richText`.
   */
  it('never uses an emphasis mark no surface can render', () => {
    const prose = (entry: HelpEntry): Array<[string, string]> => [
      ['body', entry.body],
      ...(entry.when ? [['when', entry.when] as [string, string]] : []),
      ...(entry.short ? [['short', entry.short] as [string, string]] : []),
    ];
    const outsideCode = (text: string) =>
      text.split('`').filter((_, i) => i % 2 === 0).join('');

    for (const [key, entry] of ALL) {
      for (const [field, text] of prose(entry)) {
        expect(outsideCode(text), `${key}.${field}`).not.toMatch(/[*_]/);
      }
    }
    for (const [key, group] of Object.entries(SETUP_STEP_HELP)) {
      for (const row of group.rows ?? []) {
        expect(outsideCode(row.body), `${key}.${row.label}`).not.toMatch(/[*_]/);
      }
    }
  });

  it('shows each dot colour rather than naming it', () => {
    expect(DOT_LEGEND.map((d) => d.status)).toEqual(['high', 'low', 'none']);
    for (const row of DOT_LEGEND) expect(row.label.trim()).not.toBe('');
  });

  it('covers the vocabulary the setup panel puts on screen', () => {
    // These are the strings a user sees with no explanation today.
    for (const key of ['dots', 'autoVsSaved', 'todoChip', 'picker', 'neverSubmits'] as const) {
      expect(CONCEPT_HELP[key]).toBeTruthy();
    }
  });

  /**
   * The review modal's Apply button is greyed out on any page where no Send
   * button could be found. Pressing it opens this entry — so it has to say what
   * Apply does AND how to point it at the right control, or the user is left
   * exactly where they started.
   */
  it('explains the greyed-out Apply button and how to enable it', () => {
    const entry = CONCEPT_HELP.apply;
    expect(entry).toBeTruthy();
    expect(entry.body).toMatch(/set up this site|send button/i);
    expect(entry.body).toMatch(/press|send/i);
  });
});

describe('describeConfig', () => {
  const base: SiteConfig = { id: 'acme', name: 'Acme', urlPatterns: ['*://acme.com/*'], extract: {} };

  it('names the pages the config applies to', () => {
    expect(describeConfig(base)).toContain('*://acme.com/*');
  });

  it('describes the wait, in seconds rather than milliseconds', () => {
    const text = describeConfig({ ...base, waitFor: 'form', waitTimeoutMs: 15000 });
    expect(text).toContain('form');
    expect(text).toContain('15s');
  });

  // "Page actions" is what the wizard's second step is called, so that is what
  // these are named here too — "setup step" collided with the wizard's own
  // numbered steps, which is two vocabularies wearing one word.
  it('counts page actions and says what the first one does', () => {
    const text = describeConfig({
      ...base,
      prep: [
        { action: 'click', selector: '#apply', optional: true },
        { action: 'delay', ms: 500 },
      ],
    });
    expect(text).toContain('#apply');
    expect(text).toMatch(/2 page actions/i);
    expect(text).not.toMatch(/setup steps?/i);
  });

  it('mentions the handoff when redirect selectors are configured', () => {
    const text = describeConfig({ ...base, redirect: { markerSelector: '.ext-badge' } });
    expect(text).toMatch(/employer|external/i);
    expect(text).toContain('.ext-badge');
  });

  /**
   * The board that mixes both kinds of posting is the normal shape, and it is
   * exactly the one this used to get wrong: the two branches were an `else if`,
   * so a config carrying both was described as handing off and the quick-apply
   * selector went unmentioned — naming the rule that loses and omitting the rule
   * that wins. Someone debugging the site would go looking in the wrong place.
   */
  it('never describes a quick-apply site as only handing off', () => {
    const text = describeConfig({
      ...base,
      redirect: { quickApplySelector: '.inline-form', applySelector: '.ext' },
    });
    expect(text).toContain('.inline-form');
    expect(text).toContain('.ext');
  });

  // Order is the claim: `detectRedirect` checks the quick-apply marker first and
  // returns there, so a sentence that reads the other way round is a lie about
  // precedence even when it names both selectors.
  it('states the two redirect rules in the order the detector applies them', () => {
    const text = describeConfig({
      ...base,
      redirect: { quickApplySelector: '.inline-form', markerSelector: '.ext-badge' },
    });
    expect(text.indexOf('.inline-form')).toBeLessThan(text.indexOf('.ext-badge'));
  });

  it('explains successSelector as the proof it was sent', () => {
    const text = describeConfig({ ...base, successSelector: '.thanks' });
    expect(text).toContain('.thanks');
    expect(text).toMatch(/sent|applied/i);
  });

  // A configured submitCv is the difference between a live button and a dead one
  // in the review modal, so the Sites summary must not stay silent about it.
  it('mentions the CV confirmation steps and what the first one does', () => {
    const text = describeConfig({
      ...base,
      submitCv: [{ action: 'click', selector: '#cv-attach' }],
    });
    expect(text).toContain('#cv-attach');
    expect(text).toMatch(/cv|résumé/i);
  });

  it('says overrides exist and how many', () => {
    const text = describeConfig({ ...base, fieldOverrides: { email: '#e', city: '#c' } });
    expect(text).toMatch(/2 field/i);
  });

  // The bare template a user gets from "Add template" must still read as a sentence.
  it('describes a minimal config without dangling punctuation', () => {
    const text = describeConfig(base);
    expect(text.trim()).not.toMatch(/[,;]$/);
    expect(text).toMatch(/\.$/);
  });
});
