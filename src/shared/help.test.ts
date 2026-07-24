import { describe, it, expect } from 'vitest';
import type { SiteConfig } from './types';
import {
  CONCEPT_HELP, CONFIG_HELP, DOT_LEGEND, PREP_HELP, REDIRECT_HELP, SETTINGS_HELP,
  SETUP_GROUP_HELP, describeConfig, type HelpEntry,
} from './help';

/** Every catalog, flattened, so the shape rules are asserted once for all of them. */
const ALL: Array<[string, HelpEntry]> = [
  ...Object.entries(CONFIG_HELP),
  ...Object.entries(REDIRECT_HELP),
  ...Object.entries(SETTINGS_HELP),
  ...Object.entries(PREP_HELP),
  ...Object.entries(SETUP_GROUP_HELP),
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

  it('documents every row of every setup group', () => {
    for (const [key, group] of Object.entries(SETUP_GROUP_HELP)) {
      for (const row of group.rows ?? []) {
        expect(row.label.trim(), `${key} row label`).not.toBe('');
        expect(row.body.trim(), `${key}.${row.label}`).not.toBe('');
      }
    }
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

  it('counts prep steps and says what the first one does', () => {
    const text = describeConfig({
      ...base,
      prep: [
        { action: 'click', selector: '#apply', optional: true },
        { action: 'delay', ms: 500 },
      ],
    });
    expect(text).toContain('#apply');
    expect(text).toMatch(/2 (setup )?steps?/i);
  });

  it('mentions the handoff when redirect selectors are configured', () => {
    const text = describeConfig({ ...base, redirect: { markerSelector: '.ext-badge' } });
    expect(text).toMatch(/employer|external/i);
    expect(text).toContain('.ext-badge');
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
